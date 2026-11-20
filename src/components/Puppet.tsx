import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { prefersReducedMotion } from '../lib/motion';
import type { Task } from '../lib/types';
import { useEditors } from './editors';
import { NEW_MENU_EVENT } from './NewMenu';
import '../styles/puppet.css';

/* ---------- Le randonneur qui crée le ticket ----------
   Quand l'assistant IA crée une action, le premier randonneur du logo descend de la montagne et
   rejoue la création dans la vraie interface, comme une souris vivante : il saute d'élément en
   élément, se cogne contre la recherche et le bouton « Nouveau », clique sur « Nouveau » puis
   « Action », tape le titre en sautillant dans le champ, choisit sujet, échéance, priorité, puis
   saute sur « Enregistrer » avant de regagner le logo.
   L'action existe déjà (créée par le serveur) : la fenêtre est ouverte avec son identifiant, donc
   « Enregistrer » réécrit la même ligne avec les mêmes valeurs, sans doublon.
   Ignoré avec « réduire les animations », ou si le bouton « Nouveau » n'est pas visible. */

export const PUPPET_EVENT = 'cockpit-puppet-task';
/** Demande la mise en scène pour l'action `id` (déjà enregistrée). */
export const playTaskCreation = (id: string) => dispatchEvent(new CustomEvent(PUPPET_EVENT, { detail: id }));

type Pose = { run: number; amp: number; tuck: number; flail: number; lean: number; squash: number; rot: number; face: number };
type Pt = [number, number];

const UNIT = 6.5; // px par unité de dessin une fois sorti du logo (~33 px de haut)
const BODY_H = 5.1; // hauteur du bonhomme en unités (pieds → haut de la tête)

const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (k: number) => k * k * (3 - 2 * k);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Anime `fn(k)` de k = 0 à 1 en `ms`, image par image. */
const tween = (ms: number, fn: (k: number) => void) => new Promise<void>(res => {
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    fn(k);
    if (k < 1) requestAnimationFrame(step); else res();
  };
  requestAnimationFrame(step);
});

/** Élément affiché et non recouvert (le centre est bien sur lui). */
function visible(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (el === hit || el.contains(hit));
}

