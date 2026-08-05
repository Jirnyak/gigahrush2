/* ── Procedural sound engine (Web Audio API) ─────────────────── */

let ctx: AudioContext | null = null;
let mainGain: GainNode | null = null;
let scopedGain: GainNode | null = null;
type AudioSuspendReason = 'page' | 'platform';
const audioSuspendReasons = new Set<AudioSuspendReason>();

export type AudioCueBudgetId =
  | 'footstep'
  | 'melee_attack'
  | 'door'
  | 'monster_growl'
  | 'samosbor_siren'
  | 'samosbor_room_siren'
  | 'samosbor_bell'
  | 'samosbor_beep'
  | 'samosbor_distant_alarm'
  | 'maronary_ping'
  | 'route_cue'
  | 'player_weapon'
  | 'hostile_ranged'
  | 'projectile_impact'
  | 'energy_impact'
  | 'flesh_hit'
  | 'break'
  | 'psi_cast'
  | 'flame'
  | 'hud_bar_change';

export type HudBarAudioId = 'hp' | 'psi' | 'food' | 'water' | 'sleep' | 'toilet' | 'xp';

export type AmbientDroneMode = 'normal' | 'samosbor' | 'maronary' | 'istotit' | 'veretar';

interface AudioBudgetDef {
  cooldownSec: number;
  windowSec: number;
  maxPerWindow: number;
}

interface AudioBudgetRuntime {
  lastAt: number;
  windowStart: number;
  count: number;
}

const AUDIO_BUDGETS: Record<AudioCueBudgetId, AudioBudgetDef> = {
  footstep: { cooldownSec: 0.07, windowSec: 0.5, maxPerWindow: 7 },
  melee_attack: { cooldownSec: 0.045, windowSec: 0.45, maxPerWindow: 8 },
  door: { cooldownSec: 0.12, windowSec: 0.8, maxPerWindow: 5 },
  monster_growl: { cooldownSec: 0.18, windowSec: 1.0, maxPerWindow: 5 },
  samosbor_siren: { cooldownSec: 6.0, windowSec: 8.0, maxPerWindow: 1 },
  samosbor_room_siren: { cooldownSec: 0.18, windowSec: 1.4, maxPerWindow: 4 },
  samosbor_bell: { cooldownSec: 5.0, windowSec: 7.0, maxPerWindow: 1 },
  samosbor_beep: { cooldownSec: 4.0, windowSec: 6.0, maxPerWindow: 1 },
  samosbor_distant_alarm: { cooldownSec: 5.0, windowSec: 7.0, maxPerWindow: 1 },
  maronary_ping: { cooldownSec: 1.4, windowSec: 5.0, maxPerWindow: 2 },
  route_cue: { cooldownSec: 0.75, windowSec: 4.0, maxPerWindow: 3 },
  player_weapon: { cooldownSec: 0.025, windowSec: 0.35, maxPerWindow: 14 },
  hostile_ranged: { cooldownSec: 0.055, windowSec: 0.5, maxPerWindow: 8 },
  projectile_impact: { cooldownSec: 0.035, windowSec: 0.35, maxPerWindow: 9 },
  energy_impact: { cooldownSec: 0.045, windowSec: 0.45, maxPerWindow: 7 },
  flesh_hit: { cooldownSec: 0.05, windowSec: 0.4, maxPerWindow: 6 },
  break: { cooldownSec: 0.16, windowSec: 1.0, maxPerWindow: 4 },
  psi_cast: { cooldownSec: 0.07, windowSec: 0.5, maxPerWindow: 6 },
  flame: { cooldownSec: 0.04, windowSec: 0.35, maxPerWindow: 8 },
  hud_bar_change: { cooldownSec: 0.12, windowSec: 1.0, maxPerWindow: 3 },
};

const audioBudgetRuntime = new Map<AudioCueBudgetId, AudioBudgetRuntime>();

const AMBIENT_DRONE_SETTINGS: Record<AmbientDroneMode, {
  primaryHz: number;
  secondaryHz: number;
  gain: number;
  cutoffHz: number;
  detuneCents: number;
}> = {
  normal: { primaryHz: 28, secondaryHz: 41, gain: 0.028, cutoffHz: 82, detuneCents: -5 },
  samosbor: { primaryHz: 34, secondaryHz: 52, gain: 0.038, cutoffHz: 118, detuneCents: 18 },
  maronary: { primaryHz: 31, secondaryHz: 97, gain: 0.034, cutoffHz: 150, detuneCents: 42 },
  istotit: { primaryHz: 25, secondaryHz: 66, gain: 0.032, cutoffHz: 130, detuneCents: -18 },
  veretar: { primaryHz: 21, secondaryHz: 37, gain: 0.036, cutoffHz: 96, detuneCents: 26 },
};

function claimAudioCue(id: AudioCueBudgetId, now: number): boolean {
  const budget = AUDIO_BUDGETS[id];
  const runtime = audioBudgetRuntime.get(id);
  if (!runtime || now - runtime.windowStart >= budget.windowSec || now < runtime.windowStart) {
    audioBudgetRuntime.set(id, { lastAt: now, windowStart: now, count: 1 });
    return true;
  }
  if (now - runtime.lastAt < budget.cooldownSec || runtime.count >= budget.maxPerWindow) return false;
  runtime.lastAt = now;
  runtime.count++;
  return true;
}

