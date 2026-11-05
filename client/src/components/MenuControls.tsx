import { useRef } from 'react';

import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

/** Native Enter/Space activation; arrows traverse the visible menu controls. */
export default function MenuControls({ children, className, style, modal = false }: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  modal?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="file"])') ?? [])
      .filter((control) => control.getClientRects().length > 0);
    const current = controls.indexOf(document.activeElement as HTMLElement);
    const input = event.target as HTMLInputElement;
    const editing = input.tagName === 'INPUT' && input.type !== 'range';
    const arrow = !editing && (event.key === 'ArrowDown' || event.key === 'ArrowUp');
    if (!controls.length || (!arrow && !(modal && event.key === 'Tab'))) return;
    event.preventDefault();
    event.stopPropagation();
    const backward = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey);
    const next = current < 0 ? (backward ? controls.length - 1 : 0) : (current + (backward ? -1 : 1) + controls.length) % controls.length;
    controls[next].focus();
  };
  return <div ref={ref} className={className} style={style} onKeyDown={handleKeyDown} role={modal ? 'dialog' : undefined} aria-modal={modal || undefined}>{children}</div>;
}
