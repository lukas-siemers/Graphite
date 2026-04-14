/**
 * Native implementation of LivePreviewInput — Build 89.
 *
 * Loads a CodeMirror 6 Live Preview editor inside react-native-webview using
 * a STATIC HTML asset that ships inside the iOS app binary. The asset path
 * is `apps/mobile/assets/editor/editor.html`, generated at dev time by
 * `packages/editor/scripts/bundle-cm6.mjs`. expo-asset resolves it to a
 * local file:// URI at runtime, the WKWebView loads it directly, and there
 * is NO runtime serialization of the editor HTML through the RN bridge.
 *
 * Build 89 architectural reset (vs. Builds 73–88):
 *   - REMOVED  source={{ html }}  — the Build 88 fallback that re-shipped
 *               the entire 820KB+ editor through the RN bridge on every
 *               mount and silently stalled in TestFlight WKWebView.
 *   - REMOVED  source={{ uri: cacheFile }} — the Builds 82–87 path that
 *               wrote the editor runtime to FileSystem.cacheDirectory at
 *               first mount. Cache writes added a startup race and an
 *               iOS-version-dependent allowingReadAccessToURL workaround.
 *   - REMOVED  ensureEditorAssets() — runtime cache write helper.
 *   - REMOVED  BRIDGE_SHIM Object.defineProperty(window, 'parent', …) —
 *               on WKWebView this monkey-patch silently no-ops, leaving
 *               every CM6 postMessage in the void. Native now uses
 *               window.ReactNativeWebView.postMessage directly via the
 *               bridge in native-editor-bridge.ts.
 *   - REMOVED  allowingReadAccessToURL — only meaningful when the WebView
 *               navigates to a file:// URL on a non-asset path, which is
 *               no longer the delivery model.
 *   - ADDED    a 2.5s `ready` watchdog that swaps in a plain
 *               <TextInput multiline> fallback so typing ALWAYS works,
 *               even if the WebView fails to boot.
 *
 * Host → editor messages (still injected via injectJavaScript):
 *   { type: 'set-value', value: string }
 *   { type: 'apply-format', command: string }
 *   { type: 'focus' }
 *   { type: 'set-readonly', readonly: boolean }
 *   { type: 'enable-block-heights' }
 *
 * Editor → host messages (via window.ReactNativeWebView.postMessage):
 *   { type: 'ready' }
 *   { type: 'change', value: string }
 *   { type: 'active-formats', formats: string[] }
 *   { type: 'height', height: number }
 *   { type: 'command-applied' }
 *   { type: 'error', message: string }
 *   { type: 'phase', phase: number, label: string }
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Text, Platform } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';
import { tokens } from '@graphite/ui';

// react-native-webview does not re-export its error event types from the
// package root. Define the minimal shape we consume here.
type WebViewNativeErrorEvent = { nativeEvent: unknown };
import type { FormatCommand } from './types';

interface LivePreviewInputProps {
  value: string;
  onChange: (text: string) => void;
  inputMode?: 'ink' | 'scroll';
  placeholder?: string;
  onFocus?: () => void;
  pendingCommand?: FormatCommand | null;
  onCommandApplied?: () => void;
  onActiveFormatsChange?: (formats: FormatCommand[]) => void;
  autoFocus?: boolean;
  focusKey?: string | null;
  enableBlockHeights?: boolean;
  onBlockHeights?: (msg: { type: 'block-heights'; blocks: Array<{ lineStart: number; lineEnd: number; height: number }> }) => void;
}

// Build 93: ship a bundled JS asset, NOT a bundled HTML asset.
// Builds 89-92 tried loading editor.html directly via Asset.fromModule +
// source.uri. Both the full rich editor AND a 1.5 KB probe page failed the
// same way on TestFlight WKWebView (onLoadEnd fired, phase -1 / none).
// The common failure path was the bundled-HTML asset-hosting code itself.
//
// Build 93 replaces it with:
//   - a tiny inline HTML shell passed via source.html (under 500 bytes)
//   - one bundled JS asset loaded by the shell via <script src="file://...">
//     using an absolute URI resolved from Asset.fromModule at mount time
//
// Metro treats .bundle as an asset (registered in metro.config.js). The
// file contents are JavaScript — the .bundle extension is a non-code
// sentinel so .js isn't whitelisted globally.
//
// eslint-disable-next-line @typescript-eslint/no-var-requires
const EDITOR_ASSET = require('../../../apps/mobile/assets/editor/native-editor.bundle');

export function LivePreviewInput({
  value,
  onChange,
  inputMode = 'scroll',
  onFocus,
  pendingCommand,
  onCommandApplied,
  onActiveFormatsChange,
  autoFocus = false,
  focusKey = null,
  enableBlockHeights = false,
  onBlockHeights,
}: LivePreviewInputProps) {
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const [contentHeight, setContentHeight] = useState<number>(500);
  const [webViewError, setWebViewError] = useState<string | null>(null);

  // Diagnostics carried over from Build 82 — earned their place during the
  // 73–88 incident debugging cycle. Surfaced in the fallback banner so a
  // TestFlight failure pinpoints the stall point.
  const lastPhaseRef = useRef<number | null>(null);
  const lastPhaseLabelRef = useRef<string>('none');
  const lastLoadEventRef = useRef<string>('none');
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build 89: bundled-asset URI. Resolved once on mount.
  const [assetUri, setAssetUri] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);

  // Build 89: TextInput fallback. Activated by the 2.5s ready watchdog when
  // the rich editor never sends `ready`. Renders a plain native multiline
  // TextInput so typing ALWAYS works regardless of WebView state.
  const [useFallback, setUseFallback] = useState(false);
  const [fallbackValue, setFallbackValue] = useState(value);

  // Refs to latest prop values — same pattern as the web component.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onFocusRef = useRef(onFocus);
  const onCommandAppliedRef = useRef(onCommandApplied);
  const onActiveFormatsChangeRef = useRef(onActiveFormatsChange);
  const autoFocusRef = useRef(autoFocus);
  const inputModeRef = useRef(inputMode);
  const enableBlockHeightsRef = useRef(enableBlockHeights);
  const onBlockHeightsRef = useRef(onBlockHeights);
  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onFocusRef.current = onFocus; }, [onFocus]);
  useEffect(() => { onCommandAppliedRef.current = onCommandApplied; }, [onCommandApplied]);
  useEffect(() => { onActiveFormatsChangeRef.current = onActiveFormatsChange; }, [onActiveFormatsChange]);
  useEffect(() => { autoFocusRef.current = autoFocus; }, [autoFocus]);
  useEffect(() => { inputModeRef.current = inputMode; }, [inputMode]);
  useEffect(() => { enableBlockHeightsRef.current = enableBlockHeights; }, [enableBlockHeights]);
  useEffect(() => { onBlockHeightsRef.current = onBlockHeights; }, [onBlockHeights]);

  // Keep the fallback TextInput in sync with the parent's value prop while
  // the watchdog has NOT fired. After it fires, treat the user's keystrokes
  // in the TextInput as the source of truth and stop overwriting them.
  useEffect(() => {
    if (!useFallback) setFallbackValue(value);
  }, [value, useFallback]);

  // Last value pushed into the WebView — used to dedupe echoes from `change`.
  const lastSentValueRef = useRef('');

  // Resolve the bundled editor.html asset to a local file:// URI. expo-asset
  // returns immediately for assets shipped inside the binary (no network
  // download needed). Failure here is surfaced via assetError + drives the
  // TextInput fallback path immediately.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const asset = Asset.fromModule(EDITOR_ASSET);
        if (!asset.localUri) {
          // Locally-hosted asset — already on disk for bundled binaries,
          // but call downloadAsync to populate localUri uniformly.
          await asset.downloadAsync();
        }
        if (cancelled) return;
        const uri = asset.localUri ?? asset.uri;
        if (!uri) {
          throw new Error('Asset.localUri unavailable after downloadAsync');
        }
        setAssetUri(uri);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setAssetError('Failed to resolve editor.html: ' + message);
        // Skip waiting for the watchdog — failing to resolve the asset means
        // the WebView will never load. Activate fallback now.
        setUseFallback(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 2.5s ready watchdog. Build 89 reduces from 5s -> 2.5s so users hit the
  // fallback faster when the rich editor stalls. Once useFallback flips on
  // it stays on for the life of the component (no auto-recovery).
  useEffect(() => {
    readyTimerRef.current = setTimeout(() => {
      if (!readyRef.current) {
        const phase = lastPhaseRef.current ?? -1;
        const label = lastPhaseLabelRef.current;
        const loadEvent = lastLoadEventRef.current;
        setWebViewError(
          `Editor bootstrap timeout — phase ${phase} (${label}); WebView load ${loadEvent}`,
        );
        setUseFallback(true);
      }
    }, 2500);
    return () => {
      if (readyTimerRef.current) {
        clearTimeout(readyTimerRef.current);
        readyTimerRef.current = null;
      }
    };
  }, []);

  // Build 93: tiny inline HTML shell that <script src>s the bundled
  // native-editor.bundle JS asset by absolute file:// URI. The shell is
  // ~500 bytes so the RN bridge serialization isn't a bottleneck, and the
  // heavy editor code loads from disk inside WKWebView directly.
  const source = useMemo(() => {
    if (!assetUri) return null;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
html,body{margin:0;padding:0;background:#1E1E1E;color:#DCDDDE;font-family:-apple-system,sans-serif;}
.error{color:#F28500;padding:12px;}
</style>
</head>
<body>
<div id="status">Loading editor…</div>
<div id="editor"></div>
<script src="${assetUri}"></script>
</body>
</html>`;
    return { html } as const;
  }, [assetUri]);

  function postToFrame(msg: object) {
    const js = `
      (function() {
        try {
          window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(msg)} }));
        } catch (e) {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: 'post:' + String(e) }));
          }
        }
      })();
      true;
    `;
    webViewRef.current?.injectJavaScript(js);
  }

  function handleMessage(e: WebViewMessageEvent) {
    let msg: { type: string; [k: string]: any };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (!msg?.type) return;

    switch (msg.type) {
      case 'ready': {
        readyRef.current = true;
        if (readyTimerRef.current) {
          clearTimeout(readyTimerRef.current);
          readyTimerRef.current = null;
        }
        setWebViewError(null);
        const initValue = valueRef.current ?? '';
        lastSentValueRef.current = initValue;
        postToFrame({ type: 'set-value', value: initValue });
        postToFrame({ type: 'set-readonly', readonly: inputModeRef.current === 'ink' });
        if (enableBlockHeightsRef.current) {
          postToFrame({ type: 'enable-block-heights' });
        }
        if (autoFocusRef.current) postToFrame({ type: 'focus' });
        break;
      }

      case 'phase': {
        if (typeof msg.phase === 'number') {
          lastPhaseRef.current = msg.phase;
        }
        if (typeof msg.label === 'string') {
          lastPhaseLabelRef.current = msg.label;
        }
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('[LivePreview] phase', msg.phase, msg.label);
        }
        break;
      }

      case 'block-heights':
        onBlockHeightsRef.current?.(msg as { type: 'block-heights'; blocks: Array<{ lineStart: number; lineEnd: number; height: number }> });
        break;

      case 'change':
        if (msg.value !== lastSentValueRef.current) {
          lastSentValueRef.current = msg.value as string;
          onChangeRef.current(msg.value as string);
        }
        break;

      case 'active-formats':
        onActiveFormatsChangeRef.current?.(msg.formats as FormatCommand[]);
        break;

      case 'height':
        if (typeof msg.height === 'number' && msg.height > 0) {
          setContentHeight(msg.height);
        }
        break;

      case 'command-applied':
        onCommandAppliedRef.current?.();
        break;

      case 'error':
        setWebViewError(typeof msg.message === 'string' ? msg.message : 'Unknown WebView error');
        break;
    }
  }

  // Sync value → WebView when the prop changes from above.
  useEffect(() => {
    if (!readyRef.current) return;
    if (value !== lastSentValueRef.current) {
      lastSentValueRef.current = value;
      postToFrame({ type: 'set-value', value });
    }
  }, [value]);

  // Sync inputMode → readonly.
  useEffect(() => {
    if (!readyRef.current) return;
    postToFrame({ type: 'set-readonly', readonly: inputMode === 'ink' });
  }, [inputMode]);

  // Enable the block-heights plugin after the WebView is ready.
  useEffect(() => {
    if (!readyRef.current || !enableBlockHeights) return;
    postToFrame({ type: 'enable-block-heights' });
  }, [enableBlockHeights]);

  useEffect(() => {
    if (!readyRef.current || !focusKey || inputMode === 'ink') return;
    postToFrame({ type: 'focus' });
  }, [focusKey, inputMode]);

  // Apply format commands from the toolbar.
  useEffect(() => {
    if (!pendingCommand) return;
    if (!readyRef.current) {
      onCommandAppliedRef.current?.();
      return;
    }
    postToFrame({ type: 'apply-format', command: pendingCommand });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommand]);

  // Apple Pencil / ink mode: when inputMode === 'ink', the Skia layer above
  // owns all touches.
  const inkMode = inputMode === 'ink';

  // Build 92: TextInput fallback REMOVED for diagnostic builds. The previous
  // implementation (Build 89) swapped in a plain native TextInput after the
  // 2.5s watchdog so users could always type — but the fallback masked the
  // actual rich-editor failure from our debugging view: the real editor
  // inside the WebView, which may have partial state (e.g. <div id="status">
  // stuck on "Loading editor…") that indicates where bootstrap died. Per
  // Codex's recommendation: do not mask the result while diagnosing.
  //
  // If useFallback flips true we now render a dead-state overlay ON TOP of
  // the WebView so you can see the underlying editor surface AND the banner
  // telling you exactly which phase failed. Restore the TextInput fallback
  // after the rich editor boots reliably again.
  // (useFallback stays in the render tree below — no early return.)

  return (
    <View
      style={[styles.container, { height: Math.max(contentHeight, 500) }]}
      pointerEvents={inkMode ? 'none' : 'auto'}
      onTouchStart={() => {
        if (inkMode) return;
        onFocusRef.current?.();
        // WKWebView OS policy (WebKit #195884) requires focus() to originate
        // from an evaluateJavaScript call on the RN side before the keyboard
        // is allowed to show. `keyboardDisplayRequiresUserAction={false}` only
        // covers RN-initiated focus. Re-posting a 'focus' message through
        // injectJavaScript satisfies that contract.
        if (readyRef.current) {
          postToFrame({ type: 'focus' });
        }
      }}
    >
      {source ? (
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={source}
          javaScriptEnabled
          domStorageEnabled
          onMessage={handleMessage}
          onError={(e: WebViewNativeErrorEvent) => {
            try {
              setWebViewError('native onError: ' + JSON.stringify(e.nativeEvent));
            } catch {
              setWebViewError('native onError (unserializable)');
            }
          }}
          onHttpError={(e: WebViewNativeErrorEvent) => {
            try {
              setWebViewError('native onHttpError: ' + JSON.stringify(e.nativeEvent));
            } catch {
              setWebViewError('native onHttpError (unserializable)');
            }
          }}
          onLoadStart={() => { lastLoadEventRef.current = 'onLoadStart'; }}
          onLoadEnd={() => { lastLoadEventRef.current = 'onLoadEnd'; }}
          scrollEnabled={false}
          hideKeyboardAccessoryView
          keyboardDisplayRequiresUserAction={false}
          automaticallyAdjustContentInsets={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          style={styles.webView}
          containerStyle={styles.webViewContainer}
          // Critical for transparency so the canvas bgBase shows through
          // any margins CodeMirror doesn't paint.
          androidLayerType="hardware"
          opaque={false}
          backgroundColor="transparent"
        />
      ) : (
        // Asset still resolving — render nothing for a beat. The watchdog
        // (or assetError handler) will swap in the fallback if this state
        // persists.
        <View style={styles.webViewContainer} />
      )}
      {webViewError !== null && Platform.OS !== 'web' && (
        <Text style={styles.errorBanner}>WebView error: {webViewError}</Text>
      )}
      {/* Build 92: visible dead-state overlay. When useFallback flips true
          (watchdog timeout or asset error) we no longer swap in a TextInput —
          instead we paint a semi-transparent banner over the WebView so you
          can see the actual CM6 surface underneath (e.g. "Loading editor…"
          stuck on-screen means CM6 loaded but hung mid-init) AND the phase
          marker that identifies where boot died. */}
      {useFallback && (
        <View style={styles.deadStateOverlay} pointerEvents="none">
          <Text style={styles.deadStateHeadline}>
            Rich editor did not boot (diagnostic mode)
          </Text>
          {(webViewError || assetError) && (
            <Text style={styles.deadStateDetail}>
              {assetError ?? webViewError}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    flexGrow: 1,
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  webViewContainer: {
    backgroundColor: 'transparent',
  },
  errorBanner: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    backgroundColor: 'rgba(139, 0, 0, 0.85)',
    color: '#fff',
    padding: 6,
    fontSize: 11,
  },
  deadStateOverlay: {
    position: 'absolute',
    top: 40,
    left: 8,
    right: 8,
    padding: 12,
    backgroundColor: 'rgba(44, 24, 0, 0.92)',
    borderWidth: 1,
    borderColor: tokens.accentPressed,
  },
  deadStateHeadline: {
    color: tokens.accentLight,
    fontSize: 13,
    fontWeight: '600',
  },
  deadStateDetail: {
    color: tokens.textBody,
    fontSize: 11,
    marginTop: 4,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
});
