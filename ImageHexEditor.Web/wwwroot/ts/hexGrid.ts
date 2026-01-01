/**
 * hexGrid.ts
 * @fileoverview Interactive hex grid UI for JPEG byte editing with virtual scrolling.
 * Renders hex bytes in a grid layout with region-based coloring, caret navigation, 
 * and two-stage nibble editing. Includes virtualized rendering for performance and 
 * ASCII column display. Supports keyboard navigation, click selection, and scroll synchronization.
 */

import { ByteRegion, byteToAscii, byteToHex, classifyByte, JpegLayout, offsetToHex } from './jpegStructure';

// ============================================================================================
/**
 * The hex grid options
 * @param {function(number, number): void} onEditByte - The callback to edit a byte
 * @param {function(number): void} onMoveCaret - The callback to move the caret
 * @param {function(): boolean} isAutoAdvanceEnabled - Optional callback to determine whether the caret should auto-advance after completing a byte edit. Defaults to true when omitted.
 */
export interface HexGridOptions {
    onEditByte?: (offset: number, nextValue: number) => void;
    onMoveCaret?: (offset: number) => void;
    isAutoAdvanceEnabled?: () => boolean;
}

// ============================================================================================
/**
 * The hex grid interface
 * @param {function(Uint8Array | null, JpegLayout | null, number): void} setData - Set the data for the grid
 * @param {function(number, boolean): void} setActiveOffset - Set the active offset for the grid
 * @param {function(): number} getActiveOffset - Get the active offset for the grid
 */
export interface HexGrid {
    setData(bytes: Uint8Array | null, layout: JpegLayout | null, activeOffset: number): void;
    setActiveOffset(offset: number, centerIntoView?: boolean): void;
    getActiveOffset(): number;
}