function beginCue(id: AudioCueBudgetId): AudioContext | null {
  if (audioSuspended()) return null;
  if (!hasAudioContext()) return null;
  const ac = ensureContext();
  return claimAudioCue(id, ac.currentTime) ? ac : null;
}

export function resetAudioBudgetForTests(): void {
  audioBudgetRuntime.clear();
}

export function claimAudioCueForTests(id: AudioCueBudgetId, now: number): boolean {
  return claimAudioCue(id, now);
}

/* ── Distance-based volume attenuation ────────────────────────── */
const SOUND_MAX_DIST = 25;  // beyond this, sound is silent
const POSITIONAL_SOUND_MAX_GAIN = 0.78;
export type AudioDistanceProvider = (ax: number, ay: number, bx: number, by: number) => number;

export interface AudioWorldDistanceContext {
  dist2(ax: number, ay: number, bx: number, by: number): number;
}

type AudioDistanceSource = AudioDistanceProvider | AudioWorldDistanceContext;

let _playerX = 0, _playerY = 0;
let _distanceSource: AudioDistanceSource | null = null;

function audioContextCtor(): typeof AudioContext | null {
  return globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null;
}

function hasAudioContext(): boolean {
  return audioContextCtor() !== null;
}

export function setListenerPos(x: number, y: number, distanceSource?: AudioDistanceSource): void {
  _playerX = x;
  _playerY = y;
  _distanceSource = distanceSource ?? null;
}

/** Compute volume multiplier [0..1] based on distance from listener */
function volumeAt(x: number, y: number, maxDist = SOUND_MAX_DIST): number {
  if (!_distanceSource) return 1;
  const d2 = typeof _distanceSource === 'function'
    ? _distanceSource(_playerX, _playerY, x, y)
    : _distanceSource.dist2(_playerX, _playerY, x, y);
  if (d2 <= 1) return 1;
  const maxDistance = Math.max(1, maxDist);
  const d = Math.sqrt(d2);
  if (d >= maxDistance) return 0;
  return 1 - d / maxDistance;
}

/** Play a sound at a world position (volume depends on distance to player) */
export function playSoundAt(fn: () => void, x: number, y: number): void {
  if (audioSuspended()) return;
  if (!hasAudioContext()) return;
  const vol = Math.min(POSITIONAL_SOUND_MAX_GAIN, volumeAt(x, y));
  if (vol < 0.01) return;  // too far, skip entirely
  const ac = ensureContext();
  const bus = ac.createGain();
  bus.gain.value = vol;
  bus.connect(mainGain!);
  const prev = scopedGain;
  scopedGain = bus;
  try {
    fn();
  } finally {
    scopedGain = prev;
  }
  globalThis.setTimeout(() => {
    try { bus.disconnect(); } catch { /* already disconnected */ }
  }, 4000);
}

