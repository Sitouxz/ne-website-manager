import { describe, expect, it } from 'vitest';
import { nextActiveIndex } from './Topbar';

/**
 * The palette's footer has always read "Navigate with ↑ ↓ · Open with Enter"
 * while nothing listened for an arrow key. These cover the behaviour that
 * claim now actually has.
 */
describe('command palette keyboard navigation', () => {
  it('moves down and up through the results', () => {
    expect(nextActiveIndex('ArrowDown', 0, 5)).toBe(1);
    expect(nextActiveIndex('ArrowUp', 3, 5)).toBe(2);
  });

  it('wraps in both directions', () => {
    // Holding ↓ to get back to the top beats reaching for ↑ on a list this
    // short, and a highlight stuck silently on the last row reads as broken.
    expect(nextActiveIndex('ArrowDown', 4, 5)).toBe(0);
    expect(nextActiveIndex('ArrowUp', 0, 5)).toBe(4);
  });

  it('does nothing when there are no results to move through', () => {
    expect(nextActiveIndex('ArrowDown', 0, 0)).toBeNull();
    expect(nextActiveIndex('ArrowUp', 0, 0)).toBeNull();
  });

  it('ignores keys it does not own, so typing still reaches the search box', () => {
    // The handler sits on the input itself — claiming every keystroke would
    // stop anyone searching at all.
    for (const key of ['a', 'Backspace', 'Escape', ' ', 'ArrowLeft', 'Tab']) {
      expect(nextActiveIndex(key, 1, 5)).toBeNull();
    }
  });

  it('handles a single result without moving anywhere', () => {
    expect(nextActiveIndex('ArrowDown', 0, 1)).toBe(0);
    expect(nextActiveIndex('ArrowUp', 0, 1)).toBe(0);
  });
});
