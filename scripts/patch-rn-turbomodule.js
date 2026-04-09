/**
 * Patches React Native TurboModule threading bug.
 *
 * Problem: performVoidMethodInvocation dispatches to a background queue,
 * then the exception handler calls convertNSExceptionToJSError which
 * accesses the Hermes JSI runtime from that background thread. This
 * corrupts Hermes GC state and crashes the app at startup.
 *
 * Fix 1: Force gTurboModuleEnableSyncVoidMethods = YES so void methods
 *         execute synchronously on the JS thread (never dispatched).
 * Fix 2: Replace ALL convertNSExceptionToJSError throws with NSLog so
 *         no code path can touch JSI from a background thread.
 */
const fs = require('fs');
const path = require('path');

const RN_ROOT = path.join(__dirname, '..', 'apps', 'mobile', 'node_modules', 'react-native');
let patched = 0;

// --- Patch 1: RCTBridge.mm — force sync void methods ---
const bridgePath = path.join(RN_ROOT, 'React', 'Base', 'RCTBridge.mm');
if (fs.existsSync(bridgePath)) {
  let src = fs.readFileSync(bridgePath, 'utf8');
  const before = 'static BOOL gTurboModuleEnableSyncVoidMethods = NO;';
  const after  = 'static BOOL gTurboModuleEnableSyncVoidMethods = YES;';
  if (src.includes(before)) {
    src = src.split(before).join(after);
    fs.writeFileSync(bridgePath, src, 'utf8');
    console.log('[patch-rn] RCTBridge.mm: gTurboModuleEnableSyncVoidMethods = YES ✔');
    patched++;
  } else if (src.includes(after)) {
    console.log('[patch-rn] RCTBridge.mm: already patched ✔');
    patched++;
  } else {
    console.error('[patch-rn] RCTBridge.mm: target string not found — patch FAILED');
    process.exit(1);
  }
} else {
  console.warn('[patch-rn] RCTBridge.mm not found (skipping — not an iOS build?)');
}

// --- Patch 2: RCTTurboModule.mm — safe exception handler ---
const turboPath = path.join(RN_ROOT, 'ReactCommon', 'react', 'nativemodule', 'core',
  'platform', 'ios', 'ReactCommon', 'RCTTurboModule.mm');
if (fs.existsSync(turboPath)) {
  let src = fs.readFileSync(turboPath, 'utf8');
  const target = 'throw convertNSExceptionToJSError(runtime, exception, std::string{moduleName}, methodNameStr);';
  const replacement = 'NSLog(@"[RCTTurboModule] Exception in %s.%s: %@", moduleName, methodName, exception);';

  const count = (src.match(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

  if (count > 0) {
    src = src.split(target).join(replacement);
    fs.writeFileSync(turboPath, src, 'utf8');
    console.log(`[patch-rn] RCTTurboModule.mm: replaced ${count} convertNSExceptionToJSError calls ✔`);
    patched++;
  } else if (src.includes(replacement)) {
    console.log('[patch-rn] RCTTurboModule.mm: already patched ✔');
    patched++;
  } else {
    console.error('[patch-rn] RCTTurboModule.mm: target string not found — patch FAILED');
    process.exit(1);
  }
} else {
  console.warn('[patch-rn] RCTTurboModule.mm not found (skipping — not an iOS build?)');
}

console.log(`[patch-rn] Done. ${patched} file(s) patched.`);
