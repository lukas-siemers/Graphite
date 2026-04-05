import { describe, it, expect } from 'vitest';
import { slugify, buildExport } from '../export-markdown';

describe('slugify', () => {
  it('converts "Hello World" to "hello-world"', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips punctuation and trims edge dashes', () => {
    expect(slugify('  Foo & Bar!!!  ')).toBe('foo-bar');
  });

  it('falls back to untitled-<id> when title is empty', () => {
    expect(slugify('', 'abc12345xyz')).toBe('untitled-abc12345');
  });

  it('falls back to untitled-<id> when title is literally "Untitled"', () => {
    expect(slugify('Untitled', 'abc12345xyz')).toBe('untitled-abc12345');
  });

  it('collapses runs of punctuation into a single dash', () => {
    expect(slugify('a---b...c')).toBe('a-b-c');
  });
});

describe('buildExport', () => {
  it('produces "# Test\\n\\ncontent\\n" with test.md filename', () => {
    const result = buildExport({ id: 'n1', title: 'Test', body: 'content' });
    expect(result).toEqual({
      filename: 'test.md',
      content: '# Test\n\ncontent\n',
    });
  });

  it('uses "Untitled" heading and untitled-<id> filename when title is empty', () => {
    const result = buildExport({ id: 'abc12345xyz', title: '', body: '' });
    expect(result).toEqual({
      filename: 'untitled-abc12345.md',
      content: '# Untitled\n\n\n',
    });
  });
});
