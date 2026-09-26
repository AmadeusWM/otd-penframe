import assert from 'node:assert/strict';
import {test} from 'node:test';
import {areaArguments, parseDisplayArea, sameArea} from '../extension/otdArea.js';

test('reads the actual OTD 0.6.7 output separately from the tablet area', () => {
    assert.deepEqual(parseDisplayArea('Display area: [800x500@<400, 1186.2755>:0°],\n' +
        'Tablet area: [152x95@<76, 47.5>:0°],'),
    {width: 800, height: 500, centerX: 400, centerY: 1186.2755});
});

test('rejects malformed or unsupported driver output', () => {
    for (const output of ['driver unavailable', 'Display area: [0x500@<0, 0>:0°]',
        'Display area: [800x500@<0, 0>:90°]'])
        assert.throws(() => parseDisplayArea(output));
});

test('produces separate command arguments and tolerates float readback rounding', () => {
    const area = {width: 800, height: 500, centerX: 400, centerY: 1186.2755};
    assert.deepEqual(areaArguments(area), ['800', '500', '400', '1186.2755']);
    assert(sameArea(area, {...area, centerY: 1186.275}));
    assert(!sameArea(area, {...area, centerY: 1187}));
    assert.throws(() => areaArguments({...area, centerY: NaN}));
});
