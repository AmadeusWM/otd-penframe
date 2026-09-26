import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AreaSpotlight} from './overlay.js';
import {WindowTracker} from './windowTracker.js';
import {toDisplayArea, type Rect} from './geometry.js';
import {OtdClient} from './otdClient.js';
import {CalibrationRunner} from './calibrationRunner.js';
import {MappingController} from './mappingController.js';
import {PenActivity} from './penActivity.js';
import type {PenMessage} from './penProtocol.js';

// A new enable/settings session must wait for the previous mapping's restoration.
let previousShutdown: Promise<void> = Promise.resolve();

export default class Penframe extends Extension {
    private settings: Gio.Settings | null = null;
    private settingsSignal = 0;
    private monitorSignal = 0;
    private spotlight: AreaSpotlight | null = null;
    private tracker: WindowTracker | null = null;
    private calibration: CalibrationRunner | null = null;
    private calibrationTask: Promise<void> = Promise.resolve();
    private startup: Promise<void> = Promise.resolve();
    private mapping: MappingController | null = null;
    private activity: PenActivity | null = null;
    private automatic = false;
    private generation = 0;
    private bindingRegistered = false;
    private desired: Rect | null = null;
    private applied: Rect | null = null;
    private penVisible = false;
    private penContact = false;
    private hideTimer = 0;
    private monitorChanged = false;
    private lastHelperError = '';

