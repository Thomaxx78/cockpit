// Contenu du résumé hebdomadaire (vendredi 19h) : logique pure, testable sans réseau.

export type WActivity = {
  at: string; entity: 'task' | 'subject' | 'event'; entity_id: string; subject_id: string | null;
  kind: 'created' | 'status' | 'deleted'; label: string; from_status: string | null; to_status: string | null;
};
export type WTask = { id: string; name: string; status: string; priority: string; owner: string; due_date: string | null; subject_id: string | null };
export type WSubject = { id: string; name: string; color: string };
export type WEvent = { id: string; date: string; name: string; kind: string; start_time: string | null; end_time: string | null; subject_id: string | null };
export type WNote = { id: string; name: string; kind: string; created_at: string; updated_at: string };

/** Types d'événements qui ne sont pas des réunions. */
const NOT_MEETING = ['Échéance', 'Hypothèse', 'Récurrence théorique', 'Cours'];

/** Date (AAAA-MM-JJ), heure et jour de la semaine (0 = dimanche) à Paris. */
export function parisNow(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map(p => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, hour: Number(parts.hour), weekday: new Date(date + 'T12:00:00Z').getUTCDay() };
}

export const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** Semaine résumée : du lundi au jour donné ; « semaine prochaine » : du lundi au dimanche suivants. */
export function weekRange(day: string) {
  const wd = new Date(day + 'T12:00:00Z').getUTCDay();
  const monday = addDays(day, -((wd + 6) % 7));
  return { from: monday, to: day, nextFrom: addDays(monday, 7), nextTo: addDays(monday, 13) };
}

export type WeeklyData = {
  done: { name: string; subject_id: string | null }[];
  moved: { name: string; from: string | null; to: string; subject_id: string | null }[];
  created: { name: string; subject_id: string | null }[];
  subjects: { name: string; what: string }[];
  meetings: WEvent[];
  notesNew: WNote[];
  notesEdited: WNote[];
  next: WEvent[];
  dueNext: WTask[];
  overdue: WTask[];
};

