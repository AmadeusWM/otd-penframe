export interface Size {
    readonly width: number;
    readonly height: number;
}

export interface Rect extends Size {
    readonly x: number;
    readonly y: number;
}

export interface DisplayArea extends Size {
    readonly centerX: number;
    readonly centerY: number;
}

function validSize(size: Size): boolean {
    return Number.isFinite(size.width) && Number.isFinite(size.height) &&
        size.width > 0 && size.height > 0;
}

function validRect(rect: Rect): boolean {
    return validSize(rect) && Number.isFinite(rect.x) && Number.isFinite(rect.y);
}

/** Keep sensitivity fixed, even when the window is smaller than the target. */
export function centeredArea(window: Rect, monitor: Rect, size: Size): Rect | null {
    if (!validRect(window) || !validRect(monitor) || !validSize(size) ||
        size.width > monitor.width || size.height > monitor.height)
        return null;

    const x = window.x + (window.width - size.width) / 2;
    const y = window.y + (window.height - size.height) / 2;
    return {
        x: Math.max(monitor.x, Math.min(x, monitor.x + monitor.width - size.width)),
        y: Math.max(monitor.y, Math.min(y, monitor.y + monitor.height - size.height)),
        width: size.width,
        height: size.height,
    };
}

/** OTD uses center coordinates relative to the virtual desktop's minimum X/Y. */
export function toDisplayArea(rect: Rect, monitors: readonly Rect[]): DisplayArea | null {
    if (!validRect(rect) || monitors.length === 0 || monitors.some(m => !validRect(m)))
        return null;
    return {
        width: rect.width,
        height: rect.height,
        centerX: rect.x + rect.width / 2 - Math.min(...monitors.map(m => m.x)),
        centerY: rect.y + rect.height / 2 - Math.min(...monitors.map(m => m.y)),
    };
}
