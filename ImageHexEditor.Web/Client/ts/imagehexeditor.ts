import { createEmptyState, applyEdit, applyInsert, canRedo, canUndo, loadNewFile, redo, setActiveOffset, undo } from './editorState';
import { createHexGrid } from './hexGrid';
import { byteToHex, classifyByte } from './jpegStructure';
import PhotoLightbox from '../../../../../wwwroot/ts/photoLightbox';

// To avoid excessive memory / CPU usage, cap the file size we actively keep and render.
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

type RegionId =
    | 'soi'
    | 'app'
    | 'dqt'
    | 'sof'
    | 'dht'
    | 'dri'
    | 'sos-header'
    | 'rst'
    | 'com'
    | 'eoi';

const REGION_DEFS: { id: RegionId; label: string }[] = [
    { id: 'soi',        label: 'Start of Image Marker' },
    { id: 'app',        label: 'Application Segment' },
    { id: 'dqt',        label: 'Quantization Table' },
    { id: 'sof',        label: 'Frame Header' },
    { id: 'dht',        label: 'Huffman Table' },
    { id: 'dri',        label: 'Restart Interval' },
    { id: 'sos-header', label: 'Scan Header' },
    { id: 'rst',        label: 'Restart Marker' },
    { id: 'com',        label: 'Comment' },
    { id: 'eoi',        label: 'End of Image Marker' }
];

