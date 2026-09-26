import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parsePenMessage} from '../extension/penProtocol.js';

test('requires a supported version and boolean contact, proximity and activity', () => {
    const message = {version: 1, type: 'state', contact: false, proximity: true, activity: true};
    assert.deepEqual(parsePenMessage(JSON.stringify(message)), message);
    for (const invalid of [null, {}, {...message, version: 2}, {...message, contact: 0},
        {...message, activity: null}, {version: 1, type: 'unavailable'}])
        assert.throws(() => parsePenMessage(JSON.stringify(invalid)));
});
