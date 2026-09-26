from evdev import InputEvent
from evdev import ecodes as e
from penframe_activity import PenState


def event(kind, code, value):
    return InputEvent(0, 0, kind, code, value)


def report(state, now=0):
    return state.feed(event(e.EV_SYN, e.SYN_REPORT, 0), now)


def test_initial_state_is_not_activity():
    state = PenState([], 0)
    assert state.message(0, initial=True) == {
        "type": "state", "contact": False, "proximity": False, "activity": False,
    }


def test_hover_and_contact_are_coherent_and_contact_transitions_not_throttled():
    state = PenState([], 0)
    state.message(0, initial=True)
    state.feed(event(e.EV_KEY, e.BTN_TOOL_PEN, 1), 0)
    state.feed(event(e.EV_ABS, e.ABS_X, 30), 0)
    assert report(state)["activity"]
    state.feed(event(e.EV_KEY, e.BTN_TOUCH, 1), 0.001)
    state.feed(event(e.EV_ABS, e.ABS_PRESSURE, 100), 0.001)
    assert report(state, 0.001)["contact"]
    state.feed(event(e.EV_KEY, e.BTN_TOUCH, 0), 0.002)
    state.feed(event(e.EV_ABS, e.ABS_PRESSURE, 0), 0.002)
    assert not report(state, 0.002)["contact"]


def test_motion_is_throttled():
    state = PenState([e.BTN_TOOL_PEN], 0)
    state.message(0, initial=True)
    state.feed(event(e.EV_ABS, e.ABS_X, 30), 0)
    assert report(state)["activity"]
    state.feed(event(e.EV_ABS, e.ABS_X, 31), 0.01)
    assert report(state, 0.01) is None
    state.feed(event(e.EV_ABS, e.ABS_X, 32), 0.06)
    assert report(state, 0.06)["activity"]


def test_eraser_and_proximity_out():
    state = PenState([e.BTN_TOOL_RUBBER, e.BTN_TOUCH], 100)
    assert state.message(0, initial=True)["contact"]
    state.feed(event(e.EV_KEY, e.BTN_TOOL_RUBBER, 0), 0)
    assert report(state)["contact"]  # absence of a tool bit alone is not a release
    state.feed(event(e.EV_KEY, e.BTN_TOUCH, 0), 0)
    state.feed(event(e.EV_ABS, e.ABS_PRESSURE, 0), 0)
    message = report(state)
    assert not message["contact"]
    assert not message["proximity"]


def test_mouse_relative_motion_does_not_trigger_activity():
    state = PenState([], 0)
    state.message(0, initial=True)
    state.feed(event(e.EV_REL, e.REL_X, 40), 0)
    assert report(state) is None


def test_lost_events_hide_state_until_snapshot_at_next_report(monkeypatch):
    import penframe_activity as helper
    import pytest

    messages = []
    snapshots = iter([PenState([], 0), PenState([e.BTN_TOOL_PEN, e.BTN_TOUCH], 200)])

    class Device:
        fd = 1
        reads = 0

        def read(self):
            self.reads += 1
            if self.reads > 1:
                raise OSError("disconnected")
            return iter([
                event(e.EV_SYN, e.SYN_DROPPED, 0),
                event(e.EV_KEY, e.BTN_TOUCH, 0),  # incomplete report must be ignored
                event(e.EV_SYN, e.SYN_REPORT, 0),
            ])

    monkeypatch.setattr(helper, "emit", messages.append)
    monkeypatch.setattr(helper, "snapshot", lambda _: next(snapshots))
    monkeypatch.setattr(helper.select, "select", lambda *_: None)
    with pytest.raises(OSError, match="disconnected"):
        helper.observe(Device())
    assert [message["type"] for message in messages] == ["state", "unavailable", "state"]
    assert messages[-1]["contact"] is True
    assert messages[-1]["activity"] is False
