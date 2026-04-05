/**
 * Native implementation of LivePreviewInput.
 *
 * On iOS/Android, CodeMirror is not needed — CanvasTextInput already provides
 * the correct editing experience with Apple Pencil support untouched.
 */
export { CanvasTextInput as LivePreviewInput } from './CanvasTextInput';
