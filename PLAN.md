# OTD Penframe implementation plan

Status: implementation in progress, based on investigation on 2026-09-26.

Implementation checkpoint (2026-09-26): the diagnostic extension, TypeScript/Nix
build, geometry tests, isolated GNOME integration test, Home Manager module, and
opt-in manual calibration transaction are implemented. The user confirmed the
physical calibration. Automatic focus mapping, serialized updates/restoration,
the evdev activity helper, contact deferral, and pen-only outline visibility are
implemented. Unit and isolated GNOME tests cover the automatic path with fake
OTD/helper processes. Live testing needs scoped read access to the virtual tablet
and a new Shell session to load the changed JavaScript. Physical contact timing,
the full-monitor shortcut and preferences remain pending. The flake now exports
a NixOS module for permanent, device-scoped session access, alongside the Home
Manager module for the extension/helper. See [README.md](README.md) for current
commands and limitations.

## Purpose

Keep a fixed-size OpenTabletDriver (OTD) target area centered on the focused
window. Gently dim the desktop outside that area while the pen is active, with
no border. Preserve drawing sensitivity as windows move or resize.

This is desktop integration. Euthymia and other applications need no changes.

## Initial environment and support scope

The investigated machine runs:

- NixOS with GNOME Shell 50.2 on Wayland.
- OpenTabletDriver 0.6.7.
- One 3440 × 1440 monitor at 100% scaling.
- A Wacom CTL-4100WL in Linux Artist Mode.
- An 800 × 500 display area mapped from a 152 × 95 mm tablet area.

Start with this configuration and one active Artist Mode tablet. Native Wayland
and XWayland application windows should both work through Mutter's window API.
Validate fractional scaling, additional monitors, and other GNOME versions
separately before advertising support. Mouse/relative OTD output modes and other
desktop environments are outside the first release.

## Chosen stack

| Concern | Choice | Reason |
| --- | --- | --- |
| Desktop integration | GNOME Shell extension written in TypeScript, compiled to JavaScript ES modules for GJS | Typed window tracking, geometry, and asynchronous mapping state with direct GNOME API access |
| Compilation and GNOME types | TypeScript (`tsc`) with strict checking and pinned `@girs` definitions compatible with GNOME 50 | Catch interface errors while preserving GJS module imports |
| Outline rendering | GNOME Shell St/Clutter actors with CSS | Draw in the compositor's UI without a separate application window |
| Settings | GSettings schema | Native extension configuration and declarative Home Manager settings |
| Preferences, after the core works | TypeScript, GJS, GTK 4, and libadwaita in `prefs.ts`, compiled to `prefs.js` | Standard GNOME extension preferences |
| OTD control | Existing `otd` CLI through asynchronous `Gio.Subprocess` calls | Uses the installed driver without introducing a custom OTD plugin |
| Pen activity | Python 3 helper using `python-evdev` | Observe OTD's virtual tablet independently of application input routing |
| Extension/helper communication | Versioned, newline-delimited JSON over subprocess pipes | Small local protocol with lifecycle owned by the extension |
| Packaging and development | Nix flake, Home Manager module, optional NixOS module | Reproducible tools, installation, settings, and scoped device permissions |
| TypeScript checks | Strict type checking, ESLint with TypeScript support, and Node's built-in test runner | Check code and run compiled pure geometry/policy tests outside GNOME |
| Python checks | Ruff and pytest | Check helper code and test event-state handling |

Use TypeScript for extension source and its tests. Compile with `tsc` to native
JavaScript ES modules without a bundler. Preserve GJS `gi://` and `resource://`
imports, and use runtime `.js` suffixes for relative module imports. Verify and
pin the available `@girs` packages against GNOME 50 during setup; their types do
not replace testing against the installed Shell.

Keep GJS and Node test compiler configurations separate so Node globals cannot
accidentally enter extension code. Pure geometry and policy modules must not
import GNOME libraries. Compile those modules and their tests for Node's test
runner. Define TypeScript types for helper messages and validate incoming JSON
at runtime before treating it as a typed message.

Pin TypeScript, type definitions, and lint dependencies in the project's package
manifest and lockfile. Package emitted JavaScript with metadata, CSS, and compiled
GSettings schemas. Node and TypeScript are build/development tools; the installed
extension runs in GJS.

