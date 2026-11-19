import { useEffect, useState } from 'react';
import { Video } from 'lucide-react';
import { useEditors } from './editors';
import { Dot } from './ui';
import { useStore } from '../lib/store';
import type { CalEvent } from '../lib/types';
import { fmtTime, meetingLink, timeRange, todayIso, toMinutes } from '../lib/utils';
import '../styles/join.css';

/** Minutes écoulées depuis minuit, rafraîchies chaque minute. */
function useNowMinutes() {
  const read = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setNow(read()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Carte « Prochaine réunion » : réunion du jour en cours ou à venir, avec bouton « Rejoindre » si un lien de visio existe. */
export function NextMeeting({ events }: { events: CalEvent[] }) {
  const { subject } = useStore();
  const { editEvent } = useEditors();
  const now = useNowMinutes();
  const today = todayIso();
  // Sans heure de fin, on compte une heure.
  const end = (e: CalEvent) => (e.end_time ? toMinutes(e.end_time) : toMinutes(e.start_time!) + 60);
  const e = events
    .filter(x => x.date === today && x.start_time && x.kind !== 'Cours' && end(x) > now)
    .sort((a, b) => a.start_time!.localeCompare(b.start_time!))[0];
  if (!e) return null;

  const start = toMinutes(e.start_time!);
  const live = start <= now;
  const wait = start - now;
  const state = live ? 'En cours' : wait <= 60 ? `Dans ${wait} min` : `À ${fmtTime(e.start_time!.slice(0, 5))}`;
  const s = subject(e.subject_id);
  const link = meetingLink(e.description);

  return (
    <section className={`panel join-card${live ? ' live' : ''}`} aria-label="Prochaine réunion">
      <button className="join-main" onClick={() => editEvent(e)} title="Ouvrir la réunion">
        <span className="join-head">
          <span className="join-label">Prochaine réunion</span>
          <span className="join-state">{live && <span className="join-pulse" aria-hidden />}{state}</span>
        </span>
        <span className="join-title">
          {s && <Dot color={s.color} size={8} />}
          <span>{e.name}</span>
        </span>
        <span className="meta">{[timeRange(e.start_time!.slice(0, 5), e.end_time?.slice(0, 5)), s?.name].filter(Boolean).join(' · ')}</span>
      </button>
      {link && (
        <a className="btn primary join-btn" href={link.url} target="_blank" rel="noopener noreferrer" title={`Rejoindre sur ${link.provider === 'Meet' ? 'Google Meet' : link.provider}`}>
          <Video size={16} /> Rejoindre
        </a>
      )}
    </section>
  );
}