/** Regroupe les changements de la semaine (une ligne par ticket : son dernier état). */
export function collectWeek(day: string, input: { activity: WActivity[]; tasks: WTask[]; events: WEvent[]; notes: WNote[] }): WeeklyData {
  const { from, to, nextFrom, nextTo } = weekRange(day);
  const inWeek = (iso: string) => iso.slice(0, 10) >= from;
  const acts = input.activity.filter(a => inWeek(a.at)).sort((a, b) => a.at.localeCompare(b.at));
  const taskById = new Map(input.tasks.map(t => [t.id, t]));
  const nameOf = (a: WActivity) => (a.entity === 'task' ? taskById.get(a.entity_id)?.name : undefined) ?? a.label;

  // Dernier statut connu de chaque ticket, et statut au début de la semaine.
  const last = new Map<string, WActivity>();
  const firstFrom = new Map<string, string | null>();
  const createdIds = new Set<string>();
  const deleted = new Set<string>();
  for (const a of acts) {
    if (a.entity !== 'task') continue;
    if (a.kind === 'created') createdIds.add(a.entity_id);
    if (a.kind === 'deleted') { deleted.add(a.entity_id); continue; }
    if (a.kind === 'status') {
      if (!firstFrom.has(a.entity_id)) firstFrom.set(a.entity_id, a.from_status);
      last.set(a.entity_id, a);
    }
  }
  const done: WeeklyData['done'] = [];
  const moved: WeeklyData['moved'] = [];
  for (const [tid, a] of last) {
    if (deleted.has(tid)) continue;
    const item = { name: nameOf(a), subject_id: taskById.get(tid)?.subject_id ?? a.subject_id };
    if (a.to_status === 'Terminé') done.push(item);
    else if (!createdIds.has(tid) && firstFrom.get(tid) !== a.to_status) moved.push({ ...item, from: firstFrom.get(tid) ?? null, to: a.to_status ?? '' });
  }
  const created = acts
    .filter(a => a.entity === 'task' && a.kind === 'created' && !deleted.has(a.entity_id) && last.get(a.entity_id)?.to_status !== 'Terminé')
    .map(a => ({ name: nameOf(a), subject_id: taskById.get(a.entity_id)?.subject_id ?? a.subject_id }));

  const subjects = acts
    .filter(a => a.entity === 'subject' && a.kind !== 'deleted')
    .map(a => ({ name: a.label, what: a.kind === 'created' ? 'nouveau sujet' : `${a.from_status ?? '—'} → ${a.to_status ?? '—'}` }));

  const isMeeting = (e: WEvent) => !NOT_MEETING.includes(e.kind);
  const byTime = (a: WEvent, b: WEvent) => (a.date + (a.start_time ?? '99')).localeCompare(b.date + (b.start_time ?? '99'));
  const meetings = input.events.filter(e => e.date >= from && e.date <= to && isMeeting(e)).sort(byTime);
  const next = input.events.filter(e => e.date >= nextFrom && e.date <= nextTo && e.kind !== 'Cours').sort(byTime);

  const files = input.notes.filter(n => n.kind === 'file');
  const notesNew = files.filter(n => inWeek(n.created_at)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const notesEdited = files.filter(n => !inWeek(n.created_at) && inWeek(n.updated_at)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const active = input.tasks.filter(t => t.status !== 'Terminé' && t.status !== 'Backlog');
  const byPrio = (a: WTask, b: WTask) => a.priority.localeCompare(b.priority) || (a.due_date ?? '').localeCompare(b.due_date ?? '');
  const dueNext = active.filter(t => t.due_date && t.due_date >= nextFrom && t.due_date <= nextTo).sort(byPrio);
  const overdue = active.filter(t => t.due_date && t.due_date <= to).sort(byPrio);

  return { done, moved, created, subjects, meetings, notesNew, notesEdited, next, dueNext, overdue };
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const hm = (t: string | null) => (t ? t.slice(0, 5).replace(/^0/, '').replace(':00', 'h').replace(':', 'h') : '');
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { ...opts, timeZone: 'UTC' });
const plural = (n: number, one: string, many = one + 's') => `${n} ${n > 1 ? many : one}`;

export function buildWeekly(day: string, w: WeeklyData, subjects: WSubject[], appUrl?: string) {
  const { from, to } = weekRange(day);
  const subj = (id: string | null) => subjects.find(s => s.id === id);
  const period = `du ${dayLabel(from, { day: 'numeric', month: 'long' })} au ${dayLabel(to, { day: 'numeric', month: 'long' })}`;
  const notesCount = w.notesNew.length + w.notesEdited.length;
  const quiet = !w.done.length && !w.moved.length && !w.created.length && !w.meetings.length && !notesCount && !w.subjects.length;

  const bits = [
    w.done.length && plural(w.done.length, 'ticket terminé', 'tickets terminés'),
    w.meetings.length && plural(w.meetings.length, 'réunion'),
    notesCount && plural(notesCount, 'note'),
  ].filter(Boolean);
  const subject = quiet ? '🗓️ Ta semaine : semaine calme, voici la suivante' : `🗓️ Ta semaine : ${bits.length ? bits.join(', ') : 'les mises à jour'}`;

  const evLine = (e: WEvent) => `${dayLabel(e.date)}${e.start_time ? ' ' + hm(e.start_time) : ''} · ${e.name}`;
  const text = [
    'Bonjour Thomas,', '', `Voici le résumé de ta semaine ${period}.`, '',
    ...(w.done.length ? ['TERMINÉ', ...w.done.map(t => `- ${t.name}`), ''] : []),
    ...(w.moved.length ? ['AVANCEMENT', ...w.moved.map(t => `- ${t.name} : ${t.from ?? '—'} → ${t.to}`), ''] : []),
    ...(w.created.length ? ['NOUVEAUX TICKETS', ...w.created.map(t => `- ${t.name}`), ''] : []),
    ...(w.subjects.length ? ['SUJETS', ...w.subjects.map(s => `- ${s.name} : ${s.what}`), ''] : []),
    ...(w.meetings.length ? ['RÉUNIONS', ...w.meetings.map(e => `- ${evLine(e)}`), ''] : []),
    ...(notesCount ? ['NOTES', ...w.notesNew.map(n => `- ${n.name} (nouvelle)`), ...w.notesEdited.map(n => `- ${n.name} (modifiée)`), ''] : []),
    ...(w.overdue.length ? ['EN RETARD', ...w.overdue.slice(0, 8).map(t => `- [${t.priority}] ${t.name} (${dayLabel(t.due_date!)})`), ''] : []),
    'LA SEMAINE PROCHAINE',
    ...(w.next.length ? w.next.map(e => `- ${evLine(e)}`) : ['- Aucune réunion prévue']),
    ...w.dueNext.map(t => `- Échéance ${dayLabel(t.due_date!)} : ${t.name}`),
    '',
    ...(appUrl ? [`Ouvrir le Cockpit : ${appUrl}`] : []),
  ].join('\n');

  const dot = (c?: string) => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c ?? '#a3adbf'};margin-right:8px;vertical-align:middle"></span>`;
  const h = (title: string, extra = '') => `<div style="font-size:12px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#5d6981;margin:22px 0 6px">${title}${extra}</div>`;
  const row = (main: string, sub = '', color?: string) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eef1f5">
      <div style="font-size:14.5px;color:#16213a">${dot(color)}${main}</div>${sub ? `<div style="font-size:12.5px;color:#5d6981;margin:2px 0 0 16px">${sub}</div>` : ''}</td></tr>`;
  const table = (rows: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
  const stat = (n: number, label: string) => `<td align="center" style="padding:12px 4px;background:#f6f7fb;border-radius:10px">
      <div style="font-size:24px;font-weight:800;color:#16213a;line-height:1">${n}</div><div style="font-size:11.5px;color:#5d6981;margin-top:4px">${label}</div></td>`;
  const link = (path: string, label: string) => (appUrl ? `<a href="${esc(appUrl)}#/${path}" style="color:#4a40d8;text-decoration:none">${label}</a>` : label);
  const statusPill = (s: string) => `<span style="font-size:11.5px;font-weight:600;color:${s === 'En attente' ? '#a7660e' : '#4a40d8'}">${esc(s)}</span>`;

  const sections = [
    w.done.length ? h('✅ Terminé', ` · ${w.done.length}`) + table(w.done.map(t => row(`<s style="color:#5d6981">${esc(t.name)}</s>`, subj(t.subject_id)?.name ? esc(subj(t.subject_id)!.name) : '', subj(t.subject_id)?.color ?? '#16a34a')).join('')) : '',
    w.moved.length ? h('🔄 Avancement') + table(w.moved.map(t => row(esc(t.name), `${esc(t.from ?? '—')} → ${statusPill(t.to)}`, subj(t.subject_id)?.color)).join('')) : '',
    w.created.length ? h('➕ Nouveaux tickets', ` · ${w.created.length}`) + table(w.created.map(t => row(esc(t.name), subj(t.subject_id) ? esc(subj(t.subject_id)!.name) : '', subj(t.subject_id)?.color)).join('')) : '',
    w.subjects.length ? h('📁 Sujets') + table(w.subjects.map(s => row(esc(s.name), esc(s.what))).join('')) : '',
    w.meetings.length ? h('👥 Réunions de la semaine') + table(w.meetings.map(e => row(esc(e.name), `${esc(dayLabel(e.date))}${e.start_time ? ' · ' + hm(e.start_time) : ''}${subj(e.subject_id) ? ' · ' + esc(subj(e.subject_id)!.name) : ''}`, subj(e.subject_id)?.color ?? '#5b5bf0')).join('')) : '',
    notesCount ? h('📝 Notes') + table([
      ...w.notesNew.map(n => row(link('notes/' + n.id, esc(n.name)), 'Nouvelle note', '#5b5bf0')),
      ...w.notesEdited.map(n => row(link('notes/' + n.id, esc(n.name)), 'Modifiée', '#a3adbf')),
    ].join('')) : '',
    w.overdue.length ? h('⚠️ En retard', ` · ${w.overdue.length}`) + table(w.overdue.slice(0, 8).map(t => row(`<b style="color:#c2414b;font-size:11px">${esc(t.priority)}</b> ${esc(t.name)}`, `Échéance ${esc(dayLabel(t.due_date!))}${t.owner ? ' · ' + esc(t.owner) : ''}`, subj(t.subject_id)?.color)).join('')) : '',
    h('⏭️ La semaine prochaine') + table([
      ...(w.next.length ? w.next.map(e => row(esc(e.name), `${esc(dayLabel(e.date))}${e.start_time ? ' · ' + hm(e.start_time) + (e.end_time ? '–' + hm(e.end_time) : '') : ''}`, subj(e.subject_id)?.color ?? '#5b5bf0'))
        : [row('<span style="color:#5d6981">Aucune réunion prévue</span>')]),
      ...w.dueNext.map(t => row(esc(t.name), `Échéance ${esc(dayLabel(t.due_date!))} · ${esc(t.priority)}`, subj(t.subject_id)?.color)),
    ].join('')),
  ].join('');

  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f6fa;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3e8f0">
        <tr><td style="background:linear-gradient(145deg,#8a85ff,#4a40d8);background-color:#5b5bf0;padding:22px 24px;color:#ffffff">
          <div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;opacity:.85">Cockpit · résumé de la semaine</div>
          <div style="font-size:22px;font-weight:800;margin-top:4px">Semaine ${esc(period)}</div>
        </td></tr>
        <tr><td style="padding:20px 24px 4px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>
            ${stat(w.done.length, 'terminés')}${stat(w.created.length, 'nouveaux')}${stat(w.meetings.length, 'réunions')}${stat(notesCount, 'notes')}
          </tr></table>
          ${quiet ? '<p style="font-size:14px;color:#5d6981;margin:16px 0 0">Semaine calme : aucune mise à jour enregistrée.</p>' : ''}
          ${sections}
        </td></tr>
        ${appUrl ? `<tr><td style="padding:20px 24px 24px"><a href="${esc(appUrl)}#/kanban" style="display:inline-block;background:#5b5bf0;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:10px">Ouvrir le Kanban</a></td></tr>` : '<tr><td style="padding:0 0 20px"></td></tr>'}
      </table>
      <div style="font-size:11.5px;color:#8b95a7;margin-top:12px">Envoyé automatiquement chaque vendredi à 19h.</div>
    </td></tr>
  </table></body></html>`;

  return { subject, text, html };
}
