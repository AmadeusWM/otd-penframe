{
  config,
  lib,
  pkgs,
  ...
}: {
  options.hardware.otd-penframe.enable =
    lib.mkEnableOption
    "active-session access to OpenTabletDriver's virtual Artist tablet";

  config = lib.mkIf config.hardware.otd-penframe.enable {
    # uaccess must be tagged before systemd's 73-seat-late.rules applies the ACL.
    # Do not grant access to OTD's virtual keyboard or unrelated input devices.
    services.udev.packages = [
      (pkgs.writeTextDir "lib/udev/rules.d/70-otd-penframe.rules" ''
        ACTION=="add|change", SUBSYSTEM=="input", KERNEL=="event*", ATTRS{name}=="OpenTabletDriver Virtual Artist Tablet", TAG+="uaccess"
      '')
    ];
  };
}
