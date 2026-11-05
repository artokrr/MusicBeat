import type { CSSProperties } from 'react';

// Helpers for laying out HTML over a PixelStage in art pixels (see var(--px)).

/** Positions a child in art pixels inside a PixelStage. */
export function at(x: number, y: number, extra: CSSProperties = {}): CSSProperties {
  return {
    position: 'absolute',
    left: `calc(var(--px) * ${x})`,
    top: `calc(var(--px) * ${y})`,
    ...extra,
  };
}

/** Art pixels to a CSS length. */
export function u(n: number): string {
  return `calc(var(--px) * ${n})`;
}
