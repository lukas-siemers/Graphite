/**
 * Build 98 execution-level guardrail.
 *
 * The Build 89 delivery guardrail (`native-editor-delivery.test.ts`) only
 * checks source strings for banned substrings. It never *executes* the
 * assembled native injection, which is why Build 97 shipped with a scoping
 * bug that died at `postPhase(2, 'cm6-bundle-executed')` — the bootstrap
 * called `postPhase` as a free variable but the pre-runtime scaffold scoped
 * it inside an IIFE. The watchdog banner showed `phase 1 (html-parsed)` as
 * the last successful phase.
 *
 * This test runs the assembled injection inside a Node `vm` sandbox with a
 * stubbed `window.ReactNativeWebView.postMessage` and asserts that each of
 * the three helpers (`postPhase`, `reportError`, `postToHost`) referenced
 * as free variables by `EDITOR_BOOTSTRAP_SCRIPT` are actually resolvable in
 * the bootstrap's lexical scope. We don't execute the full CM6 bootstrap —
 * doing so would require a DOM and the ~870 KB CM6 bundle to be re-bundled
 * for Node. We do execute:
 *   1. `NATIVE_EDITOR_PRE_RUNTIME_SCRIPT` — must post phase 1.
 *   2. The alias `var` declarations produced by `buildNativeBootstrapScript()`.
 *   3. Synthetic bootstrap probes that call each free variable — must not
 *      throw `ReferenceError` and must post phase 2 / an error / a ready.
 *
 * If any of the three helpers go out of scope again, this test fails BEFORE
 * any TestFlight cycle.
 */
import { describe, it, expect } from 'vitest';
import { Script, createContext } from 'node:vm';
import { NATIVE_EDITOR_PRE_RUNTIME_SCRIPT } from '../live-preview/native-editor-bridge';
import { buildNativeBootstrapScript } from '../live-preview/native-editor-bootstrap';

type Message = { type: string; [k: string]: unknown };

function buildSandbox(): { context: ReturnType<typeof createContext>; messages: Message[] } {
  const messages: Message[] = [];
  // Minimal window/document stub — enough for NATIVE_EDITOR_PRE_RUNTIME_SCRIPT
  // to run its IIFE without throwing. The script touches window.addEventListener,
  // document.getElementById (lazily inside reportError), and
  // window.ReactNativeWebView.postMessage.
  const fakeWindow: Record<string, unknown> = {
    addEventListener: () => {},
    ReactNativeWebView: {
      postMessage: (s: string) => {
        try {
          messages.push(JSON.parse(s));
        } catch {
          messages.push({ type: 'raw', payload: s } as Message);
        }
      },
    },
  };
  const fakeDocument = {
    getElementById: () => null,
  };
  const sandbox = {
    window: fakeWindow,
    document: fakeDocument,
  } as Record<string, unknown>;
  // Make `window` self-reference so `window.foo = …; foo` also works if needed.
  (sandbox as any).self = fakeWindow;
  const context = createContext(sandbox);
  return { context, messages };
}

describe('native editor injection — Build 98 execution-level guardrail', () => {
  it('pre-runtime exposes __graphitePostToNative / __graphitePostPhase / __graphiteReportError on window', () => {
    const { context, messages } = buildSandbox();
    new Script(NATIVE_EDITOR_PRE_RUNTIME_SCRIPT).runInContext(context);
    expect(typeof (context as any).window.__graphitePostToNative).toBe('function');
    expect(typeof (context as any).window.__graphitePostPhase).toBe('function');
    expect(typeof (context as any).window.__graphiteReportError).toBe('function');
    // Pre-runtime must post phase 1 before returning.
    const phases = messages.filter((m) => m.type === 'phase').map((m) => m.phase);
    expect(phases).toContain(1);
  });

  it('buildNativeBootstrapScript prepends aliases for all three helpers (scoping fix)', () => {
    const script = buildNativeBootstrapScript();
    // All three bare identifiers used by EDITOR_BOOTSTRAP_SCRIPT MUST be
    // aliased to the window.__graphite* helpers at the top of the native
    // bootstrap. If any of these regress, Build 97's phase-1 stall returns.
    expect(script).toMatch(/var\s+postToHost\s*=\s*window\.__graphitePostToNative\s*;/);
    expect(script).toMatch(/var\s+postPhase\s*=\s*window\.__graphitePostPhase\s*;/);
    expect(script).toMatch(/var\s+reportError\s*=\s*window\.__graphiteReportError\s*;/);
  });

  it('postPhase / reportError / postToHost resolve from bootstrap scope (phase 2+ reachable)', () => {
    const { context, messages } = buildSandbox();

    new Script(NATIVE_EDITOR_PRE_RUNTIME_SCRIPT).runInContext(context);

    // Extract just the three alias lines that `buildNativeBootstrapScript`
    // prepends. We avoid executing the full EDITOR_BOOTSTRAP_SCRIPT body
    // because it needs CM6 + a full DOM; those are orthogonal to the
    // scoping regression this test guards against.
    const bootstrap = buildNativeBootstrapScript();
    const aliasLines = bootstrap
      .split('\n')
      .filter((line) => /^var\s+(postToHost|postPhase|reportError)\s*=/.test(line.trim()))
      .join('\n');
    expect(aliasLines).not.toBe('');

    // Probe: the same bare-identifier call shape EDITOR_BOOTSTRAP_SCRIPT uses
    // at line 288 (`postPhase(2, 'cm6-bundle-executed')`). If the aliases
    // don't resolve this throws ReferenceError and the test fails loudly.
    const probe = `
      ${aliasLines}
      postPhase(2, 'cm6-bundle-executed');
      postToHost({ type: 'ready' });
      reportError(new Error('probe error'));
    `;
    expect(() => new Script(probe).runInContext(context)).not.toThrow();

    const phases = messages.filter((m) => m.type === 'phase').map((m) => m.phase);
    expect(phases).toEqual(expect.arrayContaining([1, 2]));

    const readies = messages.filter((m) => m.type === 'ready');
    expect(readies.length).toBeGreaterThan(0);

    const errors = messages.filter((m) => m.type === 'error');
    expect(errors.length).toBeGreaterThan(0);
  });
});
