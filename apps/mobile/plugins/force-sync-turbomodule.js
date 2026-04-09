const { withAppDelegate } = require('expo/config-plugins');

/**
 * Expo config plugin: injects RCTEnableTurboModuleSyncVoidMethods into
 * AppDelegate before any TurboModules are initialized.
 *
 * Handles both Swift (.swift) and Objective-C++ (.mm) AppDelegates.
 *
 * This forces TurboModule void methods to execute synchronously on the
 * JS thread instead of being dispatched to background queues, preventing
 * Hermes GC corruption from concurrent thread access.
 */
const withForceSyncTurboModule = (config) => {
  return withAppDelegate(config, (mod) => {
    let src = mod.modResults.contents;
    const lang = mod.modResults.language;

    if (src.includes('RCTEnableTurboModuleSyncVoidMethods')) {
      return mod; // already patched
    }

    if (lang === 'objcpp' || lang === 'objc') {
      // Objective-C++ AppDelegate.mm
      if (!src.includes('#import <React/RCTBridge.h>')) {
        src = src.replace(
          /(#import .+\n)(\s*@)/,
          `$1#import <React/RCTBridge.h>\n$2`
        );
      }
      src = src.replace(
        /(didFinishLaunchingWithOptions[\s\S]*?\{)/,
        `$1\n  RCTEnableTurboModuleSyncVoidMethods(YES);`
      );
    } else {
      // Swift AppDelegate.swift
      // Insert at the top of didFinishLaunchingWithOptions
      src = src.replace(
        /(didFinishLaunchingWithOptions[\s\S]*?->\s*Bool\s*\{)/,
        `$1\n    RCTEnableTurboModuleSyncVoidMethods(true)`
      );
    }

    mod.modResults.contents = src;
    return mod;
  });
};

module.exports = withForceSyncTurboModule;
