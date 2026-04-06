/**
 * Reading time estimate from a pre-computed word count.
 *
 * Uses 200 wpm — a standard average for comprehension reading.
 * Notes under 50 words show "< 1 min read" to avoid false precision.
 */
export function computeReadingTime(wordCount: number): string {
  if (wordCount < 50) return '< 1 min read';
  const minutes = Math.ceil(wordCount / 200);
  return `${minutes} min read`;
}