function ensureContext(): AudioContext {
  if (!ctx) {
    const Ctor = audioContextCtor();
    if (!Ctor) throw new Error('AudioContext is unavailable');
    ctx = new Ctor();
    mainGain = ctx.createGain();
    mainGain.gain.value = 0.3;
    mainGain.connect(ctx.destination);
  }
  if (!audioSuspended() && ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function gain(): GainNode { return scopedGain ?? mainGain!; }

function audioSuspended(): boolean {
  return audioSuspendReasons.size > 0;
}

function setAudioSuspended(reason: AudioSuspendReason, suspended: boolean): void {
  const wasSuspended = audioSuspended();
  if (suspended) audioSuspendReasons.add(reason);
  else audioSuspendReasons.delete(reason);
  const isSuspended = audioSuspended();
  if (!ctx || wasSuspended === isSuspended) return;
  if (isSuspended) {
    if (ctx.state === 'running') void ctx.suspend().catch(() => {});
    return;
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
}

export function setAudioSuspendedForPage(hidden: boolean): void {
  setAudioSuspended('page', hidden);
}

export function setAudioSuspendedForPlatform(paused: boolean): void {
  setAudioSuspended('platform', paused);
}

export function resetAudioSuspensionForTests(): void {
  audioSuspendReasons.clear();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
}

export function primeBadAppleProjectorAudio(): void {
}

export function updateBadAppleProjectorLoop(_active: boolean, _x: number, _y: number, _frame: number, _maxDist = SOUND_MAX_DIST): void {
}

/* ── Footstep: short low thump ───────────────────────────────── */
export function playFootstep(): void {
  const ac = beginCue('footstep');
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = 60 + Math.random() * 30;
  g.gain.setValueAtTime(0.15, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.12);
  osc.connect(g).connect(gain());
  osc.start(); osc.stop(ac.currentTime + 0.12);
}

/* ── Attack swing: quick noise burst ─────────────────────────── */
export function playAttack(): void {
  const ac = beginCue('melee_attack');
  if (!ac) return;
  const len = 0.15;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    d[i] = (Math.random() * 2 - 1) * (1 - t) * 0.5;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.2;
  src.connect(g).connect(gain());
  src.start();
}

/* ── Door open/close: creaky tone ────────────────────────────── */
export function playDoor(): void {
  const ac = beginCue('door');
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(120, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(60, ac.currentTime + 0.3);
  g.gain.setValueAtTime(0.08, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.35);
  osc.connect(g).connect(gain());
  osc.start(); osc.stop(ac.currentTime + 0.35);
}

/* ── Monster growl: distorted buffer ─────────────────────────── */
export function playGrowl(): void {
  const ac = beginCue('monster_growl');
  if (!ac) return;
  const len = 0.6;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / ac.sampleRate;
    const freq = 80 + Math.sin(t * 15) * 30;
    d[i] = Math.sin(t * freq * Math.PI * 2) * 0.4 * (1 - t / len)
         + (Math.random() * 2 - 1) * 0.1 * (1 - t / len);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.15;
  src.connect(g).connect(gain());
  src.start();
}

/* ── Samosbor alarm: rising distorted siren ──────────────────── */
export function playSamosborAlarm(): void {
  const ac = beginCue('samosbor_siren');
  if (!ac) return;
  const len = 3;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / ac.sampleRate;
    const freq = 200 + Math.sin(t * 4) * 150 + t * 100;
    d[i] = Math.sin(t * freq * Math.PI * 2) * 0.3
         + Math.sin(t * freq * 0.5 * Math.PI * 2) * 0.15;
    // Clip for distortion
    d[i] = Math.max(-0.5, Math.min(0.5, d[i] * 2));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.25;
  src.connect(g).connect(gain());
  src.start();
}

/* ── Apartment room siren: short positional locator pulse ─────── */
export function playSamosborRoomSiren(seed = 0): void {
  const ac = beginCue('samosbor_room_siren');
  if (!ac) return;
  const now = ac.currentTime;
  const len = 1.15;
  const wobble = ((Math.abs(seed) % 17) - 8) * 2.5;
  const base = 420 + wobble;
  const bus = ac.createGain();
  bus.gain.setValueAtTime(0.001, now);
  bus.gain.exponentialRampToValueAtTime(0.14, now + 0.05);
  bus.gain.exponentialRampToValueAtTime(0.001, now + len);
  bus.connect(gain());

  const hi = ac.createOscillator();
  hi.type = 'sawtooth';
  hi.frequency.setValueAtTime(base, now);
  hi.frequency.linearRampToValueAtTime(base * 1.48, now + len * 0.5);
  hi.frequency.linearRampToValueAtTime(base * 0.92, now + len);
  hi.connect(bus);
  hi.start(now);
  hi.stop(now + len);

  const lo = ac.createOscillator();
  lo.type = 'triangle';
  lo.frequency.setValueAtTime(base * 0.5, now + 0.08);
  lo.frequency.linearRampToValueAtTime(base * 0.72, now + len);
  const loGain = ac.createGain();
  loGain.gain.setValueAtTime(0.001, now);
  loGain.gain.exponentialRampToValueAtTime(0.05, now + 0.12);
  loGain.gain.exponentialRampToValueAtTime(0.001, now + len);
  lo.connect(loGain).connect(bus);
  lo.start(now + 0.08);
  lo.stop(now + len);
}

/* ── Maronary cue: thin green-screen beep and distant chord ─────
   This high beep + wall tick is the approved Maronary identity; keep it distinct from sirens. */
export function playMaronarySignal(): void {
  const ac = beginCue('samosbor_beep');
  if (!ac) return;
  const len = 3.2;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.001, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + 0.12);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + len);
  g.connect(gain());

  const beep = ac.createOscillator();
  beep.type = 'sine';
  beep.frequency.setValueAtTime(1480, ac.currentTime);
  beep.frequency.linearRampToValueAtTime(1660, ac.currentTime + len);
  beep.connect(g);
  beep.start();
  beep.stop(ac.currentTime + len);

  const choir = ac.createOscillator();
  choir.type = 'triangle';
  choir.frequency.setValueAtTime(247, ac.currentTime);
  choir.frequency.linearRampToValueAtTime(233, ac.currentTime + len);
  choir.connect(g);
  choir.start(ac.currentTime + 0.35);
  choir.stop(ac.currentTime + len);
}

/* ── Maronary active ping: short wall-borne proof tick ────────── */
export function playMaronaryPing(): void {
  const ac = beginCue('maronary_ping');
  if (!ac) return;
  const now = ac.currentTime;
  const len = 0.42;
  const bus = ac.createGain();
  bus.gain.setValueAtTime(0.001, now);
  bus.gain.exponentialRampToValueAtTime(0.11, now + 0.025);
  bus.gain.exponentialRampToValueAtTime(0.001, now + len);
  bus.connect(gain());

  const ping = ac.createOscillator();
  ping.type = 'sine';
  ping.frequency.setValueAtTime(1720, now);
  ping.frequency.linearRampToValueAtTime(1510, now + len);
  ping.connect(bus);
  ping.start(now);
  ping.stop(now + len);

  const undertone = ac.createOscillator();
  undertone.type = 'triangle';
  undertone.frequency.setValueAtTime(196, now + 0.08);
  undertone.frequency.linearRampToValueAtTime(185, now + len);
  const underGain = ac.createGain();
  underGain.gain.setValueAtTime(0.001, now);
  underGain.gain.exponentialRampToValueAtTime(0.035, now + 0.12);
  underGain.gain.exponentialRampToValueAtTime(0.001, now + len);
  undertone.connect(underGain).connect(bus);
  undertone.start(now + 0.08);
  undertone.stop(now + len);
}

/* ── Veretar cue: far outdoor alarm with dry low drone ────────── */
export function playVeretarSignal(): void {
  const ac = beginCue('samosbor_distant_alarm');
  if (!ac) return;
  const now = ac.currentTime;
  const len = 3.6;
  const bus = ac.createGain();
  bus.gain.setValueAtTime(0.001, now);
  bus.gain.exponentialRampToValueAtTime(0.16, now + 0.18);
  bus.gain.exponentialRampToValueAtTime(0.001, now + len);
  bus.connect(gain());

  const farAlarm = ac.createOscillator();
  farAlarm.type = 'sine';
  farAlarm.frequency.setValueAtTime(520, now);
  farAlarm.frequency.linearRampToValueAtTime(460, now + len);
  farAlarm.connect(bus);
  farAlarm.start(now);
  farAlarm.stop(now + len);

  const drone = ac.createOscillator();
  drone.type = 'sawtooth';
  drone.frequency.setValueAtTime(78, now);
  drone.frequency.linearRampToValueAtTime(66, now + len);
  const droneGain = ac.createGain();
  droneGain.gain.setValueAtTime(0.035, now);
  droneGain.gain.exponentialRampToValueAtTime(0.001, now + len);
  drone.connect(droneGain).connect(bus);
  drone.start(now + 0.25);
  drone.stop(now + len);
}

/* ── Istotit cue: low cathedral bell with wordless choir ───────── */
export function playIstotitBell(): void {
  const ac = beginCue('samosbor_bell');
  if (!ac) return;
  const now = ac.currentTime;
  const len = 4.2;
  const bus = ac.createGain();
  bus.gain.setValueAtTime(0.001, now);
  bus.gain.exponentialRampToValueAtTime(0.26, now + 0.06);
  bus.gain.exponentialRampToValueAtTime(0.001, now + len);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(780, now);
  lp.frequency.exponentialRampToValueAtTime(520, now + len);
  bus.connect(lp).connect(gain());

  const strikes = [0, 0.44, 0.9, 1.38];
  const fundamentals = [82.41, 73.42, 98, 65.41];
  const partials = [1, 1.5, 2.01, 2.72];
  for (let s = 0; s < strikes.length; s++) {
    const strikeAt = now + strikes[s];
    for (let p = 0; p < partials.length; p++) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = p === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(fundamentals[s] * partials[p], strikeAt);
      g.gain.setValueAtTime(0.001, strikeAt);
      g.gain.exponentialRampToValueAtTime((0.16 - s * 0.018) / (p + 1), strikeAt + 0.025);
      g.gain.exponentialRampToValueAtTime(0.001, now + len - p * 0.18);
      osc.connect(g).connect(bus);
      osc.start(strikeAt);
      osc.stop(now + len);
    }
  }

  const choir = ac.createOscillator();
  choir.type = 'triangle';
  choir.frequency.setValueAtTime(65.41, now + 0.25);
  choir.frequency.linearRampToValueAtTime(61.74, now + len);
  const choirGain = ac.createGain();
  choirGain.gain.setValueAtTime(0.001, now);
  choirGain.gain.exponentialRampToValueAtTime(0.07, now + 0.75);
  choirGain.gain.exponentialRampToValueAtTime(0.001, now + len);
  choir.connect(choirGain).connect(bus);
  choir.start(now + 0.25);
  choir.stop(now + len);

  const undertone = ac.createOscillator();
  undertone.type = 'sawtooth';
  undertone.frequency.setValueAtTime(41.2, now);
  undertone.frequency.linearRampToValueAtTime(38.9, now + len);
  const undertoneGain = ac.createGain();
  undertoneGain.gain.setValueAtTime(0.001, now);
  undertoneGain.gain.exponentialRampToValueAtTime(0.035, now + 0.18);
  undertoneGain.gain.exponentialRampToValueAtTime(0.001, now + len);
  undertone.connect(undertoneGain).connect(bus);
  undertone.start(now);
  undertone.stop(now + len);
}

/* ── Route cue: short pipe-song hint, procedural and non-looping ─ */
export function playRouteCueTone(seed = 0, intensity = 1): void {
  const ac = beginCue('route_cue');
  if (!ac) return;
  const now = ac.currentTime;
  const len = 2.35;
  const amp = Math.max(0.06, Math.min(0.2, 0.15 * intensity));
  const base = 118 + Math.abs(seed % 37);

  const bus = ac.createGain();
  bus.gain.setValueAtTime(0.001, now);
  bus.gain.exponentialRampToValueAtTime(amp, now + 0.18);
  bus.gain.exponentialRampToValueAtTime(0.001, now + len);
  bus.connect(gain());

  for (let i = 0; i < 3; i++) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    const bend = 1 + ((seed + i * 17) % 9) * 0.006;
    osc.type = i === 1 ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(base * (1 + i * 0.52) * bend, now + i * 0.08);
    osc.frequency.linearRampToValueAtTime(base * (0.92 + i * 0.48), now + len - i * 0.12);
    g.gain.setValueAtTime(0.001, now + i * 0.08);
    g.gain.exponentialRampToValueAtTime(0.09 / (i + 1), now + 0.28 + i * 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, now + len);
    osc.connect(g).connect(bus);
    osc.start(now + i * 0.08);
    osc.stop(now + len);
  }

  const noiseLen = 0.42;
  const buf = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * noiseLen)), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const gate = Math.sin(t * Math.PI);
    d[i] = (Math.random() * 2 - 1) * gate * (0.12 + 0.08 * Math.sin(i * 0.021 + seed));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const hp = ac.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.value = 740;
  hp.Q.value = 1.8;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.001, now + 0.55);
  g.gain.exponentialRampToValueAtTime(0.045 * intensity, now + 0.66);
  g.gain.exponentialRampToValueAtTime(0.001, now + 1.12);
  src.connect(hp).connect(g).connect(bus);
  src.start(now + 0.55);
}

