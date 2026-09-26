import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MappingController, type MappingTarget} from '../extension/mappingController.js';
import type {AreaClient} from '../extension/calibration.js';
import type {DisplayArea} from '../extension/geometry.js';

const baseline = {width: 800, height: 500, centerX: 400, centerY: 1186};
const target = (x: number): MappingTarget => ({
    area: {...baseline, centerX: x + 400, centerY: 500},
    rect: {x, y: 250, width: 800, height: 500},
});
const tick = async (): Promise<void> => { await new Promise(resolve => setImmediate(resolve)); };

class Client implements AreaClient {
    area = baseline;
    writes: DisplayArea[] = [];
    reads = 0;
    async readArea(): Promise<DisplayArea> { this.reads++; return this.area; }
    async writeArea(area: DisplayArea): Promise<void> { this.writes.push(area); this.area = area; }
}

function setup(client = new Client()) {
    const applied: MappingTarget[] = [];
    const errors: unknown[] = [];
    const controller = new MappingController(client, value => applied.push(value), error => errors.push(error));
    return {client, controller, applied, errors};
}

test('waits for known tip-up, applies once, ignores repeated activity, restores baseline', async () => {
    const {client, controller, applied} = setup();
    await controller.start();
    controller.setTarget(target(200));
    await controller.idle();
    assert.equal(client.writes.length, 0);
    controller.setContact(false);
    await controller.idle();
    assert.deepEqual(applied, [target(200)]);
    const reads = client.reads;
    for (let i = 0; i < 100; i++) controller.setContact(false);
    await controller.idle();
    assert.equal(client.reads, reads, 'motion must not invoke OTD');
    await controller.stop();
    assert.deepEqual(client.writes, [target(200).area, baseline]);
});

test('holds current mapping during contact and applies only newest target after release', async () => {
    const {client, controller} = setup();
    await controller.start();
    controller.setContact(true);
    controller.setTarget(target(100));
    controller.setTarget(target(300));
    await controller.idle();
    assert.equal(client.writes.length, 0);
    controller.setContact(false);
    await controller.idle();
    assert.deepEqual(client.writes, [target(300).area]);
    await controller.stop();
});

test('coalesces focus changes during a write and never overlaps operations', async () => {
    const {client, controller, applied} = setup();
    let release!: () => void;
    const write = client.writeArea.bind(client);
    client.writeArea = async area => {
        await write(area);
        if (client.writes.length === 1)
            await new Promise<void>(resolve => { release = resolve; });
    };
    await controller.start();
    controller.setContact(false);
    controller.setTarget(target(100));
    await tick();
    controller.setTarget(target(200));
    controller.setTarget(target(300));
    assert.equal(client.writes.length, 1);
    assert.equal(applied.length, 0, 'must wait for readback');
    release();
    await controller.idle();
    assert.deepEqual(client.writes, [target(100).area, target(300).area]);
    await controller.stop();
});

test('rechecks contact after asynchronous ownership read', async () => {
    const {client, controller} = setup();
    await controller.start();
    const read = client.readArea.bind(client);
    client.readArea = async () => {
        controller.setContact(true);
        return read();
    };
    controller.setContact(false);
    controller.setTarget(target(100));
    await controller.idle();
    assert.equal(client.writes.length, 0);
    await controller.stop();
});

test('disable waits for an in-flight command, discards pending target and restores', async () => {
    const {client, controller, applied} = setup();
    let release!: () => void;
    const write = client.writeArea.bind(client);
    client.writeArea = async area => {
        await write(area);
        if (client.writes.length === 1)
            await new Promise<void>(resolve => { release = resolve; });
    };
    await controller.start();
    controller.setContact(false);
    controller.setTarget(target(100));
    await tick();
    controller.setTarget(target(300));
    const stopped = controller.stop();
    release();
    await stopped;
    assert.deepEqual(client.writes, [target(100).area, baseline]);
    assert.equal(applied.length, 0);
});

test('external edits pause following and are not overwritten during shutdown', async () => {
    const {client, controller, errors} = setup();
    await controller.start();
    controller.setContact(false);
    controller.setTarget(target(100));
    await controller.idle();
    client.area = target(500).area;
    controller.setTarget(target(300));
    await controller.idle();
    assert.equal(errors.length, 1);
    await assert.rejects(controller.stop(), /changed externally/);
    assert.deepEqual(client.area, target(500).area);
});

test('a failed write that reached the driver can still be restored', async () => {
    const {client, controller, errors} = setup();
    const write = client.writeArea.bind(client);
    client.writeArea = async area => {
        await write(area);
        if (client.writes.length === 1) throw new Error('transport lost');
    };
    await controller.start();
    controller.setContact(false);
    controller.setTarget(target(100));
    await controller.idle();
    assert.equal(errors.length, 1);
    await controller.stop();
    assert.deepEqual(client.area, baseline);
});

test('unknown tablet state and absence of a target suspend following', async () => {
    const {client, controller} = setup();
    await controller.start();
    controller.setContact(false);
    controller.setTarget(target(100));
    controller.setContact(null);
    await controller.idle();
    assert.equal(client.writes.length, 0);
    controller.setTarget(null);
    controller.setContact(false);
    await controller.idle();
    assert.equal(client.writes.length, 0);
    await controller.stop();
});

test('device recovery revalidates ownership even when the focused window is unchanged', async () => {
    const {client, controller, applied, errors} = setup();
    await controller.start();
    controller.setContact(false);
    controller.setTarget(target(100));
    await controller.idle();
    controller.setContact(null);
    client.area = target(500).area;
    controller.setContact(false);
    await controller.idle();
    assert.equal(errors.length, 1);
    assert.equal(applied.length, 1, 'must not redisplay an unverified area after reconnect');
    await assert.rejects(controller.stop(), /changed externally/);
});