/** Remplit un champ contrôlé par React comme le ferait une saisie. */
function setField(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

/** Rejoue une classe d'animation CSS sur un élément. */
function flash(el: Element, cls: string, ms: number) {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

/** Chemin du bonhomme (pieds en 0,0, tourné vers la droite) : même allure que dans le logo. */
function shape(p: Pose) {
  const c = p.tuck;
  const sw = Math.sin(p.run) * p.amp;
  const hip: Pt = [p.lean * 0.3 - c * 0.2, -1.8 + c * 0.85 - Math.abs(Math.cos(p.run)) * 0.2 * p.amp];
  const sh: Pt = [hip[0] + p.lean + c * 0.45, hip[1] - 1.5 + c * 0.1];
  const head: Pt = [sh[0] + p.lean * 0.4, sh[1] - 1];
  // Arrêté : jambes écartées et bras décollés du corps (sinon on ne lit qu'un trait).
  const stance = 0.5 * (1 - p.amp) * (1 - c * 0.5);
  const f1: Pt = [sw * 0.85 + stance, 0], f2: Pt = [-sw * 0.85 - stance, 0];
  const knee = (f: Pt): Pt => [(hip[0] + f[0]) / 2 + 0.35 * Math.max(p.amp, 0.3) + c * 0.6, (hip[1] + f[1]) / 2 - c * 0.2];
  const hand = (side: number): Pt => {
    const open = 0.6 * (1 - p.amp);
    const walk: Pt = [sh[0] + mix(side * (sw * 0.85 + open), 0.75 + side * 0.15, c), sh[1] + mix(1.1 - open * 0.25, 1.2, c)];
    const up: Pt = [sh[0] + 0.2 + side * 0.85, sh[1] - 1.05 - side * 0.25]; // bras en l'air (choc, panique)
    return [mix(walk[0], up[0], p.flail), mix(walk[1], up[1], p.flail)];
  };
  const q = (a: Pt) => `${a[0].toFixed(2)} ${a[1].toFixed(2)}`;
  const [h1, h2] = [hand(-1), hand(1)];
  return {
    d: `M${q(f1)} L${q(knee(f1))} L${q(hip)} L${q(knee(f2))} L${q(f2)} M${q(hip)} L${q(sh)} M${q(h1)} L${q(sh)} L${q(h2)}`,
    head,
  };
}

const REST: Pose = { run: 0, amp: 0, tuck: 0, flail: 0, lean: 0, squash: 1, rot: 0, face: 1 };

/** Acteur : position (pieds, px écran), taille (px par unité), pose ; dessin direct dans le DOM. */
function makeActor(root: HTMLDivElement) {
  const svg = root.querySelector('svg')!, g = svg.querySelector('g')!;
  const body = g.querySelector('path')!, head = g.querySelector('circle')!;
  const a = { x: 0, y: 0, s: UNIT, opacity: 1, pose: { ...REST } };
  const draw = () => {
    const { pose: p, s } = a;
    root.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
    root.style.opacity = a.opacity.toFixed(2);
    svg.setAttribute('width', (10 * s).toFixed(1));
    svg.setAttribute('height', (10 * s).toFixed(1));
    svg.style.left = (-5 * s).toFixed(1) + 'px';
    svg.style.top = (-8 * s).toFixed(1) + 'px';
    const wide = 1 + (1 - p.squash) * 0.6;
    g.setAttribute('transform', `rotate(${p.rot.toFixed(1)} 0 -2.4) scale(${(p.face * wide).toFixed(3)} ${p.squash.toFixed(3)})`);
    const sh = shape(p);
    body.setAttribute('d', sh.d);
    head.setAttribute('cx', sh.head[0].toFixed(2));
    head.setAttribute('cy', sh.head[1].toFixed(2));
  };
  const pose = (p: Partial<Pose>) => { Object.assign(a.pose, p); };
  return { a, draw, pose };
}

type Actor = ReturnType<typeof makeActor>;

/** Petites étoiles du choc, au point d'impact. */
function stars(x: number, y: number) {
  for (let i = 0; i < 5; i++) {
    const s = document.createElement('span');
    s.className = 'puppet-star';
    s.textContent = i % 2 ? '✦' : '✧';
    const ang = (-150 + i * 30) * Math.PI / 180;
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    s.style.setProperty('--dx', (Math.cos(ang) * 22).toFixed(0) + 'px');
    s.style.setProperty('--dy', (Math.sin(ang) * 22).toFixed(0) + 'px');
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 700);
  }
}

/* ---------- Mouvements ---------- */

/** Saut en cloche jusqu'à `to` (pieds). `grow` : taille d'arrivée (px par unité). */
async function hop(A: Actor, to: Pt, o: { height?: number; ms?: number; grow?: number; spin?: number } = {}) {
  const { a, draw, pose } = A;
  const [x0, y0, s0] = [a.x, a.y, a.s];
  const dist = Math.hypot(to[0] - x0, to[1] - y0);
  const ms = o.ms ?? clamp(260 + dist * 0.9, 320, 950);
  const h = (o.height ?? clamp(dist * 0.3, 22, 130)) + Math.abs(y0 - to[1]) / 2;
  if (Math.abs(to[0] - x0) > 3) pose({ face: Math.sign(to[0] - x0) });
  // Il plie les jambes avant de sauter.
  await tween(110, k => { pose({ tuck: ease(k) * 0.65, amp: 0, flail: 0, squash: 1 - k * 0.08 }); draw(); });
  const face = a.pose.face;
  await tween(ms, k => {
    a.x = mix(x0, to[0], k);
    a.y = mix(y0, to[1], k) - 4 * h * k * (1 - k);
    if (o.grow) a.s = mix(s0, o.grow, ease(k));
    pose({ tuck: 0.3 + 0.5 * Math.sin(Math.PI * k), squash: 1, flail: 0.15, rot: o.spin ? -face * o.spin * ease(k) : face * mix(-10, 12, k) });
    draw();
  });
  await land(A);
}

/** Réception : il s'écrase un peu puis se redresse. */
async function land(A: Actor) {
  const { draw, pose } = A;
  await tween(150, k => { pose({ rot: 0, flail: 0, tuck: mix(0.55, 0, ease(k)), squash: mix(0.72, 1, ease(k)) }); draw(); });
}

/** Marche sur place ou jusqu'à x (même hauteur). */
async function walk(A: Actor, toX: number) {
  const { a, draw, pose } = A;
  const x0 = a.x, ms = clamp(Math.abs(toX - x0) * 7, 150, 900);
  pose({ face: Math.sign(toX - x0) || a.pose.face });
  const r0 = a.pose.run;
  await tween(ms, k => {
    a.x = mix(x0, toX, k);
    pose({ run: r0 + k * ms / 55, amp: Math.min(1, k * 6, (1 - k) * 6), lean: 0.25 });
    draw();
  });
  pose({ amp: 0, lean: 0 });
  draw();
}

/** Il fonce dans le côté de `el`, se cogne, part en arrière en tournant et retombe sur `fall`. */
async function bump(A: Actor, el: HTMLElement, fall: Pt) {
  const { a, draw, pose } = A;
  const r = el.getBoundingClientRect();
  const fromLeft = a.x < r.left + r.width / 2;
  const hit: Pt = [fromLeft ? r.left - 2 * a.s : r.right + 2 * a.s, r.top + r.height * 0.75];
  const [x0, y0] = [a.x, a.y];
  pose({ face: fromLeft ? 1 : -1 });
  await tween(110, k => { pose({ tuck: ease(k) * 0.6 }); draw(); });
  // Vol trop bas, droit dans le mur.
  await tween(clamp(Math.abs(hit[0] - x0) * 1.4, 220, 520), k => {
    a.x = mix(x0, hit[0], k);
    a.y = mix(y0, hit[1], k) - 4 * 16 * k * (1 - k);
    pose({ tuck: mix(0.5, 0.1, k), lean: 0.6, flail: 0.2, rot: 0 });
    draw();
  });
  // Bong.
  stars(hit[0] + (fromLeft ? 2 : -2) * a.s, a.y - 3 * a.s);
  flash(el, 'puppet-bonk', 420);
  const face = a.pose.face;
  pose({ squash: 0.8, flail: 1, lean: -0.4 });
  draw();
  await wait(70);
  const [x1, y1] = [a.x, a.y];
  await tween(560, k => {
    a.x = mix(x1, fall[0], k);
    a.y = mix(y1, fall[1], k) - 4 * 22 * k * (1 - k);
    pose({ rot: face * 360 * ease(k), flail: mix(1, 0.3, k), squash: 1, tuck: 0.4 * Math.sin(Math.PI * k), lean: 0 });
    draw();
  });
  await land(A);
  // Un peu sonné.
  await tween(380, k => { pose({ rot: Math.sin(k * Math.PI * 4) * 9 * (1 - k) }); draw(); });
}

/** Il saute sur place et retombe de tout son poids sur l'élément : c'est le clic. */
async function stomp(A: Actor, el: Element, action?: () => void) {
  const { a, draw, pose } = A;
  const y0 = a.y;
  await tween(100, k => { pose({ tuck: ease(k) * 0.6, squash: 1 - k * 0.1 }); draw(); });
  await tween(300, k => {
    a.y = y0 - 4 * 3.2 * a.s * k * (1 - k);
    pose({ tuck: 0.25, squash: 1, flail: 0.5 * Math.sin(Math.PI * k) });
    draw();
  });
  a.y = y0;
  flash(el, 'puppet-press', 260);
  action?.();
  await land(A);
}

/** Debout sur le dessus d'un élément, à la fraction `fx` de sa largeur. */
const onTop = (el: Element, fx = 0.5): Pt => {
  const r = el.getBoundingClientRect();
  return [r.left + clamp(r.width * fx, 10, r.width - 10), r.top + 1];
};

/* ---------- Mise en scène ---------- */

async function perform(A: Actor, task: Task, editTask: (t: Task | null, d?: Partial<Task>) => void, home: () => { pt: Pt; s: number } | null) {
  const q = <E extends Element = HTMLElement>(sel: string) => document.querySelector<E>(sel);
  const newBtn = q('.topbar .new-menu:not(.more-menu) > .btn');
  if (!visible(newBtn)) return false;
  const start = home();
  if (!start) return false;
  const { a, draw } = A;
  [a.x, a.y] = start.pt;
  a.s = start.s;
  a.pose = { ...REST };
  draw();

  // 1. Il saute du logo sur le nom « Cockpit » (et prend sa taille), puis file vers la recherche.
  const brand = q('.brandname');
  const search = q('.topbar .searchbar');
  if (visible(brand)) await hop(A, onTop(brand, 0.75), { grow: UNIT, height: 30 });
  else await hop(A, [a.x + 26, a.y + 4], { grow: UNIT, height: 26 });

  if (visible(search)) {
    const r = search.getBoundingClientRect();
    if (a.x < r.left) await bump(A, search, [r.left - 7 * UNIT, r.bottom]);
    await hop(A, onTop(search, 0.06));
    await walk(A, onTop(search, 0.94)[0]);
  }
  const sync = q('.topbar .top-actions .sync');
  if (visible(sync)) await hop(A, onTop(sync));
  const more = q('.topbar .more-menu > button');
  if (visible(more)) {
    await hop(A, onTop(more));
    // Saut trop court : il se cogne contre « Nouveau » et retombe sur le bouton « ⋯ ».
    await bump(A, newBtn, onTop(more));
  }

  // 2. « Nouveau » puis « Action ».
  await hop(A, onTop(newBtn, 0.45), { height: 34 });
  await stomp(A, newBtn, () => dispatchEvent(new CustomEvent(NEW_MENU_EVENT, { detail: true })));
  await wait(160);
  const item = q('.topbar .new-menu:not(.more-menu) .menu button');
  if (!item) return true;
  await hop(A, onTop(item, 0.3), { height: 18 });
  await stomp(A, item, () => {
    dispatchEvent(new CustomEvent(NEW_MENU_EVENT, { detail: false }));
    editTask(null, { id: task.id, name: '', subject_id: null, due_date: null, owner: '', priority: 'P2', status: 'À faire', position: task.position });
  });

  // 3. La fiche : il tape le titre en sautillant, puis règle chaque champ.
  await wait(300);
  const modal = q('.backdrop:not(.leaving) .modal');
  if (!modal) return true;
  const alive = () => modal.isConnected && !modal.closest('.leaving');
  const inputs = [...modal.querySelectorAll<HTMLInputElement>('.form input:not([type=date])')];
  const selects = [...modal.querySelectorAll<HTMLSelectElement>('.form select')];
  const date = modal.querySelector<HTMLInputElement>('.form input[type=date]');

  const type = async (input: HTMLInputElement, text: string) => {
    await hop(A, onTop(input, 0.04), { height: 40 });
    const r = input.getBoundingClientRect(), y0 = a.y, x0 = a.x;
    const ms = clamp(text.length * 55, 300, 2600);
    let shown = 0;
    await tween(ms, k => {
      const n = Math.round(k * text.length);
      if (n !== shown && alive()) { shown = n; setField(input, text.slice(0, n)); }
      a.x = Math.min(x0 + n * 7.4, r.right - 12);
      const b = Math.abs(Math.sin(k * ms / 60));
      a.y = y0 - b * 1.6 * a.s;
      A.pose({ face: 1, tuck: 0.3 * (1 - b), squash: b < 0.15 ? 0.85 : 1, run: k * ms / 50, amp: 0.5 });
      draw();
    });
    a.y = y0;
    A.pose({ amp: 0 });
    await land(A);
  };
  const pick = async (el: HTMLInputElement | HTMLSelectElement | null | undefined, value: string) => {
    if (!el || !alive() || el.value === value) return;
    await hop(A, onTop(el, 0.35));
    await stomp(A, el, () => setField(el, value));
  };

  if (inputs[0] && alive()) await type(inputs[0], task.name);
  await pick(selects[0], task.subject_id ?? '');
  await pick(date, task.due_date ?? '');
  await pick(selects[1], task.status);
  await pick(selects[2], task.priority);
  if (task.owner && inputs[1] && alive()) await type(inputs[1], task.owner);

  // 4. « Enregistrer ».
  const save = modal.querySelector<HTMLButtonElement>('.modal-foot .btn.primary');
  if (save && alive()) {
    await hop(A, onTop(save), { height: 36 });
    await stomp(A, save, () => save.click());
  }
  return true;
}

/* ---------- Mode jeu ----------
   Clic sur le logo : le randonneur de tête en sort et se pilote au clavier, comme un petit jeu de
   plateforme posé sur l'interface. Chaque élément de la page est une plateforme (on atterrit sur
   son bord supérieur), les boutons et les champs sont des murs (il s'y cogne).
   ← → : courir · ↑ ou Espace : sauter (autant de fois qu'on veut, même en l'air, avec un salto)
   ↓ : descendre à travers l'élément · Entrée : il saute et retombe sur l'élément = clic
   Échap (ou nouveau clic sur le logo) : il rentre dans le logo. */

export const PLAY_EVENT = 'cockpit-puppet-play';
/** Fait sortir le randonneur pour le piloter, ou le fait rentrer. */
export const togglePlay = () => dispatchEvent(new Event(PLAY_EVENT));

type Controls = { held: Set<string>; queue: string[]; stop: boolean };

const INTERACTIVE = 'button, a[href], input, select, textarea, summary, label, [role="button"], [role="tab"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';
const WALL = 'button, a[href], input, select, textarea, .btn';
const GRAVITY = 2300; // px/s²
const JUMP_V = 760; // px/s (≈ 125 px de haut)
const RUN = 280; // px/s
const MAX_FALL = 1150;
const HALF = 0.6 * UNIT; // demi-largeur du bonhomme

/** Bord supérieur d'élément franchi en tombant de y0 à y1 (le plus haut), à l'abscisse x. */
function platformAt(x: number, y0: number, y1: number, below: number | null) {
  let best: Element | null = null, top = Infinity;
  for (const el of document.elementsFromPoint(x, y1)) {
    if (el === document.documentElement || el === document.body || el.closest('.puppet')) continue;
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue; // icônes : le <svg> suffit
    const r = el.getBoundingClientRect();
    if (r.height > innerHeight * 0.85 || r.width < 6) continue; // pas les grands conteneurs de page
    if (below !== null && r.top < below - 1) continue; // ↓ : on traverse l'élément quitté et tout son contenu
    if (r.top >= y0 - 1 && r.top <= y1 && r.top < top) { best = el; top = r.top; }
  }
  return best ? { el: best, top } : null;
}

/** Mur rencontré en allant de x0 à x1 (pieds à y, hauteur h) : bouton, lien ou champ dont le haut dépasse. */
function wallAt(x0: number, x1: number, y: number, h: number) {
  const dir = Math.sign(x1 - x0);
  if (!dir) return null;
  for (const py of [y - h * 0.3, y - h * 0.75]) {
    for (const hit of document.elementsFromPoint(x1 + dir * HALF, py)) {
      const w = hit.closest(WALL);
      if (!w || w.closest('.puppet')) continue;
      const r = w.getBoundingClientRect();
      if (r.top > y - 3) continue; // il est dessus, pas contre
      if (dir > 0 && x0 + HALF <= r.left + 1) return { x: r.left - HALF, el: w };
      if (dir < 0 && x0 - HALF >= r.right - 1) return { x: r.right + HALF, el: w };
    }
  }
  return null;
}

/** Clic sur ce qui est sous ses pieds : l'élément cliquable le plus proche. */
function clickUnder(plat: Element | null, x: number, y: number) {
  const below = document.elementsFromPoint(x, y + 3).filter(e => !e.closest('.puppet'));
  const target = plat?.closest(INTERACTIVE) ?? below.map(e => e.closest(INTERACTIVE)).find(Boolean) ?? plat;
  if (!(target instanceof HTMLElement)) return;
  flash(target, 'puppet-press', 260);
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    target.focus();
    try { (target as HTMLInputElement).showPicker?.(); } catch { /* champ texte : pas de sélecteur */ }
  } else target.click();
}

