import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, CalendarDays, Check, Cloud, Columns3, Download, FolderOpen, HardDrive, LayoutDashboard, ListChecks, LogOut, Search, Upload,
} from 'lucide-react';
import { signOut } from './components/Auth';
import { AIChat } from './components/AIChat';
import { NewMenu, useCreate } from './components/NewMenu';
import { MoreMenu } from './components/MoreMenu';
import { Palette } from './components/Palette';
import { SEED } from './lib/seed';
import { parseImport, useStore } from './lib/store';
import { download, useRoute } from './lib/utils';
import { Actions } from './views/Actions';
import { Calendar } from './views/Calendar';
import { Dashboard } from './views/Dashboard';
import { Kanban } from './views/Kanban';
import { SubjectDetail } from './views/SubjectDetail';
import { Subjects } from './views/Subjects';

const NAV = [
  ['', 'Vue d’ensemble', LayoutDashboard],
  ['sujets', 'Sujets', FolderOpen],
  ['kanban', 'Kanban', Columns3],
  ['calendrier', 'Calendrier', CalendarDays],
  ['actions', 'Actions', ListChecks],
] as const;

export function App({ email }: { email: string | null }) {
  const { parts, query } = useRoute();
  const store = useStore();
  const { db, ready, loadError, saving, saveError, backendKind, toasts, importDB, reload } = store;
  const [palette, setPalette] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const page = parts[0] ?? '';
  const currentSubject = page === 'sujets' && parts[1] ? parts[1] : undefined;
  const create = useCreate(currentSubject);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.backdrop')) return;
      const run = ({ n: create.task, e: create.event, s: create.subject } as Record<string, () => void>)[e.key.toLowerCase()];
      if (run) { e.preventDefault(); run(); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [create]);

  const exportJSON = () => download(
    new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), ...db }, null, 2)], { type: 'application/json' }),
    `sapaudia-cockpit-${new Date().toISOString().slice(0, 10)}.json`,
  );

  const importFile = async (f?: File) => {
    if (!f) return;
    try {
      const data = parseImport(JSON.parse(await f.text()));
      if (confirm(`Importer ${data.subjects.length} sujets, ${data.tasks.length} actions et ${data.events.length} événements ?\nLes éléments existants avec le même identifiant seront mis à jour ; rien n'est supprimé.`)) await importDB(data);
    } catch (e) {
      store.toast('Import impossible : ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  let view;
  if (!ready) view = <div className="splash"><div className="spinner" /></div>;
  else if (loadError) view = (
    <div className="page"><div className="notice error">
      <AlertCircle size={18} /> Impossible de charger les données : {loadError}. As-tu bien exécuté <code>supabase/schema.sql</code> ?
      <button className="btn" onClick={reload}>Réessayer</button>
    </div></div>
  );
  else if (page === 'sujets' && parts[1]) view = <SubjectDetail key={parts[1]} id={parts[1]} />;
  else if (page === 'sujets') view = <Subjects key={query.toString()} initialStatus={query.get('statut') ?? undefined} />;
  else if (page === 'kanban') view = <Kanban />;
  else if (page === 'calendrier') view = <Calendar />;
  else if (page === 'actions') view = <Actions />;
  else view = <Dashboard />;

  const sync = backendKind === 'local'
    ? <span className="sync local" title="Supabase non configuré : les données restent dans ce navigateur"><HardDrive size={14} /> Local</span>
    : saveError ? <span className="sync err"><AlertCircle size={14} /> Erreur de sauvegarde</span>
    : saving ? <span className="sync busy"><Cloud size={14} /> Enregistrement…</span>
    : <span className="sync ok"><Check size={14} /> Synchronisé</span>;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark">✦</div>
          <div className="brandtext">Sapaudia<small>Cockpit IA</small></div>
        </div>
        <nav>
          {NAV.map(([path, label, Icon]) => (
            <a key={path} href={'#/' + path} className={`nav ${page === path ? 'active' : ''}`} title={label} aria-current={page === path ? 'page' : undefined}>
              <Icon size={18} /><span>{label}</span>
              {path === 'actions' && <span className="nav-count">{db.tasks.filter(t => t.status !== 'Terminé').length}</span>}
            </a>
          ))}
        </nav>
        <div className="side-subjects">
          <div className="side-title">Sujets</div>
          {db.subjects.map(s => (
            <a key={s.id} href={'#/sujets/' + s.id} className={`side-subject ${parts[1] === s.id ? 'active' : ''}`}>
              <span className="dot" style={{ background: s.color }} /><span>{s.name}</span>
            </a>
          ))}
        </div>
        <div className="side-foot">
          {email ? <>
            <span className="side-user" title={email}>{email}</span>
            <button className="icon-btn" title="Déconnexion" onClick={signOut}><LogOut size={16} /></button>
          </> : <span className="side-user">Mode local — configure Supabase pour synchroniser</span>}
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <div className="top-title" aria-hidden="true">
            <span className="brandmark small">✦</span>
            <span>{currentSubject ? 'Sujet' : NAV.find(([p]) => p === page)?.[1] ?? 'Cockpit'}</span>
          </div>
          <button className="searchbar" onClick={() => setPalette(true)} aria-label="Rechercher (Ctrl K)">
            <Search size={16} /> <span>Rechercher…</span> <kbd>Ctrl K</kbd>
          </button>
          <div className="top-actions">
            <span className="desktop-only">{sync}</span>
            <button className="icon-btn bordered desktop-only" title="Exporter (JSON)" aria-label="Exporter une sauvegarde" onClick={exportJSON}><Download size={17} /></button>
            <button className="icon-btn bordered desktop-only" title="Importer une sauvegarde (ancien ou nouveau cockpit)" aria-label="Importer une sauvegarde" onClick={() => fileRef.current?.click()}><Upload size={17} /></button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={e => importFile(e.target.files?.[0])} />
            <span className="mobile-only">
              <MoreMenu
                status={sync}
                items={[
                  { icon: <Download size={17} />, label: 'Exporter', hint: 'Sauvegarde JSON', run: exportJSON },
                  { icon: <Upload size={17} />, label: 'Importer', hint: 'Fusionner une sauvegarde', run: () => fileRef.current?.click() },
                  ...(email ? [{ icon: <LogOut size={17} />, label: 'Verrouiller', hint: 'Se déconnecter', run: () => { signOut(); }, danger: true }] : []),
                ]}
              />
            </span>
            <NewMenu subjectId={currentSubject} />
          </div>
        </header>

        {ready && !loadError && backendKind === 'supabase' && db.subjects.length === 0 && db.tasks.length === 0 && (
          <div className="page"><div className="notice">
            Ta base Supabase est vide.
            <button className="btn primary" onClick={() => importDB(SEED)}>Charger les données de la réunion du 21/10/2026</button>
          </div></div>
        )}

        <main key={page + (parts[1] ?? '')} className="main">{view}</main>
      </div>

      <nav className="tabbar" aria-label="Navigation principale">
        {NAV.map(([path, label, Icon]) => (
          <a key={path} href={'#/' + path} className={page === path ? 'active' : ''} aria-current={page === path ? 'page' : undefined}>
            <span className="tab-ico"><Icon size={21} /></span><span>{label.split(' ')[0]}</span>
          </a>
        ))}
      </nav>

      {palette && <Palette onClose={() => setPalette(false)} pages={NAV.map(([p, l]) => [p, l])} />}

      <AIChat />

      <div className="toasts">
        {toasts.map(t => <div key={t.id} className={`toast ${t.tone ?? ''}`}>{t.text}</div>)}
      </div>
    </div>
  );
}

