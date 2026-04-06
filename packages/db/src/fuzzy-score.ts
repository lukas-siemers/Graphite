/**
 * Pure fuzzy-scoring function (simplified VS Code / fzf algorithm).
 * Zero dependencies.
 *
 * For each character in `query`, finds it sequentially in `text`.
 * Returns 0 when any character is not found (no match).
 *
 * Scoring:
 *   +5  start-of-string match
 *   +3  consecutive match (previous match was at index - 1)
 *   +2  word-boundary match (char after space, punctuation, or underscore)
 *   +1  base per-character match
 *   -1  per gap character between matches
 */
export function fuzzyScore(query: string, text: string): number {
  if (query.length === 0) return 0;

  const q = query.toLowerCase();
  const t = text.toLowerCase();

  let score = 0;
  let textIndex = 0;
  let prevMatchIndex = -2; // sentinel so first match is never "consecutive"

  for (let i = 0; i < q.length; i++) {
    const charIndex = t.indexOf(q[i], textIndex);
    if (charIndex === -1) return 0; // character not found — no match

    // Base point for matching a character.
    score += 1;

    // Start-of-string bonus.
    if (charIndex === 0) {
      score += 5;
    }

    // Consecutive bonus.
    if (charIndex === prevMatchIndex + 1) {
      score += 3;
    }

    // Word-boundary bonus: character is at position 0 or preceded by a
    // space, punctuation, or underscore.
    if (charIndex > 0) {
      const prev = t[charIndex - 1];
      if (prev === ' ' || prev === '_' || prev === '-' || prev === '.' || prev === '/') {
        score += 2;
      }
    }

    // Gap penalty: distance between this match and the previous one,
    // minus the expected step of 1 for a consecutive match.
    if (prevMatchIndex >= 0) {
      const gap = charIndex - prevMatchIndex - 1;
      if (gap > 0) {
        score -= gap;
      }
    }

    prevMatchIndex = charIndex;
    textIndex = charIndex + 1;
  }

  return score;
}
