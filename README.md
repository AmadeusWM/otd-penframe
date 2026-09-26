# OTD Penframe

A TypeScript GNOME Shell extension for a fixed-size tablet target centered on the
focused window. See [PLAN.md](PLAN.md) for the full design and implementation order.

## Current state

The first prototype targets GNOME 50 on Wayland and OTD 0.6.7:

- Automatic mode maps an 800 × 500 area to the focused window on focus changes,
  with a short settling delay for moves/resizes.
- It keeps its size for small windows, clamps to the selected monitor, and hides
  during Overview or when there is no supported target.
- The outline is noninteractive and has a transparent interior.
- An opt-in shortcut provides a single 30-second OTD calibration transaction,
  with readback verification and restoration of the previous area.
- Automatic mode shows the border on tablet hover/motion and throughout tip
  contact, then hides it after 700 ms of inactivity or proximity-out. Mouse
  movement does not trigger it.
- Pending mappings wait for tip-up. Unknown/disconnected tablet state suspends
  updates; disable restores the baseline if Penframe still owns the mapping.

**By default, diagnostic mode shows a proposed area; OTD is not changed.** Enable
automatic mode using the instructions below. Manual physical calibration was
confirmed on the original single-monitor setup. Automatic mode passes simulated
GNOME tests; physical activity/contact timing still needs validation. The
full-monitor shortcut and preferences are not implemented yet.

## Stack

- TypeScript, strict `tsc` checks, and GNOME 50 `@girs` definitions; emitted ES
  modules run in GJS without a bundler.
- St/Clutter and CSS for rendering; GSettings for configuration.
- Asynchronous Gio subprocesses for the existing OTD CLI.
- Nix for tools, packaging, and Home Manager integration.
- Node's test runner and ESLint for checks.
- Python/evdev observes OTD's virtual Artist tablet, with a versioned JSON protocol
  to the extension. The helper runs as your user and never grabs or injects input.

## Build and checks

```sh
nix develop path:.
pnpm install --frozen-lockfile
pnpm check
pnpm build:shell-test
pnpm bundle
ruff check helper tests/*.py
PYTHONPATH=helper python -m pytest -q tests/test_pen_activity.py
```

`dist/` contains the loadable extension. `pnpm bundle` produces
`otd-penframe@zendeus.github.io.shell-extension.zip` for isolated tests.

The Nix package builds and runs the focused checks in a sandbox:

```sh
nix build path:.
nix flake check path:.
```

The `path:.` form also includes new files before the initial Git commit.

## Isolated GNOME integration test

Use the installed GNOME 50 test tool from a desktop terminal, after building the
bundle and Shell test. It starts a separate D-Bus session and headless compositor
with temporary extension/settings directories; it does not enable Penframe in
your active desktop.

```sh
timeout 60s dbus-run-session -- gnome-shell-test-tool \
  --headless --disable-animations \
  --extension "$PWD/otd-penframe@zendeus.github.io.shell-extension.zip" \
  "$PWD/.shell-build/tests/shell.js"
```

Success prints `PENFRAME_SHELL_TEST_PASS` and `PENFRAME_AUTOMATIC_TEST_PASS`. The
test checks loading, focus/movement, fixed dimensions, nonreactive actors,
Overview, window closure, and disable/re-enable. Fake OTD/helper processes also
exercise automatic focus mapping, contact deferral, pen-only visibility,
inactivity hiding, and baseline restoration without touching the real driver.
Set `PENFRAME_TEST_CAPTURE` to an absolute PNG filename to save a test screenshot.

Run the host GNOME test tool outside `nix develop` so its GI libraries match the
installed desktop. Similarly, standalone GJS/OTD checks inside a dev shell need
care: an inherited `GI_TYPELIB_PATH` may refer to a different GLib, and the shell's
private `TMPDIR` changes where .NET looks for the running OTD daemon's named pipe.
The installed extension uses the normal desktop environment.

