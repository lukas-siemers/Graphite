import { describe, it, expect } from 'vitest';
import { fuzzyScore } from '../fuzzy-score';

describe('fuzzyScore', () => {
  it('returns 0 for an empty query', () => {
    expect(fuzzyScore('', 'hello world')).toBe(0);
  });

  it('returns a positive score for a single char match', () => {
    expect(fuzzyScore('h', 'hello')).toBeGreaterThan(0);
  });

  it('returns a high score for a full exact match', () => {
    const score = fuzzyScore('hello', 'hello');
    expect(score).toBeGreaterThan(10);
  });

  it('returns 0 when there is no match', () => {
    expect(fuzzyScore('xyz', 'hello world')).toBe(0);
  });

  it('is case insensitive', () => {
    expect(fuzzyScore('ABC', 'abc')).toBe(fuzzyScore('abc', 'abc'));
  });

  it('gives a higher score for word-boundary matches', () => {
    const boundary = fuzzyScore('fn', 'function_name');
    const interior = fuzzyScore('fn', 'affinity');
    expect(boundary).toBeGreaterThan(interior);
  });

  it('gives a higher score for consecutive matches', () => {
    const consecutive = fuzzyScore('abc', 'abcdef');
    const scattered = fuzzyScore('abc', 'aXbXc');
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it('penalizes gaps between matches', () => {
    const smallGap = fuzzyScore('ac', 'abc');
    const largeGap = fuzzyScore('ac', 'aXXXc');
    expect(smallGap).toBeGreaterThan(largeGap);
  });

  it('returns 0 when query is longer than text and chars cannot be found', () => {
    expect(fuzzyScore('abcdefghij', 'abc')).toBe(0);
  });

  it('awards start-of-string bonus', () => {
    const atStart = fuzzyScore('a', 'apple');
    const midString = fuzzyScore('p', 'apple');
    expect(atStart).toBeGreaterThan(midString);
  });
});
