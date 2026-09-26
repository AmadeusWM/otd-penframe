import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {parsePenMessage, type PenMessage} from './penProtocol.js';

/** The helper performs bounded reconnects; malformed output or EOF stops this session. */
export class PenActivity {
    private process: Gio.Subprocess | null = null;
    private stream: Gio.DataInputStream | null = null;
    private readonly cancellable = new Gio.Cancellable();
    private stopped = false;

    constructor(executable: string, private readonly onMessage: (message: PenMessage) => void) {
        if (!GLib.path_is_absolute(executable))
            throw new Error('Set activity-helper to the absolute penframe-activity executable path.');
        this.process = Gio.Subprocess.new([executable], Gio.SubprocessFlags.STDOUT_PIPE);
        this.stream = new Gio.DataInputStream({base_stream: this.process.get_stdout_pipe()!});
        this.process.wait_async(null, (process, result) => {
            try { process!.wait_finish(result); } catch (error) { logError(error); }
        });
        this.read();
    }

    private read(): void {
        this.stream!.read_line_async(GLib.PRIORITY_DEFAULT, this.cancellable, (stream, result) => {
            const input = stream as Gio.DataInputStream;
            try {
                const [line] = input.read_line_finish_utf8(result);
                if (this.stopped)
                    return;
                if (line === null)
                    throw new Error('Pen activity helper stopped. Following is suspended; re-enable Penframe to retry.');
                this.onMessage(parsePenMessage(line));
                this.read();
            } catch (error) {
                if (!this.stopped) {
                    this.onMessage({version: 1, type: 'unavailable', reason: String(error)});
                    this.stop();
                }
            } finally {
                if (this.stopped)
                    input.close(null);
            }
        });
    }

    stop(): void {
        if (this.stopped)
            return;
        this.stopped = true;
        this.cancellable.cancel();
        this.process?.force_exit();
        this.process = null;
        // The cancelled read's callback closes the stream after finishing that operation.
        this.stream = null;
    }
}
