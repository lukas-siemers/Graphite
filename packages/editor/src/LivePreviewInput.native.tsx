/**
 * Native implementation of LivePreviewInput.
 *
 * Hosts the same CodeMirror 6 Live Preview editor as the web build, but inside
 * a react-native-webview instead of an <iframe>. Shares the editor CSS,
 * pre-runtime scaffold, and app bootstrap script with the web build via
 * editorHtml.ts; the only thing that differs is how the CM6 runtime library
 * is delivered to the WebView.
 *
 * Build 82 load strategy:
 *   1. At mount, write the CM6 runtime bundle (imported as a string constant
 *      from editor-runtime-string.generated.ts) to the cache directory as
 *      `editor-runtime.js`.
 *   2. Write the shell HTML (buildEditorHtmlShell) next to it as
 *      `editor.html`. The shell references the runtime via
 *      `<script src="editor-runtime.js">` — a sibling file lookup.
 *   3. Point the WebView at `file://...editor.html`.
 *
 * Why this beats Build 81: Build 81 passed the 820KB runtime through the RN
 * bridge inside `source={{ html }}`. That inline payload stalled silently
 * under production WKWebView (TestFlight). Writing once to disk and loading
 * from file:// keeps the bridge payload to a tiny URI.
 *
 * Host → WebView messages (injected via injectJavaScript → window.postMessage):
 *   { type: 'set-value', value: string }
 *   { type: 'apply-format', command: string }
 *   { type: 'focus' }
 *   { type: 'set-readonly', readonly: boolean }
 *
 * WebView → Host messages (via window.ReactNativeWebView.postMessage):
 *   { type: 'ready' }
 *   { type: 'change', value: string }
 *   { type: 'active-formats', formats: string[] }
 *   { type: 'height', height: number }
 *   { type: 'command-applied' }
 *   { type: 'error', message: string }
 *   { type: 'phase', phase: number, label: string }
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';

// react-native-webview does not re-export its error event types from the
// package root, and the package exports map blocks the /lib/WebViewTypes
// subpath. Define the minimal shape we consume here — only { nativeEvent }
// is touched, so this stays forward-compatible with any library bump.
type WebViewNativeErrorEvent = { nativeEvent: unknown };
import { buildEditorHtmlShell } from './live-preview/editor-shell';
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

/**
 * Injected script that rewires the iframe's `postMessage` bridge so the
 * CodeMirror host code (which uses `window.parent.postMessage` and a
 * `message` listener on the inner window) talks to the React Native side
 * via `window.ReactNativeWebView.postMessage` instead.
 */
const BRIDGE_SHIM = `
(function() {
  if (window.__graphiteBridgeInstalled) return;
  window.__graphiteBridgeInstalled = true;

  // Outbound: redirect window.parent.postMessage -> ReactNativeWebView
  try {
    var rn = window.ReactNativeWebView;
    var fakeParent = {
      postMessage: function(msg) {
        try {
          rn.postMessage(typeof msg === 'string' ? msg : JSON.stringify(msg));
        } catch (e) {
          rn.postMessage(JSON.stringify({ type: 'error', message: String(e) }));
        }
      }
    };
    try { Object.defineProperty(window, 'parent', { value: fakeParent, configurable: true }); } catch (e) {}
    try { Object.defineProperty(window, 'top',    { value: fakeParent, configurable: true }); } catch (e) {}
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: 'bridge-install:' + String(e) }));
  }

  // Surface runtime errors to the host
  window.addEventListener('error', function(e) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'error',
        message: (e && e.message) ? e.message : 'unknown',
      }));
    } catch (_) {}
  });

  // Build 82: phase 0 — bridge shim installed. First signal the host gets
  // that any JS at all is running inside the WebView. If this marker never
  // arrives the failure is pre-JS (WebView didn't load the HTML at all).
  // Build 85: also report window.location.href so we can tell whether the
  // shim ran against the actual HTML shell or an empty about:blank.
  try {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'phase', phase: 0,
      label: 'bridge-installed @ ' + String(window.location && window.location.href),
    }));
  } catch (_) {}

  true;
})();
true;
`;

