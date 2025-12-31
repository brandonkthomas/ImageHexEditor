/**
 * jpegStructure.ts
 * @fileoverview JPEG byte classification and structure analysis
 * @description Identifies JPEG markers, regions, and provides hex/ASCII conversion
 */

export type ByteRegion =
    | 'unknown'
    | 'soi'
    | 'app'
    | 'dqt'
    | 'sof'
    | 'sof-width'
    | 'dht'
    | 'dri'
    | 'sos-header'
    | 'scan'
    | 'rst'
    | 'com'
    | 'eoi'
    | 'other';

enum RegionCode {
    Unknown = 0,
    Soi = 1,
    App = 2,
    Dqt = 3,
    Sof = 4,
    SofWidth = 5,
    Dht = 6,
    Dri = 7,
    SosHeader = 8,
    Scan = 9,
    Rst = 10,
    Com = 11,
    Eoi = 12,
    Other = 13
}

// ============================================================================================
/**
 * The layout of the JPEG
 * @param {number} length - The total number of bytes in the JPEG
 * @param {Uint8Array} regions - The per-byte region codes
 */
export interface JpegLayout {
    /** Total number of bytes in the JPEG. */
    length: number;
    /** Per-byte region codes (see RegionCode). */
    regions: Uint8Array;
}

// ============================================================================================
/**
 * Analyze a JPEG and classify each byte according to the high-level anatomy:
 * SOI, APPn, DQT, SOF (with width bytes), DHT, DRI, SOS header, scan data,
 * restart markers, COM, EOI, and "other".
 * @param {Uint8Array} bytes - The bytes of the JPEG
 * @returns {JpegLayout | null} The layout of the JPEG
 */
export function analyzeJpeg(bytes: Uint8Array): JpegLayout | null {
    const len = bytes.length;
    if (len < 4) return null;

    // Require a valid SOI marker; otherwise we bail and treat as unknown.
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) {
        return null;
    }

    const regions = new Uint8Array(len);

    markRange(regions, 0, 2, RegionCode.Soi);

    let pos = 2;

    while (pos < len - 1) {
        if (bytes[pos] !== 0xff) {
            // Non-marker data outside of scan regions – treat as generic header/other.
            if (regions[pos] === RegionCode.Unknown) {
                regions[pos] = RegionCode.Other;
            }
            pos++;
            continue;
        }

        if (pos + 1 >= len) break;
        const marker = bytes[pos + 1];
        const markerStart = pos;

        // EOI (FF D9) – mark and continue scanning; some files may contain
        // additional JPEG-like data (e.g., Adobe-style concatenated images).
        if (marker === 0xd9) {
            markRange(regions, markerStart, Math.min(markerStart + 2, len), RegionCode.Eoi);
            pos = markerStart + 2;
            continue;
        }

        // Additional SOI markers (FF D8) after the initial one – treat as the
        // start of another image region so jump-to and visualization can see it.
        if (marker === 0xd8) {
            markRange(regions, markerStart, Math.min(markerStart + 2, len), RegionCode.Soi);
            pos = markerStart + 2;
            continue;
        }

        // Restart markers (FF D0–D7) – two-byte markers with no length.
        if (marker >= 0xd0 && marker <= 0xd7) {
            markRange(regions, markerStart, Math.min(markerStart + 2, len), RegionCode.Rst);
            pos = markerStart + 2;
            continue;
        }

        // TEM marker (FF 01) – no length, rarely used; treat as "other".
        if (marker === 0x01) {
            markRange(regions, markerStart, Math.min(markerStart + 2, len), RegionCode.Other);
            pos = markerStart + 2;
            continue;
        }

        const seg = readSegment(bytes, markerStart);
        if (!seg) {
            // Truncated / malformed segment – stop classification to avoid overruns.
            break;
        }

        const { headerEnd, segmentEnd } = seg;

        if (marker >= 0xe0 && marker <= 0xef) {
            // APPn segments (FF E0 – FF EF)
            markRange(regions, markerStart, segmentEnd, RegionCode.App);
        } else if (marker === 0xdb) {
            // DQT (Define Quantization Table)
            markRange(regions, markerStart, segmentEnd, RegionCode.Dqt);
        } else if (isSofMarker(marker)) {
            // SOF (Start of Frame) – highlight width bytes specially.
            markRange(regions, markerStart, segmentEnd, RegionCode.Sof);

            const widthHigh = markerStart + 7;
            const widthLow = markerStart + 8;
            markByte(regions, widthHigh, RegionCode.SofWidth);
            markByte(regions, widthLow, RegionCode.SofWidth);
        } else if (marker === 0xc4) {
            // DHT (Define Huffman Table)
            markRange(regions, markerStart, segmentEnd, RegionCode.Dht);
        } else if (marker === 0xdd) {
            // DRI (Define Restart Interval)
            markRange(regions, markerStart, segmentEnd, RegionCode.Dri);
        } else if (marker === 0xda) {
            // SOS (Start of Scan) – highlight only the header as SOS, then mark
            // the subsequent entropy-coded data as "scan" until the next marker.
            markRange(regions, markerStart, headerEnd, RegionCode.SosHeader);
            pos = consumeScanData(bytes, regions, headerEnd);
            continue;
        } else if (marker === 0xfe) {
            // COM (Comment)
            markRange(regions, markerStart, segmentEnd, RegionCode.Com);
        } else {
            // Any other marker with a length – treat as generic "other" header.
            markRange(regions, markerStart, segmentEnd, RegionCode.Other);
        }

        pos = segmentEnd;
    }

    return {
        length: len,
        regions
    };
}

