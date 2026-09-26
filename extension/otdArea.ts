import type {DisplayArea} from './geometry.js';

/** Isolated parser for the supported OTD 0.6.7 getareas output, with LC_ALL=C. */
export function parseDisplayArea(output: string): DisplayArea {
    const number = '(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)';
    const pattern = new RegExp(`^Display area: \\[${number}x${number}@<${number},\\s*${number}>:${number}°\\]`, 'm');
    const match = output.match(pattern);
    if (!match)
        throw new Error('OTD returned an unrecognized display area (expected OTD 0.6.7).');
    const [width, height, centerX, centerY, rotation] = match.slice(1).map(Number);
    if (width === undefined || height === undefined || centerX === undefined || centerY === undefined ||
        ![width, height, centerX, centerY, rotation].every(Number.isFinite) || width <= 0 || height <= 0)
        throw new Error('OTD returned an invalid display area.');
    if (rotation !== 0)
        throw new Error('Rotated display areas are not supported by this calibration.');
    return {width, height, centerX, centerY};
}

export function sameArea(a: DisplayArea, b: DisplayArea): boolean {
    return Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01 &&
        Math.abs(a.centerX - b.centerX) < 0.01 && Math.abs(a.centerY - b.centerY) < 0.01;
}

export function areaArguments(area: DisplayArea): string[] {
    if (![area.width, area.height, area.centerX, area.centerY].every(Number.isFinite) ||
        area.width <= 0 || area.height <= 0)
        throw new Error('Cannot apply an invalid display area.');
    return [area.width, area.height, area.centerX, area.centerY].map(String);
}