## Local testing without NixOS integration

After building the bundle, run these from a normal desktop terminal:

```sh
gnome-extensions install ./otd-penframe@zendeus.github.io.shell-extension.zip
gsettings --schemadir ./dist/schemas set org.gnome.shell.extensions.otd-penframe tablet-profile 'Wacom CTL-4100WL'
gsettings --schemadir ./dist/schemas set org.gnome.shell.extensions.otd-penframe otd-executable '/run/current-system/sw/bin/otd'
gsettings --schemadir ./dist/schemas set org.gnome.shell.extensions.otd-penframe calibration-enabled true
```

This installs a removable user extension under `~/.local/share/gnome-shell/extensions/`.
It does not require a NixOS rebuild. GNOME 50's D-Bus `ReloadExtension` method is
deprecated and cannot discover this newly installed extension.

For the **first load in the current session**, press **Alt+F2**, enter `lg`, and
paste this into Looking Glass's evaluator:

```js
(async () => { const u = 'otd-penframe@zendeus.github.io'; const m = Main.extensionManager; if (!m.lookup(u)) await m.loadExtension(m.createExtensionObject(u, Gio.File.new_for_path(GLib.get_user_data_dir() + '/gnome-shell/extensions/' + u), 2)); return m.enableExtension(u); })()
```

Close Looking Glass with Escape. This uses GNOME 50's internal extension manager
to register and enable the installed build. Alternatively, log out and back in,
then run `gnome-extensions enable otd-penframe@zendeus.github.io`.
Changed JavaScript still requires a new Shell process; use the isolated test
runner during development or log out/in to test a rebuilt version on the desktop.

Follow the manual calibration steps below. To stop the preview:

```sh
gnome-extensions disable otd-penframe@zendeus.github.io
```

Once calibration has restored the original mapping, remove the local test build
with `gnome-extensions uninstall otd-penframe@zendeus.github.io`. Remove this local
copy before switching to declarative installation so it cannot shadow that build.

## Enable automatic following locally

Build the package to obtain the helper with its Python dependencies, then set
the following from your desktop terminal:

```sh
nix build path:.
gsettings --schemadir ./dist/schemas set org.gnome.shell.extensions.otd-penframe activity-helper "$PWD/result/bin/penframe-activity"
gsettings --schemadir ./dist/schemas set org.gnome.shell.extensions.otd-penframe automatic-enabled true
```

Keep the tablet profile and OTD executable settings from local testing. Install
the new bundle with `gnome-extensions install --force` if updating the previous
prototype, then log out/in to load the new JavaScript. The existing 30-second
calibration shortcut is inactive in automatic mode.

The helper needs **read access only to OTD's virtual Artist tablet**. On the
investigated machine this device is `root:input` without user access. Identify its
current event node using:

```sh
for device in /sys/class/input/event*; do
  if [ "$(cat "$device/device/name")" = 'OpenTabletDriver Virtual Artist Tablet' ]; then
    printf '/dev/input/%s\n' "${device##*/}"
  fi
done
```

For a temporary test, grant access to that exact node (replace `eventN`):

```sh
sudo setfacl -m "u:$(id -un):r" /dev/input/eventN
```

Alternatively, run `./scripts/grant-tablet-access.sh` as your desktop user. It
finds the one matching OTD device, prints the intended change, and invokes sudo
only to grant that device's read ACL. Run it after login if OTD recreated the
device during logout.

This ACL lasts until the device is recreated; it may need to be repeated after
OTD restarts or logout/login. Re-enable Penframe after granting access if the
helper has exhausted its ten reconnect attempts. Revoke the temporary ACL with
`sudo setfacl -x "u:$(id -un)" /dev/input/eventN`. The NixOS module below supplies
permanent, device-scoped session access; adding the user to the general `input`
group is unnecessary.

