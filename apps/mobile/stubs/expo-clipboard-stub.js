// Web stub for expo-clipboard.
// Delegates to the browser's Clipboard API when available, no-ops otherwise.
module.exports = {
  setStringAsync: async (text) => {
    if (navigator && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
  },
  getStringAsync: async () => {
    if (navigator && navigator.clipboard) {
      return navigator.clipboard.readText();
    }
    return '';
  },
  setString: (text) => {
    if (navigator && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  },
};
