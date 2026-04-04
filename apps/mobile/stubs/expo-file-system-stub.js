// Web stub for expo-file-system/legacy
// File system operations are no-ops on web — drawings are not supported in the web/Electron build.
module.exports = {
  documentDirectory: null,
  cacheDirectory: null,
  getInfoAsync: async () => ({ exists: false, isDirectory: false }),
  readAsStringAsync: async () => '',
  writeAsStringAsync: async () => {},
  deleteAsync: async () => {},
  makeDirectoryAsync: async () => {},
  copyAsync: async () => {},
  moveAsync: async () => {},
};
