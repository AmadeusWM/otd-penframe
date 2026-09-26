import type {AreaClient} from './calibration.js';
import type {DisplayArea, Rect} from './geometry.js';
import {sameArea} from './otdArea.js';

export interface MappingTarget {
    area: DisplayArea;
    rect: Rect;
}

/** Owns one OTD mapping session. All reads, writes and shutdown are serialized. */
export class MappingController {
    private baseline: DisplayArea | null = null;
    private owned: DisplayArea | null = null;
    private attempted: DisplayArea | null = null;
    private desired: MappingTarget | null = null;
    private lastApplied: MappingTarget | null = null;
    private contact: boolean | null = null;
    private stopped = false;
    private failed = false;
    private task: Promise<void> | null = null;
    private shutdown: Promise<void> | null = null;

    constructor(
        private readonly client: AreaClient,
        private readonly onApplied: (target: MappingTarget) => void,
        private readonly onError: (error: unknown) => void,
    ) {}

    async start(): Promise<void> {
        this.baseline = await this.client.readArea();
        this.owned = this.baseline;
        this.kick();
    }

    setTarget(target: MappingTarget | null): void {
        if (target && this.desired && sameArea(target.area, this.desired.area) &&
            target.rect.x === this.desired.rect.x && target.rect.y === this.desired.rect.y)
            return;
        this.desired = target;
        this.kick();
    }

    setContact(contact: boolean | null): void {
        // Revalidate ownership after device loss/resynchronization, even at the same target.
        if (contact === null)
            this.lastApplied = null;
        if (this.contact === contact)
            return;
        this.contact = contact;
        this.kick();
    }

    private canApply(): boolean {
        return !this.stopped && !this.failed && this.contact === false &&
            this.baseline !== null && this.desired !== null;
    }

    private kick(): void {
        if (this.task || !this.canApply() || this.lastApplied === this.desired)
            return;
        this.task = this.applyPending().catch((error: unknown) => {
            this.failed = true;
            this.onError(error);
        }).finally(() => {
            this.task = null;
            if (this.canApply() && this.owned && this.desired &&
                !sameArea(this.owned, this.desired.area))
                this.kick();
        });
    }

    private async applyPending(): Promise<void> {
        while (this.canApply()) {
            // Check for external edits even if the requested target has not moved.
            const actual = await this.client.readArea();
            if (!this.owned || !sameArea(actual, this.owned))
                throw new Error('OTD mapping changed externally; automatic following is paused.');
            if (!this.canApply())
                return;
            const target = this.desired!; // newest target after the asynchronous read
            if (!sameArea(actual, target.area)) {
                this.attempted = target.area;
                await this.client.writeArea(target.area);
                if (!sameArea(await this.client.readArea(), target.area))
                    throw new Error('OTD did not confirm the automatic mapping; following is paused.');
                this.owned = target.area;
                this.attempted = null;
            }
            if (!this.stopped)
                this.onApplied(target);
            this.lastApplied = target;
            if (this.desired === target)
                return;
        }
    }

    async idle(): Promise<void> {
        await this.task;
    }

    stop(): Promise<void> {
        this.stopped = true;
        this.desired = null;
        this.shutdown ??= this.restore();
        return this.shutdown;
    }

    private async restore(): Promise<void> {
        await this.task;
        if (!this.baseline)
            return;
        const actual = await this.client.readArea();
        if (sameArea(actual, this.baseline))
            return;
        // A command can reach OTD even when the client reports failure.
        if ((this.owned && sameArea(actual, this.owned)) ||
            (this.attempted && sameArea(actual, this.attempted))) {
            await this.client.writeArea(this.baseline);
            if (!sameArea(await this.client.readArea(), this.baseline))
                throw new Error('OTD did not restore the original mapping; check its settings.');
        } else {
            throw new Error('OTD mapping changed externally; left that mapping in place.');
        }
    }
}
