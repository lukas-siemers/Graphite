import { describe, it, expect } from 'vitest';
import { computeReadingTime } from '../reading-time';

describe('computeReadingTime', () => {
  it('returns "< 1 min read" for zero words', () => {
    expect(computeReadingTime(0)).toBe('< 1 min read');
  });

  it('returns "< 1 min read" for under 50 words', () => {
    expect(computeReadingTime(10)).toBe('< 1 min read');
    expect(computeReadingTime(49)).toBe('< 1 min read');
  });

  it('returns "1 min read" for 50 words (threshold)', () => {
    expect(computeReadingTime(50)).toBe('1 min read');
  });

  it('returns "1 min read" for exactly 200 words', () => {
    expect(computeReadingTime(200)).toBe('1 min read');
  });

  it('returns "2 min read" for 201 words (ceil rounds up)', () => {
    expect(computeReadingTime(201)).toBe('2 min read');
  });

  it('returns "3 min read" for 450 words', () => {
    expect(computeReadingTime(450)).toBe('3 min read');
  });

  it('returns "5 min read" for 1000 words', () => {
    expect(computeReadingTime(1000)).toBe('5 min read');
  });
});
