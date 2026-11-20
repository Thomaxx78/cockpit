import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AlertCircle, CalendarDays, Check, Cloud, Columns3, Download, HardDrive, History as HistoryIcon, LogOut, NotebookPen, Search, Upload,
} from 'lucide-react';
import { signOut } from './components/Auth';
import { NewMenu, useCreate } from './components/NewMenu';
import { MoreMenu } from './components/MoreMenu';
import { Logo } from './components/Logo';
import { Palette } from './components/Palette';
import { SEED } from './lib/seed';
import { parseImport, useStore } from './lib/store';
import { useTheme } from './lib/theme';
import { inPageTransition, useSkyPhase } from './lib/motion';
import { download, go, useRoute } from './lib/utils';
import { Calendar } from './views/Calendar';
import './styles/shell.css';

/* ---------- Découpage du code ----------
   Calendrier (page d'accueil) reste dans le bundle principal ; les autres vues et
   l'assistant IA sont chargés à la demande, puis préchargés en tâche de fond. */
const loaders = {
  sujets: () => import('./views/SubjectDetail'),
  kanban: () => import('./views/Kanban'),
  notes: () => import('./views/Notes'),
  historique: () => import('./views/History'),
  ai: () => import('./components/AIChat'),
};
const SubjectDetail = lazy(() => loaders.sujets().then(m => ({ default: m.SubjectDetail })));
const Kanban = lazy(() => loaders.kanban().then(m => ({ default: m.Kanban })));
const Notes = lazy(() => loaders.notes().then(m => ({ default: m.Notes })));
const History = lazy(() => loaders.historique().then(m => ({ default: m.History })));
const AIChat = lazy(() => loaders.ai().then(m => ({ default: m.AIChat })));

/** Précharge le code d'une page (survol / focus d'un lien). Erreur réseau ignorée : le lazy réessaiera. */
const preload = (path: string) => { loaders[path as keyof typeof loaders]?.().catch(() => {}); };
/** Après le premier affichage, quand le navigateur est inactif : précharge toutes les vues. */
const preloadAllWhenIdle = () => {
  const run = () => Object.values(loaders).forEach(l => l().catch(() => {}));
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(run, { timeout: 4000 }); else setTimeout(run, 1500);
};

/** Menu principal : seulement les deux vues utilisées au quotidien. « Historique » passe par le menu « ⋯ ». */
const NAV = [
  ['', 'Calendrier', CalendarDays, 'Agenda'],
  ['kanban', 'Kanban', Columns3, 'Kanban'],
  ['notes', 'Notes', NotebookPen, 'Notes'],
] as const;
const PAGES: [string, string][] = [...NAV.map(([p, l]): [string, string] => [p, l]), ['historique', 'Historique']];
const splash = <div className="splash"><div className="spinner" /></div>;

/** Zone de page. Elle s'anime à son arrivée (ouverture de l'onglet, fin du chargement) ;
    pendant une transition de page, c'est la View Transition qui anime : on n'ajoute rien,
    sinon l'animation serait jouée deux fois. Décidé une fois au montage. */
function Main({ children }: { children: ReactNode }) {
  const [enter] = useState(() => !inPageTransition());
  return <main className={`main${enter ? ' enter' : ''}`}>{children}</main>;
}