// Build 88: no runtime disk writes. The editor HTML is built once (with
// CM6 bundle + pre-runtime + bootstrap all inlined) and passed directly via
// source.html. Matches the Build 71-era pattern that was the last confirmed-
// working editor delivery on TestFlight production.

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
  // Surface WebView errors in a red overlay — temporary diagnostic for
  // Build 78+. Hiding errors behind __DEV__ meant production users saw a
  // silent dead editor when the WebView bundle failed.
  const [webViewError, setWebViewError] = useState<string | null>(null);
  // Build 88: HTML is built once and held for the life of the component.
  // No disk writes, no file:// delivery. source.html is the original
  // Build 71-era pattern — inline HTML passes through the WebView source
  // prop and WKWebView loads it via loadHTMLString.
  // Build 82: last bootstrap phase + label observed. The 5s ready watchdog
  // reports both fields in the red banner if the ready handshake never
  // arrives, so TestFlight logs pinpoint the exact stall point.
  const lastPhaseRef = useRef<number | null>(null);
  const lastPhaseLabelRef = useRef<string>('none');
  // Build 86: load events tracked separately so they don't overwrite phase
  // markers in the watchdog banner (Codex-flagged).
  const lastLoadEventRef = useRef<string>('none');
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs to latest prop values — same pattern as the web component, needed so
  // the `ready` handler seeds the editor with the CURRENT value rather than
  // the value captured at mount time.
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

  // Last value pushed into the WebView — used to dedupe echoes from `change`
  const lastSentValueRef = useRef('');

  // Build 88: no-op — the shell HTML is ready synchronously. Kept the
  // effect signature for symmetry but nothing async to wait on.

  // 5s ready watchdog. If the WebView never posts 'ready', surface the last
  // bootstrap phase observed so TestFlight banners pinpoint the stall.
  useEffect(() => {
    readyTimerRef.current = setTimeout(() => {
      if (!readyRef.current) {
        const phase = lastPhaseRef.current ?? -1;
        const label = lastPhaseLabelRef.current;
        const loadEvent = lastLoadEventRef.current;
        setWebViewError(
          `Editor bootstrap timeout — phase ${phase} (${label}); WebView load ${loadEvent}`,
        );
      }
    }, 5000);
    return () => {
      if (readyTimerRef.current) {
        clearTimeout(readyTimerRef.current);
        readyTimerRef.current = null;
      }
    };
  }, []);

  // Build 88: inline HTML source — Build 71-era proven-working pattern.
  const shellHtml = useMemo(() => buildEditorHtmlShell(), []);
  const source = useMemo(() => ({ html: shellHtml } as const), [shellHtml]);

  function postToFrame(msg: object) {
    const js = `
      (function() {
        try {
          window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(msg)} }));
        } catch (e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: 'post:' + String(e) }));
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
        // Build 82: bundle is alive — cancel the bootstrap timeout and clear
        // any stale error banner from a previous failed load.
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
        // Build 82: bootstrap progress marker. Record the most recent phase
        // so the ready-timeout can report where boot stalled.
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
        // Surface WebView errors as a visible overlay (not gated on __DEV__)
        // so release users see the failure instead of a dead editor.
        setWebViewError(typeof msg.message === 'string' ? msg.message : 'Unknown WebView error');
        break;
    }
  }

  // Sync value → WebView when prop changes from above
  useEffect(() => {
    if (!readyRef.current) return;
    if (value !== lastSentValueRef.current) {
      lastSentValueRef.current = value;
      postToFrame({ type: 'set-value', value });
    }
  }, [value]);

  // Sync inputMode → readonly
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

  // Apply format commands from the toolbar
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
  // must own all touches. We disable pointer events on the WebView wrapper so
  // pan/draw gestures pass through to the InkLayer sibling rendered on top.
  const inkMode = inputMode === 'ink';

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
      <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={source}
          javaScriptEnabled
          domStorageEnabled
          injectedJavaScriptBeforeContentLoaded={BRIDGE_SHIM}
          onMessage={handleMessage}
          // Surface native WebView load failures through the same red-banner
          // path as in-JS errors. Before Build 81, a failed bundle load would
          // leave the user with a silent dead editor. Errors are now visible.
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
          onLoadStart={(e: WebViewNativeErrorEvent) => {
            lastLoadEventRef.current = 'onLoadStart';
          }}
          onLoadEnd={(e: WebViewNativeErrorEvent) => {
            lastLoadEventRef.current = 'onLoadEnd';
          }}
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
      {webViewError !== null && (
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
});
