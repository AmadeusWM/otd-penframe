import GLib from 'gi://GLib';
import type {DisplayArea} from './geometry.js';
import {calibrate} from './calibration.js';
import {OtdClient} from './otdClient.js';

// A disable/re-enable must not launch a new transaction before the old restore finishes.
let restoringOrCalibrating = false;

export class CalibrationRunner {
    private cancelled = false;
    private release: (() => void) | null = null;
    private timer = 0;

    async run(client: OtdClient, target: DisplayArea, onApplied: () => void): Promise<void> {
        if (restoringOrCalibrating)
            throw new Error('Wait for the previous calibration to restore its mapping.');
        restoringOrCalibrating = true;
        try {
            await client.verifyVersion();
            if (!this.cancelled) {
                await calibrate(client, target, () => this.cancelled, onApplied, () => {
                    if (this.cancelled)
                        return Promise.resolve();
                    return new Promise<void>(resolve => {
                        this.release = resolve;
                        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30000, () => {
                            this.timer = 0;
                            this.finishHold();
                            return GLib.SOURCE_REMOVE;
                        });
                    });
                });
            }
        } finally {
            this.finishHold();
            restoringOrCalibrating = false;
        }
    }

    private finishHold(): void {
        if (this.timer) {
            GLib.Source.remove(this.timer);
            this.timer = 0;
        }
        this.release?.();
        this.release = null;
    }

    cancel(): void {
        this.cancelled = true;
        this.finishHold();
    }
}
