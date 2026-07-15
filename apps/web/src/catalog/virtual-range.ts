export type VirtualRange = {
  start: number;
  end: number;
  offset: number;
  totalHeight: number;
};

export function calculateVariableVirtualRange(options: {
  rowHeights: readonly number[];
  estimatedRowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan: number;
}): VirtualRange {
  const { rowHeights, estimatedRowHeight, scrollTop, viewportHeight, overscan } = options;
  const fallbackHeight = Math.max(1, estimatedRowHeight);
  const heights = rowHeights.map((height) =>
    Number.isFinite(height) && height > 0 ? height : fallbackHeight,
  );
  const offsets = [0];
  for (const height of heights) {
    offsets.push((offsets.at(-1) ?? 0) + height);
  }

  const totalHeight = offsets.at(-1) ?? 0;
  const viewportStart = Math.max(0, scrollTop);
  const viewportEnd = viewportStart + Math.max(0, viewportHeight);
  let firstVisible = 0;
  while (
    firstVisible < heights.length &&
    (offsets[firstVisible + 1] ?? totalHeight) <= viewportStart
  ) {
    firstVisible += 1;
  }
  let afterLastVisible = firstVisible;
  while (
    afterLastVisible < heights.length &&
    (offsets[afterLastVisible] ?? totalHeight) < viewportEnd
  ) {
    afterLastVisible += 1;
  }

  const start = Math.max(0, firstVisible - Math.max(0, overscan));
  const end = Math.min(heights.length, afterLastVisible + Math.max(0, overscan));
  return { start, end, offset: offsets[start] ?? 0, totalHeight };
}

export function calculateVirtualRange(options: {
  itemCount: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan: number;
}): VirtualRange {
  const { itemCount, rowHeight, scrollTop, viewportHeight, overscan } = options;
  const totalHeight = itemCount * rowHeight;
  const maximumStart = Math.max(0, itemCount - overscan);
  const start = Math.min(
    Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan),
    maximumStart,
  );
  const end = Math.min(
    itemCount,
    Math.ceil((Math.max(0, scrollTop) + viewportHeight) / rowHeight) + overscan,
  );

  return { start, end, offset: start * rowHeight, totalHeight };
}
