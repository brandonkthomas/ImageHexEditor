import { ByteRegion, byteToAscii, byteToHex, classifyByte, JpegLayout, offsetToHex } from './jpegStructure';

export interface HexGridOptions {
    onEditByte?: (offset: number, nextValue: number) => void;
    onMoveCaret?: (offset: number) => void;
}

export interface HexGrid {
    setData(bytes: Uint8Array | null, layout: JpegLayout | null, activeOffset: number): void;
    setActiveOffset(offset: number, centerIntoView?: boolean): void;
    getActiveOffset(): number;
}

export function createHexGrid(root: HTMLElement, opts: HexGridOptions): HexGrid {
    root.classList.add('ix-grid-body');
    root.tabIndex = 0;

    let bytes: Uint8Array | null = null;
    let layout: JpegLayout | null = null;
    let activeOffset = 0;
    let pendingNibble: number | null = null;
    let renderLength = 0; // how many bytes we actually draw (full file)
    let renderToken = 0; // increments to cancel in-flight renders

    function ensureActiveOffset(): void {
        if (!bytes || renderLength === 0) {
            activeOffset = 0;
            return;
        }
        if (activeOffset < 0) activeOffset = 0;
        if (activeOffset >= renderLength) activeOffset = renderLength - 1;
    }

    function regionClass(region: ByteRegion): string {
        switch (region) {
            case 'soi': return 'ix-byte--soi';
            case 'app': return 'ix-byte--app';
            case 'dqt': return 'ix-byte--dqt';
            case 'sof': return 'ix-byte--sof';
            case 'sof-width': return 'ix-byte--sof-width';
            case 'dht': return 'ix-byte--dht';
            case 'dri': return 'ix-byte--dri';
            case 'sos-header': return 'ix-byte--sos';
            case 'scan': return 'ix-byte--scan';
            case 'rst': return 'ix-byte--rst';
            case 'com': return 'ix-byte--com';
            case 'eoi': return 'ix-byte--eoi';
            case 'other': return 'ix-byte--other';
            default: return '';
        }
    }

    function startRender(): void {
        renderToken++;
        const token = renderToken;

        root.innerHTML = '';

        if (!bytes || renderLength === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = 'ix-row';
            placeholder.textContent = 'Drop a JPEG to inspect its bytes.';
            root.appendChild(placeholder);
            return;
        }

        const totalLength = renderLength;
        const bytesPerRow = 16;
        const totalRows = Math.ceil(totalLength / bytesPerRow);
        const rowsPerFrame = 64;

        const renderBatch = (startRow: number) => {
            if (token !== renderToken) return; // cancelled

            const frag = document.createDocumentFragment();
            const endRow = Math.min(totalRows, startRow + rowsPerFrame);

            for (let row = startRow; row < endRow; row++) {
                const rowStart = row * bytesPerRow;
                const rowEl = document.createElement('div');
                rowEl.className = 'ix-row';

                const offsetEl = document.createElement('div');
                offsetEl.className = 'ix-row-offset';
                offsetEl.textContent = offsetToHex(rowStart);
                rowEl.appendChild(offsetEl);

                const bytesEl = document.createElement('div');
                bytesEl.className = 'ix-row-bytes';

                const asciiEl = document.createElement('div');
                asciiEl.className = 'ix-row-ascii';

                for (let col = 0; col < bytesPerRow; col++) {
                    const index = rowStart + col;
                    if (index >= totalLength) {
                        const placeholderByte = document.createElement('div');
                        placeholderByte.className = 'ix-byte ix-byte-placeholder';
                        placeholderByte.textContent = '--';
                        bytesEl.appendChild(placeholderByte);

                        const placeholderAscii = document.createElement('div');
                        placeholderAscii.className = 'ix-ascii-char ix-ascii-char-muted';
                        placeholderAscii.textContent = '·';
                        asciiEl.appendChild(placeholderAscii);
                        continue;
                    }

                    const value = bytes[index];
                    const region = classifyByte(index, layout);

                    const byteSpan = document.createElement('div');
                    const regionCss = regionClass(region);
                    byteSpan.className = regionCss ? `ix-byte ${regionCss}` : 'ix-byte';
                    byteSpan.textContent = byteToHex(value);
                    byteSpan.dataset.offset = String(index);
                    byteSpan.dataset.region = region;

                    if (index === activeOffset) {
                        byteSpan.classList.add('ix-byte--active');
                    }

                    const asciiSpan = document.createElement('div');
                    asciiSpan.className = 'ix-ascii-char';
                    asciiSpan.textContent = byteToAscii(value);
                    asciiSpan.dataset.offset = String(index);

                    // Dim ASCII for non-scan metadata so the scan data "soup" stands out.
                    if (region !== 'scan') {
                        asciiSpan.classList.add('ix-ascii-char-muted');
                    }

                    bytesEl.appendChild(byteSpan);
                    asciiEl.appendChild(asciiSpan);
                }

                rowEl.appendChild(bytesEl);
                rowEl.appendChild(asciiEl);
                frag.appendChild(rowEl);
            }

            root.appendChild(frag);

            if (endRow < totalRows) {
                window.requestAnimationFrame(() => renderBatch(endRow));
            } else {
                updateActiveClass(false);
            }
        };

        window.requestAnimationFrame(() => renderBatch(0));
    }

    function updateActiveClass(centerIntoView: boolean): void {
        if (!bytes || renderLength === 0) return;
        const current = root.querySelector<HTMLElement>('.ix-byte--active');
        if (current) current.classList.remove('ix-byte--active');

        const next = root.querySelector<HTMLElement>(`.ix-byte[data-offset="${activeOffset}"]`);
        if (next) {
            next.classList.add('ix-byte--active');
            if (centerIntoView) {
                next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        }
    }

    function moveCaret(delta: number): void {
        if (!bytes || renderLength === 0) return;
        activeOffset = Math.max(0, Math.min(activeOffset + delta, renderLength - 1));
        pendingNibble = null;
        updateActiveClass(true);
        opts.onMoveCaret?.(activeOffset);
    }

    function handleKeyDown(ev: KeyboardEvent): void {
        if (!bytes || bytes.length === 0) return;

        const key = ev.key;

        if (key === 'ArrowLeft') {
            ev.preventDefault();
            moveCaret(-1);
            return;
        }
        if (key === 'ArrowRight') {
            ev.preventDefault();
            moveCaret(1);
            return;
        }
        if (key === 'ArrowUp') {
            ev.preventDefault();
            moveCaret(-16);
            return;
        }
        if (key === 'ArrowDown') {
            ev.preventDefault();
            moveCaret(16);
            return;
        }
        if (key === 'PageUp') {
            ev.preventDefault();
            moveCaret(-16 * 8);
            return;
        }
        if (key === 'PageDown') {
            ev.preventDefault();
            moveCaret(16 * 8);
            return;
        }
        if (key === 'Home') {
            ev.preventDefault();
            activeOffset = 0;
            pendingNibble = null;
            updateActiveClass(true);
            opts.onMoveCaret?.(activeOffset);
            return;
        }
        if (key === 'End') {
            ev.preventDefault();
            activeOffset = bytes.length - 1;
            pendingNibble = null;
            updateActiveClass(true);
            opts.onMoveCaret?.(activeOffset);
            return;
        }
        if (key === 'Backspace') {
            ev.preventDefault();
            if (pendingNibble !== null) {
                pendingNibble = null;
                startRender();
                return;
            }
            const value = 0x00;
            opts.onEditByte?.(activeOffset, value);
            return;
        }

        const hex = parseHexKey(key);
        if (hex != null) {
            ev.preventDefault();
            const current = bytes[activeOffset];
            if (pendingNibble == null) {
                pendingNibble = hex;
                const temp = ((hex << 4) | (current & 0x0f)) & 0xff;
                applyTemporaryDisplay(temp);
            } else {
                const nextValue = ((pendingNibble << 4) | hex) & 0xff;
                pendingNibble = null;
                opts.onEditByte?.(activeOffset, nextValue);
            }
        }
    }

    function parseHexKey(key: string): number | null {
        if (key.length !== 1) return null;
        if (key >= '0' && key <= '9') return key.charCodeAt(0) - 48;
        const lower = key.toLowerCase();
        if (lower >= 'a' && lower <= 'f') return 10 + (lower.charCodeAt(0) - 97);
        return null;
    }

    function applyTemporaryDisplay(tempValue: number): void {
        const el = root.querySelector<HTMLElement>(`.ix-byte[data-offset="${activeOffset}"]`);
        const ascii = root.querySelector<HTMLElement>(`.ix-ascii-char[data-offset="${activeOffset}"]`);
        if (el) el.textContent = byteToHex(tempValue);
        if (ascii) ascii.textContent = byteToAscii(tempValue);
    }

    root.addEventListener('keydown', handleKeyDown);

    root.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement | null;
        if (!target) return;
        const byteEl = target.closest<HTMLElement>('.ix-byte');
        if (!byteEl || !bytes) return;
        const rawOffset = byteEl.dataset.offset;
        if (!rawOffset) return;
        const parsed = Number.parseInt(rawOffset, 10);
        if (Number.isNaN(parsed)) return;
        activeOffset = parsed;
        pendingNibble = null;
        updateActiveClass(false);
        root.focus();
        opts.onMoveCaret?.(activeOffset);
    });

    return {
        setData(nextBytes, nextLayout, nextActiveOffset) {
            bytes = nextBytes;
            layout = nextLayout;
            renderLength = bytes ? bytes.length : 0;
            activeOffset = nextActiveOffset;
            ensureActiveOffset();
            pendingNibble = null;
            startRender();
        },

        setActiveOffset(offset, centerIntoView = false) {
            activeOffset = offset;
            ensureActiveOffset();
            updateActiveClass(centerIntoView);
        },

        getActiveOffset() {
            return activeOffset;
        }
    };
}




