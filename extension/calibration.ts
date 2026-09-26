import type {DisplayArea} from './geometry.js';
import {sameArea} from './otdArea.js';

export interface AreaClient {
    readArea(): Promise<DisplayArea>;
    writeArea(area: DisplayArea): Promise<void>;
}

/** A single manually triggered transaction. Callers provide the hold/cancel wait. */
export async function calibrate(
    client: AreaClient,
    target: DisplayArea,
    cancelled: () => boolean,
    onApplied: () => void,
    hold: () => Promise<void>,
): Promise<void> {
    const baseline = await client.readArea();
    if (cancelled())
        return;
    const errors: unknown[] = [];
    try {
        await client.writeArea(target);
        const actual = await client.readArea();
        if (!sameArea(actual, target))
            throw new Error('OTD readback differs from the requested calibration area.');
        if (!cancelled()) {
            onApplied();
            await hold();
        }
    } catch (error) {
        errors.push(error);
    }
    // Even a failed command may have reached the daemon. Check ownership before restoring.
    try {
        const actual = await client.readArea();
        if (sameArea(actual, target)) {
            await client.writeArea(baseline);
            if (!sameArea(await client.readArea(), baseline))
                throw new Error('OTD did not restore the original area; check its settings.');
        } else if (!sameArea(actual, baseline)) {
            throw new Error('OTD area changed externally; left that mapping in place.');
        }
    } catch (error) {
        errors.push(error);
    }
    if (errors.length === 1)
        throw errors[0];
    if (errors.length > 1)
        throw new AggregateError(errors, errors.map(String).join('\n'));
}