Create the development flake from
`/home/amadeusw/nixos/templates/empty/flake.nix`. Add project tools to this flake,
and use `nix develop` unless already inside its development environment.

## Components and ownership

### GNOME extension

The extension owns:

- Enable/disable lifecycle, settings, and the helper subprocess.
- Focused-window selection and signal subscriptions.
- Target-area calculation and mapping policy.
- OTD command serialization and readback verification.
- Outline visibility and position.
- A shortcut for switching temporarily to full-monitor mapping.
- Cleanup, restoration, and reporting failures.

Watch `global.display` for `notify::focus-window`. Subscribe to the selected
window's position, size, and lifecycle changes, disconnecting old subscriptions
when the target changes. Use `Meta.Window.get_frame_rect()` for visible window
bounds. Also observe monitor configuration, Overview, and session state changes.

### Pen-activity helper

The helper discovers the device named `OpenTabletDriver Virtual Artist Tablet`
and verifies its tablet capabilities. Never hard-code an `eventN` path. Open it
for observation without an exclusive grab or input injection.

Track pen/eraser presence, motion, pressure, and tip contact from evdev reports.
Process coherent reports at `SYN_REPORT`. Handle initial state, device removal,
reconnection, and event loss; a lost state must not leave the extension believing
indefinitely that a stroke is active or that it is safe to remap.

Send small messages describing readiness, proximity/contact transitions,
coalesced activity, and errors. Keep diagnostic logs on stderr. Preserve contact
transitions while limiting motion notifications; never forward every tablet
sample into Shell JavaScript. Include a protocol version and an initial state
message. The extension must treat disconnect or unknown contact state
conservatively.

The extension starts the helper only while enabled, reads its output
asynchronously, and stops it on disable. Use bounded retries for disconnects or
crashes. A separate systemd service or D-Bus API can be added later only if there
is a concrete need.

OTD shares this virtual device across Artist Mode tablets. It does not reliably
identify which physical tablet generated an event. The first release assumes
one active tablet and documents that limitation.

## Behavior contract

### Position and size

1. Select the focused normal application window or focused dialog. Ignore menus,
   tooltips, desktop surfaces, and other transient popup types as independent
   targets. Do not blindly skip all dialogs by following every transient parent.
2. Keep the configured area size, initially 800 × 500 logical units.
3. Center it on the window frame.
4. Clamp it inside the monitor associated with that window.
5. If the window is smaller than the area, allow the area to extend beyond it.
6. If the monitor is smaller than the configured area, report unsupported sizing
   and suspend following instead of silently changing sensitivity.

For a window spanning monitors, use Mutter's window monitor selection initially.
Keep positioning and window-selection policy separate from GNOME signal wiring
so their decisions can be tested with synthetic inputs.

### Coordinate conventions

Use GNOME logical desktop coordinates for window geometry and the outline.
OTD 0.6.7's Wayland backend reads logical output positions and sizes, so do not
automatically multiply coordinates by monitor scale.

OTD's display-area X/Y values represent the area's **center**, not its top-left
corner. Its virtual desktop has a normalized origin. Account for the desktop's
minimum X/Y when converting from a layout with negative monitor coordinates.

The current single-monitor, 100% setup is the first calibration case. Verify
actual pen endpoints against the outline. Compositor tablet mapping can apply
an additional transform, so matching rectangle numbers alone does not prove the
mapping is correct.

OTD's inspected Wayland display implementation takes a snapshot of outputs.
Monitor changes may leave the running driver's coordinate model stale. Suspend
and diagnose mismatches rather than blindly applying a new scale or restarting
the driver automatically.

### When mapping changes

- Request focus changes immediately; settle move/resize notifications for 150 ms.
- Skip updates if the desired area already matches the applied area.
- Allow one OTD update in flight and retain only the newest pending target.
- While the tip is down, retain the current mapping and queue the latest target.
- After release, recompute the target and apply it when settled.
- Recheck contact immediately before launching an update.
- Suspend following during Overview, lock, or absence of a valid target.

