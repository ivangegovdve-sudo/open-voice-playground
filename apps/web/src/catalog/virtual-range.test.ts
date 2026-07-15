import { describe, expect, it } from 'vitest';

import { calculateVariableVirtualRange, calculateVirtualRange } from './virtual-range';

describe('virtual voice range', () => {
  it('renders only the visible window plus overscan for a large catalog', () => {
    expect(
      calculateVirtualRange({
        itemCount: 426,
        rowHeight: 180,
        scrollTop: 1800,
        viewportHeight: 720,
        overscan: 2,
      }),
    ).toEqual({ start: 8, end: 16, offset: 1440, totalHeight: 76_680 });
  });

  it('clamps the range at both list boundaries', () => {
    expect(
      calculateVirtualRange({
        itemCount: 3,
        rowHeight: 180,
        scrollTop: 900,
        viewportHeight: 720,
        overscan: 2,
      }),
    ).toEqual({ start: 1, end: 3, offset: 180, totalHeight: 540 });
  });

  it('keeps the final item reachable with measured mixed row heights', () => {
    const rowHeights = Array.from({ length: 35 }, (_, index) => (index % 7 === 0 ? 460 : 220));
    const totalHeight = rowHeights.reduce((total, height) => total + height, 0);

    const range = calculateVariableVirtualRange({
      rowHeights,
      estimatedRowHeight: 240,
      scrollTop: totalHeight - 500,
      viewportHeight: 500,
      overscan: 2,
    });

    expect(range.end).toBe(rowHeights.length);
    expect(range.totalHeight).toBe(totalHeight);
    expect(range.offset).toBe(
      rowHeights.slice(0, range.start).reduce((total, height) => total + height, 0),
    );
  });
});