    override enable(): void {
        const generation = ++this.generation;
        try {
            const settings = this.getSettings();
            this.settings = settings;
            this.automatic = settings.get_boolean('automatic-enabled');
            this.monitorChanged = false;
            this.spotlight = new AreaSpotlight();
            this.tracker = new WindowTracker(
                () => ({width: settings.get_int('area-width'), height: settings.get_int('area-height')}),
                () => settings.get_int('settle-delay-ms'),
                area => this.targetChanged(area),
            );
            this.settingsSignal = settings.connect('changed', () => {
                this.disable();
                this.enable();
            });
            this.monitorSignal = Main.layoutManager.connect('monitors-changed', () => {
                if (!this.automatic)
                    return;
                this.monitorChanged = true;
                this.targetChanged(null);
                this.report(new Error('Monitor layout changed. Check OTD display coordinates, then re-enable Penframe.'));
            });
            Main.wm.addKeybinding('calibrate-area', settings, Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL, () => {
                    if (this.calibration)
                        this.calibration.cancel();
                    else
                        this.calibrationTask = this.startCalibration();
                });
            this.bindingRegistered = true;
            if (this.automatic) {
                this.startup = this.startAutomatic(generation).catch((error: unknown) => {
                    if (generation === this.generation) {
                        this.mapping?.setContact(null);
                        this.applied = null;
                        this.render();
                        this.report(error);
                    }
                });
            }
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    private client(): OtdClient {
        const settings = this.settings!;
        const executable = settings.get_string('otd-executable') || GLib.find_program_in_path('otd');
        if (!executable)
            throw new Error('Cannot find OTD. Set otd-executable to its absolute path.');
        return new OtdClient(executable, settings.get_string('tablet-profile'));
    }

    private async startAutomatic(generation: number): Promise<void> {
        await previousShutdown;
        if (generation !== this.generation)
            return;
        const client = this.client();
        await client.verifyVersion();
        if (generation !== this.generation)
            return;
        const mapping = new MappingController(client, target => {
            if (generation !== this.generation)
                return;
            this.applied = target.rect;
            this.render();
        }, error => {
            if (generation !== this.generation)
                return;
            this.applied = null;
            this.render();
            this.report(error);
        });
        this.mapping = mapping;
        await mapping.start();
        if (generation !== this.generation)
            return;
        this.targetChanged(this.tracker?.currentArea() ?? null);
        const executable = this.settings!.get_string('activity-helper') ||
            GLib.find_program_in_path('penframe-activity');
        if (!executable)
            throw new Error('Cannot find penframe-activity. Set activity-helper to its absolute path.');
        this.activity = new PenActivity(executable, message => this.penChanged(message));
    }

    private targetChanged(area: Rect | null): void {
        this.desired = this.monitorChanged ? null : area;
        if (this.automatic) {
            const displayArea = this.desired && toDisplayArea(this.desired, Main.layoutManager.monitors);
            this.mapping?.setTarget(displayArea && this.desired ? {area: displayArea, rect: this.desired} : null);
            this.render();
        } else {
            if (!area)
                this.calibration?.cancel();
            if (!this.calibration || !area)
                this.spotlight?.showArea(area);
        }
    }

    private penChanged(message: PenMessage): void {
        this.cancelHideTimer();
        if (message.type === 'unavailable') {
            this.mapping?.setContact(null);
            this.applied = null;
            this.penContact = false;
            this.penVisible = false;
            this.render();
            if (this.lastHelperError !== message.reason) {
                this.lastHelperError = message.reason;
                this.report(new Error(message.reason));
            }
            return;
        }
        this.lastHelperError = '';
        const wasContact = this.penContact;
        this.penContact = message.contact;
        // Recompute on release so a still-pending movement timer cannot apply stale geometry.
        if (wasContact && !message.contact)
            this.targetChanged(this.tracker?.currentArea() ?? null);
        this.mapping?.setContact(message.contact);
        if (message.contact || message.activity)
            this.penVisible = true;
        if (!message.contact && !message.proximity)
            this.penVisible = false;
        if (!message.contact && this.penVisible) {
            this.hideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                this.settings!.get_int('outline-idle-ms'), () => {
                    this.hideTimer = 0;
                    this.penVisible = false;
                    this.render();
                    return GLib.SOURCE_REMOVE;
                });
        }
        this.render();
    }

    private render(): void {
        this.spotlight?.showArea(this.desired && (this.penVisible || this.penContact) ? this.applied : null);
    }

    private report(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        logError(error instanceof Error ? error : new Error(message), 'OTD Penframe');
        if (this.settings)
            Main.notify('OTD Penframe', message);
    }

    private async startCalibration(): Promise<void> {
        if (this.automatic)
            return;
        if (this.calibration) {
            this.calibration.cancel();
            return;
        }
        const settings = this.settings;
        const target = this.tracker?.currentArea();
        if (!settings?.get_boolean('calibration-enabled') || !target)
            return;
        const area = toDisplayArea(target, Main.layoutManager.monitors);
        if (!area)
            return;
        const generation = this.generation;
        const calibration = new CalibrationRunner();
        this.calibration = calibration;
        this.spotlight?.showArea(null);
        try {
            await previousShutdown;
            if (generation !== this.generation)
                return;
            await calibration.run(this.client(), area, () => {
                if (this.calibration === calibration)
                    this.spotlight?.showArea(target);
            });
        } catch (error) {
            this.report(error);
        } finally {
            if (this.calibration === calibration) {
                this.calibration = null;
                this.tracker?.refresh();
            }
        }
    }

    private cancelHideTimer(): void {
        if (this.hideTimer)
            GLib.Source.remove(this.hideTimer);
        this.hideTimer = 0;
    }

    override disable(): void {
        ++this.generation;
        if (this.bindingRegistered)
            Main.wm.removeKeybinding('calibrate-area');
        this.bindingRegistered = false;
        this.calibration?.cancel();
        this.calibration = null;
        this.activity?.stop();
        this.activity = null;
        const mapping = this.mapping;
        mapping?.setTarget(null);
        this.mapping = null;
        previousShutdown = Promise.all([previousShutdown, this.startup, this.calibrationTask])
            .then(() => mapping?.stop()).catch((error: unknown) => this.report(error));
        this.startup = Promise.resolve();
        this.calibrationTask = Promise.resolve();
        if (this.settings && this.settingsSignal)
            this.settings.disconnect(this.settingsSignal);
        this.settingsSignal = 0;
        if (this.monitorSignal)
            Main.layoutManager.disconnect(this.monitorSignal);
        this.monitorSignal = 0;
        this.cancelHideTimer();
        this.tracker?.destroy();
        this.tracker = null;
        this.spotlight?.destroy();
        this.spotlight = null;
        this.settings = null;
        this.desired = null;
        this.applied = null;
        this.penVisible = false;
        this.penContact = false;
        this.lastHelperError = '';
    }
}