Test switching windows with the pen lifted, then hover/draw and check visibility.
While drawing, change focus using the keyboard: the mapping should wait for tip
release. An observer and an asynchronous OTD command cannot make this atomic;
contact beginning during a command remains a physical validation case. Lift the
pen before disabling, since shutdown restores the original mapping.

The outline shows only a verified mapping. Mapping conflicts pause following;
helper loss hides the outline and blocks updates. Monitor-layout changes require
checking OTD's coordinate model and re-enabling the extension. The initial scope
is one active tablet in Artist mode, on the calibrated single monitor.

## Declarative installation

The flake exports `packages.<system>.default`, `homeManagerModules.default`, and
`nixosModules.default`. Add a flake input (the lock file pins its revision):

```nix
inputs.otd-penframe.url = "github:AmadeusWM/otd-penframe";
```

In the NixOS configuration, enable access to the virtual tablet for the active
local session:

```nix
imports = [ inputs.otd-penframe.nixosModules.default ];
hardware.otd-penframe.enable = true;
```

The module installs `70-otd-penframe.rules`, before systemd applies `uaccess`
permissions. It matches only `OpenTabletDriver Virtual Artist Tablet`, including
when OTD recreates the device. Existing OTD daemon configuration remains separate.

In the Home Manager configuration:

```nix
imports = [ inputs.otd-penframe.homeManagerModules.default ];

programs.otd-penframe = {
  enable = true;
  tabletProfile = "Wacom CTL-4100WL";
  areaWidth = 800;
  areaHeight = 500;
  automaticEnabled = true;
  calibrationEnabled = false;
};
```

The module expects the existing NixOS OTD installation at
`/run/current-system/sw/bin/otd`. The extension itself can use another absolute
path through its `otd-executable` setting. Home Manager configures the helper's
immutable Nix store path, so the development checkout is not needed at runtime.

A newly installed extension may require logging out and back in before GNOME
discovers it. Integration in `~/nixos` is optional for local testing.

When migrating from the local test install, move that extension directory out
of `~/.local/share/gnome-shell/extensions/` so it cannot shadow the Nix package.
If the extension is currently running, keep it enabled until logging out; its
code is already loaded. Activate both NixOS and Home Manager when using standalone
Home Manager, then reboot or start a fresh desktop/OTD session to pick up the
new extension and device permissions. If you previously disabled/uninstalled it,
run `gnome-extensions enable otd-penframe@zendeus.github.io` after login to clear
GNOME's per-user disabled list.

## Manual calibration gate

Use the current single-monitor, 100% scaling setup first. This test is for
**hovering**, with the pen lifted before starting and before restoration. Manual
calibration mode does not run the activity helper or guard against contact.

1. Enable the extension and confirm that its preview follows the intended window.
2. Enable calibration through the local settings above or set
   `calibrationEnabled = true` through Home Manager, and ensure the tablet profile
   and OTD executable are correct.
3. Focus the test window, let it settle, and lift the pen out of proximity.
4. Press **Super+Alt+P**. The outline briefly disappears during the command and
   returns only after OTD confirms the requested mapping.
5. Hover the pen over the tablet's corners and center. Check that the on-screen
   position matches the outline corners and center. Keep the window stationary.
6. Lift the pen again. Press the shortcut a second time to restore early, or let
   the 30-second timer restore the original area.
7. Check the restored area with `otd getareas 'Wacom CTL-4100WL'`.

The calibration does not save OTD defaults or alter tablet dimensions/bindings.
If the area changes externally during the test, Penframe leaves that mapping
alone and reports the conflict. Disabling cancels the test and attempts an ordered
restore, but Shell crashes cannot guarantee cleanup.

For the mapping observed during initial investigation, the manual recovery command
is below. Use the area reported before **your** test if it differs:

```sh
otd setdisplayarea 'Wacom CTL-4100WL' 800 500 400 1186.2755
```

The user confirmed this calibration on the original single-monitor setup.
Negative monitor origins and fractional coordinates have unit coverage;
multi-monitor and scaled physical tablet mapping remain unverified.
