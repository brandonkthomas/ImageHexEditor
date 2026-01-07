/**
 * dialogs.ts
 * @fileoverview Glass-surface dialog UI kit (alerts, confirms, prompts)
 */

import { createGlassSurface } from './glassSurface';
import type { GlassSurfaceInstance } from './glassSurface';
import { logEvent, LogData, LogLevel } from './common';

const logDialogs = (event: string, data?: LogData, note?: string, level: LogLevel = 'info') => {
    logEvent('dialogs', event, data, note, level);
};

//==============================================================================================
// Types

export type DialogKind = 'alert' | 'confirm' | 'prompt';
export type DialogVariant = 'default' | 'danger' | 'success' | 'info';

export interface BaseDialogOptions {
    /**
     * Dialog title text
     */
    title?: string;
    /**
     * Main message HTML text (simple markup allowed) or plain string
     */
    message?: string;
    /**
     * Optional HTML content node to inject as the message body
     */
    contentNode?: HTMLElement;
    /**
     * Visual variant for accent color
     */
    variant?: DialogVariant;
    /**
     * Custom primary button label
     */
    primaryLabel?: string;
    /**
     * Optional secondary button label (cancel)
     */
    secondaryLabel?: string;
    /**
     * Allow closing via ESC key (default: true)
     */
    allowEscapeClose?: boolean;
    /**
     * Allow closing by clicking on the backdrop (default: true for alert/confirm, false for prompt)
     */
    allowBackdropClose?: boolean;
    /**
     * Optional CSS width for the dialog card (default: 'min(420px, 100%)')
     */
    width?: string;
}

export interface AlertOptions extends BaseDialogOptions {
    kind?: Extract<DialogKind, 'alert'>;
}

export interface ConfirmOptions extends BaseDialogOptions {
    kind?: Extract<DialogKind, 'confirm'>;
}

export interface PromptOptions extends BaseDialogOptions {
    kind?: Extract<DialogKind, 'prompt'>;
    /**
     * Placeholder text for the input
     */
    placeholder?: string;
    /**
     * Default value for the input
     */
    defaultValue?: string;
    /**
     * If true, an empty value is not allowed and will keep the dialog open on submit
     */
    required?: boolean;
}

export type AnyDialogOptions = AlertOptions | ConfirmOptions | PromptOptions;

//==============================================================================================
// Internal helpers

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
        for (const [key, value] of Object.entries(attrs)) {
            el.setAttribute(key, value);
        }
    }
    return el;
}

//==============================================================================================
// Dialog manager

class DialogManager {
    private activeOverlay: HTMLElement | null = null;
    private glassSurface: GlassSurfaceInstance | null = null;
    private lastFocusedElement: HTMLElement | null = null;
    private bodyOverflowBefore: string | null = null;

    // Simple mutex to avoid overlapping dialogs; queue could be added later if needed
    private isOpen = false;

    private log(event: string, data?: LogData, note?: string, level: LogLevel = 'info') {
        logEvent('dialogs', event, data, note, level);
    }

    //------------------------------------------------------------------------------------------
    /**
     * Show an alert dialog
     */
    alert(options: string | AlertOptions): Promise<void> {
        const opts: AlertOptions = typeof options === 'string' ? { message: options } : options || {};
        opts.kind = 'alert';
        return new Promise<void>((resolve) => {
            this.openInternal(opts, () => resolve(undefined), () => resolve(undefined));
        });
    }

    //------------------------------------------------------------------------------------------
    /**
     * Show a confirmation dialog
     */
    confirm(options: string | ConfirmOptions): Promise<boolean> {
        const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options || {};
        opts.kind = 'confirm';
        return new Promise<boolean>((resolve) => {
            this.openInternal(opts, () => resolve(true), () => resolve(false));
        });
    }

    //------------------------------------------------------------------------------------------
    /**
     * Show a prompt dialog
     */
    prompt(options: string | PromptOptions): Promise<string | null> {
        const opts: PromptOptions = typeof options === 'string' ? { message: options } : options || {};
        opts.kind = 'prompt';
        return new Promise<string | null>((resolve) => {
            this.openInternal(
                opts,
                (value?: string) => resolve(value ?? null),
                () => resolve(null)
            );
        });
    }

