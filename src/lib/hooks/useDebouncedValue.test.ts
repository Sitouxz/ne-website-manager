import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the initial value immediately', () => {
    // No delay on first render: an empty search box must not spend 300ms
    // before the list loads at all.
    const { result } = renderHook(() => useDebouncedValue('a', 300));
    expect(result.current).toBe('a');
  });

  it('withholds a change until the delay elapses', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'ab' });
    expect(result.current).toBe('a');

    act(() => { vi.advanceTimersByTime(299); });
    expect(result.current).toBe('a');

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe('ab');
  });

  it('emits only the final value of a fast burst', () => {
    // The whole point: ten keystrokes are one request, not ten whose
    // responses can arrive out of order.
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: '' },
    });

    for (const v of ['r', 're', 'rep', 'repo', 'report']) {
      rerender({ v });
      act(() => { vi.advanceTimersByTime(50); });
    }
    expect(result.current).toBe('');

    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('report');
  });

  it('settles back when a value changes and changes back', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'b' });
    rerender({ v: 'a' });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('a');
  });

  it('works for non-string values', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 100), {
      initialProps: { v: 1 },
    });
    rerender({ v: 2 });
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe(2);
  });
});
