const { withAppDelegate } = require('expo/config-plugins');

/**
 * Expo config plugin: injects RCTEnableTurboModuleSyncVoidMethods(YES)
 * into AppDelegate.mm before any TurboModules are initialized.
 *
 * This forces TurboModule void methods to execute synchronously on the
 * JS thread instead of being dispatched to background queues, preventing
 * Hermes GC corruption from concurrent thread access.
 *
 * Works regardless of whether React.framework is pre-built or source-compiled
 * because the call is in OUR binary, not React's framework.
 */
const withForceSyncTurboModule = (config) => {
  return withAppDelegate(config, (mod) => {
    const src = mod.modResults.contents;

    // Add the import for the flag setter
    if (!src.includes('RCTEnableTurboModuleSyncVoidMethods')) {
      // Insert import after the last #import
      const importLine = '#import <React/RCTBridge.h>';
      const callLine = '  RCTEnableTurboModuleSyncVoidMethods(YES); // Fix: force sync void methods to prevent Hermes GC crash';

      // Add import if not present
      if (!src.includes(importLine)) {
        mod.modResults.contents = src.replace(
          /(#import .+\n)(\s*@)/,
          `$1${importLine}\n$2`
        );
      }

      // Insert the call at the very start of didFinishLaunchingWithOptions
      mod.modResults.contents = mod.modResults.contents.replace(
        /(didFinishLaunchingWithOptions[\s\S]*?\{)/,
        `$1\n${callLine}`
      );
    }

    return mod;
  });
};

module.exports = withForceSyncTurboModule;