const HUD_BAR_BASE_HZ: Record<HudBarAudioId, number> = {
  hp: 170,
  psi: 720,
  food: 260,
  water: 390,
  sleep: 510,
  toilet: 300,
  xp: 880,
};

export function playHudBarChange(bar: HudBarAudioId, direction: 'up' | 'down', intensity = 1): void {
  const ac = beginCue('hud_bar_change');
  if (!ac) return;
  const base = HUD_BAR_BASE_HZ[bar] ?? 420;
  const now = ac.currentTime;
  const len = direction === 'up' ? 0.13 : 0.16;
  const amount = Math.max(0.35, Math.min(1.25, intensity));
  const osc = ac.createOscillator();
  const g = ac.createGain();
  const filter = ac.createBiquadFilter();
  osc.type = bar === 'psi' || bar === 'xp' ? 'sine' : 'triangle';
  filter.type = bar === 'hp' || direction === 'down' ? 'lowpass' : 'bandpass';
  filter.frequency.value = direction === 'down' ? Math.max(220, base * 1.6) : Math.max(500, base * 2.2);
  filter.Q.value = 0.7;
  if (direction === 'up') {
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 1.42, now + len);
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.034 * amount, now + 0.025);
  } else {
    osc.frequency.setValueAtTime(base * 1.12, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(55, base * 0.68), now + len);
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.026 * amount, now + 0.02);
  }
  g.gain.exponentialRampToValueAtTime(0.001, now + len);
  osc.connect(filter).connect(g).connect(gain());
  osc.start(now);
  osc.stop(now + len + 0.01);
}

