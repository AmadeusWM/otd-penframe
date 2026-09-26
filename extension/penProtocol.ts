export type PenMessage =
    | {version: 1; type: 'state'; contact: boolean; proximity: boolean; activity: boolean}
    | {version: 1; type: 'unavailable'; reason: string};

export function parsePenMessage(line: string): PenMessage {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1 ||
        !('type' in value))
        throw new Error('Invalid pen activity protocol message');
    if (value.type === 'state' && 'contact' in value && typeof value.contact === 'boolean' &&
        'proximity' in value && typeof value.proximity === 'boolean' &&
        'activity' in value && typeof value.activity === 'boolean')
        return {version: 1, type: 'state', contact: value.contact,
            proximity: value.proximity, activity: value.activity};
    if (value.type === 'unavailable' && 'reason' in value && typeof value.reason === 'string')
        return {version: 1, type: 'unavailable', reason: value.reason};
    throw new Error('Invalid pen activity protocol message');
}
