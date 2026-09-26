penframe:
{config, lib, pkgs, ...}: let
  cfg = config.programs.otd-penframe;
in {
  options.programs.otd-penframe = {
    enable = lib.mkEnableOption "OTD Penframe's GNOME extension";
    package = lib.mkOption {
      type = lib.types.package;
      default = penframe.packages.${pkgs.stdenv.hostPlatform.system}.default;
      description = "Penframe extension package.";
    };
    tabletProfile = lib.mkOption {
      type = lib.types.str;
      default = "";
      description = "Exact OTD profile name.";
    };
    areaWidth = lib.mkOption {
      type = lib.types.ints.between 1 32768;
      default = 800;
      description = "Target width in logical desktop units.";
    };
    areaHeight = lib.mkOption {
      type = lib.types.ints.between 1 32768;
      default = 500;
      description = "Target height in logical desktop units.";
    };
    calibrationEnabled = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Enable manual 30-second calibration, which has no pen contact guard.";
    };
    automaticEnabled = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Follow focused windows; requires read access to OTD's Artist tablet device.";
    };
  };
  config = lib.mkIf cfg.enable {
    home.packages = [cfg.package];
    dconf.enable = true;
    dconf.settings = {
      "org/gnome/shell".enabled-extensions = [cfg.package.extensionUuid];
      "org/gnome/shell/extensions/otd-penframe" = {
        area-width = cfg.areaWidth;
        area-height = cfg.areaHeight;
        tablet-profile = cfg.tabletProfile;
        calibration-enabled = cfg.calibrationEnabled;
        automatic-enabled = cfg.automaticEnabled;
        activity-helper = "${cfg.package}/bin/penframe-activity";
        otd-executable = "/run/current-system/sw/bin/otd";
      };
    };
  };
}