/* ── Pickup ding ─────────────────────────────────────────────── */
export function playPickup(): void {
  const ac = ensureContext();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(900, ac.currentTime + 0.08);
  g.gain.setValueAtTime(0.12, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15);
  osc.connect(g).connect(gain());
  osc.start(); osc.stop(ac.currentTime + 0.15);
}

/* ── Gunshot: sharp percussive bang ───────────────────────────── */
export function playGunshot(): void {
  const ac = beginCue('player_weapon');
  if (!ac) return;
  const len = 0.2;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.exp(-t * 20);
    d[i] = ((Math.random() * 2 - 1) * 0.8 + Math.sin(i * 0.05) * 0.3) * env;
    d[i] = Math.max(-1, Math.min(1, d[i] * 1.5));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.25;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3000;
  src.connect(lp).connect(g).connect(gain());
  src.start();
}

/* ── Hostile shot: sharper incoming crack, distinct from player ─ */
export function playHostileGunshot(): void {
  const ac = beginCue('hostile_ranged');
  if (!ac) return;
  const len = 0.16;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.exp(-t * 28);
    d[i] = ((Math.random() * 2 - 1) * 0.7 + Math.sin(i * 0.11) * 0.45) * env;
    d[i] = Math.max(-1, Math.min(1, d[i] * 1.7));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.2;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2600;
  bp.Q.value = 0.9;
  src.connect(bp).connect(g).connect(gain());
  src.start();
}

/* ── Shotgun: heavy boom ─────────────────────────────────────── */
export function playShotgun(): void {
  const ac = beginCue('player_weapon');
  if (!ac) return;
  const len = 0.35;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.exp(-t * 12);
    d[i] = (Math.random() * 2 - 1) * env;
    d[i] += Math.sin(i * 0.015) * 0.4 * env;
    d[i] = Math.max(-1, Math.min(1, d[i] * 2));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.3;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1500;
  src.connect(lp).connect(g).connect(gain());
  src.start();
}

/* ── Hostile shotgun: dry double slap with less low-end weight ── */
export function playHostileShotgun(): void {
  const ac = beginCue('hostile_ranged');
  if (!ac) return;
  const len = 0.28;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.exp(-t * 15);
    const slap = Math.sin(i * 0.06) * 0.35 + Math.sin(i * 0.023) * 0.28;
    d[i] = ((Math.random() * 2 - 1) * 0.75 + slap) * env;
    d[i] = Math.max(-1, Math.min(1, d[i] * 1.8));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.24;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1250;
  bp.Q.value = 0.7;
  src.connect(bp).connect(g).connect(gain());
  src.start();
}

