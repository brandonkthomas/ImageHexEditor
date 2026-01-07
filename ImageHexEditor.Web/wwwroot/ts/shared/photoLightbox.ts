/**
 * photoLightbox.ts
 * @fileoverview Photo lightbox library with swipe/drag functionality + smooth animations
 */

import { logEvent, LogData, LogLevel } from './common';

type GalleryInput = HTMLElement | HTMLElement[] | NodeListOf<HTMLElement> | string;

export interface PhotoLightboxOptions {
    gallery: GalleryInput;
    /**
     * Selector under the gallery that identifies clickable children -- defaults
     * to recommended anchor markup
     */
    children?: string;
    /**
     * Whether the gallery should wrap when navigating beyond the first/last slide
     */
    loop?: boolean;
    /**
     * Pixels worth of drag displacement required before a slide swipe commits
     */
    dragThreshold?: number;
    /**
     * Allow closing the overlay by clicking on the backdrop
     */
    closeOnBackdrop?: boolean;
    /**
     * Whether to show the slide counter (e.g. "1 / 13") below the image
     */
    showCounter?: boolean;
    /**
     * Optional callback invoked whenever the active slide changes
     */
    onSlideChange?: (index: number) => void;
}

//==============================================================================================
// Private types
//==============================================================================================
interface SlideRecord {
    trigger: HTMLElement;
    src: string;
    width: number;
    height: number;
    alt: string;
    thumb?: HTMLImageElement;
    element?: HTMLElement;
    image?: HTMLImageElement;
    loaded: boolean;
}

interface InternalOptions extends Required<Omit<PhotoLightboxOptions, 'gallery'>> {
    gallery: HTMLElement[];
}

//==============================================================================================
// Private constants
//==============================================================================================
const DEFAULT_OPTIONS: Omit<InternalOptions, 'gallery'> = {
    children: '[data-photo-lightbox-width]',
    loop: true,
    dragThreshold: 85,
    closeOnBackdrop: true,
    showCounter: true,
    onSlideChange: () => undefined
};

const ACTIVE_CLASS = 'photo-lightbox--visible';
const DISABLED_CLASS = 'is-disabled';
const ANIMATION_DURATION_MS = 320;
const VELOCITY_TRIGGER = 0.35;
const VERTICAL_CLOSE_THRESHOLD = 120;
const VERTICAL_VELOCITY_TRIGGER = 0.45;
const BASE_BACKDROP_BLUR = 5;
const BLUR_FADE_DISTANCE = 35;
const HORIZONTAL_LOCK_THRESHOLD = 14;
const HORIZONTAL_LOCK_BIAS = 6;

type LightboxState = 'open' | 'close';
const stateListeners = new Set<(state: LightboxState) => void>();

export function onPhotoLightboxStateChange(listener: (state: LightboxState) => void) {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
}

function emitLightboxState(state: LightboxState) {
    stateListeners.forEach(listener => {
        try {
            listener(state);
        } catch (error) {
            logEvent(
                'photoLightbox',
                'State Listener Error',
                { state },
                error instanceof Error ? error.message : String(error),
                'error'
            );
        }
    });
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

//==============================================================================================
// Private functions
//==============================================================================================

//==============================================================================================
/**
 * Resolve gallery input (selector, element or collection) into a normalized array
 * @param {GalleryInput} input - The gallery input to resolve
 * @returns {HTMLElement[]} The resolved gallery input
 */
function resolveGalleryInput(input: GalleryInput): HTMLElement[] {
    if (typeof input === 'string') {
        return Array.from(document.querySelectorAll<HTMLElement>(input));
    }

    if (input instanceof HTMLElement) {
        return [input];
    }

    if ('length' in input) {
        return Array.from(input);
    }

    return [];
}

//==============================================================================================
/**
 * Helper to create DOM nodes with an optional class list and attributes
 * @param {K} tag - The tag name of the element to create
 * @param {string[]} classNames - The class names of the element
 * @param {Record<string, string>} attrs - The attributes of the element
 * @returns {HTMLElementTagNameMap[K]} The created element
 */
function createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    classNames?: string[],
    attrs?: Record<string, string>
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (classNames && classNames.length) {
        el.classList.add(...classNames);
    }
    if (attrs) {
        Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    }
    return el;
}

//==============================================================================================
/**
 * PhotoLightbox class
 * @description Handles photo lightbox functionality with focus on readability and performance
 */
export default class PhotoLightbox {

    //==============================================================================================
    // Private properties
    //==============================================================================================
    private readonly options: InternalOptions;
    private readonly galleries: HTMLElement[];
    private readonly galleryHandlers = new Map<HTMLElement, (ev: Event) => void>();

    private dataSources = new Map<HTMLElement, SlideRecord[]>();

    private overlay?: HTMLElement;
    private track?: HTMLElement;
    private content?: HTMLElement;
    private counter?: HTMLElement;
    private closeButton?: HTMLButtonElement;
    private prevButton?: HTMLButtonElement;
    private nextButton?: HTMLButtonElement;

    private slides: SlideRecord[] = [];
    private currentIndex = 0;
    private viewportWidth = 0;
    private isOpen = false;
    private canNavigate = false;

