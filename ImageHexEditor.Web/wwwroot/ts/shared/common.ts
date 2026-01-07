/**
 * common.js
 * @fileoverview Shared functions used by other modules
 * @description Handles mobile detection, URL path display, navigation
 */

//==============================================================================================
/**
 * Detects if the current device is a mobile device
 * @function isMobile
 * @returns {boolean} true if mobile; else false
 * @description Checks for touch capability and screen width to determine if device is mobile
 */
export function isMobile(): boolean {
    // Check if device has touch capability
    const hasTouch: boolean = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Check screen width (768px as common breakpoint)
    const isSmallScreen: boolean = window.innerWidth <= 768;

    return hasTouch && isSmallScreen;
}

//==============================================================================================
/**
 * Checks if the current page is an error page
 * @function isErrorPage
 * @returns {boolean} true if error page; else false
 * @description Checks for presence of error-message element to determine if page is an error page
 */
export function isErrorPage(): boolean {
    return !!document.querySelector('.error-message');
}

//==============================================================================================
/**
 * Check if browser supports SVG filters with backdrop-filter
 * BT 2025-10-24: is user agent still the most reliable way to figure this out?
 * @function supportsSVGFilters
 * @param {string} filterId - The filter ID to test
 * @returns {boolean} True if SVG filters are supported
 */
