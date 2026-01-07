/**
 * glassSurface.js
 * @fileoverview Glass surface component with SVG filter effects
 * @description Creates glass surface material with real-time distortion and lighting
 */

import { supportsSVGFilters, logEvent, LogData, LogLevel } from './common';

const logGlass = (event: string, data?: LogData, note?: string, level: LogLevel = 'info') => {
    logEvent('glassSurface', event, data, note, level);
};

let uniqueIdCounter = 0;

//==============================================================================================
// Types

export type DisplacementChannel = 'R' | 'G' | 'B' | 'A';

export interface GlassSurfaceOptions {
    width?: number | string;
    height?: number | string;
    borderRadius?: number;
    borderWidth?: number;
    brightness?: number;
    opacity?: number;
    blur?: number;
    displace?: number;
    backgroundOpacity?: number | string;
    saturation?: number | string;
    distortionScale?: number;
    redOffset?: number;
    greenOffset?: number;
    blueOffset?: number;
    xChannel?: DisplacementChannel;
    yChannel?: DisplacementChannel;
    mixBlendMode?: string;
    className?: string;
    style?: Partial<Record<string, string>>;
}

export interface GlassSurfaceInstance {
    element: HTMLDivElement;
    contentElement: HTMLDivElement;
    updateDisplacementMap: () => void;
    destroy: () => void;
}

//==============================================================================================
/**
 * Creates a glass surface effect
 * @param {Object} options - Configuration options
 * @returns {Object} Glass surface instance with methods and element reference
 */
