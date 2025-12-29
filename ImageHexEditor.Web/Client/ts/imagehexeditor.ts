import { createEmptyState, applyEdit, applyInsert, canRedo, canUndo, loadNewFile, redo, setActiveOffset, undo } from './editorState';
import { createHexGrid } from './hexGrid';

// To avoid excessive memory / CPU usage, cap the file size we actively keep and render.
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB
import { byteToHex } from './jpegStructure';

function initImageHexEditor() {
    console.info('[ImageHexEditor] init');

    const gridEl = document.getElementById('ix-grid') as HTMLElement | null;
    const mainEl = document.getElementById('ix-main') as HTMLElement | null;
    const toolbarEl = document.getElementById('ix-toolbar') as HTMLElement | null;
    const dropzone = document.getElementById('ix-dropzone') as HTMLElement | null;
    const fileInput = document.getElementById('ix-file-input') as HTMLInputElement | null;
    const undoBtn = document.getElementById('ix-undo-btn') as HTMLButtonElement | null;
    const redoBtn = document.getElementById('ix-redo-btn') as HTMLButtonElement | null;
    const findBtn = document.getElementById('ix-find-btn') as HTMLButtonElement | null;
    const insertBtn = document.getElementById('ix-insert-btn') as HTMLButtonElement | null;
    const statusEl = document.getElementById('ix-status') as HTMLElement | null;
    const editorStatusEl = document.getElementById('ix-editor-status') as HTMLElement | null;
    const previewImg = document.getElementById('ix-preview-image') as HTMLImageElement | null;
    const metaFilename = document.getElementById('ix-meta-filename') as HTMLElement | null;
    const metaSize = document.getElementById('ix-meta-size') as HTMLElement | null;
    const metaDimensions = document.getElementById('ix-meta-dimensions') as HTMLElement | null;
    const downloadBtn = document.getElementById('ix-download-btn') as HTMLButtonElement | null;

    if (!gridEl || !mainEl || !toolbarEl || !dropzone || !fileInput || !undoBtn || !redoBtn || !findBtn || !insertBtn || !statusEl || !editorStatusEl || !previewImg || !metaFilename || !metaSize || !metaDimensions || !downloadBtn) {
        console.error('[ImageHexEditor] Missing required DOM elements, aborting init.');
        return;
    }

    const state = createEmptyState();
    const grid = createHexGrid(gridEl, {
        onEditByte(offset, value) {
            applyEdit(state, (draft) => {
                draft[offset] = value & 0xff;
            });
            syncView();
            setEditorStatus(`Edited byte at 0x${byteToHex(offset & 0xff)} (offset ${offset}).`);
        },
        onMoveCaret(offset) {
            setActiveOffset(state, offset);
            syncToolbar();
            syncStatusForCaret();
        }
    });

    let previewUrl: string | null = null;
    let previewScheduled = false;

    function humanSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} bytes`;
        const kb = bytes / 1024;
        if (kb < 1024) return `${kb.toFixed(1)} KB`;
        const mb = kb / 1024;
        return `${mb.toFixed(2)} MB`;
    }

    function setStatus(message: string): void {
        console.info('[ImageHexEditor] Status:', message);
        statusEl!.textContent = message;
    }

    function setEditorStatus(message: string): void {
        editorStatusEl!.textContent = message;
    }

    function syncToolbar(): void {
        const hasBytes = !!state.bytes && state.bytes.length > 0;
        undoBtn!.disabled = !hasBytes || !canUndo(state);
        redoBtn!.disabled = !hasBytes || !canRedo(state);
        findBtn!.disabled = !hasBytes;
        insertBtn!.disabled = !hasBytes;
        downloadBtn!.disabled = !hasBytes;
    }

    function syncMeta(): void {
        metaFilename!.textContent = state.fileName ?? '—';
        if (!state.bytes) {
            metaSize!.textContent = '—';
            return;
        }

        const total = state.bytes.length;
        const base = humanSize(total);
        metaSize!.textContent = base;
    }

    function syncStatusForCaret(): void {
        if (!state.bytes || state.bytes.length === 0) {
            setEditorStatus('Drop a JPEG to begin.');
            return;
        }
        const offset = state.activeOffset;
        const value = state.bytes[offset];
        setEditorStatus(`Offset 0x${offset.toString(16).padStart(6, '0').toUpperCase()} = 0x${value.toString(16).padStart(2, '0').toUpperCase()}`);
    }

    function schedulePreviewUpdate(): void {
        if (previewScheduled) return;
        previewScheduled = true;
        window.setTimeout(() => {
            previewScheduled = false;
            try {
                updatePreview();
            } catch (err) {
                console.error('[ImageHexEditor] Failed to update preview', err);
                setStatus('Failed to update preview.');
            }
        }, 150);
    }

    function updatePreview(): void {
        if (!state.bytes || state.bytes.length === 0) {
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl);
                previewUrl = null;
            }
            previewImg!.removeAttribute('src');
            metaDimensions!.textContent = '—';
            return;
        }

        const blob = new Blob([state.bytes], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);

        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }
        previewUrl = url;
        previewImg!.src = url;
    }

    previewImg!.addEventListener('load', () => {
        if (previewImg!.naturalWidth && previewImg!.naturalHeight) {
            metaDimensions!.textContent = `${previewImg!.naturalWidth} × ${previewImg!.naturalHeight}`;
        } else {
            metaDimensions!.textContent = 'Unknown';
        }
    });

    previewImg!.addEventListener('error', () => {
        metaDimensions!.textContent = 'Unreadable / corrupt JPEG';
    });

    function syncView(): void {
        grid.setData(state.bytes, state.layout, state.activeOffset);
        syncToolbar();
        syncMeta();
        syncStatusForCaret();
        const hasBytes = !!state.bytes && state.bytes.length > 0;
        mainEl!.hidden = !hasBytes;
        toolbarEl!.hidden = !hasBytes;
        schedulePreviewUpdate();
    }

    function handleFile(file: File): void {
        if (!file) return;
        if (!file.type || !file.type.startsWith('image/')) {
            setStatus('Please choose an image file (preferably JPEG).');
            return;
        }

        if (file.size > MAX_FILE_BYTES) {
            const msg = `File is too large for the in-browser editor (${humanSize(file.size)}). Max supported is ${humanSize(MAX_FILE_BYTES)}.`;
            console.warn('[ImageHexEditor] File too large', { name: file.name, size: file.size });
            setStatus(msg);
            return;
        }

        console.info('[ImageHexEditor] handleFile', { name: file.name, size: file.size, type: file.type });

        const reader = new FileReader();
        reader.onerror = (ev) => {
            console.error('[ImageHexEditor] FileReader error', ev);
            setStatus('Failed to read file.');
        };
        reader.onloadstart = () => {
            console.info('[ImageHexEditor] FileReader loadstart');
            setStatus('Reading file in browser…');
        };
        reader.onloadend = () => {
            console.info('[ImageHexEditor] FileReader loadend');
        };
        reader.onload = () => {
            const result = reader.result;
            if (!(result instanceof ArrayBuffer)) {
                setStatus('Unexpected file reader result.');
                return;
            }
            loadNewFile(state, result, file.name);
            console.info('[ImageHexEditor] File loaded into state', {
                byteLength: state.bytes?.length ?? 0,
                layout: state.layout
            });
            syncView();
        };
        reader.readAsArrayBuffer(file);
    }

    function handleFiles(files: FileList | null): void {
        if (!files || files.length === 0) return;
        handleFile(files[0]);
    }

    fileInput.addEventListener('change', () => {
        handleFiles(fileInput.files);
    });

    const enter = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('ix-dropzone--hover');
    };
    const over = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };
    const leave = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('ix-dropzone--hover');
    };
    const drop = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('ix-dropzone--hover');
        handleFiles(e.dataTransfer?.files ?? null);
    };

    dropzone.addEventListener('dragenter', enter);
    dropzone.addEventListener('dragover', over);
    dropzone.addEventListener('dragleave', leave);
    dropzone.addEventListener('dragend', leave);
    dropzone.addEventListener('drop', drop);

    dropzone.addEventListener('click', (e) => {
        fileInput.click();
    });

    undoBtn.addEventListener('click', () => {
        if (undo(state)) {
            syncView();
        }
    });

    redoBtn.addEventListener('click', () => {
        if (redo(state)) {
            syncView();
        }
    });

    function buildDownloadFileName(): string {
        const original = state.fileName || 'image.jpg';
        const dot = original.lastIndexOf('.');
        if (dot <= 0) return `${original}-glitched.jpg`;
        const base = original.slice(0, dot);
        const ext = original.slice(dot);
        return `${base}-glitched${ext}`;
    }

    downloadBtn.addEventListener('click', () => {
        if (!state.bytes || state.bytes.length === 0) {
            setStatus('No image to download yet.');
            return;
        }

        try {
            const blob = new Blob([state.bytes], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = buildDownloadFileName();
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
            console.info('[ImageHexEditor] Download triggered');
        } catch (err) {
            console.error('[ImageHexEditor] Failed to prepare download', err);
            setStatus('Failed to prepare download.');
        }
    });

    findBtn.addEventListener('click', () => {
        if (!state.bytes || state.bytes.length === 0) {
            setStatus('Load a JPEG before using Find / Replace.');
            return;
        }

        const findText = window.prompt('Find ASCII text (searches raw bytes):');
        if (!findText) return;

        const replaceText = window.prompt('Replace with (leave blank to just select):') ?? '';

        const findBytes = textToBytes(findText);
        if (findBytes.length === 0) return;

        const startIndex = 0;
        const haystack = state.bytes;
        const index = indexOfBytes(haystack, findBytes, startIndex);
        if (index === -1) {
            setStatus('Search text not found.');
            return;
        }

        if (replaceText.length > 0) {
            const replaceBytes = textToBytes(replaceText);
            if (replaceBytes.length !== findBytes.length) {
                window.alert('For now, replacement text must be the same length as the search text.');
            } else {
                applyEdit(state, (draft) => {
                    draft.set(replaceBytes, index);
                });
                setActiveOffset(state, index);
                syncView();
                return;
            }
        }

        setActiveOffset(state, index);
        grid.setActiveOffset(index, true);
        syncToolbar();
        syncStatusForCaret();
    });

    insertBtn.addEventListener('click', () => {
        if (!state.bytes) {
            setStatus('Load a JPEG before inserting text.');
            return;
        }
        const text = window.prompt('Text to insert at current offset (ASCII):');
        if (!text) return;
        const insertBytes = textToBytes(text);
        if (insertBytes.length === 0) return;
        const offset = state.activeOffset;
        applyInsert(state, offset, insertBytes);
        setActiveOffset(state, offset);
        syncView();
    });

    window.addEventListener('beforeunload', () => {
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }
    });

    syncView();
    mainEl.hidden = true;
}

function textToBytes(text: string): Uint8Array {
    const arr = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
        arr[i] = text.charCodeAt(i) & 0xff;
    }
    return arr;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, fromIndex: number): number {
    const limit = haystack.length - needle.length;
    outer: for (let i = fromIndex; i <= limit; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}

initImageHexEditor();

export {};




