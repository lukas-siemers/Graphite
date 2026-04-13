/**
 * Web implementation of LivePreviewInput.
 *
 * Renders a CodeMirror 6 Live Preview editor inside an iframe using srcdoc —
 * no Metro bundling of CodeMirror needed.
 *
 * Parent → iframe messages:
 *   { type: 'set-value', value: string }
 *   { type: 'apply-format', command: string }
 *   { type: 'focus' }
 *   { type: 'set-readonly', readonly: boolean }
 *
 * iframe → parent messages:
 *   { type: 'ready' }
 *   { type: 'change', value: string }
 *   { type: 'active-formats', formats: string[] }
 *   { type: 'height', height: number }
 *   { type: 'command-applied' }
 */
import React, { useEffect, useRef } from 'react';
import { buildEditorHtml } from './live-preview/editorHtml';
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
}

const EDITOR_HTML = buildEditorHtml();

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
}: LivePreviewInputProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);

  // Keep refs to the latest props so the message listener (registered once at
  // mount) always reads current values. Critical for the `ready` handler —
  // without this, it would capture the initial empty string and load the
  // editor blank, even after `value` is set.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onFocusRef = useRef(onFocus);
  const onCommandAppliedRef = useRef(onCommandApplied);
  const onActiveFormatsChangeRef = useRef(onActiveFormatsChange);
  const autoFocusRef = useRef(autoFocus);
  const inputModeRef = useRef(inputMode);
  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onFocusRef.current = onFocus; }, [onFocus]);
  useEffect(() => { onCommandAppliedRef.current = onCommandApplied; }, [onCommandApplied]);
  useEffect(() => { onActiveFormatsChangeRef.current = onActiveFormatsChange; }, [onActiveFormatsChange]);
  useEffect(() => { autoFocusRef.current = autoFocus; }, [autoFocus]);
  useEffect(() => { inputModeRef.current = inputMode; }, [inputMode]);

  // Last value we pushed into the iframe — used to dedupe echoes from `change`
  const lastSentValueRef = useRef('');

  function postToFrame(msg: object) {
    iframeRef.current?.contentWindow?.postMessage(msg, '*');
  }

  // Mount the iframe once. The message listener is registered inside this
  // effect so it's attached exactly once for the component's lifetime.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('srcdoc', EDITOR_HTML);
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    // Transparent, no border, fills parent. Height grows via ResizeObserver
    // messages from the iframe content so the page scrolls like one surface.
    iframe.style.cssText = [
      'width:100%',
      'border:none',
      'background:transparent',
      'display:block',
      'height:100%',
      'min-height:500px',
    ].join(';');
    iframeRef.current = iframe;
    container.appendChild(iframe);

    function handleMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const msg = e.data as { type: string; [k: string]: any };
      if (!msg?.type) return;

      switch (msg.type) {
        case 'ready': {
          readyRef.current = true;
          // Seed from the CURRENT value ref, not from stale closure state.
          // This is the fix for the "notes load blank" race.
          const initValue = valueRef.current ?? '';
          lastSentValueRef.current = initValue;
          postToFrame({ type: 'set-value', value: initValue });
          postToFrame({ type: 'set-readonly', readonly: inputModeRef.current === 'ink' });
          if (autoFocusRef.current) postToFrame({ type: 'focus' });
          break;
        }

        case 'change':
          // Ignore echoes of values we pushed
          if (msg.value !== lastSentValueRef.current) {
            lastSentValueRef.current = msg.value as string;
            onChangeRef.current(msg.value as string);
          }
          break;

        case 'active-formats':
          onActiveFormatsChangeRef.current?.(msg.formats as FormatCommand[]);
          break;

        case 'height':
          if (iframeRef.current) iframeRef.current.style.height = `${msg.height}px`;
          break;

        case 'command-applied':
          onCommandAppliedRef.current?.();
          break;

        case 'error':
          // Surface iframe errors to the parent console for debugging
          console.error('[LivePreviewInput] iframe error:', msg.message);
          break;
      }
    }

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
      iframe.remove();
      iframeRef.current = null;
      readyRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync value → iframe when the prop changes from above
  useEffect(() => {
    if (!readyRef.current) return; // ready handler will pick up valueRef.current
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
    // onCommandApplied fires when the iframe sends 'command-applied'
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommand]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', minHeight: '100%', display: 'flex', flexDirection: 'column', cursor: 'text' }}
      onClick={() => {
        onFocusRef.current?.();
        if (readyRef.current) postToFrame({ type: 'focus' });
      }}
    />
  );
}
