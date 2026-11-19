import { useEffect, useId, useState } from 'react';

/* Logo du Cockpit : deux sommets et un astre qui suit l'heure réelle.
   Jour (7h–20h) : le soleil se lève à gauche, culmine vers 13h30 et se couche à droite.
   Nuit : la lune fait le même trajet. L'astre est dessiné derrière les montagnes,
   il disparaît donc derrière elles au lever et au coucher. */
const DAY_START = 7;
const DAY_END = 20;

/** Position sur l'arc (viewBox 32×32) et nature de l'astre pour une heure donnée. */
function skyAt(d: Date) {
  const h = d.getHours() + d.getMinutes() / 60;
  const day = h >= DAY_START && h < DAY_END;
  const span = day ? DAY_END - DAY_START : 24 - (DAY_END - DAY_START);
  const since = day ? h - DAY_START : (h - DAY_END + 24) % 24;
  const t = since / span; // 0 = lever, 1 = coucher
  return { day, x: 4 + 24 * t, y: 23 - 16 * Math.sin(Math.PI * t) };
}

/** Heure courante, rafraîchie chaque minute. */
function useMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function Logo({ size = 20 }: { size?: number }) {
  const { day, x, y } = skyAt(useMinute());
  const mask = `lune${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        {/* croissant de lune : disque moins un disque décalé */}
        <mask id={mask}>
          <circle r="3.2" fill="#fff" />
          <circle cx="1.6" cy="-1.1" r="2.7" fill="#000" />
        </mask>
      </defs>
      <g className="logo-astre" style={{ transform: `translate(${x}px, ${y}px)` }}>
        {day
          ? <circle r="3.4" fill="#ffc94d" />
          : <circle r="3.2" fill="var(--logo-moon)" mask={`url(#${mask})`} />}
      </g>
      <path d="M3 25 L12.5 9.5 L18 18.5 L21 14 L29 25 Z" fill="currentColor" />
      {/* versant à l'ombre du grand sommet */}
      <path d="M12.5 9.5 L18 18.5 L16.4 25 L13.8 25 Z" fill="#000" opacity=".16" />
    </svg>
  );
}
