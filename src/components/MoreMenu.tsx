import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

export type MoreItem = { icon: ReactNode; label: string; hint?: string; run: () => void; danger?: boolean };

/** Menu « ⋯ » (mobile) : regroupe les actions secondaires de la barre du haut. */
export function MoreMenu({ items, status }: { items: MoreItem[]; status?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', close);
    addEventListener('keydown', esc);
    return () => { removeEventListener('pointerdown', close); removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="new-menu more-menu" ref={ref}>
      <button className="icon-btn bordered" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu" aria-label="Plus d’options">
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {status && <div className="menu-status">{status}</div>}
          {items.map(it => (
            <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => { setOpen(false); it.run(); }}>
              <span className="menu-ico">{it.icon}</span>
              <span className="menu-text"><b>{it.label}</b>{it.hint && <small>{it.hint}</small>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
