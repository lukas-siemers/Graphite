import { describe, it, expect } from 'vitest';
import { tokens } from '../tokens';

describe('design tokens — The Digital Monolith (Design/IPad/DESIGN.md)', () => {
  // Surface hierarchy
  it('bgCode is #0E0E0E (code block / deepest surface)', () => {
    expect(tokens.bgCode).toBe('#0E0E0E');
  });

  it('bgBase is #131313 (primary editor area)', () => {
    expect(tokens.bgBase).toBe('#131313');
  });

  it('bgSidebar is #1B1B1C (navigation layer)', () => {
    expect(tokens.bgSidebar).toBe('#1B1B1C');
  });

  it('bgModal is #202020 (modals and popovers)', () => {
    expect(tokens.bgModal).toBe('#202020');
  });

  it('bgHover is #2A2A2A (interactive / elevated panels)', () => {
    expect(tokens.bgHover).toBe('#2A2A2A');
  });

  it('bgActive is #353535 (active list item background)', () => {
    expect(tokens.bgActive).toBe('#353535');
  });

  it('bgBright is #393939 (button hover)', () => {
    expect(tokens.bgBright).toBe('#393939');
  });

  // Borders
  it('border is #333333 (structural 1px lines between major regions)', () => {
    expect(tokens.border).toBe('#333333');
  });

  it('borderGhost is #A48C7B (floating elements at 15% opacity)', () => {
    expect(tokens.borderGhost).toBe('#A48C7B');
  });

  it('outlineVariant is #564335 (warm amber outline)', () => {
    expect(tokens.outlineVariant).toBe('#564335');
  });

  // Text
  it('textPrimary is #FFFFFF (headings / titles)', () => {
    expect(tokens.textPrimary).toBe('#FFFFFF');
  });

  it('textBody is #DCDDDE (markdown body)', () => {
    expect(tokens.textBody).toBe('#DCDDDE');
  });

  it('textMuted is #8A8F98 (timestamps, metadata)', () => {
    expect(tokens.textMuted).toBe('#8A8F98');
  });

  it('textHint is #555558 (placeholders)', () => {
    expect(tokens.textHint).toBe('#555558');
  });

  // Accent — Tangerine
  it('accent is #F28500 (primary action, 2px selection pill)', () => {
    expect(tokens.accent).toBe('#F28500');
  });

  it('accentLight is #FFB77D (accent text on dark tint)', () => {
    expect(tokens.accentLight).toBe('#FFB77D');
  });

  it('accentPressed is #D4730A (pressed state)', () => {
    expect(tokens.accentPressed).toBe('#D4730A');
  });

  it('accentTint is #503100 (burn state — markdown highlight bg)', () => {
    expect(tokens.accentTint).toBe('#503100');
  });

  it('tokens object has exactly 18 keys (no missing or extra tokens)', () => {
    const expectedKeys: (keyof typeof tokens)[] = [
      'bgCode', 'bgBase', 'bgSidebar', 'bgModal', 'bgHover', 'bgActive', 'bgBright',
      'border', 'borderGhost', 'outlineVariant',
      'textPrimary', 'textBody', 'textMuted', 'textHint',
      'accent', 'accentLight', 'accentPressed', 'accentTint',
    ];
    expect(Object.keys(tokens)).toHaveLength(expectedKeys.length);
    for (const key of expectedKeys) {
      expect(tokens).toHaveProperty(key);
    }
  });

  it('all token values are non-empty strings (as const integrity check)', () => {
    for (const value of Object.values(tokens)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
