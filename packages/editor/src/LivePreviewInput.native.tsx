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
import { View, StyleSheet, Text, TextInput, Platform } from 'react-native';
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

// Static asset reference — Metro resolves this at bundle time because
// `.html` is registered as an asset extension in apps/mobile/metro.config.js.
// At runtime, Asset.fromModule() returns a handle whose `.uri` (after
// downloadAsync, which is a no-op for bundled assets) is a file:// URI
// pointing into the app binary.
//
// The require() path is relative to THIS file: packages/editor/src ->
// ../../apps/mobile/assets/editor/editor.html
//
// eslint-disable-next-line @typescript-eslint/no-var-requires
const EDITOR_ASSET = require('../../../apps/mobile/assets/editor/editor.html');

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

  // WebView source — pure asset URI, no inline html, no runtime cache writes.
  const source = useMemo(
    () => (assetUri ? ({ uri: assetUri } as const) : null),
    [assetUri],
  );

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

  // Build 89 fallback path. Renders a plain native TextInput when the rich
  // editor failed to boot OR the asset failed to resolve. Same onChange
  // contract as the WebView path so the save pipeline upstream is unchanged.
  if (useFallback) {
    return (
      <View
        style={[styles.container, { minHeight: 500 }]}
        pointerEvents={inkMode ? 'none' : 'auto'}
      >
        <Text style={styles.fallbackBanner}>
          Rich editor failed — using basic text editor. Typing works.
        </Text>
        {(webViewError || assetError) && (
          <Text style={styles.fallbackDiag}>
            {assetError ?? webViewError}
          </Text>
        )}
        <TextInput
          value={fallbackValue}
          onChangeText={(text) => {
            setFallbackValue(text);
            onChangeRef.current(text);
          }}
          onFocus={() => onFocusRef.current?.()}
          autoFocus={autoFocus}
          editable={!inkMode}
          multiline
          textAlignVertical="top"
          placeholder="Start writing..."
          placeholderTextColor={tokens.textHint}
          style={styles.fallbackInput}
        />
      </View>
    );
  }

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
  fallbackBanner: {
    backgroundColor: tokens.accentTint,
    color: tokens.accentLight,
    padding: 8,
    fontSize: 12,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  fallbackDiag: {
    backgroundColor: tokens.bgCode,
    color: tokens.textMuted,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 10,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  fallbackInput: {
    flex: 1,
    backgroundColor: tokens.bgBase,
    color: tokens.textBody,
    paddingHorizontal: 24,
    paddingVertical: 16,
    fontSize: 16,
    lineHeight: 24,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
});
