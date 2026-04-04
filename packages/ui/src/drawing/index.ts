/**
 * Platform-aware drawing canvas export.
 *
 * - Platform.OS === 'web'  →  tldraw (Electron / browser)
 * - native                 →  react-native-skia (mobile, imported at call site)
 *
 * Desktop/web consumers import from '@graphite/ui/drawing' and always get
 * the web implementation. Mobile keeps its own import path:
 *   apps/mobile/components/drawing/DrawingCanvas
 */
export { default as DrawingCanvasWeb } from './DrawingCanvasWeb';
export type { DrawingCanvasProps, Stroke, Point } from './drawing-types';