/* ── Nailgun: rapid metallic clack ───────────────────────────── */
export function playNailgun(): void {
  const ac = beginCue('player_weapon');
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(800 + Math.random() * 200, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(200, ac.currentTime + 0.04);
  g.gain.setValueAtTime(0.15, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.06);
  osc.connect(g).connect(gain());
  osc.start(); osc.stop(ac.currentTime + 0.06);
}

/* ── Hostile nailgun: brittle high metal tick ────────────────── */
export function playHostileNailgun(): void {
  const ac = beginCue('hostile_ranged');
  if (!ac) return;
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1150 + Math.random() * 240, now);
  osc.frequency.exponentialRampToValueAtTime(260, now + 0.055);
  g.gain.setValueAtTime(0.13, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 520;
  osc.connect(hp).connect(g).connect(gain());
  osc.start();
  osc.stop(now + 0.07);
}

/* ── Projectile impact: short concrete/metal tick ────────────── */
export function playProjectileImpact(): void {
  const ac = beginCue('projectile_impact');
  if (!ac) return;
  const len = 0.11;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.exp(-t * 42);
    const ping = Math.sin(i * 0.33 + Math.sin(i * 0.017) * 0.9) * 0.38;
    d[i] = ((Math.random() * 2 - 1) * 0.52 + ping) * env;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.13;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 950;
  src.connect(hp).connect(g).connect(gain());
  src.start();
}

/* ── Energy/PSI impact: compact zap plus psychic after-ring ───── */
export function playEnergyImpact(): void {
  const ac = beginCue('energy_impact');
  if (!ac) return;
  const len = 0.2;
  const now = ac.currentTime;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.exp(-t * 14);
    const warp = Math.sin(i * 0.018) * 2.7;
    d[i] = Math.sin(i * 0.16 + warp) * 0.34 * env;
    d[i] += Math.sin(i * 0.047 + warp * 0.4) * 0.18 * env;
    d[i] += (Math.random() * 2 - 1) * 0.24 * env;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.15;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1360;
  bp.Q.value = 1.7;
  const bus = ac.createGain();
  bus.connect(gain());
  src.connect(bp).connect(g).connect(bus);
  src.start(now);

  const ring = ac.createOscillator();
  const rg = ac.createGain();
  ring.type = 'triangle';
  ring.frequency.setValueAtTime(620 + Math.random() * 90, now);
  ring.frequency.exponentialRampToValueAtTime(180, now + 0.22);
  rg.gain.setValueAtTime(0.06, now + 0.02);
  rg.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
  ring.connect(rg).connect(bus);
  ring.start(now + 0.02);
  ring.stop(now + 0.24);
}

/* ── Weapon break: crunch ────────────────────────────────────── */
export function playBreak(): void {
  const ac = beginCue('break');
  if (!ac) return;
  const len = 0.25;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    d[i] = (Math.random() * 2 - 1) * (1 - t) * 0.4;
    d[i] += Math.sin(i * 0.02 + Math.sin(i * 0.005) * 3) * 0.3 * (1 - t);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.2;
  src.connect(g).connect(gain());
  src.start();
}

/* ── Fleshy damage hit: wet organic impact ───────────────────── */
export function playFleshHit(): void {
  const ac = beginCue('flesh_hit');
  if (!ac) return;
  const len = 0.35;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.exp(-t * 8);
    // Low wet thump + squelchy noise
    d[i] = Math.sin(i * 0.008 + Math.sin(i * 0.003) * 4) * 0.5 * env;
    d[i] += (Math.random() * 2 - 1) * 0.3 * env * (1 - t);
    d[i] += Math.sin(i * 0.025) * 0.2 * env; // sub bass
    d[i] = Math.max(-0.8, Math.min(0.8, d[i] * 1.5));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.25;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2000;
  src.connect(lp).connect(g).connect(gain());
  src.start();
}

/* ── Projectile body hit: readable but lighter than melee gore ── */
export function playProjectileBodyHit(): void {
  const ac = beginCue('flesh_hit');
  if (!ac) return;
  const len = 0.16;
  const buf = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * len)), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.exp(-t * 18);
    d[i] = Math.sin(i * 0.018 + Math.sin(i * 0.004) * 2.4) * 0.28 * env;
    d[i] += (Math.random() * 2 - 1) * 0.38 * env;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.14;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 720;
  bp.Q.value = 0.7;
  src.connect(bp).connect(g).connect(gain());
  src.start();
}

/* ── PSI cast: eerie ethereal whoosh ─────────────────────────── */
export function playPsiCast(): void {
  const ac = beginCue('psi_cast');
  if (!ac) return;
  const len = 0.4;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.sin(t * Math.PI) * Math.exp(-t * 3);
    // Eerie sweep: rising sine + phase modulation
    const phase = i * 0.006 * (1 + t * 2);
    d[i] = Math.sin(phase + Math.sin(i * 0.002) * 3) * 0.4 * env;
    d[i] += Math.sin(i * 0.015 + Math.sin(i * 0.008) * 2) * 0.2 * env;
    d[i] += (Math.random() * 2 - 1) * 0.1 * env * (1 - t);
    d[i] = Math.max(-0.7, Math.min(0.7, d[i]));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.3;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 800;
  bp.Q.value = 1.5;
  src.connect(bp).connect(g).connect(gain());
  src.start();
}

/* ── Hostile PSI cast: thinner warning shriek before impact ───── */
export function playHostilePsiCast(): void {
  const ac = beginCue('hostile_ranged');
  if (!ac) return;
  const now = ac.currentTime;
  const len = 0.32;
  const buf = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * len)), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.sin(t * Math.PI) * Math.exp(-t * 2.7);
    const sweep = 0.012 + t * 0.012;
    d[i] = Math.sin(i * sweep + Math.sin(i * 0.004) * 3.2) * 0.42 * env;
    d[i] += (Math.random() * 2 - 1) * 0.16 * env;
    d[i] = Math.max(-0.8, Math.min(0.8, d[i]));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.22;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1250;
  bp.Q.value = 1.9;
  src.connect(bp).connect(g).connect(gain());
  src.start(now);
}

