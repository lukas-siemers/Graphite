/**
 * Graphite design tokens — "The Digital Monolith"
 * Source: Design/IPad/DESIGN.md
 *
 * Rules:
 * - 0px border radius everywhere (no exceptions)
 * - No shadows, no gradients
 * - Depth via tonal stacking, not elevation
 * - Ghost borders (borderGhost at low opacity) for floating elements only
 * - Accent used ONLY for final actions and active focus states
 */
export const tokens = {
  // Surface hierarchy — tonal stacking (darkest to lightest)
  bgCode:    '#0E0E0E', // Level -1: code block background
  bgBase:    '#131313', // Level 0:  primary editor area
  bgSidebar: '#1B1B1C', // Level 1:  navigation / sidebars
  bgModal:   '#202020', // Level 2:  modals, popovers
  bgHover:   '#2A2A2A', // Interactive: elevated panels, hover states
  bgActive:  '#353535', // Selection background in lists (surface_container_highest)
  bgBright:  '#393939', // Button hover state (surface_bright)

  // Borders — use sparingly; only between major functional regions
  border:      '#333333', // Primary structural demarcation (1px)
  borderGhost: '#A48C7B', // Floating elements (tooltips, command palette) — use at 15% opacity
  outlineVariant: '#564335', // Warm amber outline variant

  // Text
  textPrimary: '#FFFFFF', // Headings, titles — Semi-bold (600)
  textBody:    '#DCDDDE', // Body / markdown — Regular (400)
  textMuted:   '#8A8F98', // Timestamps, metadata — Label-SM
  textHint:    '#555558', // Placeholders, status bar

  // Accent — Tangerine signature
  // Use ONLY for: final actions, active focus states, selection pill
  accent:        '#F28500', // Primary action, selection pill (2px left border)
  accentLight:   '#FFB77D', // Accent text on dark tint
  accentPressed: '#D4730A', // Pressed state
  accentTint:    '#503100', // "Burn" state — markdown highlight background
} as const;

export type TokenKey = keyof typeof tokens;
export type TokenValue = (typeof tokens)[TokenKey];
