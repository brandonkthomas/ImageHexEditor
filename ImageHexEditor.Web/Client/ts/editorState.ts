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

export function loadNewFile(state: EditorState, buffer: ArrayBuffer, fileName: string | null): void {
    const nextBytes = new Uint8Array(buffer);
    pushSnapshot(state, nextBytes, fileName);
    state.activeOffset = 0;
}

export function applyEdit(state: EditorState, mutator: (draft: Uint8Array) => void): void {
    if (!state.bytes) return;
    const draft = new Uint8Array(state.bytes);
    mutator(draft);
    pushSnapshot(state, draft, state.fileName);
}

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

export function canUndo(state: EditorState): boolean {
    return state.historyIndex > 0;
}

export function canRedo(state: EditorState): boolean {
    return state.historyIndex >= 0 && state.historyIndex < state.history.length - 1;
}

export function undo(state: EditorState): boolean {
    if (!canUndo(state)) return false;
    state.historyIndex -= 1;
    restoreFromHistory(state);
    return true;
}

export function redo(state: EditorState): boolean {
    if (!canRedo(state)) return false;
    state.historyIndex += 1;
    restoreFromHistory(state);
    return true;
}

export function setActiveOffset(state: EditorState, offset: number): void {
    if (!state.bytes || state.bytes.length === 0) {
        state.activeOffset = 0;
        return;
    }
    const max = state.bytes.length - 1;
    state.activeOffset = Math.max(0, Math.min(offset, max));
}

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

function restoreFromHistory(state: EditorState): void {
    const current = state.history[state.historyIndex];
    state.bytes = new Uint8Array(current);
    state.fileSize = current.length;
    state.layout = analyzeJpeg(state.bytes);
    if (state.activeOffset >= state.fileSize) {
        state.activeOffset = state.fileSize > 0 ? state.fileSize - 1 : 0;
    }
}




