/**
 * editorState.ts
 * @fileoverview Hex editor state management and undo/redo history
 * @description Manages file bytes, history stack, and editor cursor position
 */

import { analyzeJpeg, JpegLayout } from './jpegStructure';

export interface EditorState {
    bytes: Uint8Array | null;
    fileName: string | null;
    fileSize: number;
    layout: JpegLayout | null;
    activeOffset: number;
    history: Uint8Array[];
    historyIndex: number;
}

// ============================================================================================
/**
 * Create an empty state
 * @returns {EditorState} The empty state
 */
export function createEmptyState(): EditorState {
    return {
        bytes: null,
        fileName: null,
        fileSize: 0,
        layout: null,
        activeOffset: 0,
        history: [],
        historyIndex: -1
    };
}

// ============================================================================================
/**
 * Load a new photo into the state
 * @param {EditorState} state - The state to load the photo into
 * @param {ArrayBuffer} buffer - The buffer containing the photo data
 * @param {string | null} fileName - The name of the photo
 * @returns {void} The loaded photo
 */
export function loadNewFile(state: EditorState, buffer: ArrayBuffer, fileName: string | null): void {
    const nextBytes = new Uint8Array(buffer);
    pushSnapshot(state, nextBytes, fileName);
    state.activeOffset = 0;
}

// ============================================================================================
/**
 * Apply a byte-by-byte edit to the state
 * @param {EditorState} state - The state to apply the edit to
 * @param {function(Uint8Array): void} mutator - The mutator function to apply the edit
 * @returns {void} The edited state
 */
export function applyEdit(state: EditorState, mutator: (draft: Uint8Array) => void): void {
    if (!state.bytes) return;
    const draft = new Uint8Array(state.bytes);
    mutator(draft);
    pushSnapshot(state, draft, state.fileName);
}

// ============================================================================================
/**
 * Insert bytes at a specified offset pos into the state
 * @param {EditorState} state - The state to apply the insert to
 * @param {number} offset - The offset to insert the data at
 * @param {Uint8Array} insert - The data to insert
 * @returns {void} The inserted state
 */
export function applyInsert(state: EditorState, offset: number, insert: Uint8Array): void {
    if (!state.bytes || insert.length === 0) return;
    const src = state.bytes;
    const safeOffset = Math.max(0, Math.min(offset, src.length));
    const next = new Uint8Array(src.length + insert.length);
    next.set(src.subarray(0, safeOffset), 0);
    next.set(insert, safeOffset);
    next.set(src.subarray(safeOffset), safeOffset + insert.length);
    pushSnapshot(state, next, state.fileName);
    state.activeOffset = safeOffset;
}

// ============================================================================================
/**
 * Check if the state can be undone
 * @param {EditorState} state - The state to check
 * @returns {boolean} True if the state can be undone, false otherwise
 */
export function canUndo(state: EditorState): boolean {
    return state.historyIndex > 0;
}

// ============================================================================================
/**
 * Check if the state can be redone
 * @param {EditorState} state - The state to check
 * @returns {boolean} True if the state can be redone, false otherwise
 */
export function canRedo(state: EditorState): boolean {
    return state.historyIndex >= 0 && state.historyIndex < state.history.length - 1;
}

// ============================================================================================
/**
 * Undo the last editor action
 * @param {EditorState} state - The state to undo
 * @returns {boolean} True if the undo was successful, false otherwise
 */
export function undo(state: EditorState): boolean {
    if (!canUndo(state)) return false;
    state.historyIndex -= 1;
    restoreFromHistory(state);
    return true;
}

// ============================================================================================
/**
 * Redo the last editor action
 * @param {EditorState} state - The state to redo
 * @returns {boolean} True if the redo was successful, false otherwise
 */
export function redo(state: EditorState): boolean {
    if (!canRedo(state)) return false;
    state.historyIndex += 1;
    restoreFromHistory(state);
    return true;
}

// ============================================================================================
/**
 * Set the active offset
 * @param {EditorState} state - The state to set the active offset for
 * @param {number} offset - The offset to set
 * @returns {void} The set state
 */
export function setActiveOffset(state: EditorState, offset: number): void {
    if (!state.bytes || state.bytes.length === 0) {
        state.activeOffset = 0;
        return;
    }
    const max = state.bytes.length - 1;
    state.activeOffset = Math.max(0, Math.min(offset, max));
}

// ============================================================================================
/**
 * Push a snapshot of the state to the history
 * @param {EditorState} state - The state to push the snapshot to
 * @param {Uint8Array} bytes - The bytes to push
 * @param {string | null} fileName - The name of the file
 * @returns {void} The pushed state
 */
function pushSnapshot(state: EditorState, bytes: Uint8Array, fileName: string | null): void {
    const snapshot = new Uint8Array(bytes);
    state.bytes = snapshot;
    state.fileName = fileName;
    state.fileSize = snapshot.length;
    state.layout = analyzeJpeg(snapshot);

    if (state.historyIndex >= 0 && state.historyIndex < state.history.length - 1) {
        state.history = state.history.slice(0, state.historyIndex + 1);
    }

    state.history.push(new Uint8Array(snapshot));
    state.historyIndex = state.history.length - 1;

    if (state.activeOffset >= snapshot.length) {
        state.activeOffset = snapshot.length > 0 ? snapshot.length - 1 : 0;
    }
}

// ============================================================================================
/**
 * Restore the state from the history
 * @param {EditorState} state - The state to restore
 * @returns {void} The restored state
 */
function restoreFromHistory(state: EditorState): void {
    const current = state.history[state.historyIndex];
    state.bytes = new Uint8Array(current);
    state.fileSize = current.length;
    state.layout = analyzeJpeg(state.bytes);
    if (state.activeOffset >= state.fileSize) {
        state.activeOffset = state.fileSize > 0 ? state.fileSize - 1 : 0;
    }
}
