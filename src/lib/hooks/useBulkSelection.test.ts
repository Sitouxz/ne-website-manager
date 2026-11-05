import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBulkSelection } from './useBulkSelection';

describe('useBulkSelection', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useBulkSelection(['a', 'b']));
    expect(result.current.count).toBe(0);
    expect(result.current.selectedVisibleIds).toEqual([]);
    expect(result.current.allVisibleSelected).toBe(false);
  });

  it('toggles a row on and off', () => {
    const { result } = renderHook(() => useBulkSelection(['a', 'b']));

    act(() => result.current.toggle('a'));
    expect(result.current.isSelected('a')).toBe(true);
    expect(result.current.selectedVisibleIds).toEqual(['a']);

    act(() => result.current.toggle('a'));
    expect(result.current.isSelected('a')).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it('selects and clears every visible row', () => {
    const { result } = renderHook(() => useBulkSelection(['a', 'b', 'c']));

    act(() => result.current.toggleAllVisible());
    expect(result.current.count).toBe(3);
    expect(result.current.allVisibleSelected).toBe(true);

    act(() => result.current.toggleAllVisible());
    expect(result.current.count).toBe(0);
  });

  it('never reports a selected row that is no longer visible', () => {
    // The rule this hook exists for: filter a list down after selecting, and
    // "Delete 3 selected" must not delete two rows the user cannot see.
    const { result, rerender } = renderHook(({ ids }) => useBulkSelection(ids), {
      initialProps: { ids: ['a', 'b', 'c'] },
    });

    act(() => result.current.toggleAllVisible());
    expect(result.current.count).toBe(3);

    rerender({ ids: ['a'] });
    expect(result.current.selectedVisibleIds).toEqual(['a']);
    expect(result.current.count).toBe(1);
  });

  it('restores a hidden selection when the row becomes visible again', () => {
    // The selection itself is kept, so narrowing a filter and widening it back
    // does not silently discard what the user picked.
    const { result, rerender } = renderHook(({ ids }) => useBulkSelection(ids), {
      initialProps: { ids: ['a', 'b'] },
    });

    act(() => result.current.toggleAllVisible());
    rerender({ ids: ['a'] });
    expect(result.current.count).toBe(1);

    rerender({ ids: ['a', 'b'] });
    expect(result.current.count).toBe(2);
  });

  it('select-all only covers the visible rows, leaving others alone', () => {
    const { result, rerender } = renderHook(({ ids }) => useBulkSelection(ids), {
      initialProps: { ids: ['a'] },
    });

    act(() => result.current.toggleAllVisible());
    rerender({ ids: ['b', 'c'] });

    // 'a' is still remembered but not visible, so it is not reported.
    expect(result.current.count).toBe(0);
    act(() => result.current.toggleAllVisible());
    expect(result.current.selectedVisibleIds).toEqual(['b', 'c']);

    rerender({ ids: ['a', 'b', 'c'] });
    expect(result.current.count).toBe(3);
  });

  it('clear empties everything, visible or not', () => {
    const { result, rerender } = renderHook(({ ids }) => useBulkSelection(ids), {
      initialProps: { ids: ['a', 'b'] },
    });

    act(() => result.current.toggleAllVisible());
    rerender({ ids: ['a'] });
    act(() => result.current.clear());

    rerender({ ids: ['a', 'b'] });
    expect(result.current.count).toBe(0);
  });

  it('reports allVisibleSelected as false for an empty list', () => {
    const { result } = renderHook(() => useBulkSelection([]));
    expect(result.current.allVisibleSelected).toBe(false);
  });
});
