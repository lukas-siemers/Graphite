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

// Build 97: Codex's call after Build 96 proved phase 0.05 (WKUserScript-
// injected) fires but phase 0.1 (HTML inline <script>) doesn't. WKWebView
// is loading the page but blocking <script> tag execution — both inline
// and src — while accepting injection via the prop-based path. So we
// stop using HTML <script> tags entirely. The shell HTML is body-only,
// and the editor (pre-runtime + CM6 bundle + bootstrap) is delivered via
// the `injectedJavaScript` prop, which uses the same WKUserScript path
// as `injectedJavaScriptBeforeContentLoaded` (proven to work in 96).
//
// The bundled .bundle asset stays committed for parity but is no longer
// referenced at runtime by the WebView source. The native editor code
// is now imported as TS strings and concatenated below.
import { CM6_BUNDLE } from './live-preview/editor-runtime-string.generated';
import { buildEditorShellHtml } from './live-preview/editorHtml';
import { NATIVE_EDITOR_PRE_RUNTIME_SCRIPT } from './live-preview/native-editor-bridge';
import { buildNativeBootstrapScript } from './live-preview/native-editor-bootstrap';

// Concatenated once at module load — same content as native-editor.bundle.
// Total ~870 KB. Passed via the injectedJavaScript prop on every WebView
// navigation; runs after the page DOM is ready.
const NATIVE_EDITOR_INJECT_JS =
  '(function(){try{if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){window.ReactNativeWebView.postMessage(JSON.stringify({type:\'phase\',phase:0.06,label:\'injected-after-content\'}));}}catch(_){}})();\n' +
  NATIVE_EDITOR_PRE_RUNTIME_SCRIPT + '\n;\n' +
  CM6_BUNDLE + '\n;\n' +
  buildNativeBootstrapScript() + '\n;\n' +
  'true;\n';

