# Desktop signing and notarization plan

This repo now ships the baseline `electron-builder` release config in `apps/desktop/package.json`.

## Build outputs

- `pnpm pack:desktop`: unpacked validation build.
- `pnpm dist:desktop`: installer artifacts under `dist/desktop/`.

The packaged app includes these assets inside `app.asar`:

- `apps/desktop/dist` as the Electron main/preload bundle
- `apps/controller/dist` as the utility-process controller bundle
- `packages/database/migrations` as the packaged migration source
- `apps/web-ui/out` as packaged renderer assets

## Native dependency alignment

- `apps/desktop` runs `electron-builder install-app-deps` in `postinstall`.
- `pnpm --filter @monet/desktop rebuild:native` is available for forced local ABI rebuilds after Electron upgrades or after adding native modules.

The current controller uses Node's built-in `node:sqlite`, but the rebuild hook is kept in place so release packaging stays ready for future native dependencies.

## Electron fuses

Packaged builds flip these fuses:

- `runAsNode: false`
- `enableNodeOptionsEnvironmentVariable: false`
- `enableNodeCliInspectArguments: false`
- `enableEmbeddedAsarIntegrityValidation: true`
- `onlyLoadAppFromAsar: true`
- `grantFileProtocolExtraPrivileges: false`

That keeps production binaries aligned with the local-controller architecture and closes unnecessary Node/inspect entry points.

## SQLite path and permissions

- Managed desktop runs pass `MONET_DATABASE_PATH=${app.getPath("userData")}/sqlite/monet.db` to the controller.
- The controller creates the parent directory with owner-only intent (`0700`) and best-effort chmods the database, WAL, and SHM files to `0600` on POSIX hosts.
- Windows still uses the per-user `userData` location, but relies on the OS profile ACLs instead of POSIX chmod.

## macOS signing and notarization

Configured builder settings:

- hardened runtime enabled
- notarization enabled
- entitlements loaded from `apps/desktop/resources/entitlements.mac*.plist`
- `dmg` and `zip` artifacts emitted

Preferred CI secrets (App Store Connect API key flow):

- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `CSC_LINK`
- `CSC_KEY_PASSWORD`

Fallback Apple ID flow:

- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Operational rollout:

1. Import the Developer ID Application certificate into CI and expose it through `CSC_LINK` and `CSC_KEY_PASSWORD`.
2. Add the App Store Connect API key secrets above.
3. Run `pnpm dist:desktop` on macOS CI.
4. Verify `spctl --assess --type execute` and `xcrun stapler validate` against the produced app or DMG.

## Windows signing

Configured builder settings:

- NSIS installer target
- SHA-256 signing hash
- DigiCert timestamp server configured

Planned CI secrets:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`

If EV or cloud signing is adopted later, move to `win.azureSignOptions` or certificate-subject signing without changing the release commands.

## Deferred to the next task

- publish pipeline wiring
- auto-update feed configuration
- updater-specific graceful shutdown/restart hooks
