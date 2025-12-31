import { analyzeJpeg, JpegLayout } from './jpegStructure';

// ============================================================================================
/// <summary>
/// The state of the editor
/// </summary>
/// <param name="bytes">The bytes of the file</param>
/// <param name="fileName">The name of the file</param>
/// <param name="fileSize">The size of the file</param>
/// <param name="layout">The layout of the file</param>
/// <param name="activeOffset">The active offset</param>
/// <param name="history">The history of the file</param>
/// <param name="historyIndex">The index of the history</param>
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
/// <summary>
/// Create an empty state
/// </summary>
/// <returns>The empty state</returns>
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
/// <summary>
/// Load a new file into the state
/// </summary>
/// <param name="state">The state to load the file into</param>
/// <param name="buffer">The buffer containing the file data</param>
/// <param name="fileName">The name of the file</param>
/// <returns>The loaded file</returns>
export function loadNewFile(state: EditorState, buffer: ArrayBuffer, fileName: string | null): void {
    const nextBytes = new Uint8Array(buffer);
    pushSnapshot(state, nextBytes, fileName);
    state.activeOffset = 0;
}

// ============================================================================================
/// <summary>
/// Apply an edit to the state
/// </summary>
/// <param name="state">The state to apply the edit to</param>
/// <param name="mutator">The mutator function to apply the edit</param>
/// <returns>The edited state</returns>
export function applyEdit(state: EditorState, mutator: (draft: Uint8Array) => void): void {
    if (!state.bytes) return;
    const draft = new Uint8Array(state.bytes);
    mutator(draft);
    pushSnapshot(state, draft, state.fileName);
}

// ============================================================================================
/// <summary>
/// Apply an insert to the state
/// </summary>
/// <param name="state">The state to apply the insert to</param>
/// <param name="offset">The offset to insert the data at</param>
/// <param name="insert">The data to insert</param>
/// <returns>The inserted state</returns>
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
/// <summary>
/// Check if the state can be undone
/// </summary>
/// <param name="state">The state to check</param>
/// <returns>True if the state can be undone, false otherwise</returns>
export function canUndo(state: EditorState): boolean {
    return state.historyIndex > 0;
}

// ============================================================================================
/// <summary>
/// Check if the state can be redone
/// </summary>
/// <param name="state">The state to check</param>
/// <returns>True if the state can be redone, false otherwise</returns>
export function canRedo(state: EditorState): boolean {
    return state.historyIndex >= 0 && state.historyIndex < state.history.length - 1;
}

// ============================================================================================
/// <summary>
/// Undo the last action
/// </summary>
/// <param name="state">The state to undo</param>
/// <returns>True if the undo was successful, false otherwise</returns>
export function undo(state: EditorState): boolean {
    if (!canUndo(state)) return false;
    state.historyIndex -= 1;
    restoreFromHistory(state);
    return true;
}

// ============================================================================================
/// <summary>
/// Redo the last action
/// </summary>
/// <param name="state">The state to redo</param>
/// <returns>True if the redo was successful, false otherwise</returns>
export function redo(state: EditorState): boolean {
    if (!canRedo(state)) return false;
    state.historyIndex += 1;
    restoreFromHistory(state);
    return true;
}

// ============================================================================================
/// <summary>
/// Set the active offset
/// </summary>
/// <param name="state">The state to set the active offset for</param>
/// <param name="offset">The offset to set</param>
/// <returns>The set state</returns>
export function setActiveOffset(state: EditorState, offset: number): void {
    if (!state.bytes || state.bytes.length === 0) {
        state.activeOffset = 0;
        return;
    }
    const max = state.bytes.length - 1;
    state.activeOffset = Math.max(0, Math.min(offset, max));
}

// ============================================================================================
/// <summary>
/// Push a snapshot of the state to the history
/// </summary>
/// <param name="state">The state to push the snapshot to</param>
/// <param name="bytes">The bytes to push</param>
/// <param name="fileName">The name of the file</param>
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
/// <summary>
/// Restore the state from the history
/// </summary>
/// <param name="state">The state to restore</param>
/// <returns>The restored state</returns>
function restoreFromHistory(state: EditorState): void {
    const current = state.history[state.historyIndex];
    state.bytes = new Uint8Array(current);
    state.fileSize = current.length;
    state.layout = analyzeJpeg(state.bytes);
    if (state.activeOffset >= state.fileSize) {
        state.activeOffset = state.fileSize > 0 ? state.fileSize - 1 : 0;
    }
}
