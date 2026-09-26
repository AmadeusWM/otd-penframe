{
  description = "Window-centered OpenTabletDriver mapping for GNOME";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = {
    self,
    nixpkgs,
    ...
  }: let
    systems = ["x86_64-linux" "aarch64-linux"];
  in {
    packages = nixpkgs.lib.genAttrs systems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      default = pkgs.callPackage ./nix/package.nix {};
    });
    checks = nixpkgs.lib.genAttrs systems (system: {
      extension = self.packages.${system}.default;
    });
    homeManagerModules.default = import ./nix/home-manager.nix self;
    nixosModules.default = import ./nix/nixos.nix;
    devShells = nixpkgs.lib.genAttrs systems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_24
          pnpm
          gjs
          glib
          zip
          (python3.withPackages (ps: with ps; [evdev pytest]))
          ruff
        ];
      };
    });
  };
}
