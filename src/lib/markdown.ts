import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/* ---------- Rendu Markdown → HTML ----------
   Markdown « GitHub » : tableaux, cases à cocher, blocs de code, encadrés `> [!NOTE]`.
   Le HTML produit est toujours nettoyé (DOMPurify) : un collage ne peut pas injecter de script. */

export type Heading = { id: string; text: string; level: number };

const ALERTS: Record<string, string> = {
  NOTE: 'Note', TIP: 'Astuce', IMPORTANT: 'Important', WARNING: 'Attention', CAUTION: 'Prudence',
};

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';

const decode = (html: string) => {
  const el = document.createElement('textarea');
  el.innerHTML = html.replace(/<[^>]+>/g, '');
  return el.value;
};

export function renderMarkdown(md: string): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const seen = new Map<string, number>();
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = decode(inner);
        let id = 'md-' + slug(text);
        const n = seen.get(id) ?? 0;
        seen.set(id, n + 1);
        if (n) id += '-' + n;
        if (depth <= 3) headings.push({ id, text, level: depth });
        return `<h${depth} id="${id}">${inner}</h${depth}>`;
      },
      blockquote({ tokens }) {
        const body = this.parser.parse(tokens);
        const m = body.match(/^<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br>)?\s*/i);
        if (!m) return `<blockquote>${body}</blockquote>`;
        const kind = m[1].toUpperCase();
        const rest = body.slice(m[0].length).replace(/^<\/p>/, '');
        return `<div class="md-alert md-${kind.toLowerCase()}"><p class="md-alert-title">${ALERTS[kind]}</p>${rest.startsWith('<') ? rest : '<p>' + rest}</div>`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:/i.test(href);
        return `<a href="${href}"${title ? ` title="${title}"` : ''}${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`;
      },
      table(token) {
        // Conteneur défilant : un large tableau ne casse pas la page sur téléphone.
        return `<div class="md-table">${marked.Renderer.prototype.table.call(this, token)}</div>`;
      },
    },
  });
  const raw = marked.parse(md, { async: false }) as string;
  const html = DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });
  return { html, headings };
}

