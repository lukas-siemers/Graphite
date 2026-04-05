// Web stub for expo-sharing
// On web, the share sheet is unavailable — the markdown-export path uses a
// browser Blob download instead (see lib/export-markdown.web.ts). These
// no-ops exist so that any accidental import on web does not crash.
module.exports = {
  isAvailableAsync: async () => false,
  shareAsync: async () => {},
};
