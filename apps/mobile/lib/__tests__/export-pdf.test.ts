import { describe, it, expect } from 'vitest';
import {
  buildPdfHtml,
  escapeHtml,
  markdownToHtml,
} from '../export-pdf';

describe('escapeHtml', () => {
  it('escapes the five HTML entities', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('markdownToHtml', () => {
  it('returns an empty paragraph for empty input', () => {
    expect(markdownToHtml('')).toBe('<p></p>');
  });

  it('converts # H1 headings', () => {
    expect(markdownToHtml('# Hello')).toBe('<h1>Hello</h1>');
  });

  it('converts ## H2 and ### H3 headings', () => {
    expect(markdownToHtml('## Sub')).toBe('<h2>Sub</h2>');
    expect(markdownToHtml('### Deep')).toBe('<h3>Deep</h3>');
  });

  it('renders paragraphs and bold/italic inline', () => {
    const out = markdownToHtml('# H1\n\nPara\n\n**bold** text and *em*');
    expect(out).toContain('<h1>H1</h1>');
    expect(out).toContain('<p>Para</p>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>em</em>');
  });

  it('renders fenced code blocks with escaped entities', () => {
    const out = markdownToHtml('```\n<script>alert(1)</script>\n```');
    expect(out).toContain('<pre><code>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).not.toContain('<script>alert(1)</script>');
  });

  it('renders inline code', () => {
    const out = markdownToHtml('use `foo()` here');
    expect(out).toContain('<code>foo()</code>');
  });

  it('escapes HTML entities in paragraph text', () => {
    const out = markdownToHtml('A <b>raw</b> tag');
    expect(out).toContain('&lt;b&gt;raw&lt;/b&gt;');
    expect(out).not.toContain('<b>raw</b>');
  });
});

describe('buildPdfHtml', () => {
  it('produces a .pdf filename matching the slug', () => {
    const { filename } = buildPdfHtml({
      id: 'n1',
      title: 'My Note',
      body: 'hi',
    });
    expect(filename).toBe('my-note.pdf');
  });

  it('falls back to Untitled heading and untitled-<id> filename', () => {
    const { filename, html } = buildPdfHtml({
      id: 'abc12345xyz',
      title: '',
      body: '',
    });
    expect(filename).toBe('untitled-abc12345.pdf');
    expect(html).toContain('Untitled');
  });

  it('renders markdown body into the document HTML', () => {
    const { html } = buildPdfHtml({
      id: 'n1',
      title: 'T',
      body: '# H1\n\nPara\n\n**bold** text',
    });
    expect(html).toContain('<h1>H1</h1>');
    expect(html).toContain('<p>Para</p>');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('escapes HTML injection attempts in the title', () => {
    const { html } = buildPdfHtml({
      id: 'n1',
      title: '<script>alert(1)</script>',
      body: '',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes HTML injection in the body', () => {
    const { html } = buildPdfHtml({
      id: 'n1',
      title: 'T',
      body: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('uses Graphite color tokens in the styles', () => {
    const { html } = buildPdfHtml({ id: 'n1', title: 'T', body: '' });
    expect(html).toContain('#1E1E1E');
    expect(html).toContain('#DCDDDE');
    expect(html).toContain('#FFFFFF');
  });
});
