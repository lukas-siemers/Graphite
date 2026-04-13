/**
 * Formatting commands dispatched from the toolbar to the active text input.
 */
export type FormatCommand =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code-inline'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet-list'
  | 'numbered-list'
  | 'blockquote'
  | 'code-block'
  | 'copy-code-block'
  | 'link'
  | 'undo'
  // Pseudo-format: reported in activeFormats when the cursor is inside a
  // fenced code block. Not a dispatchable command — used by the toolbar to
  // conditionally render the COPY button.
  | 'in-fence';