    //------------------------------------------------------------------------------------------
    private openInternal(
        options: AnyDialogOptions,
        onResolve: (value?: string) => void,
        onReject: () => void
    ) {
        if (this.isOpen) {
            this.closeInternal(false);
        }
        this.isOpen = true;

        const kind: DialogKind =
            (options.kind as DialogKind) ||
            (('placeholder' in options || 'defaultValue' in options) ? 'prompt' : 'alert');

        const variant: DialogVariant = options.variant || (kind === 'confirm' ? 'info' : 'default');

        const allowEscapeClose = options.allowEscapeClose !== false;
        const allowBackdropClose =
            typeof options.allowBackdropClose === 'boolean'
                ? options.allowBackdropClose
                : kind !== 'prompt';

        // Create overlay
        const overlay = createElement('div', ['ui-dialog-overlay']);
        overlay.setAttribute('role', 'presentation');

        // Create glass surface
        const glass = createGlassSurface({
            width: 'auto',
            height: 'auto',
            borderRadius: 18,
            borderWidth: 0.07,
            brightness: 50,
            opacity: 0.93,
            blur: 26,
            displace: 0,
            backgroundOpacity: 0.16,
            saturation: 0.9,
            distortionScale: -18,
            redOffset: 8,
            greenOffset: 8,
            blueOffset: 8,
            xChannel: 'R',
            yChannel: 'G',
            mixBlendMode: 'difference',
            className: `ui-dialog-glass ui-dialog-glass--${variant}`,
            style: {
                minWidth: '260px',
                maxWidth: options.width || 'min(500px, 100%)',
            },
        });

        const dialogRoot = glass.element;
        dialogRoot.classList.add('ui-dialog');
        dialogRoot.setAttribute('role', 'dialog');
        dialogRoot.setAttribute('aria-modal', 'true');

        const content = glass.contentElement;
        content.classList.add('ui-dialog-inner');

        const header = createElement('header', ['ui-dialog-header']);
        const titleId = `ui-dialog-title-${Date.now().toString(36)}`;

        const titleText =
            options.title ||
            (kind === 'confirm'
                ? 'Are you sure?'
                : kind === 'prompt'
                ? 'Enter a value'
                : 'Notice');

        const titleEl = createElement('h2', ['ui-dialog-title']);
        titleEl.id = titleId;
        titleEl.textContent = titleText;
        header.appendChild(titleEl);

        const body = createElement('div', ['ui-dialog-body']);
        const messageId = `ui-dialog-message-${Date.now().toString(36)}`;
        body.id = messageId;

        if (options.contentNode) {
            body.appendChild(options.contentNode);
        } else if (options.message) {
            const messageEl = createElement('p', ['ui-dialog-message']);
            // Allow simple text; keep HTML injection controlled by caller
            messageEl.innerHTML = options.message;
            body.appendChild(messageEl);
        }

        const footer = createElement('footer', ['ui-dialog-footer']);

        const primaryLabel =
            options.primaryLabel ||
            (kind === 'confirm' ? 'Confirm' : kind === 'prompt' ? 'OK' : 'OK');
        const secondaryLabel =
            options.secondaryLabel ||
            (kind === 'confirm' || kind === 'prompt' ? 'Cancel' : undefined);

        const primaryBtn = createElement(
            'button',
            ['ui-dialog-button', 'ui-dialog-button--primary', `ui-dialog-button--${variant}`],
            { type: 'button' }
        );
        primaryBtn.textContent = primaryLabel;

        let inputEl: HTMLInputElement | null = null;
        if (kind === 'prompt') {
            inputEl = createElement('input', ['ui-dialog-input'], {
                type: 'text',
                autocomplete: 'off',
                spellcheck: 'false',
            }) as HTMLInputElement;
            if ((options as PromptOptions).placeholder) {
                inputEl.placeholder = (options as PromptOptions).placeholder as string;
            }
            if ((options as PromptOptions).defaultValue) {
                inputEl.value = (options as PromptOptions).defaultValue as string;
            }
            body.appendChild(inputEl);
        }

        const buttons: HTMLButtonElement[] = [];

        if (secondaryLabel) {
            const secondaryBtn = createElement(
                'button',
                ['ui-dialog-button', 'ui-dialog-button--secondary'],
                { type: 'button' }
            );
            secondaryBtn.textContent = secondaryLabel;
            footer.appendChild(secondaryBtn);
            buttons.push(secondaryBtn);

            secondaryBtn.addEventListener('click', () => {
                this.log('Dismiss Secondary', { kind });
                this.closeInternal(false);
                onReject();
            });
        }

        footer.appendChild(primaryBtn);
        buttons.push(primaryBtn);

        content.appendChild(header);
        content.appendChild(body);
        content.appendChild(footer);

        overlay.appendChild(dialogRoot);
        document.body.appendChild(overlay);

        this.activeOverlay = overlay;
        this.glassSurface = glass;

        // Track focus + scrolling
        this.lastFocusedElement =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.bodyOverflowBefore = document.body.style.overflow || null;
        document.body.style.overflow = 'hidden';

        dialogRoot.setAttribute('aria-labelledby', titleId);
        dialogRoot.setAttribute('aria-describedby', messageId);

        // Focus first interactive element
        const firstFocusTarget: HTMLElement =
            (kind === 'prompt' && inputEl) ||
            primaryBtn ||
            dialogRoot;

        // Fade in
        requestAnimationFrame(() => {
            overlay.classList.add('is-visible');
            firstFocusTarget.focus();
        });

        // Interactions --------------------------------------------------------------------------

        const handlePrimary = () => {
            if (kind === 'prompt' && inputEl) {
                const value = inputEl.value;
                const required = (options as PromptOptions).required === true;
                if (required && !value.trim()) {
                    inputEl.classList.add('ui-dialog-input--invalid');
                    inputEl.focus();
                    this.log('Prompt Validation Failed', { kind });
                    return;
                }
                this.log('Resolve Primary', { kind });
                this.closeInternal(false);
                onResolve(value);
            } else {
                this.log('Resolve Primary', { kind });
                this.closeInternal(false);
                onResolve();
            }
        };

        primaryBtn.addEventListener('click', handlePrimary);

        if (kind === 'prompt' && inputEl) {
            inputEl.addEventListener('input', () => {
                inputEl!.classList.remove('ui-dialog-input--invalid');
            });
            inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    handlePrimary();
                } else if (event.key === 'Escape' && allowEscapeClose) {
                    event.preventDefault();
                    this.log('Dismiss Escape', { kind });
                    this.closeInternal(false);
                    onReject();
                }
            });
        }

        const keydownHandler = (event: KeyboardEvent) => {
            if (!this.isOpen) return;
            if (event.key === 'Escape' && allowEscapeClose) {
                event.preventDefault();
                this.log('Dismiss Escape', { kind });
                this.closeInternal(false);
                onReject();
            } else if (event.key === 'Tab') {
                // Basic focus trap
                const focusables: Array<HTMLButtonElement | HTMLInputElement> =
                    buttons.filter((btn) => !btn.disabled);
                if (kind === 'prompt' && inputEl) {
                    focusables.unshift(inputEl);
                }
                if (!focusables.length) return;

                const currentIndex = focusables.indexOf(
                    document.activeElement as HTMLButtonElement | HTMLInputElement
                );
                let nextIndex = currentIndex;

                if (event.shiftKey) {
                    nextIndex = currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1;
                } else {
                    nextIndex = currentIndex === focusables.length - 1 ? 0 : currentIndex + 1;
                }

                event.preventDefault();
                const next = focusables[nextIndex] || focusables[0];
                next.focus();
            }
        };

        document.addEventListener('keydown', keydownHandler);

        const backdropHandler = (event: MouseEvent) => {
            if (!allowBackdropClose) return;
            if (event.target === overlay) {
                this.log('Dismiss Backdrop', { kind });
                this.closeInternal(false);
                onReject();
            }
        };

        overlay.addEventListener('click', backdropHandler);

        // Store handlers on element for cleanup
        (overlay as any).__uiDialogCleanup = () => {
            document.removeEventListener('keydown', keydownHandler);
            overlay.removeEventListener('click', backdropHandler);
        };

        this.log('Opened', { kind });
    }

    //------------------------------------------------------------------------------------------
    private closeInternal(fromDestroy: boolean) {
        if (!this.isOpen) return;
        this.isOpen = false;

        const overlay = this.activeOverlay;
        const glass = this.glassSurface;

        this.activeOverlay = null;
        this.glassSurface = null;

        if (!overlay) {
            if (glass) {
                glass.destroy();
            }
            return;
        }

        const cleanup = (overlay as any).__uiDialogCleanup as (() => void) | undefined;
        if (cleanup) {
            cleanup();
        }

        overlay.classList.remove('is-visible');

        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }

        if (glass) {
            glass.destroy();
        }

        if (!fromDestroy && this.lastFocusedElement) {
            this.lastFocusedElement.focus();
        }
        this.lastFocusedElement = null;

        if (this.bodyOverflowBefore !== null) {
            document.body.style.overflow = this.bodyOverflowBefore;
        } else {
            document.body.style.overflow = '';
        }
        this.bodyOverflowBefore = null;

        this.log('Closed');
    }

    //------------------------------------------------------------------------------------------
    /**
     * Destroy any active dialog (used by consumers if they need a hard reset)
     */
    destroyActive() {
        this.closeInternal(true);
    }
}

//==============================================================================================
// Singleton and convenience exports

export const dialogManager = new DialogManager();

export function showAlert(options: string | AlertOptions): Promise<void> {
    return dialogManager.alert(options);
}

export function showConfirm(options: string | ConfirmOptions): Promise<boolean> {
    return dialogManager.confirm(options);
}

export function showPrompt(options: string | PromptOptions): Promise<string | null> {
    return dialogManager.prompt(options);
}

// Convenience globals for quick access in DevTools / simple pages
declare global {
    interface Window {
        dialogManager?: DialogManager;
        showAlert?: typeof showAlert;
        showConfirm?: typeof showConfirm;
        showPrompt?: typeof showPrompt;
    }
}

if (typeof window !== 'undefined') {
    if (!window.dialogManager) {
        window.dialogManager = dialogManager;
    }
    window.showAlert = showAlert;
    window.showConfirm = showConfirm;
    window.showPrompt = showPrompt;
}

export default dialogManager;


