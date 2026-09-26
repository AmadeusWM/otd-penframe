import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type {DisplayArea} from './geometry.js';
import {areaArguments, parseDisplayArea} from './otdArea.js';

export class OtdClient {
    constructor(private readonly executable: string, private readonly tablet: string) {
        if (!GLib.path_is_absolute(executable) || !tablet.trim())
            throw new Error('Set an absolute OTD executable path and a tablet profile name.');
    }

    async verifyVersion(): Promise<void> {
        const version = (await this.command(['--version'])).trim();
        if (version !== '0.6.7')
            throw new Error(`Penframe supports OTD 0.6.7; found ${version}.`);
    }

    async readArea(): Promise<DisplayArea> {
        return parseDisplayArea(await this.command(['getareas', this.tablet]));
    }

    async writeArea(area: DisplayArea): Promise<void> {
        await this.command(['setdisplayarea', this.tablet, ...areaArguments(area)]);
    }

    private command(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            launcher.setenv('LC_ALL', 'C', true);
            let process: Gio.Subprocess;
            try {
                process = launcher.spawnv([this.executable, ...args]);
            } catch (error) {
                reject(error);
                return;
            } finally {
                launcher.close();
            }
            let timedOut = false;
            const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
                timedOut = true;
                process.force_exit();
                return GLib.SOURCE_REMOVE;
            });
            process.communicate_utf8_async(null, null, (_source, result) => {
                if (!timedOut)
                    GLib.Source.remove(timeout);
                try {
                    const [, stdout, stderr] = process.communicate_utf8_finish(result);
                    if (timedOut)
                        throw new Error('OTD command timed out; the mapping must be checked.');
                    if (!process.get_successful())
                        throw new Error(`OTD command failed: ${stderr?.trim() || 'no error details'}`);
                    resolve(stdout ?? '');
                } catch (error) {
                    reject(error);
                }
            });
        });
    }
}
