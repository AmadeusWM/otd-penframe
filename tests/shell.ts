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

function outlines(): St.Widget[] {
    return Main.layoutManager.uiGroup.get_children()
        .filter((actor): actor is St.Widget => actor instanceof St.Widget &&
            actor.name === 'otd-penframe-outline');
}

export async function run(): Promise<void> {
    Main.overview.hide();
    await Scripting.sleep(500);
    assert(outlines().length === 1, 'Extension must load and create one outline');
    await Scripting.createTestWindow({width: 1000, height: 550});
    await Scripting.waitTestWindows();
    await Scripting.sleep(500);
    const window = global.get_window_actors().map(actor => actor.meta_window)
        .find(candidate => candidate?.get_wm_class()?.toLowerCase().includes('perf'));
    assert(window, 'Test window must be mapped');
    window.activate(global.get_current_time());
    await Scripting.sleep(500);
    let outline = outlines()[0]!;
    assert(outline.visible, 'Outline must appear for focused window');
    assert(outline.width === 800 && outline.height === 500, 'Outline must retain target size');
    assert(!outline.reactive && !outline.can_focus, 'Outline must not accept input or focus');

    window.move_resize_frame(true, 100, 80, 1000, 550);
    await Scripting.sleep(500);
    const frame = window.get_frame_rect();
    assert(Math.abs(outline.x + 400 - (frame.x + frame.width / 2)) < 1,
        'Outline must follow window center after movement');

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
    assert(!outline.visible, 'Outline must hide during Overview');
    Main.overview.hide();
    await Scripting.sleep(500);
    assert(outline.visible, 'Outline must return after Overview');

    await testAutomatic(uuid, window);
    await Scripting.sleep(500);
    assert(outlines().length === 0, 'Disable must remove the outline');
    Main.extensionManager.enableExtension(uuid);
    await Scripting.sleep(500);
    assert(outlines().length === 1, 'Re-enable must create exactly one outline');
    outline = outlines()[0]!;
    await Scripting.destroyTestWindows();
    await Scripting.sleep(500);
    assert(!outline.visible, 'Closing the target must hide the outline');
    print('PENFRAME_SHELL_TEST_PASS');
}
