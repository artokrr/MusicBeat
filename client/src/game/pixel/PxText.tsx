import { memo } from 'react';

interface PxTextProps {
  text: string;
  /** Art pixels per font dot (DotGothic16 is drawn on a 16-dot grid). */
  scale?: number;
  /** Wrap onto several lines at this width, in art pixels. */
  maxWidth?: number;
  align?: 'left' | 'center';
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Text in DotGothic16 at 16 art pixels per em, so each font dot lands on one
 * art pixel of the stage behind it (see var(--px)). Color comes from CSS.
 */
function PxText({ text, scale = 1, maxWidth, align = 'left', style, className }: PxTextProps) {
  const size = `calc(var(--px) * ${16 * scale})`;
  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-dot)',
        fontSize: size,
        lineHeight: size,
        whiteSpace: maxWidth ? 'normal' : 'pre',
        maxWidth: maxWidth ? `calc(var(--px) * ${maxWidth})` : undefined,
        textAlign: align,
        ...style,
      }}
    >
      {text}
    </span>
  );
}

export default memo(PxText);
