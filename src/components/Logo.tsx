import { useEffect, useId, useState } from 'react';

/* Logo du Cockpit : deux sommets et un astre qui parcourt le ciel.
   Jour (7h–20h) : le soleil se lève à gauche, culmine et se couche à droite derrière les sommets.
   Nuit : la lune fait le même trajet. Le temps est accéléré (une journée = CYCLE_MS, 40 s) et part
   de l'heure réelle ; avec « réduire les animations », l'astre reste à sa place réelle. */
const DAY_START = 7;
const DAY_END = 20;
const CYCLE_MS = 40_000;
const FRAME_MS = 50; // ~20 images/s : fluide sur une si petite icône, sans charger le processeur

/** Position sur l'arc (viewBox 32×32) et nature de l'astre pour une heure (0–24). */
function skyAt(h: number) {
  const day = h >= DAY_START && h < DAY_END;
  const span = day ? DAY_END - DAY_START : 24 - (DAY_END - DAY_START);
  const since = day ? h - DAY_START : (h - DAY_END + 24) % 24;
  const t = since / span; // 0 = lever, 1 = coucher
  // Aux extrémités l'astre est sous l'horizon (y > 25 + rayon) : le passage soleil ↔ lune est invisible.
  // Puissance < 1 : montée et descente raides, l'astre reste caché très peu de temps entre soleil et lune.
  return { day, x: 6 + 20 * t, y: 29.5 - 22.5 * Math.sin(Math.PI * t) ** 0.4 };
}

const realHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };

/** Heure « du logo » : réelle au départ, puis accélérée. */
function useSkyHour() {
  const [hour, setHour] = useState(realHour);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      const id = setInterval(() => setHour(realHour()), 60_000);
      return () => clearInterval(id);
    }
    const start = performance.now(), h0 = realHour();
    let raf = 0, last = 0;
    const tick = (now: number) => {
      if (now - last >= FRAME_MS) { last = now; setHour((h0 + ((now - start) / CYCLE_MS) * 24) % 24); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return hour;
}

export function Logo({ size = 20 }: { size?: number }) {
  const { day, x, y } = skyAt(useSkyHour());
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const mask = `lune${uid}`, sky = `ciel${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        {/* croissant de lune : disque moins un disque décalé */}
        <mask id={mask}>
          <circle r="3.2" fill="#fff" />
          <circle cx="1.6" cy="-1.1" r="2.7" fill="#000" />
        </mask>
        {/* ciel = tout ce qui est au-dessus de l'horizon (pied des montagnes) */}
        <clipPath id={sky}><rect x="-8" y="-8" width="48" height="33" /></clipPath>
      </defs>
      <g clipPath={`url(#${sky})`}>
        <g transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>
          {day
            ? <circle r="3.4" fill="#ffc94d" />
            : <circle r="3.2" fill="var(--logo-moon)" mask={`url(#${mask})`} />}
        </g>
      </g>
      <path d="M3 25 L12.5 9.5 L18 18.5 L21 14 L29 25 Z" fill="currentColor" />
      {/* versant à l'ombre du grand sommet */}
      <path d="M12.5 9.5 L18 18.5 L16.4 25 L13.8 25 Z" fill="#000" opacity=".16" />
    </svg>
  );
}
