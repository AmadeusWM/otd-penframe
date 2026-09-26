// GNOME 50's test-only scripting API is not included in @girs/gnome-shell.
// Signatures verified against GNOME/gnome-shell 50.2, js/ui/scripting.js.
declare module 'resource:///org/gnome/shell/ui/scripting.js' {
    export function sleep(milliseconds: number): Promise<void>;
    export function createTestWindow(params: {width: number; height: number}): Promise<void>;
    export function waitTestWindows(): Promise<void>;
    export function destroyTestWindows(): Promise<void>;
}