const NATIVE_EDITOR_SHELL_HTML = buildEditorShellHtml();

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

  // Build 100: mirror the phase refs into state so the always-on phase
  // indicator rerenders as boot progresses. Visible on device in both
  // success and failure paths — screenshot tells us exactly where boot got.
  const [phaseDisplay, setPhaseDisplay] = useState<string>('phase - (waiting)');
  // Build 101: diagnostic counters for the post-ready "can't type" bug.
  const [tapCount, setTapCount] = useState(0);
  const [inputCount, setInputCount] = useState(0);
  // Build 104: persist the one-shot diagnostic phase labels (4.1 parent
  // resolution, 5.05 attachment) so the phase pill doesn't lose them
  // when phase 6 ready overwrites the main display. Shown alongside as
  // "... · par:X · att:Y" so a single screenshot captures the entire
  // boot trace: parent-found/created, view-attached/force-attached,
  // main phase, tap counter, input counter.
  const [parentStatusDisplay, setParentStatusDisplay] = useState<string>('?');
  const [attachStatusDisplay, setAttachStatusDisplay] = useState<string>('?');

  // Build 97: assetUri retained as a state shape only so the watchdog
  // banner format stays compatible with prior diagnostics. It's no longer
  // populated at runtime — the editor code is delivered via injectedJavaScript.
  const [assetUri] = useState<string | null>('inject:NATIVE_EDITOR_INJECT_JS');
  const [assetError] = useState<string | null>(null);

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

  // Build 97: no asset resolution at runtime. Editor code is now imported
  // as TS strings and concatenated into NATIVE_EDITOR_INJECT_JS at module
  // scope (above), then delivered via the `injectedJavaScript` prop. The
  // useEffect below is a no-op kept only to preserve cleanup symmetry.
  useEffect(() => {
    let cancelled = false;
    return () => { cancelled = true; void cancelled; };
  }, []);

  // Refs mirror assetUri + baseUrl so the watchdog banner can read them at
  // timeout fire time without pulling the useEffect's dep list forward.
  const assetUriRef = useRef<string | null>(null);
  const baseUrlRef = useRef<string | null>(null);

  // 2.5s ready watchdog. Once useFallback flips on it stays on for the life
  // of the component (no auto-recovery).
  useEffect(() => {
    readyTimerRef.current = setTimeout(() => {
      if (!readyRef.current) {
        const phase = lastPhaseRef.current ?? -1;
        const label = lastPhaseLabelRef.current;
        const loadEvent = lastLoadEventRef.current;
        const uri = assetUriRef.current ?? 'null';
        const base = baseUrlRef.current ?? 'null';
        setWebViewError(
          `Editor bootstrap timeout — phase ${phase} (${label}); WebView load ${loadEvent}; assetUri=${uri}; baseUrl=${base}`,
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

  // Mirror into refs so the watchdog banner can surface the current URIs
  // regardless of render timing.
  useEffect(() => { assetUriRef.current = assetUri; }, [assetUri]);
  useEffect(() => { baseUrlRef.current = 'inject:none'; }, []);

  const source = useMemo(() => {
    // Build 97: shell HTML has NO <script> tags at all. WKWebView blocked
    // every <script> we tried (inline AND src-loaded) with phase -1. The
    // editor code is delivered entirely via the injectedJavaScript prop —
    // same WKUserScript path that posted phase 0.05 successfully in 96.
    // Build 99: shell is produced by buildEditorShellHtml() which carries
    // the full shared EDITOR_CSS — CM6 layout, status indicator, and
    // placeholder styling all come from the same source as the web iframe.
    return { html: NATIVE_EDITOR_SHELL_HTML } as const;
  }, []);

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
        setPhaseDisplay('phase 6 · ready');
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
        const phaseNum = typeof msg.phase === 'number' ? msg.phase : null;
        const phaseLabel = typeof msg.label === 'string' ? msg.label : '?';
        // Build 104: route diagnostic sub-phases into dedicated state so
        // phase 6 (ready) doesn't erase them. Main pill keeps showing the
        // headline phase progression; par: and att: stay persistent.
        if (phaseNum === 4.1) {
          setParentStatusDisplay(phaseLabel);
        } else if (phaseNum === 5.05) {
          setAttachStatusDisplay(phaseLabel);
        } else {
          setPhaseDisplay(`phase ${phaseNum ?? '?'} · ${phaseLabel}`);
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

      case 'input-activity':
        // Build 101: posted by the CM6 bootstrap's updateListener any time
        // the editor document changes or selection moves. Lets us see on-
        // device whether CM6 is receiving any keystrokes after ready.
        setInputCount((n) => n + 1);
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

  // Build 98: rich editor is the only path. The Build 89–92 TextInput fallback
  // was deliberately removed — fixing the root cause (the scoping bug in
  // `native-editor-bootstrap.ts` that kept `postPhase(2, …)` from resolving)
  // makes the rich editor boot reliably. The dead-state overlay still exists
  // for diagnostic visibility but there is no alternate text surface.

  return (
    <View
      style={[styles.container, { height: Math.max(contentHeight, 500) }]}
      pointerEvents={inkMode ? 'none' : 'auto'}
      onTouchStart={() => {
        if (inkMode) return;
        setTapCount((n) => n + 1);
        onFocusRef.current?.();
        // Build 101: direct .cm-content.focus() injection. Previously we
        // dispatched a MessageEvent through postToFrame and relied on the
        // bootstrap's message listener to call view.focus(). The indirection
        // drops out of the evaluateJavaScript synchronous context, which
        // (combined with WKWebView's keyboard policy) can silently prevent
        // the iOS keyboard from showing even when keyboardDisplayRequiresUserAction
        // is false. Calling .cm-content.focus() directly in the injection
        // keeps focus inside the RN-originated evaluateJavaScript window.
        // Also set a collapsed selection at offset 0 so CM6 syncs its
        // internal selection state with the native caret on first focus.
        if (readyRef.current) {
          webViewRef.current?.injectJavaScript(`
            (function(){
              try {
                var el = document.querySelector('.cm-content');
                if (el) {
                  el.focus();
                  var sel = window.getSelection && window.getSelection();
                  if (sel && el.firstChild) {
                    var range = document.createRange();
                    range.setStart(el, 0);
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);
                  }
                }
              } catch (e) {
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: 'focus-inject:' + String(e) }));
                }
              }
            })();
            true;
          `);
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
          /* Build 96 diagnostic. injectedJavaScriptBeforeContentLoaded uses a
             different injection mechanism than HTML <script> tags — it runs
             via WKUserScript at documentStart for every navigation. If THIS
             posts a phase 0.05 marker but our HTML's inline scripts don't
             post phase 0.1, then WKWebView is loading the page but blocking
             inline script execution. Both signals together pinpoint whether
             the bridge itself is reachable at all. */
          injectedJavaScriptBeforeContentLoaded={`
            (function(){
              try {
                if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'phase',
                    phase: 0.05,
                    label: 'injected-before-content',
                    href: String(location && location.href),
                    userAgent: String(navigator && navigator.userAgent || '?')
                  }));
                }
              } catch (_) {}
            })();
            true;
          `}
          /* Build 97: native editor (pre-runtime + CM6 bundle + bootstrap)
             delivered via injectedJavaScript prop. WKWebView blocked HTML
             <script> tags through Build 96 but accepted WKUserScript
             injection. injectedJavaScript runs once per navigation, after
             the page is loaded. */
          injectedJavaScript={NATIVE_EDITOR_INJECT_JS}
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
          // Build 104: WKWebView on iPad has a known CALayer compositing
          // bug where the layer can skip paint entirely when opaque=false
          // combined with a clear backgroundColor (alpha=0). react-native-
          // webview/apple/RNCWebViewImpl.m line 720 sets _webView.opaque =
          // false but has no macOS-style paint-flush workaround on iOS.
          // Symptom: JS runs to completion, phases post, but user sees no
          // WebView content. Fix: make the WebView fully opaque with a
          // solid dark background matching the shell HTML's body color.
          // Shell already paints #1E1E1E, so there's no visual difference
          // once rendered — we just stop the compositor from deciding the
          // layer is invisible.
          androidLayerType="hardware"
          opaque
          backgroundColor={tokens.bgBase}
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
      {/* Build 100: always-on phase indicator, extended in Build 101 with
          tap/input counters. Shows the deepest boot phase plus live counts
          of RN-side onTouchStart events (t:N) and CM6 input-activity
          events (i:M). Screenshot interpretation:
            phase 6 · ready · t:0 i:0 → editor booted but no taps landing
            phase 6 · ready · t:3 i:0 → taps land but CM6 not getting input
            phase 6 · ready · t:3 i:5 → everything working (not the bug) */}
      <View style={styles.phaseIndicator} pointerEvents="none">
        <Text style={styles.phaseIndicatorText}>
          {`${phaseDisplay} · par:${parentStatusDisplay} · att:${attachStatusDisplay} · t:${tapCount} i:${inputCount}`}
        </Text>
      </View>
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
    backgroundColor: tokens.bgBase,
  },
  webView: {
    flex: 1,
    backgroundColor: tokens.bgBase,
  },
  webViewContainer: {
    backgroundColor: tokens.bgBase,
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
  phaseIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(20, 20, 20, 0.75)',
    borderWidth: 1,
    borderColor: tokens.border,
  },
  phaseIndicatorText: {
    color: tokens.textMuted,
    fontSize: 10,
    letterSpacing: 0.3,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
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