export function App({ email }: { email: string | null }) {
  const { parts } = useRoute();
  const store = useStore();
  const { db, ready, loadError, saving, saveError, backendKind, toasts, importDB, reload } = store;
  const [palette, setPalette] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Anciennes adresses (#/calendrier, #/sujets, #/actions…) : on retombe sur le calendrier.
  const raw = parts[0] ?? '';
  const page = ['kanban', 'notes', 'historique'].includes(raw) || (raw === 'sujets' && parts[1]) ? raw : '';
  const currentSubject = page === 'sujets' && parts[1] ? parts[1] : undefined;
  const create = useCreate(currentSubject);
  useTheme(); // garde data-theme et theme-color à jour (changement du système, autre onglet)
  useSkyPhase(); // lueur de la barre latérale selon l'heure (aube, jour, crépuscule, nuit)

  useEffect(preloadAllWhenIdle, []);

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
  if (!ready) view = splash;
  else if (loadError) view = (
    <div className="page"><div className="notice error">
      <AlertCircle size={18} /> Impossible de charger les données : {loadError}. As-tu bien exécuté <code>supabase/schema.sql</code> ?
      <button className="btn" onClick={reload}>Réessayer</button>
    </div></div>
  );
  else if (page === 'sujets' && parts[1]) view = <SubjectDetail key={parts[1]} id={parts[1]} />;
  else if (page === 'kanban') view = <Kanban />;
  else if (page === 'notes') view = <Notes id={parts[1]} />;
  else if (page === 'historique') view = <History />;
  else view = <Calendar />;

  const sync = backendKind === 'local'
    ? <span className="sync local" title="Supabase non configuré : les données restent dans ce navigateur"><HardDrive size={14} /> Local</span>
    : saveError ? <span className="sync err"><AlertCircle size={14} /> Erreur de sauvegarde</span>
    : saving ? <span className="sync busy"><Cloud size={14} /> Enregistrement…</span>
    : <span className="sync ok"><Check size={14} /> Synchronisé</span>;
  // Barre du haut : rien de coloré quand tout va bien, une simple coche grise.
  const syncCompact = backendKind === 'supabase' && !saveError && !saving
    ? <span className="sync ok compact" title="Synchronisé" aria-label="Synchronisé"><Check size={15} /></span>
    : sync;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark"><Logo size={50} /></div>
          <span className="brandname">Cockpit</span>
        </div>
        <nav>
          {NAV.map(([path, label, Icon], i) => (
            <a
              key={path} href={'#/' + path} className={`nav ${page === path ? 'active' : ''}`} title={label} aria-current={page === path ? 'page' : undefined}
              onPointerEnter={() => preload(path)} onFocus={() => preload(path)} style={{ '--i': i } as CSSProperties}
            >
              {/* fond de l'élément actif : un seul à la fois, il glisse d'un lien à l'autre (View Transition) */}
              {page === path && <span className="nav-pill" aria-hidden="true" />}
              <Icon size={18} /><span>{label}</span>
            </a>
          ))}
        </nav>
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
            <span className="brandmark small"><Logo size={36} /></span>
            <span>{currentSubject ? 'Sujet' : PAGES.find(([p]) => p === page)?.[1] ?? 'Cockpit'}</span>
          </div>
          <button className="searchbar" onClick={() => setPalette(true)} aria-label="Rechercher (Ctrl K)">
            <Search size={16} /> <span>Rechercher…</span> <kbd>Ctrl K</kbd>
          </button>
          <div className="top-actions">
            <span className="desktop-only">{syncCompact}</span>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={e => importFile(e.target.files?.[0])} />
            <MoreMenu
              status={sync}
              items={[
                { icon: <HistoryIcon size={17} />, label: 'Historique', hint: 'Journal des modifications', run: () => go('historique') },
                { icon: <Download size={17} />, label: 'Exporter', hint: 'Sauvegarde JSON', run: exportJSON },
                { icon: <Upload size={17} />, label: 'Importer', hint: 'Fusionner une sauvegarde', run: () => fileRef.current?.click() },
                ...(email ? [{ icon: <LogOut size={17} />, label: 'Verrouiller', hint: 'Se déconnecter', run: () => { signOut(); }, danger: true }] : []),
              ]}
            />
            <NewMenu subjectId={currentSubject} />
          </div>
        </header>

        {ready && !loadError && backendKind === 'supabase' && db.subjects.length === 0 && db.tasks.length === 0 && (
          <div className="page"><div className="notice">
            Ta base Supabase est vide.
            <button className="btn primary" onClick={() => importDB(SEED)}>Charger les données de la réunion du 21/10/2026</button>
          </div></div>
        )}

        {/* Notes : pas de remontage à chaque note ouverte (l'arborescence reste en place). */}
        {/* La clé inclut `ready` : la page s'anime quand les données arrivent, pas sur le chargement. */}
        <Main key={(ready ? 'r:' : 'l:') + (page === 'notes' ? page : page + (parts[1] ?? ''))}><Suspense fallback={splash}>{view}</Suspense></Main>
      </div>

      <nav className="tabbar" aria-label="Navigation principale">
        {NAV.map(([path, , Icon, short]) => (
          <a
            key={path} href={'#/' + path} className={page === path ? 'active' : ''} aria-current={page === path ? 'page' : undefined}
            onPointerDown={() => preload(path)}
          >
            <span className="tab-ico">{page === path && <span className="tab-pill" aria-hidden="true" />}<Icon size={21} /></span><span>{short}</span>
          </a>
        ))}
      </nav>

      {palette && <Palette onClose={() => setPalette(false)} pages={PAGES} />}

      {/* Chunk séparé, demandé dès le premier rendu (en parallèle) : le bouton apparaît aussitôt chargé. */}
      <Suspense fallback={null}><AIChat /></Suspense>

      <div className="toasts">
        {toasts.map(t => <div key={t.id} className={`toast ${t.tone ?? ''}`}>{t.text}</div>)}
      </div>
    </div>
  );
}

