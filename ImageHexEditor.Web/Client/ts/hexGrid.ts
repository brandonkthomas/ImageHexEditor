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

    const BYTES_PER_ROW = 16;
    const VISIBLE_ROWS = 40; // number of rows to keep in DOM (virtualized window)
    let totalRows = 0;
    let firstVisibleRow = 0;
    let rowHeight = 0; // measured in pixels once we have a row

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

    function clampFirstVisibleRow(row: number): number {
        if (totalRows <= VISIBLE_ROWS) return 0;
        const maxStart = totalRows - VISIBLE_ROWS;
        if (row < 0) return 0;
        if (row > maxStart) return maxStart;
        return row;
    }

    function buildRow(row: number): HTMLDivElement {
        const rowStart = row * BYTES_PER_ROW;
        const totalLength = renderLength;

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

        for (let col = 0; col < BYTES_PER_ROW; col++) {
            const index = rowStart + col;
            if (index >= totalLength || !bytes) {
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
        return rowEl;
    }

    function ensureRowHeight(): void {
        if (rowHeight > 0 || !bytes || renderLength === 0) return;

        // Render a single row to measure its height.
        root.innerHTML = '';
        const sampleRow = buildRow(0);
        root.appendChild(sampleRow);
        const rect = sampleRow.getBoundingClientRect();
        rowHeight = rect.height || 18;
    }

    function renderWindow(): void {
        root.innerHTML = '';

        if (!bytes || renderLength === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = 'ix-row';
            placeholder.textContent = 'Drop a JPEG to inspect its bytes.';
            root.appendChild(placeholder);
            return;
        }

        ensureRowHeight();
        if (rowHeight <= 0) return;

        const fragment = document.createDocumentFragment();
        const totalHeight = totalRows * rowHeight;

        const startRow = clampFirstVisibleRow(firstVisibleRow);
        const endRow = Math.min(totalRows, startRow + VISIBLE_ROWS);

        const topSpacer = document.createElement('div');
        topSpacer.style.height = `${startRow * rowHeight}px`;
        fragment.appendChild(topSpacer);

        for (let row = startRow; row < endRow; row++) {
            fragment.appendChild(buildRow(row));
        }

        const renderedRows = endRow - startRow;
        const bottomSpacerHeight = Math.max(0, totalHeight - (startRow + renderedRows) * rowHeight);
        const bottomSpacer = document.createElement('div');
        bottomSpacer.style.height = `${bottomSpacerHeight}px`;
        fragment.appendChild(bottomSpacer);

        root.appendChild(fragment);
    }

    function ensureVisibleForActive(centerIntoView: boolean): void {
        if (!bytes || renderLength === 0 || totalRows === 0) {
            firstVisibleRow = 0;
            renderWindow();
            return;
        }

        const activeRow = Math.floor(activeOffset / BYTES_PER_ROW);

        let targetFirst = firstVisibleRow;
        if (centerIntoView) {
            const half = Math.floor(VISIBLE_ROWS / 2);
            targetFirst = clampFirstVisibleRow(activeRow - half);
        } else {
            if (activeRow < firstVisibleRow) {
                targetFirst = activeRow;
            } else if (activeRow >= firstVisibleRow + VISIBLE_ROWS) {
                targetFirst = activeRow - VISIBLE_ROWS + 1;
            }
            targetFirst = clampFirstVisibleRow(targetFirst);
        }

        firstVisibleRow = targetFirst;
        renderWindow();

        // Once rows are rendered and we know rowHeight, adjust scrollTop so
        // the active row is centered in the viewport.
        if (rowHeight > 0 && centerIntoView) {
            const desiredScrollTop = firstVisibleRow * rowHeight;
            root.scrollTop = desiredScrollTop;
        }
    }

    function resetDisplayForOffset(offset: number): void {
        if (!bytes || offset < 0 || offset >= renderLength) return;
        const value = bytes[offset];
        const el = root.querySelector<HTMLElement>(`.ix-byte[data-offset="${offset}"]`);
        const ascii = root.querySelector<HTMLElement>(`.ix-ascii-char[data-offset="${offset}"]`);
        if (el) el.textContent = byteToHex(value);
        if (ascii) ascii.textContent = byteToAscii(value);
    }

    function showPendingNibble(firstNibble: number): void {
        if (!bytes || renderLength === 0) return;
        const current = bytes[activeOffset];
        const el = root.querySelector<HTMLElement>(`.ix-byte[data-offset="${activeOffset}"]`);
        const ascii = root.querySelector<HTMLElement>(`.ix-ascii-char[data-offset="${activeOffset}"]`);
        if (el) {
            const high = firstNibble.toString(16).toUpperCase();
            el.textContent = `${high}_`;
        }
        if (ascii) {
            const temp = ((firstNibble << 4) | (current & 0x0f)) & 0xff;
            ascii.textContent = byteToAscii(temp);
        }
    }

    function moveCaret(delta: number): void {
        if (!bytes || renderLength === 0) return;
        const prevOffset = activeOffset;
        if (pendingNibble !== null) {
            resetDisplayForOffset(prevOffset);
            pendingNibble = null;
        }
        activeOffset = Math.max(0, Math.min(activeOffset + delta, renderLength - 1));
        ensureVisibleForActive(true);
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
            if (pendingNibble !== null) {
                resetDisplayForOffset(activeOffset);
                pendingNibble = null;
            }
            activeOffset = 0;
            ensureVisibleForActive(true);
            opts.onMoveCaret?.(activeOffset);
            return;
        }
        if (key === 'End') {
            ev.preventDefault();
            if (pendingNibble !== null) {
                resetDisplayForOffset(activeOffset);
                pendingNibble = null;
            }
            activeOffset = bytes.length - 1;
            ensureVisibleForActive(true);
            opts.onMoveCaret?.(activeOffset);
            return;
        }
        if (key === 'Backspace') {
            ev.preventDefault();
            if (pendingNibble !== null) {
                pendingNibble = null;
                renderWindow();
                return;
            }
            const value = 0x00;
            opts.onEditByte?.(activeOffset, value);
            return;
        }

        const hex = parseHexKey(key);
        if (hex != null) {
            ev.preventDefault();
            if (pendingNibble == null) {
                pendingNibble = hex;
                showPendingNibble(hex);
            } else {
                const nextValue = ((pendingNibble << 4) | hex) & 0xff;
                pendingNibble = null;
                opts.onEditByte?.(activeOffset, nextValue);
                // After fully specifying a byte, automatically advance to the next one.
                moveCaret(1);
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
        if (pendingNibble !== null) {
            resetDisplayForOffset(activeOffset);
            pendingNibble = null;
        }
        activeOffset = parsed;
        ensureVisibleForActive(false);
        root.focus();
        opts.onMoveCaret?.(activeOffset);
    });

    root.addEventListener('scroll', () => {
        if (!bytes || renderLength === 0 || rowHeight <= 0 || totalRows === 0) return;
        const approxRow = Math.floor(root.scrollTop / rowHeight);
        const nextFirst = clampFirstVisibleRow(approxRow);
        if (nextFirst === firstVisibleRow) return;
        firstVisibleRow = nextFirst;
        renderWindow();
    });

    return {
        setData(nextBytes, nextLayout, nextActiveOffset) {
            bytes = nextBytes;
            layout = nextLayout;
            renderLength = bytes ? bytes.length : 0;
            totalRows = bytes ? Math.ceil(renderLength / BYTES_PER_ROW) : 0;
            const clampedOffset = Math.max(0, Math.min(nextActiveOffset, Math.max(0, renderLength - 1)));
            activeOffset = clampedOffset;
            ensureActiveOffset();
            pendingNibble = null;

            if (!bytes || renderLength === 0) {
                firstVisibleRow = 0;
                renderWindow();
                return;
            }

            if (rowHeight > 0) {
                const approxFromScroll = Math.floor(root.scrollTop / rowHeight);
                firstVisibleRow = clampFirstVisibleRow(approxFromScroll);
            } else {
                const activeRow = Math.floor(clampedOffset / BYTES_PER_ROW);
                firstVisibleRow = clampFirstVisibleRow(activeRow);
            }

            renderWindow();
        },

        setActiveOffset(offset, centerIntoView = false) {
            activeOffset = offset;
            ensureActiveOffset();
            ensureVisibleForActive(centerIntoView);
        },

        getActiveOffset() {
            return activeOffset;
        }
    };
}




