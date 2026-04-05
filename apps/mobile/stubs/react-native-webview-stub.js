// Web stub for react-native-webview.
// On web we never host the editor inside a WebView — LivePreviewInput.web.tsx
// renders a plain <iframe> directly. This stub only exists so Metro can
// resolve imports from packages/editor on the web target without crashing.
const React = require('react');

function WebView() {
  return null;
}
WebView.displayName = 'WebViewWebStub';

module.exports = new Proxy(
  { WebView, default: WebView, __esModule: true },
  {
    get: (target, prop) => {
      if (prop in target) return target[prop];
      const noop = () => null;
      noop.displayName = `WebViewStub(${String(prop)})`;
      return noop;
    },
  }
);