function initImageHexEditor() {
    console.info('[ImageHexEditor] init');

    const gridEl = document.getElementById('ix-grid') as HTMLElement | null;
    const mainEl = document.getElementById('ix-main') as HTMLElement | null;
    const toolbarEl = document.getElementById('ix-toolbar') as HTMLElement | null;
    const uploadEl = document.getElementById('ix-upload') as HTMLElement | null;
    const dropzone = document.getElementById('ix-dropzone') as HTMLElement | null;
    const fileInput = document.getElementById('ix-file-input') as HTMLInputElement | null;
    const undoBtn = document.getElementById('ix-undo-btn') as HTMLButtonElement | null;
    const redoBtn = document.getElementById('ix-redo-btn') as HTMLButtonElement | null;
    const findBtn = document.getElementById('ix-find-btn') as HTMLButtonElement | null;
    const insertBtn = document.getElementById('ix-insert-btn') as HTMLButtonElement | null;
    const jumpBtn = document.getElementById('ix-jump-btn') as HTMLButtonElement | null;
    const statusEl = document.getElementById('ix-status') as HTMLElement | null;
    const editorStatusEl = document.getElementById('ix-editor-status') as HTMLElement | null;
    const previewImg = document.getElementById('ix-preview-image') as HTMLImageElement | null;
    const previewThrobber = document.getElementById('ix-preview-throbber') as HTMLElement | null;
    const previewZoomBtn = document.getElementById('ix-preview-zoom-btn') as HTMLButtonElement | null;
    const jumpMenu = document.getElementById('ix-jump-menu') as HTMLElement | null;
    const jumpMenuBody = document.getElementById('ix-jump-menu-body') as HTMLElement | null;
    const jumpCloseBtn = document.getElementById('ix-jump-close-btn') as HTMLButtonElement | null;
    const metaFilename = document.getElementById('ix-meta-filename') as HTMLElement | null;
    const metaSize = document.getElementById('ix-meta-size') as HTMLElement | null;
    const metaDimensions = document.getElementById('ix-meta-dimensions') as HTMLElement | null;
    const downloadBtn = document.getElementById('ix-download-btn') as HTMLButtonElement | null;
    const uploadNewBtn = document.getElementById('ix-upload-new-btn') as HTMLButtonElement | null;

    if (!gridEl || !mainEl || !toolbarEl || !uploadEl || !dropzone || !fileInput || !undoBtn || !redoBtn || !findBtn || !insertBtn || !jumpBtn || !statusEl || !editorStatusEl || !previewImg || !previewThrobber || !previewZoomBtn || !metaFilename || !metaSize || !metaDimensions || !downloadBtn || !uploadNewBtn || !jumpMenu || !jumpMenuBody || !jumpCloseBtn) {
        console.error('[ImageHexEditor] Missing required DOM elements, aborting init.');
        return;
    }

    // Zoom button is only enabled once a valid preview image is available.
    previewZoomBtn.disabled = true;

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
    let jumpMenuInitialized = false;
    let jumpMenuOpen = false;
    let regionCounts: Record<RegionId, number> = Object.create(null);
    let regionOffsets: Record<RegionId, number[]> = Object.create(null);
    let previewLightboxHost: HTMLElement | null = null;
    let previewLightbox: PhotoLightbox | null = null;

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

    function ensurePreviewLightboxHost(): HTMLElement {
        if (previewLightboxHost && previewLightboxHost.isConnected) {
            return previewLightboxHost;
        }

        const host = document.createElement('div');
        host.dataset.photoLightboxId = 'ix-preview-single';
        host.style.display = 'none';

        document.body.appendChild(host);
        previewLightboxHost = host;
        return host;
    }

    function syncPreviewLightboxSourceFromImage(): void {
        if (!previewImg || !previewImg.src) return;

        const host = ensurePreviewLightboxHost();
        const src = previewImg.src;
        const width = previewImg.naturalWidth || 1600;
        const height = previewImg.naturalHeight || 900;
        const alt = previewImg.alt || 'JPEG preview';

        let trigger = host.querySelector<HTMLButtonElement>('[data-photo-lightbox-width]');
        if (!trigger) {
            trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.dataset.photoLightboxWidth = `${width}`;
            trigger.dataset.photoLightboxHeight = `${height}`;
            trigger.dataset.photoLightboxSrc = src;
            trigger.setAttribute('aria-label', alt);

            const thumb = document.createElement('img');
            thumb.src = src;
            thumb.alt = alt;
            thumb.decoding = 'async';
            thumb.loading = 'lazy';
            trigger.appendChild(thumb);

            host.appendChild(trigger);
        } else {
            trigger.dataset.photoLightboxWidth = `${width}`;
            trigger.dataset.photoLightboxHeight = `${height}`;
            trigger.dataset.photoLightboxSrc = src;

            let thumb = trigger.querySelector<HTMLImageElement>('img');
            if (!thumb) {
                thumb = document.createElement('img');
                trigger.appendChild(thumb);
            }
            thumb.src = src;
            thumb.alt = alt;
            thumb.decoding = 'async';
            thumb.loading = 'lazy';
        }
    }

    function openPreviewLightbox(): void {
        if (!previewImg || !previewImg.src) return;

        syncPreviewLightboxSourceFromImage();
        const host = previewLightboxHost;
        if (!host) return;

        if (!previewLightbox) {
            previewLightbox = new PhotoLightbox({
                gallery: host,
                children: '[data-photo-lightbox-width]',
                loop: false,
                closeOnBackdrop: true,
                showCounter: false
            });
            previewLightbox.init();
        }

        previewLightbox.open(0, host);
    }

    function recomputeRegionOffsets(): void {
        const nextOffsets: Record<RegionId, number[]> = Object.create(null);
        for (const def of REGION_DEFS) {
            nextOffsets[def.id] = [];
        }

        const bytes = state.bytes;
        const layout = state.layout;
        if (!bytes || !layout || layout.length === 0) {
            regionOffsets = nextOffsets;
            return;
        }

        const len = layout.length;
        let prevRegion: string | null = null;

        for (let i = 0; i < len; i++) {
            const region = classifyByte(i, layout) as string;
            if (region === prevRegion) continue;
            prevRegion = region;

            // Only track region types we expose in the Jump To menu.
            if ((region as RegionId) in nextOffsets) {
                const key = region as RegionId;
                nextOffsets[key].push(i);
            }
        }

        regionOffsets = nextOffsets;
    }

    function ensureRegionCounts(): void {
        const counts: Record<RegionId, number> = Object.create(null);
        for (const def of REGION_DEFS) {
            counts[def.id] = regionOffsets[def.id]?.length ?? 0;
        }
        regionCounts = counts;
    }

    function initJumpMenuDom(): void {
        if (jumpMenuInitialized) return;
        jumpMenuInitialized = true;

        // Build static rows for each region definition.
        jumpMenuBody!.innerHTML = '';
        for (const def of REGION_DEFS) {
            const row = document.createElement('div');
            row.className = 'ix-jump-row';
            row.dataset.region = def.id;

            const label = document.createElement('div');
            label.className = 'ix-jump-label';
            label.classList.add(`ix-jump-label--${def.id}`);
            label.textContent = def.label;
            row.appendChild(label);

            const controls = document.createElement('div');
            controls.className = 'ix-jump-controls';

            const prevBtn = document.createElement('button');
            prevBtn.type = 'button';
            prevBtn.className = 'ix-toolbar-btn ix-toolbar-btn--secondary';
            prevBtn.textContent = '‹ Prev';
            prevBtn.dataset.region = def.id;
            prevBtn.dataset.dir = 'prev';
            prevBtn.dataset.role = 'prev';
            controls.appendChild(prevBtn);

            const nextBtn = document.createElement('button');
            nextBtn.type = 'button';
            nextBtn.className = 'ix-toolbar-btn ix-toolbar-btn--secondary';
            nextBtn.textContent = 'Next ›';
            nextBtn.dataset.region = def.id;
            nextBtn.dataset.dir = 'next';
            nextBtn.dataset.role = 'next-or-go';
            controls.appendChild(nextBtn);

            row.appendChild(controls);

            const countEl = document.createElement('div');
            countEl.className = 'ix-jump-count';
            countEl.id = `ix-jump-count-${def.id}`;
            row.appendChild(countEl);

            jumpMenuBody!.appendChild(row);
        }

        jumpMenuBody!.addEventListener('click', (ev) => {
            const target = ev.target as HTMLElement | null;
            if (!target) return;
            const button = target.closest<HTMLButtonElement>('button[data-region][data-dir]');
            if (!button) return;

            const region = button.dataset.region as RegionId;
            const dir = button.dataset.dir === 'prev' ? 'prev' : 'next';

            handleJump(region, dir);
        });
    }

    function updateJumpMenuCounts(): void {
        initJumpMenuDom();
        ensureRegionCounts();

        for (const def of REGION_DEFS) {
            const count = regionCounts[def.id] ?? 0;
            const row = jumpMenuBody!.querySelector<HTMLElement>(`.ix-jump-row[data-region="${def.id}"]`);
            if (!row) continue;

            const countEl = row.querySelector<HTMLElement>('.ix-jump-count');
            const prevBtn = row.querySelector<HTMLButtonElement>('button[data-role="prev"]');
            const nextBtn = row.querySelector<HTMLButtonElement>('button[data-role="next-or-go"]');

            if (countEl) {
                if (count === 0) {
                    countEl.textContent = 'None';
                } else if (count === 1) {
                    countEl.textContent = '1 match';
                } else {
                    countEl.textContent = `${count} matches`;
                }
            }

            if (!prevBtn || !nextBtn) continue;

            if (count === 0) {
                row.classList.add('ix-jump-row--empty');
                prevBtn.hidden = true;
                nextBtn.hidden = false;
                prevBtn.disabled = true;
                nextBtn.disabled = true;
                nextBtn.textContent = 'Go';
            } else if (count === 1) {
                row.classList.remove('ix-jump-row--empty');
                prevBtn.hidden = true;
                prevBtn.disabled = true;
                nextBtn.hidden = false;
                nextBtn.disabled = false;
                nextBtn.textContent = 'Go';
            } else {
                row.classList.remove('ix-jump-row--empty');
                prevBtn.hidden = false;
                nextBtn.hidden = false;
                prevBtn.disabled = false;
                nextBtn.disabled = false;
                prevBtn.textContent = '‹ Prev';
                nextBtn.textContent = 'Next ›';
            }
        }
    }

    type JumpDirection = 'prev' | 'next';

    function findOffsetForRegion(region: RegionId, dir: JumpDirection): number | null {
        if (!state.bytes) return null;
        const offsets = regionOffsets[region] ?? [];
        if (offsets.length === 0) return null;

        const startOffset = state.activeOffset;

        // Single match – always go to that one.
        if (offsets.length === 1) {
            return offsets[0];
        }

        if (dir === 'next') {
            for (let i = 0; i < offsets.length; i++) {
                if (offsets[i] > startOffset) {
                    return offsets[i];
                }
            }
            // Wrap to first.
            return offsets[0];
        }

        // dir === 'prev'
        for (let i = offsets.length - 1; i >= 0; i--) {
            if (offsets[i] < startOffset) {
                return offsets[i];
            }
        }
        // Wrap to last.
        return offsets[offsets.length - 1];
    }

    function handleJump(region: RegionId, dir: JumpDirection): void {
        if (!state.bytes || !state.layout) {
            setStatus('Load a JPEG before jumping.');
            return;
        }

        const count = regionCounts[region] ?? 0;
        if (count === 0) {
            setStatus(`No bytes found for region "${region}".`);
            return;
        }

        const offset = findOffsetForRegion(region, dir);
        if (offset == null) {
            setStatus(`No additional bytes found for region "${region}".`);
            return;
        }

        setActiveOffset(state, offset);
        grid.setActiveOffset(offset, true);
        syncToolbar();
        syncStatusForCaret();
    }

    function setPreviewLoading(isLoading: boolean): void {
        if (!previewThrobber) return;
        if (isLoading) {
            previewThrobber.classList.add('ix-preview-throbber--visible');
        } else {
            previewThrobber.classList.remove('ix-preview-throbber--visible');
        }
    }

    function syncToolbar(): void {
        const hasBytes = !!state.bytes && state.bytes.length > 0;
        undoBtn!.disabled = !hasBytes || !canUndo(state);
        redoBtn!.disabled = !hasBytes || !canRedo(state);
        findBtn!.disabled = !hasBytes;
        insertBtn!.disabled = !hasBytes;
        downloadBtn!.disabled = !hasBytes;
        uploadNewBtn!.disabled = !hasBytes;
        jumpBtn!.disabled = !hasBytes;
        previewZoomBtn!.disabled = !hasBytes || !previewImg!.src;
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
            setPreviewLoading(false);
            return;
        }

        setPreviewLoading(true);

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
        setPreviewLoading(false);
        // Now that we have a valid rendered image, enable the zoom control and
        // synchronize the lightbox source.
        previewZoomBtn.disabled = !state.bytes || state.bytes.length === 0;
        if (!previewZoomBtn.disabled) {
            syncPreviewLightboxSourceFromImage();
        }
    });

    previewImg!.addEventListener('error', () => {
        metaDimensions!.textContent = 'Unreadable / corrupt JPEG';
        setPreviewLoading(false);
        previewZoomBtn.disabled = true;
    });

    function syncView(): void {
        grid.setData(state.bytes, state.layout, state.activeOffset);
        syncToolbar();
        syncMeta();
        syncStatusForCaret();
        recomputeRegionOffsets();
        updateJumpMenuCounts();
        const hasBytes = !!state.bytes && state.bytes.length > 0;
        mainEl!.hidden = !hasBytes;
        toolbarEl!.hidden = !hasBytes;
        uploadEl!.hidden = hasBytes;
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

        // As soon as we know we have a valid file, transition away from the upload UI.
        uploadEl!.hidden = true;

        const reader = new FileReader();
        reader.onerror = (ev) => {
            console.error('[ImageHexEditor] FileReader error', ev);
            setStatus('Failed to read file.');
        };
        reader.onloadstart = () => {
            console.info('[ImageHexEditor] FileReader loadstart');
            // setStatus('Reading file in browser...');
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

    previewZoomBtn.addEventListener('click', () => {
        if (previewZoomBtn.disabled) {
            return;
        }
        openPreviewLightbox();
    });

    // Allow clicking the rendered preview image itself to trigger zoom,
    // mirroring the behavior of the dedicated zoom button.
    previewImg.addEventListener('click', () => {
        if (previewZoomBtn.disabled) {
            return;
        }
        openPreviewLightbox();
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
        if (dot <= 0) return `${original}-modified.jpg`;
        const base = original.slice(0, dot);
        const ext = original.slice(dot);
        return `${base}-modified${ext}`;
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

    uploadNewBtn.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
    });

    jumpBtn.addEventListener('click', () => {
        if (!state.bytes || !state.layout) {
            setStatus('Load a JPEG before using Jump To.');
            return;
        }
        updateJumpMenuCounts();
        jumpMenuOpen = true;
        jumpMenu.hidden = false;
    });

    jumpCloseBtn.addEventListener('click', () => {
        jumpMenuOpen = false;
        jumpMenu.hidden = true;
    });

    window.addEventListener('beforeunload', () => {
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }
    });

    syncView();
    mainEl.hidden = true;
    toolbarEl.hidden = true;
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




