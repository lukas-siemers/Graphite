const fs = require('fs');
const path = require('path');

/**
 * Expo config plugin: guards the local graphite-pencil-kit module.
 *
 * Expo SDK 54 autolinking already defaults to scanning `./modules`, so the
 * module under `apps/mobile/modules/graphite-pencil-kit/` is picked up
 * without extra config. This plugin exists for two reasons:
 *
 *   1. Fail fast during `expo prebuild` if the module directory is missing
 *      (e.g. after a bad merge). A silent autolinking miss shows up later
 *      as a "view manager not found" red box in the iOS build, which is
 *      painful to debug.
 *   2. Document in app.json that the app depends on a local PencilKit
 *      module — greppable, discoverable, and hard to accidentally drop.
 */
const withPencilKitModule = (config) => {
  const moduleRoot = path.resolve(
    __dirname,
    '..',
    'modules',
    'graphite-pencil-kit',
  );

  const required = [
    'expo-module.config.json',
    'ios/GraphitePencilKitModule.swift',
    'ios/GraphitePencilKitView.swift',
    'ios/GraphitePencilKit.podspec',
  ];

  for (const rel of required) {
    const abs = path.join(moduleRoot, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `[pencil-kit-module] Required file missing: ${rel}. ` +
          `Expected at ${abs}. Did the local module get deleted?`,
      );
    }
  }

  return config;
};

module.exports = withPencilKitModule;
