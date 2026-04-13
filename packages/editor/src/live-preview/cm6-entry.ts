/**
 * CodeMirror 6 bundle entry point.
 *
 * This file is consumed by scripts/bundle-cm6.mjs to produce a minified IIFE
 * that attaches `window.CM6` at load time. The editorHtml.ts HTML then
 * destructures the exported names from window.CM6 and runs the editor —
 * no `https://esm.sh/...` network imports at runtime.
 *
 * This is Build 81's architectural fix: TestFlight/standalone WKWebView
 * does not reliably fetch remote ES modules (network origin / CSP / ATS),
 * so we bundle CodeMirror locally and inline it into the editor HTML.
 *
 * DO NOT add logic here — this file exists only to pull every CodeMirror
 * module into one bundle. All editor behavior still lives in editorHtml.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder, ViewPlugin, Decoration } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  undo,
  redo,
  indentWithTab,
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  HighlightStyle,
  syntaxHighlighting,
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  syntaxTree,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { rust } from '@codemirror/lang-rust';
import { java } from '@codemirror/lang-java';
import { html as htmlLang } from '@codemirror/lang-html';
import { css as cssLang } from '@codemirror/lang-css';
import { json as jsonLang } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { csharp, kotlin, scala, objectiveC } from '@codemirror/legacy-modes/mode/clike';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { go as goMode } from '@codemirror/legacy-modes/mode/go';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { yaml as yamlMode } from '@codemirror/legacy-modes/mode/yaml';
import { toml as tomlMode } from '@codemirror/legacy-modes/mode/toml';
import { swift } from '@codemirror/legacy-modes/mode/swift';

// Attach everything on window.CM6 so the inlined <script> in editorHtml.ts
// can destructure from it. Names match the previous `import { ... } from
// 'https://esm.sh/...'` shape exactly so the downstream editor setup code
// (lines ~296-1340 of editorHtml.ts) is unchanged.
(window as any).CM6 = {
  EditorState,
  Compartment,
  EditorView,
  keymap,
  placeholder,
  ViewPlugin,
  Decoration,
  defaultKeymap,
  history,
  historyKeymap,
  undo,
  redo,
  indentWithTab,
  markdown,
  markdownLanguage,
  HighlightStyle,
  syntaxHighlighting,
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  syntaxTree,
  t,
  python,
  javascript,
  cpp,
  rust,
  java,
  htmlLang,
  cssLang,
  jsonLang,
  sql,
  csharp,
  kotlin,
  scala,
  objectiveC,
  shell,
  goMode,
  ruby,
  lua,
  yamlMode,
  tomlMode,
  swift,
};
