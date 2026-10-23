// Contenu du rappel quotidien : logique pure, testable sans réseau.

export type ReminderEvent = { id: string; date: string; name: string; kind: string; start_time: string | null; end_time: string | null; subject_id: string | null };
export type ReminderTask = { id: string; name: string; status: string; priority: string; owner: string; due_date: string | null; subject_id: string | null };
export type ReminderSubject = { id: string; name: string; color: string };

/** Date (AAAA-MM-JJ) et heure locales à Paris : gère seul l'heure d'été / d'hiver. */
export function parisNow(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map(p => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5).replace(/^0/, '').replace(':00', 'h').replace(':', 'h') : '');
const range = (e: ReminderEvent) => (e.start_time ? hhmm(e.start_time) + (e.end_time ? '–' + hhmm(e.end_time) : '') : 'Toute la journée');
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Ce qui doit figurer dans le rappel du jour (null = rien à envoyer). */
export function selectForDay(day: string, events: ReminderEvent[], tasks: ReminderTask[]) {
  const evs = events
    .filter(e => e.date === day && e.kind !== 'Cours')
    .sort((a, b) => (a.start_time ?? '99').localeCompare(b.start_time ?? '99'));
  const due = tasks
    .filter(t => t.due_date === day && t.status !== 'Terminé' && t.status !== 'Backlog')
    .sort((a, b) => a.priority.localeCompare(b.priority));
  return evs.length || due.length ? { events: evs, tasks: due } : null;
}

export function buildEmail(day: string, sel: { events: ReminderEvent[]; tasks: ReminderTask[] }, subjects: ReminderSubject[], appUrl?: string) {
  const subj = (id: string | null) => subjects.find(s => s.id === id);
  const label = new Date(day + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const { events, tasks } = sel;

  const first = events[0];
  const subject = first
    ? `📅 Aujourd’hui : ${first.name}${first.start_time ? ` à ${hhmm(first.start_time)}` : ''}${events.length > 1 ? ` (+${events.length - 1})` : ''}`
    : `✅ Aujourd’hui : ${tasks.length} échéance${tasks.length > 1 ? 's' : ''}`;

  const text = [
    `Bonjour Thomas,`, '', `Voici ta journée du ${label} :`, '',
    ...(events.length ? ['RÉUNIONS ET ÉVÉNEMENTS', ...events.map(e => `- ${range(e)} · ${e.name}${subj(e.subject_id) ? ` (${subj(e.subject_id)!.name})` : ''}`), ''] : []),
    ...(tasks.length ? ['ÉCHÉANCES DU JOUR', ...tasks.map(t => `- [${t.priority}] ${t.name}${t.owner ? ` — ${t.owner}` : ''}`), ''] : []),
    ...(appUrl ? [`Ouvrir le Cockpit : ${appUrl}`] : []),
  ].join('\n');

  const dot = (c?: string) => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c ?? '#a3adbf'};margin-right:6px;vertical-align:middle"></span>`;
  const evRows = events.map(e => `
      <tr>
        <td style="padding:10px 12px 10px 0;vertical-align:top;white-space:nowrap;font-weight:700;color:#4a40d8;font-size:14px">${esc(range(e))}</td>
        <td style="padding:10px 0;border-left:3px solid ${subj(e.subject_id)?.color ?? '#5b5bf0'};padding-left:12px">
          <div style="font-weight:650;font-size:15px;color:#16213a">${esc(e.name)}</div>
          <div style="font-size:12.5px;color:#5d6981;margin-top:2px">${esc(e.kind)}${subj(e.subject_id) ? ` · ${esc(subj(e.subject_id)!.name)}` : ''}</div>
        </td>
      </tr>`).join('');
  const prioColor: Record<string, string> = { P1: '#c2414b', P2: '#a7660e', P3: '#5d6981' };
  const taskRows = tasks.map(t => `
      <tr>
        <td style="padding:8px 10px 8px 0;vertical-align:top"><span style="font-size:11px;font-weight:800;color:${prioColor[t.priority] ?? '#5d6981'}">${esc(t.priority)}</span></td>
        <td style="padding:8px 0">
          <div style="font-size:14.5px;color:#16213a">${esc(t.name)}</div>
          <div style="font-size:12.5px;color:#5d6981;margin-top:2px">${subj(t.subject_id) ? dot(subj(t.subject_id)!.color) + esc(subj(t.subject_id)!.name) : 'Sans sujet'}${t.owner ? ` · ${esc(t.owner)}` : ''}</div>
        </td>
      </tr>`).join('');

  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f6fa;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3e8f0">
        <tr><td style="background:linear-gradient(145deg,#8a85ff,#4a40d8);background-color:#5b5bf0;padding:22px 24px;color:#ffffff">
          <div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;opacity:.85">Cockpit · rappel du jour</div>
          <div style="font-size:22px;font-weight:800;margin-top:4px;text-transform:capitalize">${esc(label)}</div>
        </td></tr>
        <tr><td style="padding:20px 24px 8px">
          ${events.length ? `<div style="font-size:12px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#5d6981;margin-bottom:4px">Réunions et événements</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${evRows}</table>` : ''}
          ${tasks.length ? `<div style="font-size:12px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#5d6981;margin:${events.length ? '18px' : '0'} 0 4px">Échéances du jour</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${taskRows}</table>` : ''}
        </td></tr>
        ${appUrl ? `<tr><td style="padding:12px 24px 24px"><a href="${esc(appUrl)}#/calendrier" style="display:inline-block;background:#5b5bf0;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:10px">Ouvrir le Cockpit</a></td></tr>` : '<tr><td style="padding:0 0 16px"></td></tr>'}
      </table>
      <div style="font-size:11.5px;color:#8b95a7;margin-top:12px">Envoyé automatiquement à 9h les jours où quelque chose est prévu.</div>
    </td></tr>
  </table></body></html>`;

  return { subject, text, html };
}