// ============================================================================================
/**
 * Create a new hex grid
 * @param {HTMLElement} root - The root element to mount the grid into
 * @param {HexGridOptions} opts - The options for the grid
 * @returns {HexGrid} The created hex grid
 */
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

    // ============================================================================================
    /**
     * Ensure the active offset is within valid bounds [0, renderLength).
     * Clamps the offset if it falls outside this range.
     */
    function ensureActiveOffset(): void {
        if (!bytes || renderLength === 0) {
            activeOffset = 0;
            return;
        }
        if (activeOffset < 0) activeOffset = 0;
        if (activeOffset >= renderLength) activeOffset = renderLength - 1;
    }

    // ============================================================================================
    /**
     * Map a ByteRegion to its corresponding CSS class name for styling.
     * Used to visually distinguish different JPEG structural sections (SOI, DQT, SOS, etc).
     * @param {ByteRegion} region - The byte region classification
     * @returns {string} CSS class name for the region, or empty string if unrecognized
     */
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

    // ============================================================================================
    /**
     * Clamp a row index to the valid visible window range.
     * Ensures firstVisibleRow stays within [0, totalRows - VISIBLE_ROWS] to prevent over-scrolling.
     * @param {number} row - The requested row index
     * @returns {number} The clamped row index
     */
    function clampFirstVisibleRow(row: number): number {
        if (totalRows <= VISIBLE_ROWS) return 0;
        const maxStart = totalRows - VISIBLE_ROWS;
        if (row < 0) return 0;
        if (row > maxStart) return maxStart;
        return row;
    }

    // ============================================================================================
    /**
     * Build a single row of the hex grid with hex bytes, ASCII column, and region-based coloring.
     * Creates DOM elements for offset label, byte hex values, and corresponding ASCII characters.
     * Marks bytes as placeholders if they fall beyond the file length.
     * @param {number} row - The row index to build
     * @returns {HTMLDivElement} The constructed row element
     */
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

    // ============================================================================================
    /**
     * Ensure row height is measured and cached.
     * Renders a sample row, measures its height, then clears it to avoid side effects.
     * Called once before rendering the virtualized window to enable row-to-pixel calculations.
     */
    function ensureRowHeight(): void {
        if (rowHeight > 0 || !bytes || renderLength === 0) return;

        // Render a single row to measure its height.
        root.innerHTML = '';
        const sampleRow = buildRow(0);
        root.appendChild(sampleRow);
        const rect = sampleRow.getBoundingClientRect();
        rowHeight = rect.height || 18;
        
        // Clear the sample row after measuring to prevent it from being visible
        root.innerHTML = '';
    }

    // ============================================================================================
    /**
     * Render the visible window of rows using virtualization.
     * Uses spacer divs to represent out-of-view rows and only renders visible rows in the DOM.
     * Displays a placeholder message if no data is loaded.
     */
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

    // ============================================================================================
    /**
     * Ensure the active offset is visible within the viewport and re-render if needed.
     * Optionally centers the active row or keeps it within the virtualized window.
     * Adjusts scrollTop to match the viewport when centering is requested.
     * @param {boolean} centerIntoView - Whether to center the active row or just keep it visible
     */
    function ensureVisibleForActive(centerIntoView: boolean): void {
        if (!bytes || renderLength === 0 || totalRows === 0) {
            firstVisibleRow = 0;
            renderWindow();
            return;
        }

        // Ensure we know the row height so we can relate scrollTop to a row index.
        ensureRowHeight();

        const activeRow = Math.floor(activeOffset / BYTES_PER_ROW);

        // If we can approximate the viewport and the active row is already visible,
        // avoid changing scroll position – just refresh the window so highlighting
        // stays in sync.
        if (rowHeight > 0 && root.clientHeight > 0) {
            const approxTopRow = Math.floor(root.scrollTop / rowHeight);
            const visibleRowCount = Math.max(1, Math.round(root.clientHeight / rowHeight));
            const approxBottomRow = approxTopRow + visibleRowCount - 1;

            if (activeRow >= approxTopRow && activeRow <= approxBottomRow) {
                firstVisibleRow = clampFirstVisibleRow(approxTopRow);
                renderWindow();
                return;
            }
        }

        let targetFirst = firstVisibleRow;
        if (centerIntoView) {
            // Try to center within the actual viewport when possible; otherwise
            // fall back to the virtual window height.
            if (rowHeight > 0 && root.clientHeight > 0) {
                const visibleRowCount = Math.max(1, Math.round(root.clientHeight / rowHeight));
                const half = Math.floor(visibleRowCount / 2);
                targetFirst = clampFirstVisibleRow(activeRow - half);
            } else {
                const half = Math.floor(VISIBLE_ROWS / 2);
                targetFirst = clampFirstVisibleRow(activeRow - half);
            }
        } else {
            // Keep the active row within the virtual window without forcing
            // a full recenter.
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
        // the active row is centered in the viewport when requested.
        if (rowHeight > 0 && centerIntoView) {
            const desiredScrollTop = firstVisibleRow * rowHeight;
            root.scrollTop = desiredScrollTop;
        }
    }

    // ============================================================================================
    /**
     * Reset and re-display the byte content at a specific offset.
     * Updates both the hex display and the ASCII column after an edit.
     * @param {number} offset - The byte offset to update
     */
    function resetDisplayForOffset(offset: number): void {
        if (!bytes || offset < 0 || offset >= renderLength) return;
        const value = bytes[offset];
        const el = root.querySelector<HTMLElement>(`.ix-byte[data-offset="${offset}"]`);
        const ascii = root.querySelector<HTMLElement>(`.ix-ascii-char[data-offset="${offset}"]`);
        if (el) el.textContent = byteToHex(value);
        if (ascii) ascii.textContent = byteToAscii(value);
    }

    // ============================================================================================
    /**
     * Display a pending first nibble in the active byte cell with underscore suffix.
     * Shows a preview of the ASCII character that would result from the complete byte.
     * @param {number} firstNibble - The hex digit (0-15) entered as the first nibble
     */
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

    // ============================================================================================
    /**
     * Move the caret by a delta offset and trigger the onMoveCaret callback.
     * Clamps the new offset to valid bounds and ensures it's visible in the viewport.
     * Cancels any pending nibble input before moving.
     * @param {number} delta - The signed offset delta (e.g., -1 for left, +16 for down)
     */
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

    // ============================================================================================
    /**
     * Determine whether auto-advance should occur after completing a byte edit.
     * Calls the isAutoAdvanceEnabled callback if provided; falls back to true if it throws.
     * @returns {boolean} Whether to advance the caret after an edit
     */
    function isAutoAdvanceOnEdit(): boolean {
        if (typeof opts.isAutoAdvanceEnabled === 'function') {
            try {
                return !!opts.isAutoAdvanceEnabled();
            } catch {
                // If the callback throws for any reason, fall back to the
                // default auto-advance behavior so the editor remains usable.
                return true;
            }
        }
        return true;
    }

    // ============================================================================================
    /**
     * Handle keyboard input for navigation and byte editing.
     * 
     * - Arrow keys move the caret, hex digits enter nibbles, Backspace clears to 0x00.
     * - Home/End jump to bounds
     * - Page Up/Down move by page (pending nibble input is shown visually)
     * - Alt/Option + ArrowUp/ArrowDown increments/decrements the current byte value by 1 
     *   without moving the caret
     *
     * @param {KeyboardEvent} ev - The keyboard event
     */
    function handleKeyDown(ev: KeyboardEvent): void {
        if (!bytes || bytes.length === 0) return;

        const key = ev.key;

        // Alt/Option + Up/Down: increment/decrement the current byte value by 1.
        if ((key === 'ArrowUp' || key === 'ArrowDown') && ev.altKey) {
            ev.preventDefault();
            if (pendingNibble !== null) {
                resetDisplayForOffset(activeOffset);
                pendingNibble = null;
            }
            const current = bytes[activeOffset];
            const delta = key === 'ArrowUp' ? 1 : -1;
            const nextValue = (current + delta) & 0xff;
            opts.onEditByte?.(activeOffset, nextValue);
            return;
        }

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
                // After fully specifying a byte, optionally advance to the next one.
                if (isAutoAdvanceOnEdit()) {
                    moveCaret(1);
                }
            }
        }
    }

    // ============================================================================================
    /**
     * Parse a keyboard key into a hexadecimal digit value.
     * Accepts '0'-'9' and 'a'-'f' (case-insensitive).
     * @param {string} key - The key string from a KeyboardEvent
     * @returns {number | null} The hex value (0-15) or null if not a hex digit
     */
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
