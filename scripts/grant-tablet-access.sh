#!/bin/sh
# Temporary access for local testing. Run as the desktop user, not with sudo.
set -eu
if [ "$(id -u)" -eq 0 ]; then
    echo 'Run this script as your desktop user; it invokes sudo for the ACL change.' >&2
    exit 1
fi
penframe_device=''
for entry in /sys/class/input/event*; do
    [ -r "$entry/device/name" ] || continue
    [ "$(cat "$entry/device/name")" = 'OpenTabletDriver Virtual Artist Tablet' ] || continue
    if [ -n "$penframe_device" ]; then
        echo 'More than one OTD Artist tablet found; no permissions changed.' >&2
        exit 1
    fi
    penframe_device="/dev/input/${entry##*/}"
done
if [ -z "$penframe_device" ]; then
    echo 'No OTD Artist tablet found. Start OpenTabletDriver in Artist mode first.' >&2
    exit 1
fi
if [ -r "$penframe_device" ]; then
    printf 'Already readable: %s\n' "$penframe_device"
    exit 0
fi
printf 'Granting user %s read access only to %s (OTD Artist tablet).\n' "$(id -un)" "$penframe_device"
printf 'This is temporary and must be repeated if OTD recreates the device.\n'
exec sudo setfacl -m "u:$(id -u):r" "$penframe_device"
