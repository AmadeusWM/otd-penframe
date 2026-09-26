{lib, stdenvNoCC, nodejs_24, pnpm, pnpmConfigHook, fetchPnpmDeps, glib, python3, ruff}: let
  helperPython = python3.withPackages (ps: [ps.evdev]);
  testPython = python3.withPackages (ps: [ps.evdev ps.pytest]);
in stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "otd-penframe";
  version = "0.1.0";
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../extension ../tests ../scripts ../helper
      ../package.json ../pnpm-lock.yaml ../pnpm-workspace.yaml
      ../tsconfig.json ../tsconfig.test.json ../tsconfig.shell-test.json
      ../eslint.config.mjs
    ];
  };
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version;
    inherit pnpm;
    src = lib.fileset.toSource {
      root = ../.;
      fileset = lib.fileset.unions [../package.json ../pnpm-lock.yaml ../pnpm-workspace.yaml];
    };
    fetcherVersion = 4;
    hash = "sha256-HKGmMNVbRwC9mmOOnfEUpLqBtLCijk+teMjqB0fnJug=";
  };
  nativeBuildInputs = [nodejs_24 pnpm pnpmConfigHook glib testPython ruff];
  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build:shell-test
    ruff check helper tests/*.py
    PYTHONPATH=helper python -m pytest -q tests/test_pen_activity.py
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/share/gnome-shell/extensions/${finalAttrs.passthru.extensionUuid}"
    cp -r dist/. "$out/share/gnome-shell/extensions/${finalAttrs.passthru.extensionUuid}/"
    mkdir -p "$out/bin"
    cp helper/penframe_activity.py "$out/bin/penframe-activity"
    substituteInPlace "$out/bin/penframe-activity" \
      --replace-fail '#!/usr/bin/env python3' '#!${helperPython}/bin/python3'
    chmod +x "$out/bin/penframe-activity"
    runHook postInstall
  '';
  passthru.extensionUuid = "otd-penframe@zendeus.github.io";
  meta = {
    description = "Window-centered OpenTabletDriver mapping with a pen activity outline";
    platforms = lib.platforms.linux;
  };
})
