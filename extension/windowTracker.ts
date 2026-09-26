import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {centeredArea, type Rect, type Size} from './geometry.js';

interface SignalSource {
    connect(signal: string, callback: () => void): number;
    disconnect(id: number): void;
}

type Connection = {source: SignalSource; id: number};

export class WindowTracker {
    private connections: Connection[] = [];
    private windowConnections: Connection[] = [];
    private window: Meta.Window | null = null;
    private timer = 0;
    private stopped = false;

    constructor(
        private readonly size: () => Size,
        private readonly delay: () => number,
        private readonly onArea: (area: Rect | null) => void,
    ) {
        this.watch(global.display, 'notify::focus-window', () => this.trackFocus());
        this.watch(Main.layoutManager, 'monitors-changed', () => this.refresh());
        this.watch(Main.overview, 'showing', () => this.refresh());
        this.watch(Main.overview, 'hidden', () => this.refresh());
        this.watch(Main.sessionMode, 'updated', () => this.refresh());
        this.trackFocus();
    }

    private watch(source: SignalSource, signal: string, callback: () => void): void {
        this.connections.push({source, id: source.connect(signal, callback)});
    }

    private disconnectWindow(): void {
        for (const {source, id} of this.windowConnections)
            source.disconnect(id);
        this.windowConnections = [];
        this.window = null;
    }

    private trackFocus(): void {
        this.disconnectWindow();
        let window: Meta.Window | null = global.display.focus_window;
        // Popup windows may refer back to a normal window; focused dialogs remain targets.
        while (window && ![Meta.WindowType.NORMAL, Meta.WindowType.DIALOG,
            Meta.WindowType.MODAL_DIALOG].includes(window.get_window_type()))
            window = window.get_transient_for();

        if (window) {
            this.window = window;
            for (const signal of ['position-changed', 'size-changed', 'notify::minimized'])
                this.windowConnections.push({source: window,
                    id: window.connect(signal, () => this.refresh())});
            this.windowConnections.push({source: window,
                id: window.connect('unmanaged', () => {
                    this.disconnectWindow();
                    this.refresh();
                })});
        }
        // Focus changes should take effect promptly; only movement/resizing settles.
        this.cancelTimer();
        this.update();
    }

    private suspended(): boolean {
        return Main.overview.visible || Main.sessionMode.isLocked ||
            Main.sessionMode.currentMode !== 'user';
    }

    refresh(): void {
        this.cancelTimer();
        if (this.stopped)
            return;
        if (this.suspended() || !this.window || this.window.minimized) {
            this.onArea(null);
            return;
        }
        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.delay(), () => {
            this.timer = 0;
            this.update();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** A manual operation needs current geometry, not the last debounced preview. */
    currentArea(): Rect | null {
        const window = this.window;
        if (!window || window.minimized || this.suspended())
            return null;
        const monitor = Main.layoutManager.monitors[window.get_monitor()];
        return monitor ? centeredArea(window.get_frame_rect(), monitor, this.size()) : null;
    }

    private update(): void {
        this.onArea(this.currentArea());
    }

    private cancelTimer(): void {
        if (this.timer !== 0) {
            GLib.Source.remove(this.timer);
            this.timer = 0;
        }
    }

    destroy(): void {
        this.stopped = true;
        this.cancelTimer();
        this.disconnectWindow();
        for (const {source, id} of this.connections)
            source.disconnect(id);
        this.connections = [];
    }
}
