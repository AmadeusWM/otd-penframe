import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

/** Real Shell integration with fake OTD/helper processes; never touches a real tablet. */
export async function testAutomatic(uuid: string, window: Meta.Window): Promise<void> {
    const directory = GLib.dir_make_tmp('penframe-automatic-XXXXXX');
    const python = GLib.find_program_in_path('python3');
    assert(python, 'Python is required for the fake OTD/helper processes');
    const areaPath = `${directory}/area.json`;
    const statePath = `${directory}/pen.json`;
    const original = {width: 800, height: 500, centerX: 400, centerY: 250};
    GLib.file_set_contents(areaPath, JSON.stringify(original));
    function pen(contact: boolean, proximity: boolean, activity: boolean): void {
        GLib.file_set_contents(statePath, JSON.stringify({version: 1, type: 'state', contact, proximity, activity}));
    }
    pen(false, false, false);
    function executable(name: string, body: string): string {
        const path = `${directory}/${name}`;
        GLib.file_set_contents(path, `#!${python}\n${body}`);
        Gio.File.new_for_path(path).set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NONE, null);
        return path;
    }
    const otd = executable('otd', `import json, sys\nfrom pathlib import Path
p = Path(${JSON.stringify(areaPath)})
if sys.argv[1] == '--version':
    print('0.6.7')
elif sys.argv[1] == 'getareas':
    a = json.loads(p.read_text())
    print('Display area: [{width}x{height}@<{centerX}, {centerY}>:0°],'.format(**a))
elif sys.argv[1] == 'setdisplayarea':
    p.write_text(json.dumps(dict(zip(['width', 'height', 'centerX', 'centerY'], map(float, sys.argv[3:])))))
else:
    sys.exit(1)
`);
    const helper = executable('activity', `import time\nfrom pathlib import Path
p = Path(${JSON.stringify(statePath)})
last = None
while True:
    current = p.read_text()
    if current != last:
        print(current, flush=True)
        last = current
    time.sleep(0.02)
`);
    function area(): string {
        const stream = new Gio.DataInputStream({base_stream: Gio.File.new_for_path(areaPath).read(null)});
        const [line] = stream.read_line_utf8(null);
        stream.close(null);
        return JSON.stringify(JSON.parse(line!));
    }
    const extension = Main.extensionManager.lookup(uuid)!;
    const source = Gio.SettingsSchemaSource.new_from_directory(`${extension.path}/schemas`,
        Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.otd-penframe', false)!});
    Main.extensionManager.disableExtension(uuid);
    await Scripting.sleep(300);
    settings.set_string('otd-executable', otd);
    settings.set_string('tablet-profile', 'fake-tablet');
    settings.set_string('activity-helper', helper);
    settings.set_boolean('automatic-enabled', true);
    Main.extensionManager.enableExtension(uuid);
    await Scripting.sleep(1000);
    const spotlight = Main.layoutManager.uiGroup.get_children()
        .find((actor): actor is St.Widget => actor instanceof St.Widget && actor.name === 'otd-penframe-spotlight');
    assert(spotlight, 'Automatic mode must create one spotlight');
    assert(!spotlight.visible, 'Automatic mode must stay hidden without pen activity');
    const first = area();
    assert(first !== JSON.stringify(original), 'Focus must automatically apply a mapping');
    pen(false, true, true);
    await Scripting.sleep(150);
    assert(spotlight.visible, 'Pen hover must show the verified area');
    await Scripting.sleep(1100);
    assert(!spotlight.visible, 'Inactivity must hide the area');

    pen(true, true, true);
    await Scripting.sleep(150);
    await Scripting.createTestWindow({width: 900, height: 550});
    await Scripting.waitTestWindows();
    await Scripting.sleep(300);
    const second = global.get_window_actors().map(actor => actor.meta_window)
        .find(candidate => candidate !== window && candidate?.get_wm_class()?.toLowerCase().includes('perf'));
    assert(second, 'Second test window must exist');
    second.move_resize_frame(true, 380, 170, 900, 550);
    second.activate(global.get_current_time());
    await Scripting.sleep(800);
    assert(area() === first, 'Focus changes during contact must preserve the mapping');
    assert(spotlight.visible, 'Contact must keep the spotlight visible without motion');
    pen(false, true, false);
    await Scripting.sleep(800);
    assert(area() !== first, 'Release must apply the most recent focused window');
    window.activate(global.get_current_time());
    await Scripting.sleep(600);
    assert(area() === first, 'Application switching must apply the first window again');
    pen(false, false, false);
    await Scripting.sleep(450);
    assert(!spotlight.visible, 'Proximity-out must hide the spotlight');
    Main.extensionManager.disableExtension(uuid);
    await Scripting.sleep(600);
    assert(area() === JSON.stringify(original), 'Disable must restore the baseline');
    settings.set_boolean('automatic-enabled', false);
    settings.reset('otd-executable');
    settings.reset('tablet-profile');
    settings.reset('activity-helper');
    print('PENFRAME_AUTOMATIC_TEST_PASS');
}
