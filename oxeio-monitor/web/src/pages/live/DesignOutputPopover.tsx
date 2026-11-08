import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TrendDay } from '../../api/dashboard';
import { formatDate } from '../../lib/format';

export function DesignOutputPopover({ id, day, anchor, onClose, onEnter, onLeave }: {
  id: string;
  day: TrendDay;
  anchor: HTMLButtonElement;
  onClose: () => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const box = panel.current?.getBoundingClientRect();
    if (!box) return;
    const bar = anchor.getBoundingClientRect();
    const gap = 10;
    const margin = 12;
    const beside = bar.right + gap + box.width <= window.innerWidth - margin
      ? bar.right + gap
      : bar.left - gap - box.width;
    setPosition({
      left: Math.max(margin, Math.min(beside, window.innerWidth - box.width - margin)),
      top: Math.max(margin, Math.min(bar.top - 8, window.innerHeight - box.height - margin)),
    });
  }, [anchor, day]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.contains(target) && !panel.current?.contains(target)) onClose();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) onClose();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div ref={panel} id={id} role="dialog" aria-label={`Design output for ${formatDate(day.date)}`}
      className="studio-output-popover"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
      onMouseEnter={onEnter} onMouseLeave={onLeave} onFocusCapture={onEnter}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onLeave(); }}>
      <div className="studio-output-popover-head">
        <div><span>Design output</span><strong>{formatDate(day.date)}</strong></div>
        <button type="button" onClick={onClose} aria-label="Close design breakdown">×</button>
      </div>
      <div className="studio-output-popover-total"><strong>{day.tracked ? day.designsFinished : '—'}</strong><span>completed designs</span></div>
      {!day.tracked ? <p className="studio-output-popover-empty">Not tracked yet.</p> : !day.designers.length ? <p className="studio-output-popover-empty">No designs completed.</p> : <>
        <div className="studio-output-popover-label"><span>Assigned designer</span><span>Designs</span></div>
        <ul>{day.designers.map((person, index) => <li key={person.employeeId ?? 'unassigned'}>
          <span className="studio-output-person-rank">{index + 1}</span>
          <span className="studio-output-person"><strong>{person.fullName}</strong>{person.empCode && <small>{person.empCode}</small>}</span>
          <b>{person.designsFinished}</b>
        </li>)}</ul>
      </>}
    </div>,
    document.querySelector('.studio-shell') ?? document.body,
  );
}