    private dragStartX = 0;
    private dragStartY = 0;
    private dragOffsetX = 0;
    private dragOffsetY = 0;
    private pointerId: number | null = null;
    private isDragging = false;
    private lastPointerX = 0;
    private lastPointerY = 0;
    private lastPointerTime = 0;
    private pointerVelocityX = 0;
    private pointerVelocityY = 0;
    private isVerticalDrag = false;
    private lockedDragAxis: 'horizontal' | 'vertical' | null = null;
    private activeDataSource?: HTMLElement;
    private lastFocusedElement: HTMLElement | null = null;
    private isAnimatingWrap = false;
    private overlayBaseBg = 'rgba(0, 0, 0, 0.95)';
    private baseBackdropBlur = BASE_BACKDROP_BLUR;

    //==============================================================================================
    // Private event handlers
    //==============================================================================================
    private readonly onKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);
    private readonly onResize = () => this.measureViewport();
    private readonly onPointerDown = (event: PointerEvent) => this.beginPointerDrag(event);
    private readonly onPointerMove = (event: PointerEvent) => this.updatePointerDrag(event);
    private readonly onPointerUp = (event: PointerEvent) => this.endPointerDrag(event);
    private readonly onBackdropClick = (event: MouseEvent) => this.handleBackdropClick(event);

    private log(event: string, data?: LogData, note?: string, level: LogLevel = 'info') {
        logEvent('photoLightbox', event, data, note, level);
    }

    private describeElement(element?: HTMLElement | null) {
        if (!element) {
            return 'unknown';
        }
        return (
            element.dataset.photoLightboxId ||
            element.getAttribute('data-gallery') ||
            element.id ||
            element.className ||
            element.tagName ||
            'unknown'
        );
    }

    //==============================================================================================
    // Constructor
    //==============================================================================================
    constructor(options: PhotoLightboxOptions) {
        this.galleries = resolveGalleryInput(options.gallery);
        this.options = {
            ...DEFAULT_OPTIONS,
            ...options,
            gallery: this.galleries
        };
    }

    //==============================================================================================
    // Public methods
    //==============================================================================================

    //==============================================================================================
    /**
     * Bind galleries and prepare for user interaction.
     * @description Binds galleries and prepares for user interaction
     */
    init() {
        if (!this.galleries.length) {
            this.log('Init Skipped', { galleries: 0 }, 'No gallery elements resolved', 'warn');
            return;
        }

        let boundCount = 0;
        this.galleries.forEach((gallery) => {
            if (this.galleryHandlers.has(gallery)) {
                this.log('Gallery Already Bound', { gallery: this.describeElement(gallery) });
                return;
            }

            const handler = (event: Event) => this.handleThumbnailClick(event, gallery);
            gallery.addEventListener('click', handler);
            this.galleryHandlers.set(gallery, handler);

            const slides = this.extractSlides(gallery);
            this.dataSources.set(gallery, slides);
            boundCount += 1;
            this.log('Gallery Prepared', {
                gallery: this.describeElement(gallery),
                slides: slides.length
            });
        });

        this.log('Init Completed', {
            galleries: this.galleries.length,
            bound: boundCount
        });
    }

    //==============================================================================================
    /**
     * Destroy all listeners and DOM references
     * @returns {void}
     */
    destroy() {
        this.close(false);

        let removedHandlers = 0;
        this.galleryHandlers.forEach((handler, gallery) => {
            gallery.removeEventListener('click', handler);
            removedHandlers += 1;
        });
        this.galleryHandlers.clear();
        this.dataSources.clear();

        const hadOverlay = Boolean(this.overlay);
        if (this.overlay) {
            this.overlay.remove();
        }

        this.overlay = undefined;
        this.track = undefined;
        this.content = undefined;
        this.counter = undefined;
        this.closeButton = undefined;
        this.prevButton = undefined;
        this.nextButton = undefined;
        this.slides = [];
        this.activeDataSource = undefined;
        this.canNavigate = false;

        this.log('Destroyed', {
            handlers: removedHandlers,
            hadOverlay: Number(hadOverlay)
        });
    }

    //==============================================================================================
    /**
     * Open lightbox at a specific slide index
     * @param {number} index - The index of the slide to open
     * @param {HTMLElement} gallery - The gallery to open the lightbox in
     * @returns {void}
     */
    open(index = 0, gallery?: HTMLElement) {
        const host = gallery ?? this.galleries[0];
        if (!host) {
            this.log('Open Skipped', { requestedIndex: index }, 'No gallery host available', 'warn');
            return;
        }

        const slides = this.extractSlides(host);
        if (!slides.length) {
            this.log(
                'Open Skipped',
                { requestedIndex: index, gallery: this.describeElement(host) },
                'No slides extracted',
                'warn'
            );
            return;
        }

        this.activeDataSource = host;
        this.slides = slides;
        this.currentIndex = clamp(index, 0, this.slides.length - 1);
        this.canNavigate = this.slides.length > 1;

        if (!this.overlay) {
            this.buildOverlay();
        }

        this.renderSlides();
        this.measureViewport();
        this.attachGlobalListeners();

        const wasOpen = this.isOpen;
        this.isOpen = true;

        this.overlay?.classList.add(ACTIVE_CLASS);
        this.overlay?.setAttribute('aria-hidden', 'false');

        this.updateTrackTransform(0, false);
        this.updateUIState();
        this.preloadNearbySlides();
        this.preventBodyScroll(true);
        this.focusOverlay();

        if (!wasOpen) {
            emitLightboxState('open');
        }

        this.log('Opened', {
            index: this.currentIndex,
            slides: this.slides.length,
            gallery: this.describeElement(host)
        });
    }

    //==============================================================================================
    /**
     * Close the lightbox
     * @param {boolean} restoreFocus - Whether to restore focus to the last focused element
     * @param {boolean} resetVerticalState - Whether to reset the vertical state
     * @returns {void}
     */
    close(restoreFocus = true, resetVerticalState = true) {
        if (!this.isOpen) {
            this.log('Close Ignored', { restoreFocus: Number(restoreFocus) }, 'Lightbox already closed');
            return;
        }

        if (resetVerticalState) {
            this.resetVerticalDrag(false);
            this.isVerticalDrag = false;
            this.dragOffsetY = 0;
            this.pointerVelocityY = 0;
        }

        const overlay = this.overlay ?? undefined;
        const previouslyFocused = this.lastFocusedElement;

        const wasOpen = this.isOpen;
        this.isOpen = false;

        overlay?.classList.remove(ACTIVE_CLASS);

        this.detachGlobalListeners();
        this.preventBodyScroll(false);
        
        if (wasOpen) {
            emitLightboxState('close');
        }

        // Move focus away from the overlay *before* marking it aria-hidden to
        // avoid situations where a focused descendant becomes hidden from
        // assistive technologies (which modern browsers will now block).
        if (overlay) {
            const active = document.activeElement as HTMLElement | null;
            const containsActive = active ? overlay.contains(active) : false;

            if (containsActive) {
                if (restoreFocus && previouslyFocused) {
                    previouslyFocused.focus();
                } else {
                    overlay.blur();
                }
            } else if (restoreFocus && previouslyFocused) {
                previouslyFocused.focus();
            }

            overlay.setAttribute('aria-hidden', 'true');
        } else if (restoreFocus && previouslyFocused) {
            previouslyFocused.focus();
        }

        this.lastFocusedElement = null;

        this.log('Closed', {
            restoreFocus: Number(restoreFocus),
            resetVerticalState: Number(resetVerticalState)
        });
    }

    //==============================================================================================
    /**
     * Go to the next slide
     * @returns {void}
     */
    next() {
        this.goTo(this.currentIndex + 1);
    }

    //==============================================================================================
    /**
     * Go to the previous slide
     * @returns {void}
     */
    prev() {
        this.goTo(this.currentIndex - 1);
    }

    //==============================================================================================
    /**
     * Go to a specific slide
     * @param {number} index - The index of the slide to go to
     * @returns {void}
     */
    goTo(index: number) {
        if (!this.slides.length) {
            this.log('Navigation Skipped', { requestedIndex: index }, 'No slides are loaded', 'warn');
            return;
        }

        // if we can't navigate, just update the track transform and return
        if (!this.canNavigate) {
            this.log('Navigation Disabled', { requestedIndex: index, slides: this.slides.length }, 'Single-slide mode');
            this.updateTrackTransform(0, true);
            return;
        }

        const slideCount = this.slides.length;
        const isLooping = this.options.loop && slideCount > 1;

        if (isLooping && !this.isAnimatingWrap) {
            const fromIndex = this.currentIndex;
            const isWrapBackward = fromIndex === 0 && index < 0;
            const isWrapForward = fromIndex === slideCount - 1 && index >= slideCount;

            if (isWrapBackward || isWrapForward) {
                this.log('Wrap Boundary', {
                    from: fromIndex,
                    to: index,
                    direction: isWrapForward ? 'forward' : 'backward'
                });
                this.animateBoundaryWrap(isWrapForward ? 'forward' : 'backward');
                return;
            }
        }

        if (this.isAnimatingWrap) {
            this.log('Navigation Deferred', { requestedIndex: index }, 'Wrap animation in progress');
            return;
        }

        const target = this.normalizeIndex(index);
        if (target === this.currentIndex) {
            this.log('Navigation Noop', { targetIndex: target });
            this.updateTrackTransform(0, true);
            return;
        }

        this.currentIndex = target;
        this.updateTrackTransform(0, true);
        this.updateUIState();
        this.preloadNearbySlides();
        this.options.onSlideChange(this.currentIndex);
        this.log('Slide Changed', { index: this.currentIndex });
    }

    //==============================================================================================
    // Private methods
    //==============================================================================================

    //==============================================================================================
    /**
     * Extract slide metadata from a gallery element
     * @param {HTMLElement} gallery - The gallery to extract slides from
     * @returns {SlideRecord[]} The slides
     */
    private extractSlides(gallery: HTMLElement): SlideRecord[] {
        const selector = this.options.children;
        const nodes = selector
            ? Array.from(gallery.querySelectorAll<HTMLElement>(selector))
            : Array.from(gallery.children).filter((node): node is HTMLElement => node instanceof HTMLElement);

        const withOrder = nodes
            .map((node, idx) => {
                const orderAttr = parseFloat(node.dataset.photoLightboxOrder ?? '');
                const order = Number.isFinite(orderAttr) ? orderAttr : idx;

                return { trigger: node, fallbackIndex: idx, order };
            })
            .filter((entry): entry is { trigger: HTMLElement; fallbackIndex: number; order: number } => Boolean(entry));

        withOrder.sort((a, b) => {
            if (a.order === b.order) {
                return a.fallbackIndex - b.fallbackIndex;
            }
            return a.order - b.order;
        });

        const slides: SlideRecord[] = [];

        withOrder.forEach(({ trigger }) => {
            const width = parseInt(trigger.dataset.photoLightboxWidth ?? '', 10);
            const height = parseInt(trigger.dataset.photoLightboxHeight ?? '', 10);

            const img = trigger.querySelector('img') ?? undefined;
            const alt = img?.getAttribute('alt') ?? trigger.getAttribute('aria-label') ?? 'Photo';
            const src = trigger.dataset.photoLightboxSrc || img?.currentSrc || img?.src || '';

            if (!src) {
                return;
            }

            slides.push({
                trigger,
                src,
                width: Number.isFinite(width) ? width : 1600,
                height: Number.isFinite(height) ? height : 900,
                alt,
                thumb: img,
                loaded: false
            });
        });

        return slides;
    }

    //==============================================================================================
    /**
     * Handle thumbnail click
     * @param {Event} event - The event that triggered the click
     * @param {HTMLElement} gallery - The gallery that contains the thumbnail
     * @returns {void}
     */
    private handleThumbnailClick(event: Event, gallery: HTMLElement) {
        const target = event.target as HTMLElement | null;
        const selector = this.options.children;

        if (!target || !gallery.contains(target)) {
            return;
        }

        const resolvedSelector = selector ?? '[data-photo-lightbox-width]';
        const clickable = target.closest(resolvedSelector) as HTMLElement | null;
        if (!clickable) {
            return;
        }

        const slides = this.extractSlides(gallery);
        if (!slides.length) {
            this.log('Thumbnail Click Skipped', {
                gallery: this.describeElement(gallery)
            }, 'No slides available', 'warn');
            return;
        }

        const index = slides.findIndex((slide) => slide.trigger === clickable);
        if (index === -1) {
            this.log('Thumbnail Not Registered', {
                gallery: this.describeElement(gallery)
            }, 'Clicked element not found in slides', 'warn');
            return;
        }

        event.preventDefault();
        this.log('Thumbnail Activated', {
            gallery: this.describeElement(gallery),
            index
        });
        this.open(index, gallery);
    }

    //==============================================================================================
    /**
     * Build the overlay
     * @returns {void}
     */
    private buildOverlay() {
        if (this.overlay) return;

        this.overlay = createElement('div', ['photo-lightbox']);
        this.overlay.setAttribute('role', 'dialog');
        this.overlay.setAttribute('aria-hidden', 'true');

        const closeWrapper = createElement('div', ['lightbox-control', 'lightbox-close-wrapper']);
        const prevWrapper = createElement('div', ['lightbox-control', 'lightbox-prev-wrapper']);
        const nextWrapper = createElement('div', ['lightbox-control', 'lightbox-next-wrapper']);

        const closeButton = this.createIconButton('Close', 'lightbox-close', `
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
        `, false);
        closeButton.button.addEventListener('click', () => this.close());
        
        closeWrapper.appendChild(closeButton.wrapper);

        // if we can navigate, create the prev and next buttons
        if (this.canNavigate) {
            const prevButton = this.createIconButton('Prev', 'lightbox-prev', `<polyline points="15 18 9 12 15 6"></polyline>`, false);
            prevButton.button.addEventListener('click', () => this.prev());
    
            const nextButton = this.createIconButton('Next', 'lightbox-next', `<polyline points="9 18 15 12 9 6"></polyline>`, true);
            nextButton.button.addEventListener('click', () => this.next());

            prevWrapper.appendChild(prevButton.wrapper);
            nextWrapper.appendChild(nextButton.wrapper);   
            
            this.prevButton = prevButton.button;
            this.nextButton = nextButton.button;    
        }

        const content = createElement('div', ['lightbox-content']);
        const track = createElement('div', ['lightbox-track']);
        track.setAttribute('aria-live', 'polite');

        content.appendChild(track);
        this.overlay.appendChild(content);
        this.overlay.appendChild(closeWrapper);
        this.overlay.appendChild(prevWrapper);
        this.overlay.appendChild(nextWrapper);

        if (this.options.showCounter) {
            const counter = createElement('div', ['lightbox-counter']);
            content.appendChild(counter);
            this.counter = counter;
        } else {
            this.counter = undefined;
        }

        this.track = track;
        this.content = content;
        this.closeButton = closeButton.button;

        document.body.appendChild(this.overlay);
        this.overlayBaseBg = window.getComputedStyle(this.overlay).backgroundColor || this.overlayBaseBg;

        if (this.content) {
            const blurValue = window.getComputedStyle(this.content).backdropFilter;
            const blurMatch = blurValue.match(/blur\(([\d.]+)px\)/i);
            this.baseBackdropBlur = blurMatch ? parseFloat(blurMatch[1]) : BASE_BACKDROP_BLUR;
        }
    }

    //==============================================================================================
    /**
     * Create an icon button
     * @param {string} label - The label of the button
     * @param {string} buttonClass - The class of the button
     * @param {string} svgContent - The SVG content of the button
     * @param {boolean} svgAfterLabel - Whether to place the SVG after the label
     * @returns {void}
     */
    private createIconButton(
        label: string, 
        buttonClass: string, 
        svgContent: string, 
        svgAfterLabel: boolean = false
    ): { wrapper: HTMLElement; button: HTMLButtonElement } {
        const glassWrapper = createElement('div', ['lightbox-button-glass']);
        const button = createElement('button', ['lightbox-button', buttonClass], { type: 'button', 'aria-label': label }) as HTMLButtonElement;

        if (svgAfterLabel) {
            button.innerHTML = `
                <span>${label}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgContent}</svg>
            `;
        } else {
            button.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgContent}</svg>
                <span>${label}</span>
            `;
        }

        glassWrapper.appendChild(button);
        return { wrapper: glassWrapper, button };
    }

    //==============================================================================================
    /**
     * Render the slide elements
     * @returns {void}
     */
    private renderSlides() {
        if (!this.track) return;

        this.track.innerHTML = '';

        this.slides.forEach((slide, index) => {
            const slideEl = createElement('div', ['lightbox-slide']);
            slideEl.setAttribute('role', 'group');
            slideEl.setAttribute('aria-label', `Image ${index + 1} of ${this.slides.length}`);

            const img = createElement('img', ['lightbox-image']) as HTMLImageElement;
            img.alt = slide.alt;
            img.decoding = 'async';
            img.loading = 'eager';
            img.setAttribute('draggable', 'false');
            img.addEventListener('dragstart', (event) => event.preventDefault());
            img.addEventListener('contextmenu', (event) => event.preventDefault());

            slide.element = slideEl;
            slide.image = img;

            slideEl.appendChild(img);
            this.track?.appendChild(slideEl);
        });
    }

    //==============================================================================================
    /**
     * Attach global listeners
     * @returns {void}
     */
    private attachGlobalListeners() {
        document.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('resize', this.onResize);
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('pointercancel', this.onPointerUp);
        this.content?.addEventListener('pointerdown', this.onPointerDown);
        this.overlay?.addEventListener('click', this.onBackdropClick);
    }

    //==============================================================================================
    /**
     * Detach global listeners
     * @returns {void}
     */
    private detachGlobalListeners() {
        document.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('resize', this.onResize);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerUp);
        this.content?.removeEventListener('pointerdown', this.onPointerDown);
        this.overlay?.removeEventListener('click', this.onBackdropClick);
    }

    //==============================================================================================
    /**
     * Handle key down event
     * @param {KeyboardEvent} event - The event that triggered the key down
     * @returns {void}
     */
    private handleKeyDown(event: KeyboardEvent) {
        if (!this.isOpen) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            this.close();
        } else if (event.key === 'ArrowRight' && this.canNavigate) {
            event.preventDefault();
            this.next();
        } else if (event.key === 'ArrowLeft' && this.canNavigate) {
            event.preventDefault();
            this.prev();
        }
    }

    //==============================================================================================
    /**
     * Handle backdrop click
     * @param {MouseEvent} event - The event that triggered the click
     * @returns {void}
     */
    private handleBackdropClick(event: MouseEvent) {
        if (!this.options.closeOnBackdrop || !this.overlay) return;

        // If single photo, close on any click
        if (!this.canNavigate) {
            // Don't close if clicking on the close button (it has its own handler)
            const target = event.target as HTMLElement;
            if (target.closest('.lightbox-close')) {
                return;
            }
            this.close();
            this.log('Backdrop Close', { reason: 'single-photo-click' });
            return;
        }

        // For multiple photos, only close on backdrop click
        if (event.target === this.overlay) {
            this.close();
            this.log('Backdrop Close', { reason: 'backdrop' });
        }
    }

    //==============================================================================================
    /**
     * Measure the viewport
     * @returns {void}
     */
    private measureViewport() {
        if (!this.content) return;

        const styles = window.getComputedStyle(this.content);
        const paddingLeft = parseFloat(styles.paddingLeft || '0');
        const paddingRight = parseFloat(styles.paddingRight || '0');
        const innerWidth = this.content.clientWidth - paddingLeft - paddingRight;

        this.viewportWidth = innerWidth > 0 ? innerWidth : this.content.clientWidth;
        this.updateTrackTransform(0, false);
    }

    //==============================================================================================
    /**
     * Update the track transform
     * @param {number} extraOffset - The extra offset to add to the transform
     * @param {boolean} animate - Whether to animate the transform
     * @returns {void}
     */
    private updateTrackTransform(extraOffset = 0, animate = true) {
        if (!this.track) return;

        const base = -this.currentIndex * this.viewportWidth;
        const value = base + extraOffset;

        if (animate) {
            this.track.style.transition = `transform ${ANIMATION_DURATION_MS}ms cubic-bezier(.4,0,.22,1)`;
        } else {
            this.track.style.transition = 'none';
        }

        this.track.style.transform = `translate3d(${value}px, 0, 0)`;
    }

    //==============================================================================================
    /**
     * Reset the vertical drag
     * @param {boolean} animateBack - Whether to animate the back
     * @returns {void}
     */
    private resetVerticalDrag(animateBack: boolean) {
        if (this.content) {
            if (animateBack) {
                this.content.style.transition = 'transform 200ms ease';
            } else {
                this.content.style.transition = 'none';
            }

            this.content.style.transform = 'translate3d(0, 0, 0)';
            this.content.style.backdropFilter = `blur(${this.baseBackdropBlur}px)`;

            if (animateBack) {
                const contentRef = this.content;
                requestAnimationFrame(() => {
                    if (contentRef) {
                        contentRef.style.transition = '';
                        contentRef.style.backdropFilter = `blur(${this.baseBackdropBlur}px)`;
                    }
                });
            } else {
                this.content.style.transition = '';
                this.content.style.backdropFilter = `blur(${this.baseBackdropBlur}px)`;
            }
        }

        if (this.overlay) {
            this.overlay.style.background = this.overlayBaseBg;
        }
    }

    //==============================================================================================
    /**
     * Animate the vertical dismiss and close
     * @returns {void}
     */
    private animateVerticalDismissAndClose() {
        const direction = this.dragOffsetY >= 0 ? 1 : -1;
        const travel = direction * (window.innerHeight * 0.6);
        this.log('Vertical Close', {
            direction,
            velocity: this.pointerVelocityY.toFixed(3),
            offset: this.dragOffsetY
        });

        if (this.content) {
            this.content.style.transition = 'transform 220ms ease, backdrop-filter 220ms ease';
            this.content.style.transform = `translate3d(0, ${travel}px, 0)`;
            this.content.style.backdropFilter = 'blur(0px)';
        }

        this.close(true, false);

        window.setTimeout(() => {
            this.resetVerticalDrag(false);
            this.isVerticalDrag = false;
            this.dragOffsetY = 0;
            this.pointerVelocityY = 0;
        }, ANIMATION_DURATION_MS);
    }

    //==============================================================================================
    /**
     * Preload nearby slides
     * @returns {void}
     */
    private preloadNearbySlides() {
        this.ensureSlideLoaded(this.currentIndex);
        this.ensureSlideLoaded(this.currentIndex - 1);
        this.ensureSlideLoaded(this.currentIndex + 1);
    }

    //==============================================================================================
    /**
     * Ensure the slide is loaded
     * @param {number} index - The index of the slide to ensure is loaded
     * @returns {void}
     */
    private ensureSlideLoaded(index: number) {
        const actual = this.normalizeIndex(index);
        const slide = this.slides[actual];
        if (!slide) {
            this.log('Preload Skipped', { requestedIndex: index }, 'Slide missing', 'warn');
            return;
        }
        if (slide.loaded || !slide.image) return;

        const setSource = (src: string) => {
            if (!slide.image) return;
            slide.image.src = src;
            slide.loaded = true;
        };

        if (slide.thumb) {
            const preferredSrc = slide.thumb.currentSrc || slide.thumb.src;
            if (slide.thumb.complete && preferredSrc) {
                this.log('Preload From Thumb', { index: actual });
                setSource(preferredSrc);
                return;
            }
        }

        this.log('Preload From Source', { index: actual });
        setSource(slide.src);
    }

    //==============================================================================================
    /**
     * Normalize the index
     * @param {number} index - The index to normalize
     * @returns {number} The normalized index
     */
    private normalizeIndex(index: number) {
        if (!this.slides.length) return 0;

        if (this.options.loop) {
            const total = this.slides.length;
            return ((index % total) + total) % total;
        }

        return clamp(index, 0, this.slides.length - 1);
    }

    //==============================================================================================
    /**
     * Animate wrap-around transition using existing track (insert "blank" region past ends of the strip)
     * Used to fake padding between the first and last slides
     * BT 2025-11-27: idk how to better do this so for now it'll work
     */
    private animateBoundaryWrap(direction: 'forward' | 'backward') {
        if (!this.track || !this.slides.length) {
            this.log('Wrap Animation Fallback', { direction }, 'Missing track or slides', 'warn');
            // Fallback to immediate jump if we can't animate
            this.currentIndex = direction === 'forward' ? 0 : this.slides.length - 1;
            this.updateTrackTransform(0, true);
            this.updateUIState();
            this.preloadNearbySlides();
            this.options.onSlideChange(this.currentIndex);
            return;
        }

        if (this.isAnimatingWrap) {
            return;
        }

        const width = this.viewportWidth || (this.content?.clientWidth ?? 0);
        if (!width) {
            this.log('Wrap Animation Fallback', { direction }, 'Viewport width unavailable', 'warn');
            // If we can't determine a width, just snap without animation
            this.currentIndex = direction === 'forward' ? 0 : this.slides.length - 1;
            this.updateTrackTransform(0, true);
            this.updateUIState();
            this.preloadNearbySlides();
            this.options.onSlideChange(this.currentIndex);
            return;
        }

        this.isAnimatingWrap = true;
        this.log('Wrap Animation Start', { direction, target: direction === 'forward' ? 0 : this.slides.length - 1 });

        const slideCount = this.slides.length;
        const targetIndex = direction === 'forward' ? 0 : slideCount - 1;

        // Ensure neighboring slides are ready before we snap at the end
        this.ensureSlideLoaded(targetIndex);

        // Phase 1: move the current slide into the "blank" space beyond the edge
        const leaveOffset = direction === 'forward' ? -width : width;
        this.updateTrackTransform(leaveOffset, true);

        window.setTimeout(() => {
            // Phase 2: snap to target index starting off-screen on the opposite side,
            // then animate back into the viewport.
            this.currentIndex = targetIndex;

            const enterOffset = direction === 'forward' ? width : -width;
            this.updateTrackTransform(enterOffset, false);

            this.updateUIState();
            this.preloadNearbySlides();
            this.options.onSlideChange(this.currentIndex);

            // Force layout before starting the second leg of the animation
            if (this.track) {
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                this.track.offsetHeight;
            }

            requestAnimationFrame(() => {
                this.updateTrackTransform(0, true);
            });

            window.setTimeout(() => {
                this.isAnimatingWrap = false;
            }, ANIMATION_DURATION_MS - 120);
        }, ANIMATION_DURATION_MS - 120);
    }

    //==============================================================================================
    /**
     * Update the UI state (prev and next buttons, counter)
     * @returns {void}
     */
    private updateUIState() {
        const slideCount = this.slides.length;
        const hasMultiple = slideCount > 1;

        if (this.counter) {
            this.counter.textContent = `${this.currentIndex + 1} / ${slideCount}`;
        }

        this.slides.forEach((slide, idx) => {
            const isActive = idx === this.currentIndex;
            slide.element?.classList.toggle('is-active', isActive);
            slide.element?.setAttribute('aria-hidden', isActive ? 'false' : 'true');
        });

        const disablePrev = !hasMultiple || (!this.options.loop && this.currentIndex === 0);
        const disableNext = !hasMultiple || (!this.options.loop && this.currentIndex === slideCount - 1);

        if (this.prevButton) {
            this.prevButton.classList.toggle(DISABLED_CLASS, disablePrev);
            this.prevButton.disabled = disablePrev;
        }

        if (this.nextButton) {
            this.nextButton.classList.toggle(DISABLED_CLASS, disableNext);
            this.nextButton.disabled = disableNext;
        }
    }

    //==============================================================================================
    /**
     * Prevent body scroll
     * @param {boolean} disable - Whether to disable scroll
     * @returns {void}
     */
    private preventBodyScroll(disable: boolean) {
        document.body.style.overflow = disable ? 'hidden' : '';
    }

    //==============================================================================================
    /**
     * Focus the overlay
     * @returns {void}
     */
    private focusOverlay() {
        if (!this.overlay) return;
        this.lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (!this.overlay.hasAttribute('tabindex')) {
            this.overlay.setAttribute('tabindex', '-1');
        }
        this.overlay.focus();
    }

    //==============================================================================================
    /**
     * Begin pointer drag
     * @param {PointerEvent} event - The event that triggered the pointer drag
     * @returns {void}
     */
    private beginPointerDrag(event: PointerEvent) {
        if (!this.isOpen || event.button !== 0 || this.isAnimatingWrap) return;
        if (this.pointerId !== null) {
            this.log('Drag Ignored', { pointerId: event.pointerId }, 'Pointer already active');
            return;
        }

        this.pointerId = event.pointerId;
        this.dragStartX = event.clientX;
        this.dragStartY = event.clientY;
        this.lastPointerX = event.clientX;
        this.lastPointerY = event.clientY;
        this.lastPointerTime = event.timeStamp;

        this.dragOffsetX = 0; // Reset drag offset
        this.dragOffsetY = 0;
        this.pointerVelocityX = 0; // Reset pointer velocity
        this.pointerVelocityY = 0;
        this.lockedDragAxis = null; // Reset any locked drag axis
        this.isDragging = true;
        this.isVerticalDrag = false;

        this.track?.classList.add('is-dragging');
        this.updateTrackTransform(0, false);
        this.log('Drag Started', { pointerId: event.pointerId });
    }

    //==============================================================================================
    /**
     * Update pointer drag
     * @param {PointerEvent} event - The event that triggered the pointer drag
     * @returns {void}
     */
    private updatePointerDrag(event: PointerEvent) {
        if (!this.isDragging || this.pointerId !== event.pointerId) return;

        const deltaX = event.clientX - this.dragStartX;
        const deltaY = event.clientY - this.dragStartY;

        // Check if the drag is near neutral
        const verticalDelta = Math.abs(deltaY);
        const horizontalDelta = Math.abs(deltaX);
        const nearNeutral = verticalDelta < 8 && horizontalDelta < 8;

        // If single photo, prevent horizontal dragging
        if (!this.canNavigate) {
            // Only allow vertical drags for single photo
            if (!this.isVerticalDrag) {
                const shouldStartVertical = verticalDelta > horizontalDelta + 12 && verticalDelta > 30;
                if (shouldStartVertical) {
                    this.lockedDragAxis = 'vertical';
                    this.isVerticalDrag = true;
                    this.track?.classList.remove('is-dragging');
                    this.dragOffsetX = 0;
                    this.updateTrackTransform(0, false);
                } else {
                    // Prevent horizontal drag from starting
                    this.dragOffsetX = 0;
                    this.updateTrackTransform(0, false);
                }
            }
            
            // Handle vertical drag for single photo
            if (this.isVerticalDrag) {
                this.dragOffsetY = deltaY;
                const progress = clamp(Math.abs(deltaY) / 380, 0, 1);
                const opacity = 0.95 * (1 - progress * 0.85);
                const blurProgress = clamp(Math.abs(deltaY) / BLUR_FADE_DISTANCE, 0, 1);
                const currentBlur = this.baseBackdropBlur * (1 - blurProgress);

                if (this.content) {
                    this.content.style.transition = 'none';
                    this.content.style.transform = `translate3d(0, ${deltaY}px, 0)`;
                    this.content.style.backdropFilter = `blur(${currentBlur}px)`;
                }

                if (this.overlay) {
                    this.overlay.style.background = `rgba(0, 0, 0, ${opacity})`;
                }
            }

            // Update velocity tracking
            const dt = event.timeStamp - this.lastPointerTime;
            if (dt > 0) {
                this.pointerVelocityY = (event.clientY - this.lastPointerY) / dt;
                this.lastPointerTime = event.timeStamp;
                this.lastPointerY = event.clientY;
            }

            return;
        }

        // If the drag is not vertical and not locked to horizontal, check if it should start vertical
        if (!this.isVerticalDrag && this.lockedDragAxis !== 'horizontal') {
            if (nearNeutral) {
                this.dragOffsetX = 0;
                this.updateTrackTransform(0, false);
            }

            const shouldStartVertical = verticalDelta > horizontalDelta + 12 && verticalDelta > 30;

            // If the drag should start vertical, lock it now
            if (shouldStartVertical) {
                this.lockedDragAxis = 'vertical';
                this.isVerticalDrag = true;
                this.track?.classList.remove('is-dragging');
                this.dragOffsetX = 0;
                this.updateTrackTransform(0, false);
            } else if (this.lockedDragAxis === null) {
                const shouldLockHorizontal = horizontalDelta > verticalDelta + HORIZONTAL_LOCK_BIAS 
                    && horizontalDelta > HORIZONTAL_LOCK_THRESHOLD;

                if (shouldLockHorizontal) {
                    this.lockedDragAxis = 'horizontal';
                }
            }
        }

        const dt = event.timeStamp - this.lastPointerTime;

        if (dt > 0) {
            this.pointerVelocityX = (event.clientX - this.lastPointerX) / dt;
            this.pointerVelocityY = (event.clientY - this.lastPointerY) / dt;
            this.lastPointerTime = event.timeStamp;
            this.lastPointerX = event.clientX;
            this.lastPointerY = event.clientY;
        }

        if (this.isVerticalDrag) {
            this.dragOffsetY = deltaY;
            const progress = clamp(Math.abs(deltaY) / 380, 0, 1);
            const opacity = 0.95 * (1 - progress * 0.85);
            const blurProgress = clamp(Math.abs(deltaY) / BLUR_FADE_DISTANCE, 0, 1);
            const currentBlur = this.baseBackdropBlur * (1 - blurProgress);

            if (this.content) {
                this.content.style.transition = 'none';
                this.content.style.transform = `translate3d(0, ${deltaY}px, 0)`;
                this.content.style.backdropFilter = `blur(${currentBlur}px)`;
            }

            if (this.overlay) {
                this.overlay.style.background = `rgba(0, 0, 0, ${opacity})`;
            }

            return;
        }

        // Only process horizontal drag if navigation is enabled
        if (this.canNavigate) {
            const horizontalDeadzone = this.isVerticalDrag ? 0 : 6;
            if (Math.abs(deltaX) <= horizontalDeadzone && !this.isVerticalDrag) {
                this.dragOffsetX = 0;
                this.updateTrackTransform(0, false);
            } else if (!this.isVerticalDrag) {
                this.dragOffsetX = deltaX;
                this.updateTrackTransform(this.dragOffsetX, false);
            }
        }
    }

    //==============================================================================================
    /**
     * End pointer drag
     * @param {PointerEvent} event - The event that triggered the pointer drag
     * @returns {void}
     */
    private endPointerDrag(event: PointerEvent) {
        if (!this.isDragging || this.pointerId !== event.pointerId) return;

        if (this.isVerticalDrag) {
            const shouldClose = Math.abs(this.dragOffsetY) > VERTICAL_CLOSE_THRESHOLD ||
                Math.abs(this.pointerVelocityY) > VERTICAL_VELOCITY_TRIGGER;

            if (shouldClose) {
                this.log('Vertical Swipe Close Triggered', {
                    offset: this.dragOffsetY,
                    velocity: this.pointerVelocityY.toFixed(3)
                });
                this.animateVerticalDismissAndClose();
            } else {
                this.log('Vertical Swipe Cancelled', {
                    offset: this.dragOffsetY,
                    velocity: this.pointerVelocityY.toFixed(3)
                });
                this.resetVerticalDrag(true);
            }

            this.track?.classList.remove('is-dragging');
            this.isDragging = false;
            this.pointerId = null;
            this.isVerticalDrag = false;
            this.dragOffsetY = 0;
            this.pointerVelocityY = 0;

            // Reset any locked drag axis
            this.lockedDragAxis = null;
            return;
        }

        // If single photo, don't process horizontal drags
        if (!this.canNavigate) {
            this.updateTrackTransform(0, true);
            this.track?.classList.remove('is-dragging');
            this.isDragging = false;
            this.pointerId = null;
            this.dragOffsetX = 0;
            this.pointerVelocityX = 0;
            this.lockedDragAxis = null;
            return;
        }

        // if we can navigate, check if the drag offset is greater than the drag threshold or the pointer velocity is greater than the velocity trigger
        const shouldAdvance = this.canNavigate && (
            Math.abs(this.dragOffsetX) > (this.options.dragThreshold ?? DEFAULT_OPTIONS.dragThreshold) ||
            Math.abs(this.pointerVelocityX) > VELOCITY_TRIGGER
        );

        if (shouldAdvance) {
            const direction = this.dragOffsetX < 0 ? 'next' : 'prev';
            this.log('Swipe Advance', {
                direction,
                offset: this.dragOffsetX,
                velocity: this.pointerVelocityX.toFixed(3)
            });
            if (this.dragOffsetX < 0) {
                this.next();
            } else {
                this.prev();
            }
        } else {
            this.updateTrackTransform(0, true);
            this.log('Swipe Cancelled', {
                offset: this.dragOffsetX,
                velocity: this.pointerVelocityX.toFixed(3)
            });
        }

        this.track?.classList.remove('is-dragging');

        this.isDragging = false;
        this.pointerId = null;
        this.dragOffsetX = 0;
        this.pointerVelocityX = 0;

        // Reset any locked drag axis
        this.lockedDragAxis = null;
    }
}
