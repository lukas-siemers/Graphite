import { useState, useCallback } from 'react';
import type { GestureResponderEvent } from 'react-native';

export type InputMode = 'ink' | 'scroll';

interface PencilDetection {
  /** Current input mode — 'ink' when Apple Pencil detected, 'scroll' for finger */
  inputMode: InputMode;
  /**
   * Attach this to the canvas View's onStartShouldSetResponder callback to
   * detect touch type on every new touch sequence.
   */
  handleTouchStart: (evt: GestureResponderEvent) => boolean;
}

/**
 * Detects whether the current touch is from an Apple Pencil or a finger and
 * switches inputMode accordingly.
 *
 * Touch type values (React Native native event):
 *   0 = direct (finger)
 *   2 = stylus (Apple Pencil)
 *
 * Palm rejection: during ink mode, any touch with majorRadius > 20px is
 * ignored — this covers palm contact which has a much larger contact patch
 * than a pencil tip.
 */
export function usePencilDetection(): PencilDetection {
  const [inputMode, setInputMode] = useState<InputMode>('scroll');

  const handleTouchStart = useCallback(
    (evt: GestureResponderEvent): boolean => {
      const native = evt.nativeEvent as any;

      // touchType: 2 = stylus on iOS
      const isStylus = native.touchType === 2 || native.touchType === 'stylus';

      if (isStylus) {
        setInputMode('ink');
        // Do not claim the responder — let the Skia gesture handler take over
        return false;
      }

      // Palm rejection: large contact area during ink mode → ignore touch
      const majorRadius: number = native.majorRadius ?? 0;
      if (inputMode === 'ink' && majorRadius > 20) {
        return false;
      }

      // Finger touch → switch to scroll mode
      setInputMode('scroll');
      return false;
    },
    [inputMode],
  );

  return { inputMode, handleTouchStart };
}
