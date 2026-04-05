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
  | 'link'
  | 'undo';

/**
 * Detect which FormatCommands are active at the current cursor position.
 * Used by the toolbar to highlight active format buttons.
 */
export function detectActiveFormats(
  text: string,
  selection: { start: number; end: number },
): FormatCommand[] {
  const active: FormatCommand[] = [];
  const { start } = selection;

  // ── Line-level formats ──────────────────────────────────────────────────
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', start);
  const currentLine = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);

  if (/^### /.test(currentLine)) active.push('h3');
  else if (/^## /.test(currentLine)) active.push('h2');
  else if (/^# /.test(currentLine)) active.push('h1');

  if (/^- /.test(currentLine)) active.push('bullet-list');
  if (/^\d+\. /.test(currentLine)) active.push('numbered-list');
  if (/^> /.test(currentLine)) active.push('blockquote');

  // ── Inline formats — cursor between opening and closing markers ─────────
  const before = text.slice(0, start);

  // Bold: odd number of ** before cursor → inside bold
  const boldCount = (before.match(/\*\*/g) ?? []).length;
  if (boldCount % 2 !== 0) active.push('bold');

  // Strikethrough: odd number of ~~ before cursor
  const strikeCount = (before.match(/~~/g) ?? []).length;
  if (strikeCount % 2 !== 0) active.push('strikethrough');

  // Inline code: odd number of backticks before cursor
  const codeCount = (before.match(/`/g) ?? []).length;
  if (codeCount % 2 !== 0) active.push('code-inline');

  return active;
}

/**
 * Apply a FormatCommand to a text string at the given selection position.
 * Returns the transformed string.
 */
export function applyFormatCommand(
  text: string,
  selection: { start: number; end: number },
  command: FormatCommand,
): string {
  const { start, end } = selection;
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);

  switch (command) {
    case 'bold':
      return `${before}**${selected || 'bold text'}**${after}`;

    case 'italic':
      return `${before}*${selected || 'italic text'}*${after}`;

    case 'strikethrough':
      return `${before}~~${selected || 'text'}~~${after}`;

    case 'code-inline':
      return `${before}\`${selected || 'code'}\`${after}`;

    case 'link':
      return `${before}[${selected || 'link text'}](url)${after}`;

    case 'h1':
    case 'h2':
    case 'h3': {
      const level = command === 'h1' ? 1 : command === 'h2' ? 2 : 3;
      const prefix = '#'.repeat(level) + ' ';
      const lineStart = before.lastIndexOf('\n') + 1;
      const lineEnd = text.indexOf('\n', start);
      const currentLine = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      const stripped = currentLine.replace(/^#{1,6} /, '');
      const newLine = currentLine.startsWith(prefix) ? stripped : prefix + stripped;
      return (
        text.slice(0, lineStart) +
        newLine +
        (lineEnd === -1 ? '' : text.slice(lineEnd))
      );
    }

    case 'bullet-list': {
      const lineStart = before.lastIndexOf('\n') + 1;
      const lineEnd = text.indexOf('\n', start);
      const currentLine = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      const newLine = currentLine.startsWith('- ')
        ? currentLine.slice(2)
        : `- ${currentLine}`;
      return (
        text.slice(0, lineStart) +
        newLine +
        (lineEnd === -1 ? '' : text.slice(lineEnd))
      );
    }

    case 'numbered-list': {
      const lineStart = before.lastIndexOf('\n') + 1;
      const lineEnd = text.indexOf('\n', start);
      const currentLine = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      const newLine = /^\d+\. /.test(currentLine)
        ? currentLine.replace(/^\d+\. /, '')
        : `1. ${currentLine}`;
      return (
        text.slice(0, lineStart) +
        newLine +
        (lineEnd === -1 ? '' : text.slice(lineEnd))
      );
    }

    case 'blockquote': {
      const lineStart = before.lastIndexOf('\n') + 1;
      const lineEnd = text.indexOf('\n', start);
      const currentLine = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      const newLine = currentLine.startsWith('> ')
        ? currentLine.slice(2)
        : `> ${currentLine}`;
      return (
        text.slice(0, lineStart) +
        newLine +
        (lineEnd === -1 ? '' : text.slice(lineEnd))
      );
    }

    case 'code-block': {
      if (selected) {
        return `${before}\n\`\`\`\n${selected}\n\`\`\`\n${after}`;
      }
      return `${before}\n\`\`\`\ncode here\n\`\`\`\n${after}`;
    }

    // 'undo' is handled specially in CanvasTextInput via prevValueRef
    case 'undo':
      return text;

    default:
      return text;
  }
}
