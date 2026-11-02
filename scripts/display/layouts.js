/**
 * Pane layouts for 1–6 panes, as [x, y, width, height] fractions of the screen.
 * 3 panes: one large on the left, two stacked on the right. 5 panes: three on top, two below.
 */
const LAYOUTS = {
  1: [[0, 0, 1, 1]],
  2: [[0, 0, 1/2, 1], [1/2, 0, 1/2, 1]],
  3: [[0, 0, 1/2, 1], [1/2, 0, 1/2, 1/2], [1/2, 1/2, 1/2, 1/2]],
  4: [[0, 0, 1/2, 1/2], [1/2, 0, 1/2, 1/2], [0, 1/2, 1/2, 1/2], [1/2, 1/2, 1/2, 1/2]],
  5: [[0, 0, 1/3, 1/2], [1/3, 0, 1/3, 1/2], [2/3, 0, 1/3, 1/2], [0, 1/2, 1/2, 1/2], [1/2, 1/2, 1/2, 1/2]],
  6: [[0, 0, 1/3, 1/2], [1/3, 0, 1/3, 1/2], [2/3, 0, 1/3, 1/2], [0, 1/2, 1/3, 1/2], [1/3, 1/2, 1/3, 1/2], [2/3, 1/2, 1/3, 1/2]]
};

/** The layout for `count` panes as [x, y, width, height] fractions. The companion app uses these too. */
export function layoutFractions(count) {
  return LAYOUTS[Math.clamp(count, 1, 6)];
}

/** Pixel rectangles for `count` panes on a `width` × `height` screen, with `gap` pixels between neighbours. */
export function layoutRects(count, width, height, gap = 0) {
  const fractions = layoutFractions(count);
  const half = gap / 2;
  return fractions.map(([fx, fy, fw, fh]) => {
    // Inset only the edges that touch another pane, so the outer border stays flush with the screen.
    const left = Math.round(fx * width) + (fx > 0 ? half : 0);
    const top = Math.round(fy * height) + (fy > 0 ? half : 0);
    const right = Math.round((fx + fw) * width) - ((fx + fw) < 1 ? half : 0);
    const bottom = Math.round((fy + fh) * height) - ((fy + fh) < 1 ? half : 0);
    return new PIXI.Rectangle(left, top, right - left, bottom - top);
  });
}