An evdev observer and an asynchronous OTD command cannot provide an atomic
guarantee against contact beginning just as an update is applied. Validate this
timing explicitly. If testing shows visible stroke jumps, use a more conservative
policy, such as applying after proximity-out, or investigate driver-side
coordination. Do not describe the initial design as guaranteeing stroke safety.

### Spotlight

Use 14% black dimming outside a transparent opening with 8 px rounded corners,
without a border. The opening retains the fixed mapping dimensions. It must not
accept focus, intercept input, or reserve desktop space. Verify these properties
with real pen and mouse input.

Fade the spotlight in over 300 ms on pen activity, keep it visible during contact,
and fade it out over 300 ms after inactivity. Repeated motion must not restart the
fade, and returning activity reverses a fade-out from its current opacity.
Confirm proximity-in/out reliability on the
Wacom before using proximity as the sole visibility trigger. Keep it hidden
during Overview and screen lock.

The spotlight represents the last successfully applied and verified mapping,
including clamping. It must not move to an unconfirmed requested area. A brief
preview after a mapping change is useful during development.

### Manual control and recovery

Provide a shortcut to temporarily map the pen to the full current monitor, then
return to window following. This lets the user reach controls outside the small
frame. Apply the same contact guard to shortcut-driven changes.

At startup, capture the original area from the running driver. On normal disable,
restore only that area, preserving unrelated OTD settings. Coordinate shutdown
with in-flight commands so a late callback cannot reapply a following position.
Disconnect signals, remove timers, destroy actors, and stop the helper.

Do not save tracking positions as OTD's persistent defaults. Detect external
mapping changes at readback/update boundaries and pause with an explanation
rather than repeatedly overwriting the user's OTD edits. Restore the original
area only when Penframe still owns the active mapping.

Normal disable restoration is a requirement. Shell crashes or forced process
termination cannot guarantee cleanup; document a manual restore route and assess
whether later recovery metadata is worthwhile.

## OTD integration details

Use the existing `setdisplayarea <tablet> <width> <height> <x> <y>` command.
Launch it with an argument vector, not an interpolated shell command. Resolve the
packaged executable explicitly, and keep all process I/O off the Shell main loop.

The inspected command applies settings through `SetSettings`, rebuilding output
pipelines for connected devices. Therefore, apply settled changes rather than
updating continuously during dragging or pen movement. Keeping the CLI process
alive would not eliminate this driver-side work.

Read the baseline and verify updates through the supported CLI. Choose a
structured settings export where practical; otherwise isolate and test parsing
for the supported OTD version. Check process failure, timeout, and readback
mismatch separately. On failure, keep the last confirmed outline state or hide
it when that state is no longer trustworthy.

## Nix ownership and permissions

This repository supplies:

- Packages for the extension and helper.
- A development shell and reproducible checks.
- A Home Manager module for installation, extension enablement, and settings.
- An optional NixOS module for the helper's device-access requirement.

`/home/amadeusw/nixos` consumes a pinned revision, enables these modules, selects
the Wacom profile, and sets personal preferences. Its existing OTD configuration
continues to own the driver service.

The investigated virtual tablet device is `root:input`, mode `0660`, with no user
ACL. Validate a udev/logind access rule scoped specifically to the OTD virtual
artist tablet. Verify it grants access to the active user and survives device
recreation. Avoid requiring the helper to run as root or granting access to all
input devices. Missing access should produce a useful diagnostic.

## Suggested repository layout

Create files when their milestone needs them; this is an ownership guide, not a
requirement to scaffold empty modules.

```text
PLAN.md
README.md
flake.nix
flake.lock
package.json
pnpm-lock.yaml
tsconfig.json            # GJS extension compilation
tsconfig.test.json       # pure modules and Node tests
extension/
  metadata.json
  extension.ts          # lifecycle and coordination
  windowTracker.ts      # GNOME subscriptions and target selection
  geometry.ts           # pure positioning and coordinate conversion
  mappingController.ts  # pending/applied state and update policy
  otdClient.ts          # subprocess calls and verification
  penActivity.ts        # helper protocol and lifecycle
  overlay.ts
  stylesheet.css
  schemas/
  prefs.ts              # added after core behavior works
helper/
  penframe_activity.py
tests/
  geometry.test.ts
  mappingController.test.ts
  test_pen_activity.py
nix/
  home-manager.nix
  nixos.nix
```

