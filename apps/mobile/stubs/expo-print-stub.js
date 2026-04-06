// Web stub for expo-print
// On web, PDF export goes through the browser's native print dialog via
// window.print() on a popup window (see lib/export-pdf.web.ts). This no-op
// exists so that any accidental import of expo-print on web does not crash.
module.exports = {
  printToFileAsync: async () => ({ uri: '' }),
  printAsync: async () => {},
};
