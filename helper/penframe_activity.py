#!/usr/bin/env python3
"""Observe only OTD's Artist tablet; never grab or inject events."""

import json
import select
import sys
import time
from pathlib import Path

from evdev import InputDevice
from evdev import ecodes as e

DEVICE_NAME = "OpenTabletDriver Virtual Artist Tablet"


def emit(message):
    print(json.dumps({"version": 1, **message}), flush=True)


class PenState:
    def __init__(self, keys, pressure):
        self.keys = set(keys)
        self.pressure = pressure
        self.dirty = False
        self.previous = None
        self.last_activity = float("-inf")

    def message(self, now, initial=False):
        proximity = bool(self.keys & {e.BTN_TOOL_PEN, e.BTN_TOOL_RUBBER})
        # Do not infer tip-up from a missing tool bit during eraser transitions.
        contact = e.BTN_TOUCH in self.keys or self.pressure > 0
        state = (proximity, contact)
        activity = self.dirty and (proximity or contact)
        changed = state != self.previous
        if initial or changed or (activity and now - self.last_activity >= 0.05):
            self.previous = state
            if activity:
                self.last_activity = now
            self.dirty = False
            return {"type": "state", "proximity": proximity,
                    "contact": contact, "activity": activity and not initial}
        self.dirty = False
        return None

    def feed(self, event, now):
        if event.type == e.EV_KEY:
            if event.value:
                self.keys.add(event.code)
            else:
                self.keys.discard(event.code)
            self.dirty = True
        elif event.type == e.EV_ABS:
            if event.code == e.ABS_PRESSURE:
                self.pressure = event.value
            self.dirty = True
        elif event.type == e.EV_SYN and event.code == e.SYN_REPORT:
            return self.message(now)
        return None


def discover():
    matches = []
    for entry in Path("/sys/class/input").glob("event*"):
        try:
            if (entry / "device/name").read_text().strip() == DEVICE_NAME:
                matches.append(Path("/dev/input") / entry.name)
        except FileNotFoundError:
            continue
    if not matches:
        raise OSError("OTD Artist tablet is not connected")
    if len(matches) != 1:
        raise OSError("Expected exactly one OTD Artist tablet")
    try:
        device = InputDevice(str(matches[0]))
    except PermissionError as error:
        raise PermissionError(f"Read access required for {matches[0]} ({DEVICE_NAME})") from error
    capabilities = device.capabilities(absinfo=False)
    if device.name != DEVICE_NAME or not {e.ABS_X, e.ABS_Y, e.ABS_PRESSURE}.issubset(
        capabilities.get(e.EV_ABS, [])
    ) or not {e.BTN_TOUCH, e.BTN_TOOL_PEN}.issubset(capabilities.get(e.EV_KEY, [])):
        device.close()
        raise OSError("OTD Artist tablet has unexpected capabilities")
    return device


def snapshot(device):
    return PenState(device.active_keys(), device.absinfo(e.ABS_PRESSURE).value)


def observe(device):
    state = snapshot(device)
    emit(state.message(time.monotonic(), initial=True))
    dropped = False
    while True:
        # A readable fd also reports device removal. No timeout guesses tip-up.
        select.select([device.fd], [], [])
        try:
            events = list(device.read())
        except BlockingIOError:
            continue
        for event in events:
            if event.type == e.EV_SYN and event.code == e.SYN_DROPPED:
                dropped = True
                emit({"type": "unavailable", "reason": "Tablet events lost; resynchronizing"})
                continue
            if dropped:
                if event.type == e.EV_SYN and event.code == e.SYN_REPORT:
                    state = snapshot(device)
                    emit(state.message(time.monotonic(), initial=True))
                    dropped = False
                continue
            message = state.feed(event, time.monotonic())
            if message:
                emit(message)


def main():
    # Bounded retries prevent a broken device/permission configuration from looping forever.
    for attempt in range(10):
        device = None
        try:
            device = discover()
            observe(device)
        except OSError as error:
            emit({"type": "unavailable", "reason": str(error)})
        finally:
            if device:
                device.close()
        if attempt < 9:
            time.sleep(2)
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (BrokenPipeError, KeyboardInterrupt):
        pass