// ============================================================================================
/**
 * Classify a byte according to the layout of the JPEG
 * @param {number} offset - The offset of the byte
 * @param {JpegLayout | null} layout - The layout of the JPEG
 * @returns {ByteRegion} The region of the byte
 */
export function classifyByte(offset: number, layout: JpegLayout | null): ByteRegion {
    if (!layout || offset < 0 || offset >= layout.length) {
        return 'unknown';
    }

    return codeToRegion(layout.regions[offset]);
}

// ============================================================================================
/**
 * Read a segment from the JPEG
 * @param {Uint8Array} bytes - The bytes of the JPEG
 * @param {number} markerStart - The start of the marker
 * @returns {{ headerEnd: number; segmentEnd: number } | null} The segment
 */
function readSegment(bytes: Uint8Array, markerStart: number): { headerEnd: number; segmentEnd: number } | null {
    const len = bytes.length;
    if (markerStart + 3 >= len) return null;

    const segLen = (bytes[markerStart + 2] << 8) | bytes[markerStart + 3];
    if (segLen < 2) return null;

    const end = markerStart + 2 + segLen; // marker (2 bytes) + segment length
    if (end > len) return null;

    return { headerEnd: end, segmentEnd: end };
}

// ============================================================================================
/**
 * Check if a marker is a SOF marker
 * @param {number} marker - The marker to check
 * @returns {boolean} True if the marker is a SOF marker, false otherwise
 */