/* ── Eye bolt launch: short green glass chirp, no siren masking ─ */
export function playHostileEyeShot(): void {
  const ac = beginCue('hostile_ranged');
  if (!ac) return;
  const now = ac.currentTime;
  const bus = ac.createGain();
  bus.gain.setValueAtTime(0.001, now);
  bus.gain.exponentialRampToValueAtTime(0.12, now + 0.025);
  bus.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
  bus.connect(gain());

  const chirp = ac.createOscillator();
  chirp.type = 'triangle';
  chirp.frequency.setValueAtTime(980 + Math.random() * 90, now);
  chirp.frequency.exponentialRampToValueAtTime(360, now + 0.18);
  chirp.connect(bus);
  chirp.start(now);
  chirp.stop(now + 0.19);
}

/* ── Paragraph bolt launch: paper snap plus stamped psychic hiss ─ */
export function playHostileParagraphShot(): void {
  const ac = beginCue('hostile_ranged');
  if (!ac) return;
  const now = ac.currentTime;
  const len = 0.18;
  const buf = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * len)), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.exp(-t * 12);
    const crackle = Math.sin(i * 0.071) * 0.25 + Math.sin(i * 0.019) * 0.22;
    d[i] = ((Math.random() * 2 - 1) * 0.34 + crackle) * env;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.13;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1580;
  bp.Q.value = 1.4;
  src.connect(bp).connect(g).connect(gain());
  src.start(now);
}

/* ── Hostile energy shot: electrical snap before red/orange bolts ─ */
export function playHostileEnergyShot(): void {
  const ac = beginCue('hostile_ranged');
  if (!ac) return;
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(1850 + Math.random() * 420, now);
  osc.frequency.exponentialRampToValueAtTime(420, now + 0.11);
  g.gain.setValueAtTime(0.12, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1750;
  bp.Q.value = 1.2;
  osc.connect(bp).connect(g).connect(gain());
  osc.start(now);
  osc.stop(now + 0.13);
}

/* ── Ambient drone (looping) ─────────────────────────────────── */
let droneOsc: OscillatorNode | null = null;
let droneSecondOsc: OscillatorNode | null = null;
let droneGain: GainNode | null = null;
let droneFilter: BiquadFilterNode | null = null;
let droneMode: AmbientDroneMode = 'normal';

function applyAmbientDroneMode(ac: AudioContext, mode: AmbientDroneMode, immediate = false): void {
  if (!droneOsc || !droneSecondOsc || !droneGain || !droneFilter) return;
  const setting = AMBIENT_DRONE_SETTINGS[mode];
  const now = ac.currentTime;
  const tau = immediate ? 0.01 : 0.9;
  if (immediate) {
    droneOsc.frequency.value = setting.primaryHz;
    droneOsc.detune.value = setting.detuneCents;
    droneSecondOsc.frequency.value = setting.secondaryHz;
    droneSecondOsc.detune.value = -setting.detuneCents * 0.5;
    droneGain.gain.value = setting.gain;
    droneFilter.frequency.value = setting.cutoffHz;
    return;
  }
  droneOsc.frequency.setTargetAtTime(setting.primaryHz, now, tau);
  droneOsc.detune.setTargetAtTime(setting.detuneCents, now, tau);
  droneSecondOsc.frequency.setTargetAtTime(setting.secondaryHz, now, tau);
  droneSecondOsc.detune.setTargetAtTime(-setting.detuneCents * 0.5, now, tau);
  droneGain.gain.setTargetAtTime(setting.gain, now, immediate ? 0.02 : 1.2);
  droneFilter.frequency.setTargetAtTime(setting.cutoffHz, now, tau);
}

export function startAmbientDrone(): void {
  if (!hasAudioContext()) return;
  const ac = ensureContext();
  if (droneOsc) return;
  droneOsc = ac.createOscillator();
  droneSecondOsc = ac.createOscillator();
  droneGain = ac.createGain();
  droneFilter = ac.createBiquadFilter();
  droneOsc.type = 'sawtooth';
  droneSecondOsc.type = 'triangle';
  droneFilter.type = 'lowpass';
  droneOsc.connect(droneFilter);
  droneSecondOsc.connect(droneFilter);
  droneFilter.connect(droneGain).connect(gain());
  applyAmbientDroneMode(ac, droneMode, true);
  droneOsc.start();
  droneSecondOsc.start();
}

export function setAmbientDroneMode(mode: AmbientDroneMode): void {
  droneMode = mode;
  if (!droneOsc || !hasAudioContext()) return;
  applyAmbientDroneMode(ensureContext(), mode);
}

/* ── PPSh: rapid buzzing rattle ──────────────────────────────── */
export function playPPSh(): void {
  const ac = beginCue('player_weapon');
  if (!ac) return;
  const len = 0.06;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.exp(-t * 30);
    d[i] = ((Math.random() * 2 - 1) * 0.6 + Math.sin(i * 0.08) * 0.4) * env;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.18;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4000;
  src.connect(lp).connect(g).connect(gain());
  src.start();
}

/* ── Chainsaw: grinding buzz ─────────────────────────────────── */
export function playChainsaw(): void {
  const ac = beginCue('melee_attack');
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(120 + Math.random() * 40, ac.currentTime);
  osc.frequency.linearRampToValueAtTime(80, ac.currentTime + 0.15);
  g.gain.setValueAtTime(0.2, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.2);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;
  osc.connect(lp).connect(g).connect(gain());
  osc.start(); osc.stop(ac.currentTime + 0.2);
}

/* ── Machinegun: heavy rapid banging ──────────────────────────── */
export function playMachinegun(): void {
  const ac = beginCue('player_weapon');
  if (!ac) return;
  const len = 0.08;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.exp(-t * 25);
    d[i] = (Math.random() * 2 - 1) * env;
    d[i] += Math.sin(i * 0.03) * 0.5 * env;
    d[i] = Math.max(-1, Math.min(1, d[i] * 1.8));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.22;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2500;
  src.connect(lp).connect(g).connect(gain());
  src.start();
}

/* ── Grenade explosion: deep rumbling boom ────────────────────── */
export function playExplosion(): void {
  const ac = beginCue('projectile_impact');
  if (!ac) return;
  const len = 0.6;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) * 5);
    d[i] = (Math.random() * 2 - 1) * env;
    d[i] += Math.sin(i * 0.008) * 0.6 * env;
    d[i] += Math.sin(i * 0.003 + Math.sin(i * 0.001) * 3) * 0.4 * env;
    d[i] = Math.max(-1, Math.min(1, d[i] * 2.5));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.35;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 800;
  src.connect(lp).connect(g).connect(gain());
  src.start();
}