/** Premier titre `# …` du texte (pour nommer une note collée). */
export function firstHeading(md: string) {
  const m = md.match(/^\s*#\s+(.+?)\s*#*\s*$/m);
  return m && md.trimStart().startsWith('#') ? m[1].replace(/[*_`]/g, '').trim() : null;
}

/** Retire le premier titre s'il répète le nom de la note (évite d'afficher deux fois le titre). */
export function withoutTitle(md: string, name: string) {
  const h = firstHeading(md);
  return h && h.toLowerCase() === name.trim().toLowerCase() ? md.trimStart().replace(/^#\s+.*(\r?\n)?/, '') : md;
}

/* ---------- Collage → Markdown ----------
   Le bouton « Copier » de Claude / ChatGPT donne du Markdown brut : on le garde tel quel.
   Une sélection copiée à la souris donne du HTML mis en forme : on le convertit en Markdown. */

export const looksLikeMarkdown = (t: string) =>
  /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|.*\|)/m.test(t) || /\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/.test(t);

/** Contenu d'un élément de liste : sans lignes vides autour, sous-listes collées, lignes suivantes indentées. */
const itemBody = (content: string, indent: number) => content
  .replace(/^\n+|\n+$/g, '')
  .replace(/\n{2,}(?=[ ]*(?:[-*+]|\d+\.) )/g, '\n')
  .replace(/\n/g, '\n' + ' '.repeat(indent))
  .replace(/[ ]+$/gm, '');

let td: TurndownService | null = null;
function turndown() {
  if (td) return td;
  td = new TurndownService({
    headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', hr: '---',
    // Paragraphe vide dans une cellule (tableau créé dans l'éditeur) : rien, sinon la ligne du tableau est coupée.
    blankReplacement: (_content, node) => {
      const n = node as HTMLElement;
      if (n.closest?.('td, th')) return '';
      return (n as unknown as { isBlock?: boolean }).isBlock ? '\n\n' : '';
    },
  });
  td.use(gfm);
  td.addRule('strike', { filter: ['del', 's'], replacement: content => (content.trim() ? `~~${content}~~` : '') });
  td.remove(['style', 'script', 'button', 'colgroup']);
  // Puces « - texte » (un seul espace) au lieu de « -   texte ».
  td.addRule('listItem', {
    filter: 'li',
    replacement(content, node) {
      const li = node as HTMLElement;
      const parent = li.parentNode as HTMLElement;
      let prefix = '- ';
      if (parent.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start') || 1);
        prefix = start + Array.prototype.indexOf.call(parent.children, li) + '. ';
      }
      return prefix + itemBody(content, prefix.length) + '\n';
    },
  });
  // Cases à cocher de l'éditeur : <li data-type="taskItem" data-checked="true">.
  td.addRule('taskItem', {
    filter: n => n.nodeName === 'LI' && n.getAttribute('data-type') === 'taskItem',
    replacement(content, node) {
      const li = node as HTMLElement;
      const box = li.getAttribute('data-checked') === 'true' ? '[x] ' : '[ ] ';
      return '- ' + box + itemBody(content, 2) + '\n';
    },
  });
  // Paragraphes dans les cellules : le texte seul (une ligne de tableau reste sur une ligne).
  td.addRule('cellParagraph', {
    filter: n => n.nodeName === 'P' && /^(TD|TH)$/.test(n.parentNode?.nodeName ?? ''),
    replacement: (content, node) => content + ((node as HTMLElement).nextElementSibling ? '<br>' : ''),
  });
  return td;
}

export function htmlToMarkdown(html: string) {
  return turndown().turndown(DOMPurify.sanitize(html)).replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- Éditeur visuel (Tiptap) ⇄ Markdown ----------
   L'éditeur travaille en HTML ; la note est toujours enregistrée en Markdown. */

/** Markdown → HTML compris par l'éditeur (cases à cocher au format Tiptap). */
export function markdownToEditorHtml(md: string) {
  const raw = new Marked({ gfm: true }).parse(md, { async: false }) as string;
  const box = document.createElement('div');
  box.innerHTML = DOMPurify.sanitize(raw);
  box.querySelectorAll('ul').forEach(ul => {
    const items = [...ul.children].filter(c => c.nodeName === 'LI');
    if (!items.length || !items.every(li => li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]'))) return;
    ul.setAttribute('data-type', 'taskList');
    for (const li of items) {
      const input = li.querySelector('input[type="checkbox"]') as HTMLInputElement;
      li.setAttribute('data-type', 'taskItem');
      li.setAttribute('data-checked', String(input.hasAttribute('checked')));
      input.remove();
    }
  });
  return box.innerHTML;
}

/** HTML de l'éditeur → Markdown enregistré. */
export function editorHtmlToMarkdown(html: string) {
  // <colgroup> (largeurs de colonnes) empêche la conversion des tableaux en Markdown.
  const box = document.createElement('div');
  box.innerHTML = html;
  box.querySelectorAll('colgroup').forEach(c => c.remove());
  const md = turndown().turndown(box)
    .replace(/^(>\s*)\\\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\\][ \t]*(?=\S)/gim, '$1[!$2]\n$1') // encadré suivi de texte sur la même ligne
    .replace(/^(>\s*)\\\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\\]/gim, '$1[!$2]') // encadrés > [!NOTE]
    .replace(/\n{3,}/g, '\n\n').trim();
  return md ? md + '\n' : '';
}

/** Texte à enregistrer à partir d'un presse-papier (texte brut et/ou HTML). */
export function clipboardToMarkdown(plain: string, html?: string) {
  if (html && html.trim() && !looksLikeMarkdown(plain)) {
    const md = htmlToMarkdown(html);
    if (md) return md;
  }
  return plain.replace(/\r\n/g, '\n').trim();
}

/** Lit le presse-papier (bouton « Coller ») : HTML si disponible, sinon texte. */
export async function readClipboard(): Promise<string> {
  const nav = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> };
  if (nav.read) {
    try {
      const items = await nav.read();
      let plain = '', html = '';
      for (const it of items) {
        if (it.types.includes('text/plain')) plain = await (await it.getType('text/plain')).text();
        if (it.types.includes('text/html')) html = await (await it.getType('text/html')).text();
      }
      if (plain || html) return clipboardToMarkdown(plain, html);
    } catch { /* permission refusée : on essaie en texte */ }
  }
  return clipboardToMarkdown(await navigator.clipboard.readText());
}