## Implementation milestones

### 1. Diagnostic window frame

Set up the flake, TypeScript compilation and GNOME types, minimal GNOME 50
extension, pure rectangle calculation, and a visible diagnostic outline. Confirm
the emitted modules load in GJS. Do not change OTD mapping yet.

Acceptance: the rectangle follows focus, settled moves/resizes, and dialogs;
clamps correctly; ignores popups; passes input through; and leaves no actors or
signal handlers after disable/re-enable.

### 2. Controlled OTD mapping

Implement baseline capture, one explicitly triggered mapping update, readback,
and restoration. Then enable debounced following in a diagnostic mode used only
with the pen lifted. This milestone does not yet claim protection during drawing.

Acceptance: actual pen endpoints match the outline on the current monitor;
tablet size, bindings, and unrelated settings stay intact; rapid window changes
do not create overlapping processes; disable restores the original area.

### 3. Pen activity and contact-aware updates

Implement the helper, scoped device access, activity protocol, outline fading,
and deferred mapping. Test in an actual Wayland drawing application as well as
over Shell UI. Add the full-monitor shortcut.

Acceptance: mouse movement does not trigger pen activity; drawing does; contact
defers updates; disconnects recover; no input is grabbed; mapping/contact races
have been exercised and their limits documented.

### 4. Installation and broader validation

Finish Home Manager/NixOS integration, preferences, user documentation, and CI.
Pin the project in the machine flake after the local behavior works.

Exercise fractional scaling, negative monitor origins, windows spanning monitors,
monitor reconnects, OTD restarts, application closure, Overview, screen lock,
external OTD edits, and extension reloads. Expand support only for configurations
that pass these checks.

## Verification approach

- Unit-test geometry with centered, clamped, small-window, oversized-area, and
  negative-origin cases.
- Test mapping policy with a fake asynchronous OTD client: combine updates,
  defer during contact, reject stale completion, handle errors, and order restore.
- Test helper event-state transitions and recovery using synthetic evdev reports.
- Run strict TypeScript checks, lint, compiled Node tests, and focused Python
  tests through the project dev shell, then expose them as Nix checks suitable
  for CI.
- Use GNOME's extension debugging workflow for integration checks. Pure tests
  cannot prove compositor input routing or physical pen mapping.

The initial investigation checked runtime versions, display state, OTD read-only
commands, input-device metadata/permissions, and version-matched upstream source.
It did not perform mapping mutations, install an extension, or capture a live
drawing session. Coordinate alignment, proximity behavior, timing, and the scoped
permission rule remain implementation-time validation tasks.

## References

- [GNOME window API](https://mutter.gnome.org/meta/class.Window.html)
- [GNOME extension lifecycle](https://gjs.guide/extensions/topics/extension.html)
- [GNOME extension debugging](https://gjs.guide/extensions/development/debugging.html)
- [Mutter 50.2 input routing](https://github.com/GNOME/mutter/blob/50.2/src/core/events.c)
- [Mutter 50.2 event filter ordering](https://github.com/GNOME/mutter/blob/50.2/clutter/clutter/clutter-event.c)
- [OTD 0.6.7 CLI commands](https://github.com/OpenTabletDriver/OpenTabletDriver/blob/v0.6.7/OpenTabletDriver.Console/Program.Commands.cs)
- [OTD 0.6.7 settings application](https://github.com/OpenTabletDriver/OpenTabletDriver/blob/v0.6.7/OpenTabletDriver.Daemon/DriverDaemon.cs)
- [OTD 0.6.7 Wayland display coordinates](https://github.com/OpenTabletDriver/OpenTabletDriver/blob/v0.6.7/OpenTabletDriver.Desktop/Interop/Display/WaylandDisplay.cs)
- [OTD 0.6.7 virtual tablet events](https://github.com/OpenTabletDriver/OpenTabletDriver/blob/v0.6.7/OpenTabletDriver.Desktop/Interop/Input/Absolute/EvdevVirtualTablet.cs)
- [OTD Linux mapping FAQ](https://opentabletdriver.net/Wiki/FAQ/Linux)
- [Python evdev documentation](https://python-evdev.readthedocs.io/en/latest/tutorial.html)