/* ── Gauss: electric whip crack ──────────────────────────────── */
export function playGauss(): void {
  const ac = beginCue('player_weapon');
  if (!ac) return;
  const len = 0.3;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = t < 0.02 ? 1 : Math.exp(-(t - 0.02) * 15);
    d[i] = Math.sin(i * 0.1 * (1 + t * 3)) * 0.6 * env;
    d[i] += (Math.random() * 2 - 1) * 0.3 * env;
    d[i] = Math.max(-1, Math.min(1, d[i] * 2));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.3;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1000;
  src.connect(hp).connect(g).connect(gain());
  src.start();
}

/* ── Plasma: electronic zap ──────────────────────────────────── */
export function playPlasma(): void {
  const ac = beginCue('player_weapon');
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(2000 + Math.random() * 500, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(300, ac.currentTime + 0.1);
  g.gain.setValueAtTime(0.15, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.12);
  osc.connect(g).connect(gain());
  osc.start(); osc.stop(ac.currentTime + 0.12);
}

/* ── BFG: deep resonant charge + release ─────────────────────── */
export function playBFG(): void {
  const ac = beginCue('player_weapon');
  if (!ac) return;
  const len = 0.8;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.sin(t * Math.PI) * (t < 0.3 ? t / 0.3 : 1);
    d[i] = Math.sin(i * 0.006 + Math.sin(i * 0.002) * 5) * 0.5 * env;
    d[i] += Math.sin(i * 0.015) * 0.3 * env;
    d[i] += (Math.random() * 2 - 1) * 0.2 * env;
    d[i] = Math.max(-0.9, Math.min(0.9, d[i] * 1.5));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.35;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 200;
  bp.Q.value = 2;
  src.connect(bp).connect(g).connect(gain());
  src.start();
}

/* ── Flamethrower: roaring whoosh ─────────────────────────────── */
export function playFlame(): void {
  const ac = beginCue('flame');
  if (!ac) return;
  const len = 0.1;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = 1 - t * 0.5;
    d[i] = (Math.random() * 2 - 1) * env * 0.4;
    d[i] += Math.sin(i * 0.02 + Math.random() * 0.5) * 0.3 * env;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.15;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 400;
  bp.Q.value = 0.5;
  src.connect(bp).connect(g).connect(gain());
  src.start();
}

/* ── Hostile flame: shorter warning cough in the low band ─────── */
export function playHostileFlame(): void {
  const ac = beginCue('hostile_ranged');
  if (!ac) return;
  const len = 0.13;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.exp(-t * 7);
    d[i] = (Math.random() * 2 - 1) * env * 0.45;
    d[i] += Math.sin(i * 0.014 + Math.random() * 0.7) * 0.34 * env;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.14;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 310;
  bp.Q.value = 0.65;
  src.connect(bp).connect(g).connect(gain());
  src.start();
}

export function playFogSharkHiss(): void {
  const ac = beginCue('monster_growl');
  if (!ac) return;
  const len = 0.36;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.sin(t * Math.PI) * (1 - t * 0.25);
    d[i] = (Math.random() * 2 - 1) * env * 0.32 + Math.sin(i * 0.029) * env * 0.12;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.12;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 520;
  src.connect(hp).connect(g).connect(gain());
  src.start();
}

export function playFogSharkBite(): void {
  const ac = beginCue('melee_attack');
  if (!ac) return;
  const len = 0.09;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.exp(-t * 13);
    d[i] = (Math.random() * 2 - 1) * env * 0.42 + Math.sin(i * 0.18) * env * 0.24;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.16;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 930;
  bp.Q.value = 1.4;
  src.connect(bp).connect(g).connect(gain());
  src.start();
}

/* ── PSI Beam: continuous howling energy ──────────────────────── */
export function playPsiBeam(): void {
  const ac = beginCue('psi_cast');
  if (!ac) return;
  const len = 0.15;
  const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.sin(t * Math.PI);
    d[i] = Math.sin(i * 0.01 + Math.sin(i * 0.004) * 4) * 0.5 * env;
    d[i] += Math.sin(i * 0.025) * 0.2 * env;
    d[i] += (Math.random() * 2 - 1) * 0.15 * env;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.25;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 600;
  bp.Q.value = 2;
  src.connect(bp).connect(g).connect(gain());
  src.start();
}