async function play(A: Actor, ctl: Controls) {
  const { a, draw, pose } = A;
  const H = BODY_H * UNIT;
  let vx = 0, vy = 0, grounded = false, plat: Element | null = null;
  let skip: number | null = null; // ↓ : bas de l'élément traversé
  let spin = 0, spinV = 0, squash = 0, stomp = false, bonkAt = 0;
  let last = performance.now();
  while (!ctl.stop) {
    const now = await new Promise<number>(r => requestAnimationFrame(r));
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    for (const c of ctl.queue.splice(0)) {
      if (c === 'jump') {
        if (!grounded) { spin = 0; spinV = -a.pose.face * 360 / 0.42; } // saut en l'air : salto
        vy = -JUMP_V; grounded = false; plat = null;
      } else if (c === 'drop' && grounded && plat) {
        skip = plat.getBoundingClientRect().bottom; grounded = false; plat = null; vy = 80;
      } else if (c === 'stomp') {
        stomp = true;
        if (grounded) { skip = null; vy = -340; grounded = false; }
      }
    }

    // Course : accélération douce, moins de contrôle en l'air.
    const dir = (ctl.held.has('ArrowRight') ? 1 : 0) - (ctl.held.has('ArrowLeft') ? 1 : 0);
    vx += (dir * RUN - vx) * Math.min(1, dt * (grounded ? 14 : 6));
    let nx = clamp(a.x + vx * dt, HALF + 2, innerWidth - HALF - 2);
    const wall = Math.abs(vx) > 1 ? wallAt(a.x, nx, a.y, H) : null;
    if (wall) {
      nx = wall.x;
      if (Math.abs(vx) > RUN * 0.6 && now - bonkAt > 400) { // lancé : il se cogne et rebondit
        bonkAt = now;
        stars(wall.x + Math.sign(vx) * HALF * 2, a.y - H * 0.8);
        flash(wall.el, 'puppet-bonk', 420);
        vx = -Math.sign(vx) * 170;
        if (grounded) { vy = -240; grounded = false; plat = null; }
      } else vx = 0;
    }
    a.x = nx;

    if (grounded) {
      const r = plat?.isConnected ? plat.getBoundingClientRect() : null;
      if (plat && (!r || r.height === 0 || a.x < r.left - 2 || a.x > r.right + 2)) { grounded = false; plat = null; vy = 0; }
      else a.y = r ? r.top : innerHeight - 2; // suit l'élément s'il bouge (défilement)
    }
    if (!grounded) {
      vy = Math.min(MAX_FALL, vy + GRAVITY * dt);
      let ny = a.y + vy * dt;
      if (skip !== null && ny > skip + 2) skip = null;
      if (vy > 0) {
        const p = platformAt(a.x, a.y, ny, skip);
        if (p) { ny = p.top; grounded = true; plat = p.el; }
        else if (ny >= innerHeight - 2) { ny = innerHeight - 2; grounded = true; plat = null; }
      }
      if (ny - H < 2) { ny = H + 2; vy = Math.max(vy, 0); } // haut de l'écran
      a.y = ny;
      if (grounded) {
        vy = 0; spin = 0; spinV = 0; squash = 0.15;
        if (stomp) { stomp = false; clickUnder(plat, a.x, a.y); }
      }
    }

    // Pose.
    if (spinV) { spin += spinV * dt; if (Math.abs(spin) >= 360) { spin = 0; spinV = 0; } }
    squash = Math.max(0, squash - dt);
    const sp = Math.min(1, Math.abs(vx) / RUN);
    if (grounded) a.pose.run += Math.abs(vx) * dt / (UNIT * 0.6);
    pose({
      face: dir || a.pose.face,
      amp: grounded ? sp : 0,
      lean: grounded ? 0.3 * sp : 0,
      tuck: grounded ? squash / 0.15 * 0.5 : vy < 0 ? 0.45 : 0.15,
      flail: grounded ? 0 : vy > 550 ? 0.8 : 0.15,
      squash: 1 - squash / 0.15 * 0.25,
      rot: spinV ? spin : grounded ? 0 : (dir || a.pose.face) * clamp(sp * 8, 0, 8),
    });
    draw();
  }
}