export function createGlassSurface(options: GlassSurfaceOptions = {}): GlassSurfaceInstance {

    // Set defaults (using ternary rather than nullish coalescing for NUglify compatibility)
    if (!options) options = {};
    
    const width = options.width !== undefined ? options.width : 200;
    const height = options.height !== undefined ? options.height : 80;
    const borderRadius = options.borderRadius !== undefined ? options.borderRadius : 20;
    const borderWidth = options.borderWidth !== undefined ? options.borderWidth : 0.07;
    const brightness = options.brightness !== undefined ? options.brightness : 50;
    const opacity = options.opacity !== undefined ? options.opacity : 0.93;
    const blur = options.blur !== undefined ? options.blur : 11;
    const displace = options.displace !== undefined ? options.displace : 0;
    const backgroundOpacity = options.backgroundOpacity !== undefined ? options.backgroundOpacity : 0;
    const saturation = options.saturation !== undefined ? options.saturation : 1;
    const distortionScale = options.distortionScale !== undefined ? options.distortionScale : -180;
    const redOffset = options.redOffset !== undefined ? options.redOffset : 0;
    const greenOffset = options.greenOffset !== undefined ? options.greenOffset : 10;
    const blueOffset = options.blueOffset !== undefined ? options.blueOffset : 20;
    const xChannel = options.xChannel !== undefined ? options.xChannel : 'R';
    const yChannel = options.yChannel !== undefined ? options.yChannel : 'G';
    const mixBlendMode = options.mixBlendMode !== undefined ? options.mixBlendMode : 'difference';
    const className = options.className !== undefined ? options.className : '';
    const style: Partial<Record<string, string>> = options.style !== undefined ? options.style : {};

    // Generate unique ID
    const uniqueId = `glass-${Date.now()}-${uniqueIdCounter++}`;
    const filterId = `glass-filter-${uniqueId}`;
    const redGradId = `red-grad-${uniqueId}`;
    const blueGradId = `blue-grad-${uniqueId}`;

    // Create container element
    const container: HTMLDivElement = document.createElement('div');
    const isSVGSupported = supportsSVGFilters(filterId);

    // glass-surface--svg is SVG-based "clear glass" (not supported by WebKit)
    // glass-surface--fallback is CSS-based "frosted glass" (supported by WebKit)
    
    var glassSurfaceClass = isSVGSupported ? 'glass-surface--svg' : 'glass-surface--fallback';
    glassSurfaceClass = 'glass-surface--fallback'; // testing with frosted glass on all browsers...

    container.className = `glass-surface ${glassSurfaceClass} ${className}`.trim();
    logGlass('Surface Created', {
        svgSupported: Number(isSVGSupported),
        className
    });
    
    // Apply styles
    Object.assign(container.style, style, {
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: `${borderRadius}px`,
    });
    
    // Set CSS custom properties
    container.style.setProperty('--glass-frost', String(backgroundOpacity));
    container.style.setProperty('--glass-saturation', String(saturation));
    container.style.setProperty('--filter-id', `url(#${filterId})`);

    // Create SVG filter
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'glass-surface__filter');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', filterId);
    filter.setAttribute('colorInterpolationFilters', 'sRGB');
    filter.setAttribute('x', '0%');
    filter.setAttribute('y', '0%');
    filter.setAttribute('width', '100%');
    filter.setAttribute('height', '100%');

    // Create filter elements
    const feImage = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
    feImage.setAttribute('x', '0');
    feImage.setAttribute('y', '0');
    feImage.setAttribute('width', '100%');
    feImage.setAttribute('height', '100%');
    feImage.setAttribute('preserveAspectRatio', 'none');
    feImage.setAttribute('result', 'map');

    // Red channel
    const feDispRed = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    feDispRed.setAttribute('in', 'SourceGraphic');
    feDispRed.setAttribute('in2', 'map');
    feDispRed.setAttribute('id', 'redchannel');
    feDispRed.setAttribute('result', 'dispRed');
    feDispRed.setAttribute('scale', (distortionScale + redOffset).toString());
    feDispRed.setAttribute('xChannelSelector', xChannel);
    feDispRed.setAttribute('yChannelSelector', yChannel);

    const feColorMatrixRed = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
    feColorMatrixRed.setAttribute('in', 'dispRed');
    feColorMatrixRed.setAttribute('type', 'matrix');
    feColorMatrixRed.setAttribute('values', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0');
    feColorMatrixRed.setAttribute('result', 'red');

    // Green channel
    const feDispGreen = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    feDispGreen.setAttribute('in', 'SourceGraphic');
    feDispGreen.setAttribute('in2', 'map');
    feDispGreen.setAttribute('id', 'greenchannel');
    feDispGreen.setAttribute('result', 'dispGreen');
    feDispGreen.setAttribute('scale', (distortionScale + greenOffset).toString());
    feDispGreen.setAttribute('xChannelSelector', xChannel);
    feDispGreen.setAttribute('yChannelSelector', yChannel);

    const feColorMatrixGreen = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
    feColorMatrixGreen.setAttribute('in', 'dispGreen');
    feColorMatrixGreen.setAttribute('type', 'matrix');
    feColorMatrixGreen.setAttribute('values', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0');
    feColorMatrixGreen.setAttribute('result', 'green');

    // Blue channel
    const feDispBlue = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    feDispBlue.setAttribute('in', 'SourceGraphic');
    feDispBlue.setAttribute('in2', 'map');
    feDispBlue.setAttribute('id', 'bluechannel');
    feDispBlue.setAttribute('result', 'dispBlue');
    feDispBlue.setAttribute('scale', (distortionScale + blueOffset).toString());
    feDispBlue.setAttribute('xChannelSelector', xChannel);
    feDispBlue.setAttribute('yChannelSelector', yChannel);

    const feColorMatrixBlue = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
    feColorMatrixBlue.setAttribute('in', 'dispBlue');
    feColorMatrixBlue.setAttribute('type', 'matrix');
    feColorMatrixBlue.setAttribute('values', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0');
    feColorMatrixBlue.setAttribute('result', 'blue');

    // Blend modes
    const feBlendRG = document.createElementNS('http://www.w3.org/2000/svg', 'feBlend');
    feBlendRG.setAttribute('in', 'red');
    feBlendRG.setAttribute('in2', 'green');
    feBlendRG.setAttribute('mode', 'screen');
    feBlendRG.setAttribute('result', 'rg');

    const feBlendFinal = document.createElementNS('http://www.w3.org/2000/svg', 'feBlend');
    feBlendFinal.setAttribute('in', 'rg');
    feBlendFinal.setAttribute('in2', 'blue');
    feBlendFinal.setAttribute('mode', 'screen');
    feBlendFinal.setAttribute('result', 'output');

    const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    feGaussianBlur.setAttribute('in', 'output');
    feGaussianBlur.setAttribute('stdDeviation', displace.toString());

    // Append filter elements
    filter.appendChild(feImage);
    filter.appendChild(feDispRed);
    filter.appendChild(feColorMatrixRed);
    filter.appendChild(feDispGreen);
    filter.appendChild(feColorMatrixGreen);
    filter.appendChild(feDispBlue);
    filter.appendChild(feColorMatrixBlue);
    filter.appendChild(feBlendRG);
    filter.appendChild(feBlendFinal);
    filter.appendChild(feGaussianBlur);

    defs.appendChild(filter);
    svg.appendChild(defs);

    // Create content container
    const contentDiv = document.createElement('div');
    contentDiv.className = 'glass-surface__content';

    // Append to container
    container.appendChild(svg);
    container.appendChild(contentDiv);

    // Generate displacement map
    const generateDisplacementMap = () => {
        const rect = container.getBoundingClientRect();
        const actualWidth = rect.width || 400;
        const actualHeight = rect.height || 200;
        const edgeSize = Math.min(actualWidth, actualHeight) * (borderWidth * 0.5);

        const svgContent = `
            <svg viewBox="0 0 ${actualWidth} ${actualHeight}" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="${redGradId}" x1="100%" y1="0%" x2="0%" y2="0%">
                        <stop offset="0%" stop-color="#0000"/>
                        <stop offset="100%" stop-color="red"/>
                    </linearGradient>
                    <linearGradient id="${blueGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#0000"/>
                        <stop offset="100%" stop-color="blue"/>
                    </linearGradient>
                </defs>
                <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" fill="black"></rect>
                <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${redGradId})" />
                <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${blueGradId})" style="mix-blend-mode: ${mixBlendMode}" />
                <rect x="${edgeSize}" y="${edgeSize}" width="${actualWidth - edgeSize * 2}" height="${actualHeight - edgeSize * 2}" rx="${borderRadius}" fill="hsl(0 0% ${brightness}% / ${opacity})" style="filter:blur(${blur}px)" />
            </svg>
        `;

        return `data:image/svg+xml,${encodeURIComponent(svgContent)}`;
    };

    const updateDisplacementMap = () => {
        feImage.setAttribute('href', generateDisplacementMap());
    };

    // Initialize
    setTimeout(updateDisplacementMap, 0);

    // Setup resize observer
    const resizeObserver = new ResizeObserver(() => {
        setTimeout(updateDisplacementMap, 0);
    });
    resizeObserver.observe(container);

    // Return instance
    return {
        element: container,
        contentElement: contentDiv,
        updateDisplacementMap,
        destroy: () => {
            resizeObserver.disconnect();
            logGlass('Surface Destroyed');
        }
    };
}