export function supportsSVGFilters(filterId: string): boolean {
    const ua: string = navigator.userAgent || '';
    const isIOS: boolean = /iP(hone|ad|od)/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isFirefox: boolean = /Firefox/i.test(ua);
    const isWebkit: boolean = /Safari/.test(ua) && !/Chrome/.test(ua);

    // Force fallback on iOS/WebKit (Safari, Chrome on iOS, in-app WebViews like Instagram) and Firefox
    if (isIOS || isWebkit || isFirefox) {
        return false;
    }

    // Ensure backdrop-filter is supported at all
    const hasBackdrop: boolean = (window.CSS && (CSS.supports('backdrop-filter', 'blur(1px)') 
        || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')));

    if (!hasBackdrop) {
        return false;
    }

    // Heuristic: property assignment acceptance (not fully reliable but sufficient for non-iOS Blink)
    const div: HTMLDivElement = document.createElement('div');
    div.style.backdropFilter = `url(#${filterId})`;
    return div.style.backdropFilter !== '';
}

//==============================================================================================
/**
 * Detect the current operating system
 * @returns {string} One of 'Windows','macOS','Linux','Android','iOS','ChromeOS','Unknown'
 */
export function getOperatingSystem(): 'Windows' | 'macOS' | 'Linux' | 'Android' | 'iOS' | 'ChromeOS' | 'Unknown' {
    const ua: string = navigator.userAgent || '';

    // platform is deprecated; userAgentData (recommended alternative) isn't supported by FF/Safari...??? love it
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform: string = nav.userAgentData?.platform || navigator.platform || '';
    const p: string = String(platform).toLowerCase();

    switch (true) {
        case /iphone|ipad|ipod/i.test(ua):
            return 'iOS';
        case /android/i.test(ua):
            return 'Android';
        case /cros/i.test(ua):
            return 'ChromeOS';
        case /(win32|win64|windows|wow64)/i.test(p):
        case /Windows NT/i.test(ua):
            return 'Windows';
        case /mac|macintel|macintosh|macos/i.test(p):
        case /Mac OS X/i.test(ua):
            return 'macOS';
        case /linux/i.test(p):
        case /Linux/i.test(ua):
            return 'Linux';
        default:
            return 'Unknown';
    }
}

//==============================================================================================
/**
 * Determine if Kestrel debugger is attached (from server-injected flag)
 * @returns {boolean} True if a debugger is attached
 */
export function isKestrelDebuggerAttached(): boolean {
    return !!(window as any).__dotnetDebuggerAttached;
}

/**
 * Global debug status flag
 * @returns {boolean} True if Kestrel debugger is attached (or if overridden via devtools)
 */
export function isDebug(): boolean {
    return isKestrelDebuggerAttached() || !!(window as any).__debugOverrideFlag;
}

//==============================================================================================
export type LogLevel = 'info' | 'warn' | 'error';
export type LogData = Record<string, string | number | boolean | null | undefined>;

/**
 * Structured console logging helper to keep diagnostics uniform.
 */
export function logEvent(
    component: string,
    event: string,
    data?: LogData | null,
    note?: string,
    level: LogLevel = 'info'
) {
    const logger =
        level === 'error' ? console.error :
        level === 'warn' ? console.warn :
        console.log;

    const fieldSegment = data
        ? Object.entries(data)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${value === null ? 'null' : String(value)}`)
            .join(' ')
        : '';

    const noteSegment = note ? ` (${note})` : '';
    const message =
        fieldSegment
            ? `[${component}] ${event} – ${fieldSegment}${noteSegment}`
            : `[${component}] ${event}${noteSegment}`;

    logger(message);
}

// DevTools helper to toggle client-side debug without query params
if (!(window as any).setDebugOverride) {
    (window as any).setDebugOverride = (value: boolean) => {
        (window as any).__debugOverrideFlag = !!value;
        // Inform global perf monitor if present
        const perf = (window as any).perf;
        if (perf && typeof perf.setEnabled === 'function') {
            perf.setEnabled(!!value || isKestrelDebuggerAttached());
        }
    };
}

//==============================================================================================

document.addEventListener('DOMContentLoaded', () => {
    
    // Minimal global pinch-zoom prevention (does not affect single-tap/double-tap)
    const isTouchEnv: boolean = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchEnv) {
        const preventIfPinch = (e: TouchEvent) => {
            if (e.touches && e.touches.length > 1) {
                e.preventDefault();
            }
        };

        document.addEventListener('touchstart', preventIfPinch, { passive: false });
        document.addEventListener('touchmove', preventIfPinch, { passive: false });

        const preventGesture = (e: Event) => { e.preventDefault(); };

        document.addEventListener('gesturestart', preventGesture, { passive: false });
        document.addEventListener('gesturechange', preventGesture, { passive: false });
        document.addEventListener('gestureend', preventGesture, { passive: false });
    }
    // Update URL path display
    const updateUrlPath = (): void => {
        const pathElement = document.querySelector<HTMLElement>('.url-path');

        if (pathElement) {
            const path = window.location.pathname;
            pathElement.textContent = path === '/' ? '/' : path;
        }
    };

    // Handle path option clicks with separate handlers for internal and external links
    const urlPaths = document.querySelector<HTMLElement>('.url-paths');

    if (urlPaths) {
        const internalLinks = document.querySelectorAll<HTMLElement>('.url-path-option:not(.url-external)');

        // Handle internal navigation
        internalLinks.forEach(link => {
            link.addEventListener('click', (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                const href: string | null = link.getAttribute('href');
                if (href) {
                    history.pushState({}, '', href);
                    updateUrlPath();
                }
            });
        });
    }

    // Handle mobile tap/click for URL display
    const navbar = document.querySelector<HTMLElement>('.navbar');
    if (navbar) {
        navbar.addEventListener('click', (e: MouseEvent) => {
            // Only toggle if we're on a mobile device (no hover capability)
            if (window.matchMedia('(hover: none)').matches) {
                navbar.classList.toggle('active');
            }
        });

        // Close the menu when clicking outside
        document.addEventListener('click', (e: MouseEvent) => {
            if (!(e.target instanceof Node)) { return; }
            if (navbar && !navbar.contains(e.target)) {
                navbar.classList.remove('active');
            }
        });
    }

    // Update initially and when the path changes
    updateUrlPath();
    window.addEventListener('popstate', updateUrlPath);

    // Lazy-load error page
    // if (isErrorPage()) {
    //     import('./pages/error').then(mod => {
    //         const init = (mod as any).default as (() => void) | undefined;
    //         if (typeof init === 'function') {
    //             init();
    //         }
    //     }).catch(() => { /* swallow */ });
    // }
});
