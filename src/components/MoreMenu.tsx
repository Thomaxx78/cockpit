import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Monitor, Moon, MoreHorizontal, Sun } from 'lucide-react';
import { useTheme, type Theme } from '../lib/theme';
import { EXIT_MS, useInert, usePresence } from '../lib/presence';

export type MoreItem = { icon: ReactNode; label: string; hint?: string; run: () => void; danger?: boolean };

const THEMES: { value: Theme; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'Système', icon: <Monitor size={15} /> },
  { value: 'light', label: 'Clair', icon: <Sun size={15} /> },
  { value: 'dark', label: 'Sombre', icon: <Moon size={15} /> },
];

/** Contrôle segmenté Système / Clair / Sombre (groupe de boutons radio accessible). */
function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: ReactKeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = (i + step + THEMES.length) % THEMES.length;
    setTheme(THEMES[n].value);
    refs.current[n]?.focus();
  };

  return (
    <div className="theme-row">
      <span className="theme-label" id="theme-label">Thème</span>
      <div className="theme-seg" role="radiogroup" aria-labelledby="theme-label">
        {THEMES.map((t, i) => (
          <button
            key={t.value}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={theme === t.value}
            tabIndex={theme === t.value ? 0 : -1}
            className={theme === t.value ? 'on' : ''}
            onClick={() => setTheme(t.value)}
            onKeyDown={e => onKey(e, i)}
          >
            {t.icon}<span>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Menu « ⋯ » : regroupe les actions secondaires de la barre du haut (ordinateur et téléphone). */
export function MoreMenu({ items, status }: { items: MoreItem[]; status?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { mounted, closing } = usePresence(open, EXIT_MS.menu);
  useInert(menuRef, closing);

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
      {mounted && (
        <div ref={menuRef} className={`menu${closing ? ' leaving' : ''}`} role="menu">
          {status && <div className="menu-status">{status}</div>}
          {items.map(it => (
            <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => { setOpen(false); it.run(); }}>
              <span className="menu-ico">{it.icon}</span>
              <span className="menu-text"><b>{it.label}</b>{it.hint && <small>{it.hint}</small>}</span>
            </button>
          ))}
          <ThemeSwitch />
        </div>
      )}
    </div>
  );
}
