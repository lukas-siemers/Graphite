// Ambient declarations for native-only peer modules used by *.native.tsx files.
// tsc checks both .native.tsx and .web.tsx siblings in this package; these
// modules are supplied by the consuming app (apps/mobile) at bundle time via
// the Metro resolver. Without these shims, tsc on CI flags "Cannot find
// module" for packages that are genuinely available at runtime.
declare module 'react-native-webview' {
  const content: any;
  export default content;
  // Dual-purpose: usable as both a value (JSX constructor) and as a type
  // (e.g. `useRef<WebView>`), matching the real module.
  export type WebView = any;
  // eslint-disable-next-line @typescript-eslint/no-redeclare
  export const WebView: any;
  export type WebViewMessageEvent = any;
}

declare module '@shopify/react-native-skia' {
  export const Canvas: any;
  export const Path: any;
  export const Skia: any;
  export type SkPath = any;
}

declare module 'expo-asset' {
  export class Asset {
    static fromModule(mod: number): Asset;
    uri: string | null;
    localUri: string | null;
    downloadAsync(): Promise<Asset>;
  }
}
