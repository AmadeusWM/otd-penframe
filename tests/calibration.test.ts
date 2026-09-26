import assert from 'node:assert/strict';
import {test} from 'node:test';
import {calibrate, type AreaClient} from '../extension/calibration.js';
import type {DisplayArea} from '../extension/geometry.js';

const baseline = {width: 800, height: 500, centerX: 400, centerY: 1186.2755};
const target = {...baseline, centerX: 1720, centerY: 720};

class FakeClient implements AreaClient {
    area = baseline;
    writes: DisplayArea[] = [];
    async readArea(): Promise<DisplayArea> { return this.area; }
    async writeArea(area: DisplayArea): Promise<void> {
        this.writes.push(area);
        this.area = area;
    }
}

test('shows only a verified target and restores the original area after holding', async () => {
    const client = new FakeClient();
    let shown = false;
    await calibrate(client, target, () => false, () => {
        assert.deepEqual(client.area, target);
        shown = true;
    }, async () => { assert(shown); });
    assert.deepEqual(client.writes, [target, baseline]);
});

test('cancellation during an in-flight write restores before completing', async () => {
    const client = new FakeClient();
    let release: (() => void) | undefined;
    let cancelled = false;
    const write = client.writeArea.bind(client);
    client.writeArea = async area => {
        await write(area);
        if (area === target)
            await new Promise<void>(resolve => { release = resolve; });
    };
    const done = calibrate(client, target, () => cancelled,
        () => assert.fail('must not show a cancelled target'), async () => {});
    await new Promise(resolve => setImmediate(resolve));
    cancelled = true;
    release!();
    await done;
    assert.deepEqual(client.writes, [target, baseline]);
});

test('does not overwrite a mapping changed externally during calibration', async () => {
    const client = new FakeClient();
    const external = {...target, width: 1000};
    await assert.rejects(calibrate(client, target, () => false, () => {}, async () => {
        client.area = external;
    }), /changed externally/);
    assert.deepEqual(client.area, external);
    assert.equal(client.writes.length, 1);
});

test('recovers when a command reports failure after applying the target', async () => {
    const client = new FakeClient();
    const write = client.writeArea.bind(client);
    client.writeArea = async area => {
        await write(area);
        if (area === target)
            throw new Error('connection lost');
    };
    await assert.rejects(calibrate(client, target, () => false, () => {}, async () => {}), /connection lost/);
    assert.deepEqual(client.area, baseline);
});

test('cancellation before baseline read completes never writes', async () => {
    const client = new FakeClient();
    await calibrate(client, target, () => true, () => assert.fail(), async () => assert.fail());
    assert.equal(client.writes.length, 0);
});