function isSofMarker(marker: number): boolean {
    // SOF0–SOF15 (FF C0 – FF CF) excluding:
    //  - FF C4 (DHT)
    //  - FF C8, FF CC (JPEG extensions we don't treat specially here)
    return (marker & 0xf0) === 0xc0 && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

// ============================================================================================
/**
 * Consume scan data from the JPEG
 * @param {Uint8Array} bytes - The bytes of the JPEG
 * @param {Uint8Array} regions - The regions of the JPEG
 * @param {number} start - The start of the scan data
 * @returns {number} The end of the scan data
 */
function consumeScanData(bytes: Uint8Array, regions: Uint8Array, start: number): number {
    const len = bytes.length;
    let i = start;

    while (i < len - 1) {
        const b = bytes[i];
        if (b !== 0xff) {
            regions[i] = RegionCode.Scan;
            i++;
            continue;
        }

        const next = bytes[i + 1];

        if (next === 0x00) {
            // Byte-stuffed 0xFF in the data stream (FF 00).
            regions[i] = RegionCode.Scan;
            regions[i + 1] = RegionCode.Scan;
            i += 2;
            continue;
        }

        if (next >= 0xd0 && next <= 0xd7) {
            // Restart marker inside scan data.
            markRange(regions, i, i + 2, RegionCode.Rst);
            i += 2;
            continue;
        }

        if (next === 0xff) {
            // Fill byte (FF FF ...). Treat the first FF as scan data and continue.
            regions[i] = RegionCode.Scan;
            i++;
            continue;
        }

        // Any other pattern FF xx marks the beginning of the next marker/segment.
        return i;
    }

    // Trailing bytes at the end of the file – treat as scan data.
    while (i < len) {
        regions[i] = RegionCode.Scan;
        i++;
    }

    return len;
}

// ============================================================================================
/**
 * Mark a range of bytes in the JPEG
 * @param {Uint8Array} regions - The regions of the JPEG
 * @param {number} start - The start of the range
 * @param {number} end - The end of the range
 * @param {RegionCode} code - The code to mark the range with
 */
function markRange(regions: Uint8Array, start: number, end: number, code: RegionCode): void {
    if (start < 0 || end > regions.length) return;
    const len = regions.length;
    const s = Math.max(0, start);
    const e = Math.min(end, len);
    for (let i = s; i < e; i++) {
        regions[i] = code;
    }
}

// ============================================================================================
/**
/// Mark a byte in the JPEG
 * @param {Uint8Array} regions - The regions of the JPEG
 * @param {number} index - The index of the byte
 * @param {RegionCode} code - The code to mark the byte with
 */
function markByte(regions: Uint8Array, index: number, code: RegionCode): void {
    if (index >= 0 && index < regions.length) {
        regions[index] = code;
    }
}

// ============================================================================================
/**
 * Convert a region code to a region name
 * @param {number} code - The code to convert
 * @returns {string} The region name
 */
function codeToRegion(code: number): ByteRegion {
    switch (code) {
        case RegionCode.Soi: return 'soi';
        case RegionCode.App: return 'app';
        case RegionCode.Dqt: return 'dqt';
        case RegionCode.Sof: return 'sof';
        case RegionCode.SofWidth: return 'sof-width';
        case RegionCode.Dht: return 'dht';
        case RegionCode.Dri: return 'dri';
        case RegionCode.SosHeader: return 'sos-header';
        case RegionCode.Scan: return 'scan';
        case RegionCode.Rst: return 'rst';
        case RegionCode.Com: return 'com';
        case RegionCode.Eoi: return 'eoi';
        case RegionCode.Other: return 'other';
        default: return 'unknown';
    }
}

// ============================================================================================
/**
 * Convert a byte to a hex string
 * @param {number} value - The byte to convert
 * @returns {string} The hex string
 */
export function byteToHex(value: number): string {
    return value.toString(16).padStart(2, '0').toUpperCase();
}

// ============================================================================================
/**
 * Convert an offset to a hex string
 * @param {number} offset - The offset to convert
 * @returns {string} The hex string
 */
export function offsetToHex(offset: number): string {
    return offset.toString(16).padStart(8, '0').toUpperCase();
}

// ============================================================================================
/**
 * Convert a byte to an ASCII string
 * @param {number} value - The byte to convert
 * @returns {string} The ASCII string
 */
export function byteToAscii(value: number): string {
    if (value >= 0x20 && value <= 0x7e) {
        const ch = String.fromCharCode(value);
        // Normalize whitespace-ish characters so the column stays readable.
        if (ch === '\t' || ch === '\r' || ch === '\n') return '·';
        return ch;
    }
    return '·';
}
