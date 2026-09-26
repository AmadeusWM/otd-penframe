import assert from 'node:assert/strict';
import {test} from 'node:test';
import {centeredArea, toDisplayArea} from '../extension/geometry.js';

const monitor = {x: 0, y: 0, width: 3440, height: 1440};
const size = {width: 800, height: 500};

test('centers a fixed target in a window without changing its size', () => {
    assert.deepEqual(centeredArea({x: 400, y: 100, width: 1200, height: 900}, monitor, size),
        {x: 600, y: 300, ...size});
});

test('small dialogs retain the area and clamp at each monitor edge', () => {
    for (const [x, y, expectedX, expectedY] of [
        [0, 0, 0, 0], [3400, 0, 2640, 0], [0, 1400, 0, 940], [3400, 1400, 2640, 940],
    ]) {
        assert.deepEqual(centeredArea({x: x!, y: y!, width: 40, height: 40}, monitor, size),
            {x: expectedX, y: expectedY, ...size});
    }
});

test('rejects oversize or invalid targets instead of changing sensitivity', () => {
    assert.equal(centeredArea(monitor, monitor, {width: 4000, height: 500}), null);
    assert.equal(centeredArea(monitor, monitor, {width: 800, height: 0}), null);
    assert.equal(centeredArea({...monitor, x: NaN}, monitor, size), null);
    assert.equal(centeredArea(monitor, monitor, {width: Infinity, height: 500}), null);
});

test('supports negative origins and normalizes center coordinates for OTD', () => {
    const left = {x: -1920, y: -200, width: 1920, height: 1080};
    const area = centeredArea(left, left, size)!;
    assert.deepEqual(area, {x: -1360, y: 90, ...size});
    assert.deepEqual(toDisplayArea(area, [left, monitor]), {...size, centerX: 960, centerY: 540});
    assert.equal(toDisplayArea(area, []), null);
});

test('logical coordinates preserve fractional centers without scaling twice', () => {
    const area = centeredArea({x: 100, y: 100, width: 1001, height: 701}, monitor, size)!;
    assert.deepEqual(toDisplayArea(area, [monitor]), {...size, centerX: 600.5, centerY: 450.5});
});