/** Bonhomme du logo à suivre : celui de tête, dans le logo visible (barre latérale ou du haut). */
function homeSpot() {
  for (const g of document.querySelectorAll('.logo-hiker[data-lead]')) {
    const r = g.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.left < innerWidth && r.top < innerHeight) {
      return { pt: [r.left + r.width / 2, r.bottom] as Pt, s: clamp(r.height / BODY_H, 1, UNIT) };
    }
  }
  return null;
}

export function Puppet() {
  const { db } = useStore();
  const { editTask } = useEditors();
  const live = useRef({ db, editTask });
  live.current = { db, editTask };
  const root = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [playing, setPlaying] = useState(false);
  const ctl = useRef<Controls | null>(null);

  // Mode jeu : le logo fait sortir (ou rentrer) le randonneur piloté au clavier.
  useEffect(() => {
    const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter', 'Escape'];
    const down = (e: KeyboardEvent) => {
      const c = ctl.current;
      if (!c || e.ctrlKey || e.metaKey || e.altKey || !KEYS.includes(e.key)) return;
      // Dans un champ, le clavier sert à écrire ; Échap rend la main au bonhomme.
      const t = document.activeElement as HTMLElement | null;
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) {
        if (e.key === 'Escape') { t.blur(); e.preventDefault(); e.stopPropagation(); }
        return;
      }
      if (e.key === 'Escape') {
        if (document.querySelector('.backdrop:not(.leaving), .menu:not(.leaving)')) return; // ferme d'abord la fenêtre / le menu
        c.stop = true;
      } else if (!e.repeat) {
        if (e.key === 'ArrowUp' || e.key === ' ') c.queue.push('jump');
        else if (e.key === 'ArrowDown') c.queue.push('drop');
        else if (e.key === 'Enter') c.queue.push('stomp');
      }
      c.held.add(e.key);
      e.preventDefault();
      e.stopPropagation();
    };
    const up = (e: KeyboardEvent) => ctl.current?.held.delete(e.key);
    const lost = () => ctl.current?.held.clear();
    const toggle = async () => {
      if (ctl.current) { ctl.current.stop = true; return; }
      if (busy.current || !root.current) return;
      const start = homeSpot();
      if (!start) return;
      busy.current = true;
      const c: Controls = { held: new Set(), queue: [], stop: false };
      ctl.current = c;
      setPlaying(true);
      const html = document.documentElement;
      try {
        const A = makeActor(root.current);
        [A.a.x, A.a.y] = start.pt;
        A.a.s = start.s;
        A.a.opacity = 1;
        A.a.pose = { ...REST };
        html.dataset.puppet = '';
        root.current.hidden = false;
        A.draw();
        // Il bondit hors du logo en grandissant, puis la gravité prend le relais.
        await hop(A, [start.pt[0] + 40, start.pt[1] - 10], { grow: UNIT, height: 40, ms: 420 });
        await play(A, c);
        const back = homeSpot();
        if (back) await hop(A, back.pt, { grow: back.s, height: 80, ms: 800, spin: 360 });
        await tween(160, k => { A.a.opacity = 1 - k; A.draw(); });
      } finally {
        if (root.current) root.current.hidden = true;
        delete html.dataset.puppet;
        ctl.current = null;
        busy.current = false;
        setPlaying(false);
      }
    };
    addEventListener('keydown', down, true);
    addEventListener('keyup', up, true);
    addEventListener('blur', lost);
    addEventListener(PLAY_EVENT, toggle);
    return () => {
      removeEventListener('keydown', down, true);
      removeEventListener('keyup', up, true);
      removeEventListener('blur', lost);
      removeEventListener(PLAY_EVENT, toggle);
    };
  }, []);

  useEffect(() => {
    const on = async (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (busy.current || !root.current || prefersReducedMotion()) return;
      busy.current = true;
      const html = document.documentElement;
      try {
        // L'action arrive par le rechargement qui suit la réponse de l'IA.
        let task: Task | undefined;
        for (let i = 0; i < 40 && !(task = live.current.db.tasks.find(t => t.id === id)); i++) await wait(100);
        if (!task) return;
        const A = makeActor(root.current);
        A.a.opacity = 1;
        html.dataset.puppet = '';
        root.current.hidden = false;
        const played = await perform(A, task, (t, d) => live.current.editTask(t, d), homeSpot);
        if (played) {
          // Retour au logo : grand saut, il rapetisse et reprend sa place dans la cordée.
          await wait(250);
          const back = homeSpot();
          if (back) await hop(A, back.pt, { grow: back.s, height: 90, ms: 900, spin: 360 });
        }
        await tween(160, k => { A.a.opacity = 1 - k; A.draw(); });
      } finally {
        if (root.current) root.current.hidden = true;
        delete html.dataset.puppet;
        busy.current = false;
      }
    };
    addEventListener(PUPPET_EVENT, on);
    return () => removeEventListener(PUPPET_EVENT, on);
  }, []);

  return (<>
    {playing && (
      <div className="puppet-help" role="status">
        <kbd>←</kbd><kbd>→</kbd> courir · <kbd>↑</kbd> / <kbd>Espace</kbd> sauter · <kbd>↓</kbd> descendre · <kbd>Entrée</kbd> cliquer · <kbd>Échap</kbd> rentrer
      </div>
    )}
    <div ref={root} className="puppet" hidden aria-hidden="true">
      <svg viewBox="-5 -8 10 10" overflow="visible">
        <g fill="none" stroke="var(--logo-hiker)" strokeWidth=".6" strokeLinecap="round" strokeLinejoin="round">
          <path />
          <circle r=".8" fill="var(--logo-hiker)" stroke="none" />
        </g>
      </svg>
    </div>
  </>);
}
