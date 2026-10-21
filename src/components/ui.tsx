import { useEffect, useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { statusClass } from '../lib/utils';
import { useStore } from '../lib/store';

export const Pill = ({ status }: { status: string }) => <span className={`pill ${statusClass(status)}`}>{status}</span>;

export const Prio = ({ p }: { p: string }) => <span className={`prio prio-${p.toLowerCase()}`}>{p}</span>;

export const Dot = ({ color, size = 9 }: { color?: string; size?: number }) => (
  <span className="dot" style={{ background: color ?? 'var(--muted-2)', width: size, height: size }} />
);

export function SubjectTag({ id }: { id: string | null }) {
  const s = useStore().subject(id);
  return (
    <span className="subject-tag">
      <Dot color={s?.color} />
      {s?.name ?? 'Sans sujet'}
    </span>
  );
}

/** Puces de filtre par sujet (couleurs stables). */
export function SubjectFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { db } = useStore();
  return (
    <div className="chips">
      <button className={`chip ${value === 'all' ? 'active' : ''}`} onClick={() => onChange('all')}>Tous les sujets</button>
      {db.subjects.map(s => (
        <button
          key={s.id}
          className={`chip ${value === s.id ? 'active' : ''}`}
          style={{ ['--c' as string]: s.color }}
          onClick={() => onChange(value === s.id ? 'all' : s.id)}
        >
          <Dot color={s.color} />
          {s.name}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, accent }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; accent?: string;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" style={accent ? { ['--c' as string]: accent } : undefined}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** Textarea qui grandit avec son contenu. */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [props.value]);
  return <textarea rows={1} {...props} ref={ref} />;
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
