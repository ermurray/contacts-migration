'use strict';
// electron-builder afterPack hook.
//
// We ship unsigned (no Apple Developer ID) builds. With `mac.identity: null`
// electron-builder skips signing entirely, which leaves the Electron prebuilt's
// "linker-signed" stub on the bundle. That stub has Identifier=Electron and does
// not cover the app's resources, so on Apple Silicon the app is rejected as
// "damaged" and will not launch. Re-sign the packaged .app ad-hoc here (before
// the dmg/AppImage is assembled) so the distributed binary has a valid, bound
// signature. No-op on non-macOS targets.

const { execFileSync } = require('node:child_process');

exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = packager.appInfo.productFilename; // "Contacts Migration"
  const appPath = `${appOutDir}/${appName}.app`;

  // Ad-hoc sign ("-") the whole bundle, replacing the linker stub. --deep so the
  // nested Helper apps / frameworks are signed before the outer bundle.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    stdio: 'inherit',
  });
  console.log(`  • afterPack: ad-hoc signed ${appName}.app (${context.arch})`);
};
