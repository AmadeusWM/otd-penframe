import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

import {testAutomatic} from './shellAutomatic.js';

const uuid = 'otd-penframe@zendeus.github.io';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition)
        throw new Error(message);
}

function spotlights(): St.Widget[] {
    return Main.layoutManager.uiGroup.get_children()
        .filter((actor): actor is St.Widget => actor instanceof St.Widget &&
            actor.name === 'otd-penframe-spotlight');
}

async function checkSpotlight(spotlight: St.Widget, centerX: number, centerY: number): Promise<void> {
    const background = new St.Widget({
        x: spotlight.x, y: spotlight.y, width: spotlight.width, height: spotlight.height,
        style: 'background-color: rgb(200, 200, 200);', reactive: false,
    });
    Main.layoutManager.uiGroup.insert_child_below(background, spotlight);
    try {
        await Scripting.sleep(100);
        const screenshot = new Shell.Screenshot();
        // Sample both sides of all four boundaries: no stroke, fixed 800 × 500 opening.
        const samples = [
            [0, 0, 200], [-399, 0, 200], [399, 0, 200],
            [0, -249, 200], [0, 249, 200],
            [-401, 0, 172], [401, 0, 172], [0, -251, 172], [0, 251, 172],
        ] as const;
        for (const [dx, dy, expected] of samples) {
            const color = await new Promise<{red: number; green: number; blue: number}>((resolve, reject) => {
                screenshot.pick_color(Math.round(centerX + dx), Math.round(centerY + dy), (source, result) => {
                    try {
                        const [success, color] = source!.pick_color_finish(result);
                        assert(success, 'Screenshot color sampling must succeed');
                        resolve(color);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            assert([color.red, color.green, color.blue].every(value => Math.abs(value - expected) <= 2),
                `Spotlight pixel (${dx}, ${dy}) must be ${expected}, got ${color.red}/${color.green}/${color.blue}`);
        }
    } finally {
        background.destroy();
    }
}

export async function run(): Promise<void> {
    Main.overview.hide();
    await Scripting.sleep(500);
    assert(spotlights().length === 1, 'Extension must load and create one spotlight');
    await Scripting.createTestWindow({width: 1000, height: 550});
    await Scripting.waitTestWindows();
    await Scripting.sleep(500);
    const window = global.get_window_actors().map(actor => actor.meta_window)
        .find(candidate => candidate?.get_wm_class()?.toLowerCase().includes('perf'));
    assert(window, 'Test window must be mapped');
    window.activate(global.get_current_time());
    await Scripting.sleep(500);
    let spotlight = spotlights()[0]!;
    assert(spotlight.visible, 'Spotlight must appear for focused window');
    assert(spotlight.width === global.stage.width && spotlight.height === global.stage.height,
        'Spotlight must cover the desktop');
    assert(!spotlight.reactive && !spotlight.can_focus, 'Spotlight must not accept input or focus');
    const initialFrame = window.get_frame_rect();
    await checkSpotlight(spotlight, initialFrame.x + initialFrame.width / 2,
        initialFrame.y + initialFrame.height / 2);

    window.move_resize_frame(true, 100, 80, 1000, 550);
    await Scripting.sleep(500);
    const frame = window.get_frame_rect();
    await checkSpotlight(spotlight, frame.x + frame.width / 2, frame.y + frame.height / 2);

    const capture = GLib.getenv('PENFRAME_TEST_CAPTURE');
    if (capture) {
        const stream = Gio.File.new_for_path(capture).replace(null, false, Gio.FileCreateFlags.NONE, null);
        try {
            await new Shell.Screenshot().screenshot(false, stream);
        } finally {
            stream.close(null);
        }
    }

    Main.overview.show();
    await Scripting.sleep(500);
    assert(!spotlight.visible, 'Spotlight must hide during Overview');
    Main.overview.hide();
    await Scripting.sleep(500);
    assert(spotlight.visible, 'Spotlight must return after Overview');

    await testAutomatic(uuid, window);
    await Scripting.sleep(500);
    assert(spotlights().length === 0, 'Disable must remove the spotlight');
    Main.extensionManager.enableExtension(uuid);
    await Scripting.sleep(500);
    assert(spotlights().length === 1, 'Re-enable must create exactly one spotlight');
    spotlight = spotlights()[0]!;
    await Scripting.destroyTestWindows();
    await Scripting.sleep(500);
    assert(!spotlight.visible, 'Closing the target must hide the spotlight');
    print('PENFRAME_SHELL_TEST_PASS');
}
