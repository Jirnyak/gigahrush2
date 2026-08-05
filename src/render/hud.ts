import { drawArenaOverlay } from './arenaui';
import { isArenaOverlayOpen, getArenaOverlaySnapshot } from '../systems/arena';
/* ── HUD overlay: needs bars, minimap, messages, inventory ───── */

import { SCR_W, SCR_H } from './webgl';
import {
  W, type Entity, type GameState, EntityType, FloorLevel, Tex,
  ZoneFaction,
} from '../core/types';
import { World } from '../core/world';
import { ITEMS } from '../data/catalog';
import { getEquippedToolDurability, getWeaponReadiness, type WeaponReadiness } from '../systems/inventory';
import { getPlayerHazardWarning } from '../systems/cell_hazards';
import { controlHint, menuCloseHint } from '../systems/controls';
import { formatLastPlayerDamageCause } from '../systems/damage';
import { RPG_LEVEL_CAP, xpForLevel } from '../systems/rpg';
import { zhelemishHudLine } from '../systems/status';
import { drawDebugOverlay } from '../systems/debug';
import { ZONE_COLORS, drawMinimap, drawFullMap, drawMapLegendMenu } from './map_ui';
import { drawInventory } from './stats_ui';
import { drawQuestLog } from './quest_ui';
import { drawLogMenu } from './log_ui';
import { drawFactionMenu } from './factions_ui';
import { drawDemosMenu } from './demos_ui';
import { drawGameMenu } from './menu_ui';
import { drawFeedbackMenu } from './feedback_ui';
import { drawControlsMenu } from './controls_ui';
import { drawHelpMenu } from './help_ui';
import { drawUiSettingsMenu } from './ui_settings_ui';
import { drawNpcMenu } from './npc_ui';
import { drawContainerMenu } from './container_ui';
import { drawCraftMenu } from './craft_ui';
import { drawEmergencyPanelMenu } from './emergency_panel_ui';
import { drawComputerOverlay } from './computer_ui';
import { drawGamblingOverlay } from './gambling_ui';
import { drawNetSphereMenu } from './net_sphere_ui';
import { drawNetHackOverlay } from './net_hack_ui';
import { drawFastElevatorOverlay } from './fast_elevator_ui';
import { drawNetTerminalBank } from './net_terminal_bank_ui';
import { drawNetTerminalGenDenied } from './net_terminal_gen_ui';
import { drawMapEditor } from './map_editor_ui';
import { entityDisplayName } from '../entities/monster';
import { isHostile } from '../systems/factions';
import { territoryOwnerAtIndex } from '../systems/territory';
import { getNpcPlayerRelation } from '../systems/npc_relations';
import {
  getSamosborActiveInstructionSnapshot,
  getSamosborWarningSnapshot,
  type SamosborActiveInstructionSnapshot,
  type SamosborWarningSnapshot,
} from '../systems/samosbor';
import { currentFloorInstanceLabel } from '../systems/floor_instances';
import { getLiftArachnaWarningSnapshot, type LiftArachnaWarningSnapshot } from '../systems/lift_arachna';
import {
  getProceduralSmogStatus,
  type ProceduralSmogStatus,
} from '../systems/procedural_anomalies';
import {
  currentFloorRunEntry,
  formatFloorZ,
  type FloorRunEntry,
} from '../systems/procedural_floors';
import { getActiveRouteCueHud, getObjectiveRouteHud, type ObjectiveRouteHud, type RouteCueHud } from '../systems/route_cues';
import { getNearestSmallCaravan, type SmallCaravanHudSnapshot } from '../systems/caravans';
import { getSeroburmalineHudFx } from '../systems/seroburmaline';
import { ENTITY_MASK_ACTOR, ENTITY_MASK_PROJECTILE, getEntityIndex } from '../systems/entity_index';
import { getNetSphereSnapshot, isNetSphereOpen } from '../systems/net_sphere';
import {
  getNetTerminalBankSnapshot,
  getNetTerminalGenRuntimeSnapshot,
  getNetTerminalGenTerminals,
  isNetTerminalBankOpen,
  isNetTerminalGenDeniedOpen,
  isNetTerminalGenOpen,
} from '../systems/net_terminal_gen';
import { getComputerOverlaySnapshot, isComputerOverlayOpen } from '../systems/computers';
import { getGamblingOverlaySnapshot, isGamblingOverlayOpen } from '../systems/gambling';
import { findInteractionTarget } from '../systems/interactions';
import { getCurrentObjective, npcQuestMarkerState, type CurrentObjective, type NpcQuestMarkerTone } from '../systems/quests';
import { getNetHackOverlaySnapshot, isNetHackOverlayOpen } from '../systems/net_hack';
import { getFastElevatorOverlaySnapshot, isFastElevatorOverlayOpen } from '../systems/fast_elevator';
import { getMapEditorSnapshot, isMapEditorOpen } from '../systems/map_editor';
import { isEmergencyPanelMenuOpen } from '../systems/emergency_panels';
import {
  textJitter, flicker, drawHoloBar, drawGlitchText,
  drawNeuroPanel, drawGlitchLine, drawStaticNoise, drawVeretarVeil, drawRouteCueWave, drawMaronaryProofNoise, drawSmogVeil,
  drawSeroburmalineNoLookFx,
} from './hud_fx';
import { fitTextStable as fitUiText, setUiTextTime } from './ui_text';
import { allocateHudSlot, createHudSlots, getMobileHudSafeContext, type UiRect } from './ui_layout';
import { autoPickupEnabled, cameraPlaneLen, hudMotionMode, screenInterferenceMode, uiElementEnabled } from '../systems/ui_orchestrator';
import { titleLanguageDef } from '../data/languages';
import { getLocalizationLanguage } from '../systems/localization';

const BAR_W = 50, BAR_H = 4;
const VITAL_LABEL_FONT = 6;
const VITAL_PERCENT_FONT = 5.2;
const NEEDS_PANEL_H = 20;
const COMBAT_TARGET_SCAN_CAP = 160;
const COMBAT_TARGET_QUERY_CAP = COMBAT_TARGET_SCAN_CAP * 2;
const COMBAT_TARGET_MAX_D2 = 18 * 18;
const COMBAT_TARGET_BODY_RADIUS = 0.3;
const COMBAT_TARGET_RAY_STEP_CAP = 48;
const DEATH_NEARBY_QUERY_CAP = 96;
const aimTargetQuery: Entity[] = [];
const deathNearbyQuery: Entity[] = [];

function toPercent(current: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, current / max * 100));
}

function formatVitalPercent(pct: number): string {
  if (!Number.isFinite(pct)) return '0%';
  return `${Math.round(Math.max(0, Math.min(100, pct)))}%`;
}

function routineJitter(reducedMotion: boolean, time: number, seed: number): { dx: number; dy: number } {
  return reducedMotion ? { dx: 0, dy: 0 } : textJitter(time, seed);
}

function drawRoutineHudText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  time: number,
  seed: number,
  color: string,
  fontSize: number,
  reducedMotion: boolean,
): void {
  if (!reducedMotion) {
    drawGlitchText(ctx, text, x, y, time, seed, color, fontSize);
    return;
  }
  ctx.save();
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px monospace`;
  ctx.fillText(text, x, y);
  ctx.restore();
}

const ZONE_FACTION_NAMES: Record<ZoneFaction, string> = {
  [ZoneFaction.CITIZEN]: 'Граждане',
  [ZoneFaction.LIQUIDATOR]: 'Ликвидаторы',
  [ZoneFaction.CULTIST]: 'Культисты',
  [ZoneFaction.SAMOSBOR]: 'Самосбор',
  [ZoneFaction.WILD]: 'Дикие',
  [ZoneFaction.SCIENTIST]: 'Учёные',
};
const MSG_MAX = 12;
const MSG_SCAN_MAX = 32;
const HUD_MESSAGE_TTL_SECONDS = 8;
const HUD_MESSAGE_FADE_START_SECONDS = 6;
const HUD_MINIMAP_UNITS = 68;
const HUD_SUMMARY_MAX_LINES_PER_MSG = 3;

export interface HudPerfDebugSnapshot {
  fps?: number;
  frameMsAvg?: number;
  frameMsMax?: number;
  simMs?: number;
  needsMs?: number;
  contentMs?: number;
  aiMs?: number;
  hazardMs?: number;
  samosborMs?: number;
  factionMs?: number;
  bloodMs?: number;
  cleanupMs?: number;
  renderMs?: number;
  hudMs?: number;
  liveAi?: number;
  visibleSprites?: number;
  drawnSprites?: number;
  visibleEntityQueryResults?: number;
  aiUpdated?: number;
  aiSkipped?: number;
}

export function hudMessageAgeSeconds(messageTime: number, gameTime: number): number {
  if (!Number.isFinite(messageTime) || !Number.isFinite(gameTime)) return Number.POSITIVE_INFINITY;
  return Math.max(0, gameTime - messageTime);
}

export function hudMessageVisible(messageTime: number, gameTime: number, ttlSeconds = HUD_MESSAGE_TTL_SECONDS): boolean {
  return hudMessageAgeSeconds(messageTime, gameTime) <= ttlSeconds;
}

declare global {
  interface Window {
    __gigahrushLastHudLayout?: {
      canvasW: number;
      canvasH: number;
      safe: UiRect;
      bottomVitals: UiRect;
      centerInteraction: UiRect;
    };
  }
}

interface VoidReturnPortalHudState {
  active?: boolean;
  used?: boolean;
  cell?: number;
  playerMustLeaveCell?: boolean;
  voidSpikeCarried?: boolean;
  voidSpikeResolved?: boolean;
}

function voidReturnPortalHudState(state: GameState): VoidReturnPortalHudState | undefined {
  const portal = (state as GameState & { voidReturnPortal?: VoidReturnPortalHudState }).voidReturnPortal;
  if (!portal?.active || portal.used || typeof portal.cell !== 'number') return undefined;
  if (portal.cell < 0 || portal.cell >= W * W) return undefined;
  return portal;
}

function voidReturnVictoryLine(state: GameState): string {
  const portal = (state as GameState & { voidReturnPortal?: VoidReturnPortalHudState }).voidReturnPortal;
  if (portal?.voidSpikeResolved) return 'ЗАДАЧА ЗАКРЫТА. Шип оставлен.';
  if (portal?.voidSpikeCarried) return 'ЗАДАЧА ЗАКРЫТА. Шип вынесен.';
  return 'ЗАДАЧА ЗАКРЫТА. Выход открыт.';
}

function drawVoidReturnPortalHint(
  ctx: CanvasRenderingContext2D,
  rect: UiRect,
  sx: number,
  sy: number,
  time: number,
  player: Entity,
  state: GameState,
  world: World,
): void {
  if (state.currentFloor !== FloorLevel.VOID || state.samosborActive) return;
  const portal = voidReturnPortalHudState(state);
  if (!portal || world.floorTex[portal.cell!] !== Tex.PORTAL) return;

  const px = (portal.cell! % W) + 0.5;
  const py = ((portal.cell! / W) | 0) + 0.5;
  const dx = world.delta(player.x, px);
  const dy = world.delta(player.y, py);
  const dist = Math.max(0, Math.round(Math.sqrt(dx * dx + dy * dy)));
  const consequence = portal.playerMustLeaveCell
    ? 'выйти и войти снова'
    : portal.voidSpikeResolved
      ? 'шип оставлен'
      : portal.voidSpikeCarried
        ? 'шип унесён'
        : 'встаньте в центр для выхода';
  const panelW = Math.min(rect.w, 196 * sx);
  const panelH = 28 * sy;
  const x = rect.x + (rect.w - panelW) * 0.5;
  const y = rect.y;

  ctx.save();
  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 988);
  ctx.textAlign = 'center';
  ctx.shadowColor = '#0f8';
  ctx.shadowBlur = 7;
  drawGlitchText(ctx, 'ВЫХОД ДОМОЙ', x + panelW * 0.5, y + 4 * sy, time * 1.7, 989, '#0f8', 9 * sy);
  ctx.shadowBlur = 0;
  drawGlitchText(ctx, fitHudText(ctx, `центр ${dist}м / ${consequence}`, panelW - 12 * sx), x + panelW * 0.5, y + 17 * sy, time, 990, '#cfe', 7 * sy);
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawSamosborActiveInstruction(
  ctx: CanvasRenderingContext2D,
  w: number,
  sx: number,
  sy: number,
  time: number,
  active: SamosborActiveInstructionSnapshot,
  y: number,
  _compact = false,
): void {
  const title = `${samosborHudTitle(active.variantId, active.variantName)}: ${active.secondsLeft}s`;
  const sj = textJitter(time * 3, 666);
  const sAlpha = 0.5 + Math.sin(time * 8) * 0.3;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = active.tint;
  ctx.font = `bold ${16 * sy}px monospace`;
  const fittedTitle = fitHudText(ctx, title, w - 16 * sx);
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillText(fittedTitle, w * 0.5 + sj.dx * 3 + 1, y + 8 * sy + sj.dy * 2 + 1);
  ctx.fillStyle = active.tint;
  ctx.fillText(fittedTitle, w * 0.5 + sj.dx * 3, y + 8 * sy + sj.dy * 2);
  ctx.fillStyle = `rgba(0,255,200,${sAlpha * 0.2})`;
  ctx.fillText(fittedTitle, w * 0.5 + sj.dx * 3 + 2, y + 8 * sy + sj.dy * 2 + 1);
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawSamosborWarningInstruction(
  ctx: CanvasRenderingContext2D,
  w: number,
  sx: number,
  sy: number,
  time: number,
  warning: SamosborWarningSnapshot,
  y: number,
  compact = false,
): void {
  const title = 'ВНИМАНИЕ';
  const detail = `через ${warning.secondsLeft} секунд объявляется самосбор`;
  const sj = textJitter(time * 2.4, 641);
  const titleSize = (compact ? 14 : 16) * sy;
  const detailSize = (compact ? 6.4 : 7) * sy;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `bold ${titleSize}px monospace`;
  const fittedTitle = fitHudText(ctx, title, w - 16 * sx);
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillText(fittedTitle, w * 0.5 + sj.dx * 2.2 + 1, y + 8 * sy + sj.dy * 1.4 + 1);
  ctx.fillStyle = '#ff3030';
  ctx.fillText(fittedTitle, w * 0.5 + sj.dx * 2.2, y + 8 * sy + sj.dy * 1.4);

  ctx.font = `${detailSize}px monospace`;
  const fittedDetail = fitHudText(ctx, detail, w - 18 * sx);
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillText(fittedDetail, w * 0.5 + 1, y + 22 * sy + 1);
  ctx.fillStyle = '#ff6b6b';
  ctx.fillText(fittedDetail, w * 0.5, y + 22 * sy);
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawLiftArachnaWarning(
  ctx: CanvasRenderingContext2D,
  w: number,
  sx: number,
  sy: number,
  time: number,
  warning: LiftArachnaWarningSnapshot,
  y: number,
): void {
  const panelW = Math.min(w - 12 * sx, 210 * sx);
  const panelH = 32 * sy;
  const x = (w - panelW) * 0.5;
  const tint = warning.baited ? '#f44' : warning.secondWarning ? '#f4a' : '#fa0';
  const title = warning.baited
    ? `АРАХНА ПАДАЕТ: ${warning.secondsLeft}s`
    : `ШАХТА НАД ЛИФТОМ: ${warning.secondsLeft}s`;
  const action = warning.baited
    ? 'Отойдите от лифта. Цель сбита шумом.'
    : warning.secondWarning
      ? 'Смотрите вверх или уходите от шахты.'
      : 'Скрежет сверху. Проверьте потолок.';
  const zone = warning.zoneId >= 0 ? `Зона ${warning.zoneId + 1}` : 'Лифтовой узел';

  ctx.save();
  ctx.fillStyle = 'rgba(22,8,8,0.84)';
  ctx.fillRect(x, y, panelW, panelH);
  ctx.strokeStyle = tint;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, panelW - 1, panelH - 1);
  drawStaticNoise(ctx, x, y, panelW, panelH, time, 0.022);

  ctx.textAlign = 'center';
  ctx.shadowColor = tint;
  ctx.shadowBlur = 8;
  drawGlitchText(ctx, title, w * 0.5, y + 5 * sy, time * 2.3, 812, tint, 10 * sy);
  ctx.shadowBlur = 0;
  drawGlitchText(ctx, fitHudText(ctx, `${zone} / ${action}`, panelW - 12 * sx), w * 0.5, y + 20 * sy, time, 813, '#ddd', 7 * sy);
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawSmogIndicator(
  ctx: CanvasRenderingContext2D,
  rect: UiRect,
  sx: number,
  sy: number,
  time: number,
  status: ProceduralSmogStatus,
): void {
  const panelW = Math.min(rect.w, 154 * sx);
  const panelH = 30 * sy;
  const x = rect.x + rect.w - panelW;
  const y = rect.y;
  const title = status.handled
    ? 'СМОГ: ИСТОЧНИК ЗАКРЫТ'
    : status.sourceDistance <= 7
      ? 'ИСТОЧНИК СМОГА'
      : `СМОГ ${Math.round(status.intensity * 100)}%`;
  const action = status.prompt || 'обходите плотные комнаты';

  ctx.save();
  ctx.fillStyle = 'rgba(24,20,14,0.78)';
  ctx.fillRect(x, y, panelW, panelH);
  ctx.strokeStyle = status.handled ? '#8cf' : '#b98';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, panelW - 1, panelH - 1);
  drawStaticNoise(ctx, x, y, panelW, panelH, time, status.handled ? 0.008 : 0.018);
  ctx.font = `${8 * sy}px monospace`;
  ctx.fillStyle = status.handled ? '#8cf' : '#d8b56a';
  ctx.fillText(fitHudText(ctx, title, panelW - 12 * sx), x + 6 * sx, y + 5 * sy);
  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = '#d7d0bd';
  ctx.fillText(fitHudText(ctx, action, panelW - 12 * sx), x + 6 * sx, y + 17 * sy);
  ctx.restore();
}

function drawRouteCueHint(
  ctx: CanvasRenderingContext2D,
  rect: UiRect,
  sx: number,
  sy: number,
  animationTime: number,
  gameTime: number,
  player: Entity,
  world: World,
  cue: RouteCueHud,
): void {
  const panelW = Math.min(rect.w, 176 * sx);
  const panelH = 35 * sy;
  const x = rect.x + rect.w - panelW;
  const y = rect.y;
  const dx = world.delta(player.x, cue.targetX);
  const dy = world.delta(player.y, cue.targetY);
  const dist = Math.max(0, Math.round(Math.sqrt(dx * dx + dy * dy)));
  let rel = Math.atan2(dy, dx) - player.angle;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  const arrow = Math.abs(rel) < Math.PI * 0.25 ? '>' : Math.abs(rel) > Math.PI * 0.75 ? '<' : rel > 0 ? 'v' : '^';
  const alpha = Math.max(0, Math.min(1, (cue.expiresAt - gameTime) / 1.2));

  ctx.save();
  ctx.globalAlpha = alpha;
  drawNeuroPanel(ctx, x, y, panelW, panelH, animationTime, 760);
  drawRouteCueWave(ctx, x + 6 * sx, y + 4 * sy, panelW - 12 * sx, 7 * sy, Math.max(0, gameTime - cue.startedAt), cue.color);
  ctx.textAlign = 'left';
  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = cue.color;
  ctx.fillText(fitHudText(ctx, cue.label, panelW - 12 * sx), x + 6 * sx, y + 12 * sy);
  ctx.fillStyle = '#ddd';
  ctx.fillText(fitHudText(ctx, `${arrow} ${cue.targetName} ${dist}м`, panelW - 12 * sx), x + 6 * sx, y + 21 * sy);
  ctx.font = `${6 * sy}px monospace`;
  ctx.fillStyle = '#9a8';
  ctx.fillText(fitHudText(ctx, cue.hint, panelW - 12 * sx), x + 6 * sx, y + 29 * sy);
  ctx.restore();
}

function drawObjectiveRouteHint(
  ctx: CanvasRenderingContext2D,
  rect: UiRect,
  sx: number,
  sy: number,
  time: number,
  objective: ObjectiveRouteHud,
): void {
  const panelW = Math.min(rect.w, 188 * sx);
  const panelH = 46 * sy;
  const x = rect.x + rect.w - panelW;
  const y = rect.y;

  ctx.save();
  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 784);
  ctx.textAlign = 'left';
  ctx.font = `${8 * sy}px monospace`;
  ctx.fillStyle = objective.color;
  ctx.fillText(fitHudText(ctx, objective.title, panelW - 12 * sx), x + 6 * sx, y + 5 * sy);
  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = '#ddd';
  ctx.fillText(fitHudText(ctx, objective.target, panelW - 12 * sx), x + 6 * sx, y + 16 * sy);
  ctx.fillStyle = '#9cf';
  ctx.fillText(fitHudText(ctx, objective.lift, panelW - 12 * sx), x + 6 * sx, y + 27 * sy);
  ctx.font = `${6 * sy}px monospace`;
  ctx.fillStyle = '#9a8';
  ctx.fillText(fitHudText(ctx, `${objective.risk} / ${objective.returnPath}`, panelW - 12 * sx), x + 6 * sx, y + 37 * sy);
  ctx.restore();
}

function drawCurrentObjectiveHint(
  ctx: CanvasRenderingContext2D,
  rect: UiRect,
  sx: number,
  sy: number,
  time: number,
  objective: CurrentObjective,
): void {
  const panelW = Math.min(rect.w, 188 * sx);
  const panelH = 28 * sy;
  const x = rect.x + rect.w - panelW;
  const y = rect.y;

  ctx.save();
  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 812);
  ctx.textAlign = 'left';
  ctx.font = `${6.4 * sy}px monospace`;
  ctx.fillStyle = objective.color;
  ctx.fillText('ЦЕЛЬ', x + 6 * sx, y + 4 * sy);
  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = '#ddd';
  ctx.fillText(fitHudText(ctx, objective.line, panelW - 12 * sx), x + 6 * sx, y + 14 * sy);
  ctx.restore();
}

function drawSmallCaravanHint(
  ctx: CanvasRenderingContext2D,
  rect: UiRect,
  sx: number,
  sy: number,
  time: number,
  caravan: SmallCaravanHudSnapshot,
): void {
  const panelW = Math.min(rect.w, 176 * sx);
  const panelH = 29 * sy;
  const x = rect.x + rect.w - panelW;
  const y = rect.y;
  ctx.save();
  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 815);
  ctx.textAlign = 'left';
  ctx.font = `${8 * sy}px monospace`;
  ctx.fillStyle = caravan.color;
  ctx.fillText(fitHudText(ctx, `КАРАВАН ${caravan.statusText}`, panelW - 12 * sx), x + 6 * sx, y + 5 * sy);
  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = '#ddd';
  ctx.fillText(fitHudText(ctx, `${caravan.name} ${caravan.dist}м`, panelW - 12 * sx), x + 6 * sx, y + 15 * sy);
  ctx.font = `${6 * sy}px monospace`;
  ctx.fillStyle = '#9a8';
  ctx.fillText(fitHudText(ctx, caravan.detail, panelW - 12 * sx), x + 6 * sx, y + 23 * sy);
  ctx.restore();
}

function fitHudText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  return fitUiText(ctx, text, maxW);
}

function compactFloorLabel(entry: FloorRunEntry): string {
  const z = formatFloorZ(entry.z);
  const prefix = `Этаж Z${z}: `;
  const name = entry.label.startsWith(prefix)
    ? entry.label.slice(prefix.length)
    : entry.label.replace(/^Этаж\s+Z?[+-]?\d+:\s*/, '');
  return `${z} ${name}`;
}

function wrapHudText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const limit = Math.max(1, Math.floor(maxLines));
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxW || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length >= limit) break;
  }
  if (lines.length < limit && line) lines.push(line);
  if (lines.length === 0) lines.push(text);
  const overflow = words.join(' ') !== lines.join(' ');
  const last = lines.length - 1;
  if (overflow && last >= 0) lines[last] = `${fitHudText(ctx, lines[last], Math.max(1, maxW - ctx.measureText('...').width))}...`;
  else if (last >= 0) lines[last] = fitHudText(ctx, lines[last], maxW);
  return lines.map(item => fitHudText(ctx, item, maxW));
}

function compactNumber(value: number | undefined): string {
  return Number.isFinite(value) ? String(Math.round(value!)) : '-';
}

function compactMs(value: number | undefined): string {
  return Number.isFinite(value) ? value!.toFixed(value! >= 10 ? 0 : 1) : '-';
}

function drawFpsCounter(ctx: CanvasRenderingContext2D, perf: HudPerfDebugSnapshot | undefined, rect: UiRect, sx: number, sy: number): void {
  const fps = perf?.fps;
  if (fps === undefined || !Number.isFinite(fps) || fps <= 0) return;
  const s = Math.max(1, Math.min(sx, sy));
  const lines = [
    `FPS ${Math.round(fps)}  кадр ${compactMs(perf?.frameMsAvg)}/${compactMs(perf?.frameMsMax)}мс`,
    `AI ${compactNumber(perf?.liveAi)} upd ${compactNumber(perf?.aiUpdated)} skip ${compactNumber(perf?.aiSkipped)}`,
    `VIS ${compactNumber(perf?.visibleSprites)} draw ${compactNumber(perf?.drawnSprites)} q ${compactNumber(perf?.visibleEntityQueryResults)}  ms SIM ${compactMs(perf?.simMs)} AI ${compactMs(perf?.aiMs)} R ${compactMs(perf?.renderMs)} HUD ${compactMs(perf?.hudMs)}`,
    `SYS N ${compactMs(perf?.needsMs)} C ${compactMs(perf?.contentMs)} HZ ${compactMs(perf?.hazardMs)} S ${compactMs(perf?.samosborMs)} F ${compactMs(perf?.factionMs)} B ${compactMs(perf?.bloodMs)} X ${compactMs(perf?.cleanupMs)}`,
  ];
  const padX = 3 * s;
  const padY = 2 * s;
  const lineH = 8 * s;
  ctx.save();
  ctx.font = `${7 * s}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const textW = Math.max(...lines.map(line => ctx.measureText(line).width));
  const boxW = Math.min(rect.w, textW + padX * 2);
  const boxH = Math.min(rect.h, lines.length * lineH + padY * 2);
  ctx.fillStyle = 'rgba(0,8,10,0.74)';
  ctx.fillRect(rect.x, rect.y, boxW, boxH);
  ctx.strokeStyle = 'rgba(72,220,190,0.36)';
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, boxW - 1, boxH - 1);
  ctx.fillStyle = fps >= 50 ? '#8fffd0' : fps >= 30 ? '#ffd36a' : '#ff8a6a';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(fitHudText(ctx, lines[i], boxW - padX * 2), rect.x + padX, rect.y + padY + i * lineH);
  }
  ctx.restore();
}

function mobileHudControlsOn(): boolean {
  return getMobileHudSafeContext().enabled;
}

function interactionPromptHint(): string {
  return mobileHudControlsOn()
    ? (getLocalizationLanguage() === 'en' ? '[ACT]' : '[ДЕЙСТ]')
    : controlHint('interact');
}

function drawItemPickupPanel(
  ctx: CanvasRenderingContext2D,
  interaction: NonNullable<ReturnType<typeof findInteractionTarget>>,
  rect: UiRect,
  sx: number,
  sy: number,
  time: number,
): void {
  const def = ITEMS[interaction.defId];
  const s = Math.max(1, Math.min(sx, sy));
  const panelW = Math.min(188 * sx, ctx.canvas.width - 16 * sx);
  const panelH = 42 * sy;
  const x = Math.max(8 * sx, Math.min(ctx.canvas.width - panelW - 8 * sx, rect.x + rect.w * 0.5 - panelW * 0.5));
  const y = Math.max(16 * sy, rect.y - panelH - 11 * sy);
  const count = Math.max(1, Math.floor(interaction.itemCount ?? 1));
  const title = `${interaction.itemName ?? def?.name ?? interaction.defId}${count > 1 ? ` x${count}` : ''}`;
  const value = Math.max(0, Math.floor(interaction.itemValue ?? def?.value ?? 0));
  const desc = interaction.itemDesc || def?.desc || 'Предмет без описания.';
  const descLines = wrapHudText(ctx, desc, panelW - 12 * sx, 2);

  ctx.save();
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = 'rgba(4,12,12,0.92)';
  ctx.fillRect(x, y, panelW, panelH);
  ctx.strokeStyle = `rgba(120,255,210,${0.32 + 0.08 * flicker(time, interaction.colorSeed + 1200)})`;
  ctx.strokeRect(x + 0.5, y + 0.5, panelW - 1, panelH - 1);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${8 * sy}px monospace`;
  ctx.fillStyle = '#dff';
  ctx.fillText(fitHudText(ctx, title, panelW - 12 * sx), x + 6 * sx, y + 10 * sy);
  ctx.font = `${6 * sy}px monospace`;
  ctx.fillStyle = '#9bb';
  for (let i = 0; i < descLines.length; i++) {
    ctx.fillText(descLines[i], x + 6 * sx, y + (20 + i * 8) * sy);
  }
  ctx.fillStyle = '#fd6';
  ctx.fillText(fitHudText(ctx, `${interactionPromptHint()} поднять${value > 0 ? ` / ${value} руб.` : ''}`, panelW - 12 * sx), x + 6 * sx, y + panelH - 5 * s);
  ctx.restore();
}

function samosborHudTitle(variantId: string | undefined, variantName?: string): string {
  switch (variantId) {
    case 'wet': return 'МОКРЫЙ САМОСБОР';
    case 'electric': return 'ЭЛЕКТРОСБОР';
    case 'meat': return 'МЯСНОЙ САМОСБОР';
    case 'maronary': return 'МАРОНАРИЙ';
    case 'istotit': return 'ИСТОТИТ';
    case 'veretar': return 'ВЕРЕТАР';
    default: {
      const name = variantName?.trim();
      return name && name !== 'Классический' ? `${name.toUpperCase()} САМОСБОР` : 'САМОСБОР';
    }
  }
}

function samosborCrawlLines(variantId: string | undefined): readonly string[] {
  switch (variantId) {
    case 'istotit':
      return [
        'ХРИСТОМ УКРЫТ',
        'МАЛИНОВЫЙ ЗВОН',
        'ИДТИ НА ЗВОН',
        'ГОСПОДИ',
        'ХОР ПОЁТ',
      ];
    case 'maronary':
      return [
        'НЕ СМОТРИ НА СВЕТ',
        'ТЫ ЭТО ЗНАЛ',
        'НЕТ ПРИЧИНЫ',
        'ДЛИТЬСЯ',
        'ПОЗДНО',
      ];
    case 'veretar':
      return [
        'БЕЛАЯ ЩЕЛЬ РАСТЕТ',
        'НЕ МЫСЛИ',
        'НЕБЫТИЕ НЕ ВРЕМЯ',
        'Я ИСЧЕЗАЕТ',
        'ПУСТОТА',
      ];
    default:
      return [
        'СТЕНЫ МЕНЯЮТ МЕСТА',
        'ДЫШИ ВЫШЕ ТУМАНА',
        'БЕЖАТЬ К ГЕРМЕ',
        'ЗАПАХ СЫРОГО МЯСА',
        'ЦИКЛ ЗА ЦИКЛОМ',
      ];
  }
}

function samosborCrawlHash(variantId: string | undefined, slot: number, cycle: number, salt = 0): number {
  let h = 0x811c9dc5
    ^ Math.imul(slot + 1, 374761393)
    ^ Math.imul(cycle + 1, 668265263)
    ^ Math.imul(salt + 1, 2246822519);
  const key = variantId ?? 'classic';
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  return h >>> 0;
}

function samosborCrawlUnit(variantId: string | undefined, slot: number, cycle: number, salt: number): number {
  return (samosborCrawlHash(variantId, slot, cycle, salt) % 10_000) / 10_000;
}

function samosborCrawlLineIndex(variantId: string | undefined, slot: number, cycle: number, count: number): number {
  return samosborCrawlHash(variantId, slot, cycle) % count;
}

function drawSamosborCrawl(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sx: number,
  sy: number,
  time: number,
  variantId: string | undefined,
  tint: string,
): void {
  const lines = samosborCrawlLines(variantId);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const slots = Math.max(4, Math.min(7, Math.round(w / 220)));
  for (let i = 0; i < slots; i++) {
    const phase = time * 0.12 + i / slots;
    const cycle = Math.floor(phase);
    const travel = phase % 1;
    const xUnit = samosborCrawlUnit(variantId, i, cycle, 1);
    const sizeUnit = samosborCrawlUnit(variantId, i, cycle, 2);
    const angleUnit = samosborCrawlUnit(variantId, i, cycle, 3);
    const spinUnit = samosborCrawlUnit(variantId, i, cycle, 4);
    const y = h * 1.12 - travel * h * 1.38;
    const x = w * (0.06 + xUnit * 0.88);
    const size = (5.5 + Math.pow(travel, 1.25) * 11.5) * sy * (0.72 + sizeUnit * 0.62);
    const spin = -0.45 + spinUnit * 0.9;
    const angle = -0.28 + angleUnit * 0.56 + (time * 0.35 + travel * 1.8) * spin;
    const enter = Math.max(0, Math.min(1, (travel - 0.035) / 0.12));
    const exit = Math.max(0, Math.min(1, (1 - travel) / 0.16));
    const alpha = Math.min(enter, exit);
    if (alpha <= 0.02) continue;
    const line = lines[samosborCrawlLineIndex(variantId, i, cycle, lines.length)];
    const jitter = textJitter(time * 2.5, 1800 + i * 17);
    ctx.font = `bold ${size}px monospace`;
    const maxLineW = Math.max(72 * sx, w * (0.28 + travel * 0.18));
    ctx.save();
    ctx.translate(x + jitter.dx * 1.5, y + jitter.dy);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha * 0.52;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillText(line, 1.5 * sx, 1.5 * sy, maxLineW);
    ctx.globalAlpha = alpha * 0.62;
    ctx.fillStyle = tint;
    ctx.fillText(line, 0, 0, maxLineW);
    ctx.restore();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function hudWeaponName(name: string): string {
  return name.replace(/^Сгусток:\s*/, '');
}

export function combatWeaponHudLines(weapon: Pick<
  WeaponReadiness,
  'name' | 'role' | 'damageLabel' | 'reachLabel' | 'controlLabel' | 'cooldownLabel' | 'cannotFireReason' | 'resourceKind' | 'resourceLabel'
>): { title: string; fact: string; state: string; resource: string } {
  const reach = weapon.reachLabel ? ` ${weapon.reachLabel}` : '';
  const control = weapon.controlLabel ? ` ${weapon.controlLabel}` : '';
  const resource = weapon.resourceKind === 'ammo' ? `БОЕП ${weapon.resourceLabel}` : weapon.resourceLabel;
  return {
    title: hudWeaponName(weapon.name),
    fact: `${weapon.role} УРН ${weapon.damageLabel}${reach}${control}`,
    state: weapon.cannotFireReason ? weapon.cannotFireReason.toUpperCase() : weapon.cooldownLabel,
    resource,
  };
}

interface CombatTargetHud {
  name: string;
  dist: number;
  hpPct: number;
  questMarkerTone: NpcQuestMarkerTone | null;
  screenX: number;
  headY: number;
  attitude: CombatTargetAttitude;
}

type CombatTargetAttitude = 'hostile' | 'neutral' | 'friendly';

function combatTargetName(e: Entity): string {
  return e.type === EntityType.PROJECTILE ? 'Снаряд' : entityDisplayName(e);
}

interface AimTargetHit {
  dist: number;
  forward: number;
  side: number;
}

interface CombatSpriteProjection {
  screenX: number;
  headY: number;
  width: number;
  height: number;
}

function combatSpriteScale(e: Entity): number {
  return Math.max(0.35, Math.min(1.6, e.spriteScale ?? 1));
}

function combatSpriteProjection(e: Entity, forward: number, side: number, pitch: number): CombatSpriteProjection | null {
  if (forward <= 0.1) return null;
  const scale = combatSpriteScale(e);
  const spriteScreenX = Math.floor((SCR_W / 2) * (1 + side / (forward * cameraPlaneLen())));
  const rawH = Math.abs(Math.floor(SCR_H / forward));
  const spriteH = Math.floor(rawH * scale);
  const spriteW = spriteH;
  if (spriteW <= 1 || spriteH <= 1) return null;

  const halfH = Math.floor(SCR_H / 2) + Math.floor(pitch * SCR_H);
  const footY = halfH + Math.floor(rawH * 0.5) - Math.floor(rawH * (e.spriteZ ?? 0));
  return { screenX: spriteScreenX, headY: footY - spriteH, width: spriteW, height: spriteH };
}

function crosshairInsideCombatSprite(e: Entity, forward: number, side: number, pitch: number): boolean {
  const projection = combatSpriteProjection(e, forward, side, pitch);
  if (!projection) return false;
  const tightHalfW = Math.max(2, projection.width * 0.34);
  const verticalInset = Math.max(1, projection.height * 0.08);
  const centerX = SCR_W * 0.5;
  const centerY = SCR_H * 0.5;
  return centerX >= projection.screenX - tightHalfW && centerX <= projection.screenX + tightHalfW
    && centerY >= projection.headY + verticalInset && centerY <= projection.headY + projection.height - verticalInset;
}

function aimRayBlocked(world: World, px: number, py: number, dirX: number, dirY: number, maxDist: number): boolean {
  let mapX = Math.floor(px);
  let mapY = Math.floor(py);
  const ddx = dirX === 0 ? Infinity : Math.abs(1 / dirX);
  const ddy = dirY === 0 ? Infinity : Math.abs(1 / dirY);
  const stepX = dirX < 0 ? -1 : 1;
  const stepY = dirY < 0 ? -1 : 1;
  let sdx = dirX < 0 ? (px - mapX) * ddx : (mapX + 1 - px) * ddx;
  let sdy = dirY < 0 ? (py - mapY) * ddy : (mapY + 1 - py) * ddy;

  for (let step = 0; step < COMBAT_TARGET_RAY_STEP_CAP; step++) {
    const dist = Math.min(sdx, sdy);
    if (dist >= maxDist) return false;
    if (sdx < sdy) {
      sdx += ddx;
      mapX += stepX;
    } else {
      sdy += ddy;
      mapY += stepY;
    }
    if (world.solid(mapX, mapY)) return true;
  }
  return false;
}

function aimTargetHit(world: World, player: Entity, e: Entity, ca: number, sa: number): AimTargetHit | null {
  const dx = world.delta(player.x, e.x);
  const dy = world.delta(player.y, e.y);
  const d2 = dx * dx + dy * dy;
  if (d2 > COMBAT_TARGET_MAX_D2) return null;

  const forward = dx * ca + dy * sa;
  if (forward <= 0.35) return null;
  const side = -dx * sa + dy * ca;
  const bodyRadius = Math.max(0.16, Math.min(0.48, COMBAT_TARGET_BODY_RADIUS * combatSpriteScale(e)));
  if (Math.abs(side) > bodyRadius) return null;
  if (!crosshairInsideCombatSprite(e, forward, side, player.pitch)) return null;
  if (aimRayBlocked(world, player.x, player.y, ca, sa, Math.max(0.25, forward - bodyRadius))) return null;

  return { dist: Math.sqrt(d2), forward, side };
}

function combatTargetAttitude(e: Entity, player: Entity): CombatTargetAttitude {
  if (e.type === EntityType.MONSTER) return 'hostile';
  if (e.type === EntityType.NPC) {
    if (isHostile(e, player)) return 'hostile';
    return getNpcPlayerRelation(e) < 25 ? 'neutral' : 'friendly';
  }
  return 'neutral';
}

function findAimTarget(world: World, player: Entity, state: GameState): CombatTargetHud | null {
  const ca = Math.cos(player.angle);
  const sa = Math.sin(player.angle);
  let best: Entity | null = null;
  let bestHit: AimTargetHit | null = null;
  let bestScore = Infinity;
  let bestDist = 0;
  let checked = 0;

  const maxD = Math.sqrt(COMBAT_TARGET_MAX_D2);

  getEntityIndex().queryRadiusCapped(
    player.x,
    player.y,
    maxD,
    aimTargetQuery,
    ENTITY_MASK_ACTOR,
    COMBAT_TARGET_QUERY_CAP,
  );
  for (const e of aimTargetQuery) {
    if (!e.alive || e.id === player.id) continue;
    if (e.type !== EntityType.MONSTER && e.type !== EntityType.NPC) continue;

    const dx = world.delta(player.x, e.x);
    if (Math.abs(dx) > maxD) continue;
    const dy = world.delta(player.y, e.y);
    if (Math.abs(dy) > maxD) continue;
    if (dx * dx + dy * dy > COMBAT_TARGET_MAX_D2) continue;

    checked++;
    const hit = aimTargetHit(world, player, e, ca, sa);
    if (hit) {
      const score = hit.forward + Math.abs(hit.side) * 0.4;
      if (score < bestScore) {
        best = e;
        bestHit = hit;
        bestScore = score;
        bestDist = hit.dist;
      }
    }
    if (checked >= COMBAT_TARGET_SCAN_CAP) break;
  }

  if (!best || !bestHit) return null;
  const projection = combatSpriteProjection(best, bestHit.forward, bestHit.side, player.pitch);
  const questMarker = best.type === EntityType.NPC ? npcQuestMarkerState(best, state) : null;
  return {
    name: combatTargetName(best),
    dist: Math.max(1, Math.round(bestDist)),
    hpPct: toPercent(best.hp ?? 0, best.maxHp ?? 100),
    questMarkerTone: questMarker?.showExclamation ? questMarker.tone : null,
    screenX: projection?.screenX ?? SCR_W * 0.5,
    headY: projection?.headY ?? SCR_H * 0.5 - 44,
    attitude: combatTargetAttitude(best, player),
  };
}

function inferDeathCause(state: GameState, player: Entity, world: World): { title: string; detail: string } {
  const deathTime = state.time - state.deathTimer;
  const lastDamageCause = formatLastPlayerDamageCause(state, deathTime);
  if (lastDamageCause) return { title: 'Причина смерти', detail: lastDamageCause };

  for (let i = state.msgs.length - 1; i >= 0 && i >= state.msgs.length - 16; i--) {
    const m = state.msgs[i];
    if (m.time < deathTime - 10 || m.time > deathTime + 1.5) continue;
    const text = m.text;
    if (text.includes('убил Вы')) return { title: 'Причина смерти', detail: text.replace('убил Вы', 'убил вас') };
    if (text.includes('режет тебя') || text.includes('задел тебя')) return { title: 'Причина смерти', detail: text };
    if (m.color === '#f66' && text.includes(': -')) return { title: 'Последний урон', detail: text };
    if (text.includes('Обратная тяга')) return { title: 'Последний урон', detail: text };
  }

  const needs = player.needs;
  if (needs) {
    if (needs.water <= 0) return { title: 'Причина смерти', detail: 'обезвоживание' };
    if (needs.food <= 0) return { title: 'Причина смерти', detail: 'голод' };
    if (needs.pee >= 100) return { title: 'Причина смерти', detail: 'мочевой отказ' };
    if (needs.poo >= 100) return { title: 'Причина смерти', detail: 'кишечный отказ' };
  }

  let nearest: Entity | null = null;
  let nearestD2 = 6 * 6;
  getEntityIndex().queryRadiusCapped(
    player.x,
    player.y,
    6,
    deathNearbyQuery,
    ENTITY_MASK_ACTOR | ENTITY_MASK_PROJECTILE,
    DEATH_NEARBY_QUERY_CAP,
  );
  for (const e of deathNearbyQuery) {
    if (!e.alive || e.id === player.id) continue;
    if (e.type !== EntityType.MONSTER && e.type !== EntityType.NPC && e.type !== EntityType.PROJECTILE) continue;
    const d2 = world.dist2(player.x, player.y, e.x, e.y);
    if (d2 < nearestD2) {
      nearestD2 = d2;
      nearest = e;
    }
  }
  if (nearest) {
    const dist = Math.max(1, Math.round(Math.sqrt(nearestD2)));
    return { title: 'Рядом с телом', detail: `${combatTargetName(nearest)} ${dist}м` };
  }
  if (state.samosborActive) return { title: 'Причина смерти', detail: 'самосбор: источник урона не распознан' };
  return { title: 'Причина смерти', detail: 'источник урона не распознан' };
}

export function drawPointerCaptureGate(ctx: CanvasRenderingContext2D, time = 0): void {
  const lang = titleLanguageDef(getLocalizationLanguage());
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const sx = w / SCR_W;
  const sy = h / SCR_H;
  const s = Math.max(0.78, Math.min(2.2, Math.min(sx, sy)));
  const panelW = Math.min(w - 24 * s, 430 * s);
  const panelH = Math.min(h - 24 * s, 140 * s);
  const x = (w - panelW) * 0.5;
  const y = (h - panelH) * 0.5;

  setUiTextTime(time);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.82)';
  ctx.fillRect(0, 0, w, h);
  drawStaticNoise(ctx, 0, 0, w, h, time, 0.018);
  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 1500);
  ctx.strokeStyle = 'rgba(100,220,255,0.72)';
  ctx.lineWidth = Math.max(1, s);
  ctx.strokeRect(x + 0.5, y + 0.5, panelW - 1, panelH - 1);

  ctx.textAlign = 'center';
  ctx.shadowColor = '#6cf';
  ctx.shadowBlur = 10 * s;
  ctx.fillStyle = '#bff';
  ctx.font = `bold ${Math.round(17 * s)}px monospace`;
  ctx.fillText(fitHudText(ctx, lang.pointerGateTitle, panelW - 18 * s), w * 0.5, y + 18 * s);
  ctx.font = `bold ${Math.round(12 * s)}px monospace`;
  ctx.fillText(fitHudText(ctx, lang.pointerGateSubtitle, panelW - 18 * s), w * 0.5, y + 39 * s);

  ctx.shadowBlur = 0;
  ctx.fillStyle = '#c8d0d0';
  ctx.font = `${Math.round(9 * s)}px monospace`;
  ctx.fillText(fitHudText(ctx, lang.pointerGateWarning1, panelW - 24 * s), w * 0.5, y + 61 * s);
  ctx.fillText(fitHudText(ctx, lang.pointerGateWarning2, panelW - 24 * s), w * 0.5, y + 75 * s);
  ctx.fillStyle = '#9ab';
  ctx.fillText(fitHudText(ctx, lang.pointerGateControls1, panelW - 24 * s), w * 0.5, y + 91 * s);
  ctx.fillText(fitHudText(ctx, lang.pointerGateControls2, panelW - 24 * s), w * 0.5, y + 105 * s);

  ctx.fillStyle = '#708888';
  ctx.font = `${Math.round(7 * s)}px monospace`;
  ctx.fillText(fitHudText(ctx, lang.pointerGateResume, panelW - 24 * s), w * 0.5, y + 120 * s);
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawPointerLockPrompt(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sx: number,
  sy: number,
  time: number,
): void {
  const lang = titleLanguageDef(getLocalizationLanguage());
  const panelW = Math.min(w - 18 * sx, 226 * sx);
  const panelH = 48 * sy;
  const x = (w - panelW) * 0.5;
  const y = h * 0.5 - 54 * sy;
  ctx.save();
  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 1501);
  ctx.strokeStyle = 'rgba(100,220,255,0.58)';
  ctx.strokeRect(x + 0.5, y + 0.5, panelW - 1, panelH - 1);
  ctx.textAlign = 'center';
  ctx.shadowColor = '#6cf';
  ctx.shadowBlur = 7;
  ctx.font = `${8 * sy}px monospace`;
  ctx.fillStyle = '#9df';
  ctx.fillText(fitHudText(ctx, lang.pointerLockPrompt, panelW - 14 * sx), w * 0.5, y + 6 * sy);
  ctx.shadowBlur = 0;
  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = '#9ab';
  ctx.fillText(fitHudText(ctx, lang.pointerLockControls1(controlHint('gameMenu')), panelW - 14 * sx), w * 0.5, y + 20 * sy);
  ctx.fillText(fitHudText(ctx, lang.pointerLockControls2(menuCloseHint(), controlHint('interact')), panelW - 14 * sx), w * 0.5, y + 32 * sy);
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawCombatWeaponPanel(
  ctx: CanvasRenderingContext2D,
  weapon: ReturnType<typeof getWeaponReadiness>,
  bottomSlot: UiRect,
  sx: number,
  sy: number,
  time: number,
): { x: number; y: number; w: number } {
  const s = Math.max(1, Math.min(sx, sy));
  const panelW = Math.max(44 * s, Math.min(bottomSlot.w - 8 * s, 96 * s));
  const panelH = 25 * s;
  const panelX = bottomSlot.x + bottomSlot.w - panelW - 4 * s;
  const panelY = bottomSlot.y - panelH - 3 * s;
  const statusColor = weapon.cannotFireReason ? '#f84' : weapon.lowResource ? '#fc4' : weapon.cooldown > 0.05 ? '#8cf' : '#9d9';
  drawNeuroPanel(ctx, panelX, panelY, panelW, panelH, time, 190);
  if (weapon.cannotFireReason || weapon.lowResource) {
    ctx.strokeStyle = weapon.cannotFireReason ? 'rgba(255,80,50,0.75)' : 'rgba(255,210,80,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1);
  }

  const lines = combatWeaponHudLines(weapon);
  ctx.textAlign = 'left';
  ctx.font = `${6.2 * s}px monospace`;
  ctx.fillStyle = '#dcefff';
  ctx.fillText(fitHudText(ctx, lines.title, panelW - 9 * s), panelX + 4.5 * s, panelY + 2 * s);

  ctx.font = `${5.2 * s}px monospace`;
  ctx.fillStyle = '#8cf';
  ctx.fillText(fitHudText(ctx, lines.fact, panelW - 9 * s), panelX + 4.5 * s, panelY + 9.5 * s);

  ctx.font = `${6.4 * s}px monospace`;
  ctx.fillStyle = statusColor;
  ctx.fillText(fitHudText(ctx, lines.state, 42 * s), panelX + 4.5 * s, panelY + 16 * s);
  ctx.textAlign = 'right';
  ctx.fillStyle = weapon.cannotFireReason ? '#f84' : weapon.lowResource ? '#fc4' : '#d7ffd7';
  ctx.fillText(fitHudText(ctx, lines.resource, panelW - 51 * s), panelX + panelW - 4.5 * s, panelY + 16 * s);
  ctx.textAlign = 'left';

  drawHoloBar(ctx, panelX + 4.5 * s, panelY + panelH - 3.2 * s, panelW - 9 * s, 1.8 * s, weapon.reloading ? weapon.reloadPct * 100 : (weapon.cannotFireReason ? 0 : weapon.readyPct * 100), statusColor, time, 193);
  return { x: panelX, y: panelY, w: panelW };
}

function combatTargetPalette(attitude: CombatTargetAttitude): { bg: string; stroke: string; text: string; bar: string; glow: string } {
  switch (attitude) {
    case 'hostile':
      return {
        bg: 'rgba(28,4,5,0.78)',
        stroke: 'rgba(255,70,58,0.9)',
        text: '#ff9a8f',
        bar: '#ff543f',
        glow: '#f44',
      };
    case 'friendly':
      return {
        bg: 'rgba(4,24,14,0.76)',
        stroke: 'rgba(70,255,145,0.82)',
        text: '#a9ffc7',
        bar: '#58f092',
        glow: '#4f8',
      };
    default:
      return {
        bg: 'rgba(30,22,4,0.76)',
        stroke: 'rgba(255,205,64,0.84)',
        text: '#ffe084',
        bar: '#f4c542',
        glow: '#fc4',
      };
  }
}

function drawCombatSightFeedback(
  ctx: CanvasRenderingContext2D,
  target: CombatTargetHud | null,
  sx: number,
  sy: number,
): void {
  if (target) {
    const s = Math.max(1, Math.min(sx, sy));
    const palette = combatTargetPalette(target.attitude);
    const label = `${target.name} ${target.dist}м`;
    ctx.font = `${6.5 * s}px monospace`;
    const hasQuestMarker = target.questMarkerTone !== null;
    const minW = (hasQuestMarker ? 88 : 72) * s;
    const maxW = Math.min(ctx.canvas.width - 8 * s, 124 * s);
    const tw = Math.max(minW, Math.min(maxW, ctx.measureText(label).width + (hasQuestMarker ? 25 : 13) * s));
    const th = 18 * s;
    const tx = Math.max(4 * s, Math.min(ctx.canvas.width - tw - 4 * s, target.screenX * sx - tw * 0.5));
    const ty = Math.max(4 * s, Math.min(ctx.canvas.height - th - 4 * s, target.headY * sy - 22 * s));
    ctx.fillStyle = palette.bg;
    ctx.fillRect(tx, ty, tw, th);
    ctx.strokeStyle = palette.stroke;
    ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, th - 1);
    ctx.fillStyle = palette.text;
    ctx.textAlign = 'left';
    let textX = tx + 5 * s;
    let textW = tw - 10 * s;
    if (hasQuestMarker) {
      const questColor = target.questMarkerTone === 'procedural'
        ? { bg: 'rgba(3,34,58,0.95)', stroke: '#80d8ff', shadow: '#22aaff', text: '#80d8ff' }
        : { bg: 'rgba(94,58,0,0.95)', stroke: '#fff15a', shadow: '#ffb000', text: '#ffe84a' };
      const markX = tx + 5 * s;
      const markY = ty + 2 * s;
      const markW = 9 * s;
      const markH = 10 * s;
      ctx.fillStyle = questColor.bg;
      ctx.fillRect(markX, markY, markW, markH);
      ctx.strokeStyle = questColor.stroke;
      ctx.strokeRect(markX + 0.5, markY + 0.5, markW - 1, markH - 1);
      ctx.shadowColor = questColor.shadow;
      ctx.shadowBlur = 8;
      ctx.font = `bold ${10 * s}px monospace`;
      ctx.fillStyle = questColor.text;
      ctx.fillText('!', markX + 2.2 * s, ty + 0.5 * s);
      ctx.shadowBlur = 0;
      ctx.font = `${6.5 * s}px monospace`;
      ctx.fillStyle = palette.text;
      textX = tx + 18 * s;
      textW = tw - 23 * s;
    }
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = 5;
    ctx.fillText(fitHudText(ctx, label, textW), textX, ty + 3 * s);
    ctx.shadowBlur = 0;
    const hpTrackW = tw - 10 * s;
    const hpW = hpTrackW * Math.max(0, Math.min(1, target.hpPct / 100));
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(tx + 5 * s, ty + 13 * s, hpTrackW, 2 * s);
    ctx.fillStyle = target.hpPct < 30 ? '#f84' : palette.bar;
    ctx.fillRect(tx + 5 * s, ty + 13 * s, hpW, 2 * s);
  }
}

function drawWorldSpeechBubbles(
  ctx: CanvasRenderingContext2D,
  world: World,
  player: Entity,
  entities: Entity[],
  sx: number,
  sy: number,
  time: number,
): void {
  const ca = Math.cos(player.angle);
  const sa = Math.sin(player.angle);
  const s = Math.max(1, Math.min(sx, sy));
  
  for (const e of entities) {
    if (!e.alive || e.id === player.id || !e.activeBark) continue;
    if (time > e.activeBark.until) continue;
    
    const dx = world.delta(player.x, e.x);
    const dy = world.delta(player.y, e.y);
    const d2 = dx * dx + dy * dy;
    if (d2 > 16 * 16) continue; // max 16 meters
    
    const forward = dx * ca + dy * sa;
    if (forward <= 0.35) continue; // Behind camera
    
    const side = -dx * sa + dy * ca;
    const projection = combatSpriteProjection(e, forward, side, player.pitch);
    if (!projection) continue;
    
    const text = e.activeBark.text;
    const color = e.activeBark.color;
    
    ctx.font = `${6 * s}px monospace`;
    const lines = wrapHudText(ctx, text, 120 * s, 4);
    const lh = 7.5 * s;
    const padding = 4 * s;
    const tw = Math.max(...lines.map(l => ctx.measureText(l).width));
    const th = lines.length * lh;
    
    const bx = projection.screenX * sx - tw / 2 - padding;
    const by = projection.headY * sy - th - padding * 2 - 8 * s;
    
    const remaining = e.activeBark.until - time;
    const alpha = Math.min(1, remaining * 2);
    
    ctx.save();
    ctx.globalAlpha = alpha;
    
    ctx.fillStyle = 'rgba(10, 18, 22, 0.82)';
    ctx.fillRect(bx, by, tw + padding * 2, th + padding * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, tw + padding * 2 - 1, th + padding * 2 - 1);
    
    ctx.beginPath();
    ctx.moveTo(bx + tw / 2 + padding - 3 * s, by + th + padding * 2);
    ctx.lineTo(bx + tw / 2 + padding + 3 * s, by + th + padding * 2);
    ctx.lineTo(bx + tw / 2 + padding, by + th + padding * 2 + 5 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(bx + tw / 2 + padding - 2 * s, by + th + padding * 2);
    ctx.lineTo(bx + tw / 2 + padding + 2 * s, by + th + padding * 2);
    ctx.strokeStyle = 'rgba(10, 18, 22, 1)';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], bx + padding, by + padding + i * lh);
    }
    
    ctx.restore();
  }
}

/* ── The HUD is drawn on the 2D canvas overlaying the 3D view ── */
export function drawHUD(
  ctx: CanvasRenderingContext2D,
  _scaleX: number, _scaleY: number,
  player: Entity,
  state: GameState,
  world: World,
  entities: Entity[],
  uiTime = state.time,
  options: { fps?: number; perf?: HudPerfDebugSnapshot; pointerLockHint?: boolean; pointerCaptureGate?: boolean } = {},
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Scale to match low-res viewport
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const sx = w / SCR_W;
  const sy = h / SCR_H;
  const menuScale = Math.max(0.72, Math.min(1.68, Math.min(sx, sy)));
  const msx = menuScale;
  const msy = menuScale;

  ctx.font = `${10 * sy}px monospace`;
  ctx.textBaseline = 'top';

  const time = uiTime;
  const gameTime = Number.isFinite(state.time) ? state.time : time;
  setUiTextTime(time);
  const mobileHud = getMobileHudSafeContext();
  const slots = createHudSlots(w, h, sx, sy, {
    mobileControls: mobileHud.enabled,
    safeInsets: mobileHud.safeInsets,
    bottomVitalsHeight: NEEDS_PANEL_H * sy,
    topRightWidth: 212 * sx,
  });
  if (typeof window !== 'undefined' && window.location.search.includes('smoke')) {
    window.__gigahrushLastHudLayout = {
      canvasW: w,
      canvasH: h,
      safe: { x: slots.safe.left, y: slots.safe.top, w: slots.safe.right, h: slots.safe.bottom },
      bottomVitals: { ...slots.bottomVitals },
      centerInteraction: { ...slots.centerInteraction },
    };
  }
  const showBottomTabs = uiElementEnabled('bottom_tabs');
  const showWeaponPanel = uiElementEnabled('weapon_panel');
  const showCrosshair = uiElementEnabled('crosshair');
  const showInteractionPrompt = uiElementEnabled('interaction_prompt');
  const showDamageFeedback = uiElementEnabled('damage_feedback');
  const showHazardWarning = uiElementEnabled('hazard_warning');
  const showMessages = uiElementEnabled('messages');
  const showLocationPanel = uiElementEnabled('location_panel');
  const showMinimap = uiElementEnabled('minimap');
  const showRouteHints = uiElementEnabled('route_hints');
  const showCaravanHints = uiElementEnabled('caravan_hints');
  const showStatusHints = uiElementEnabled('status_hints');
  const showAnomalyHints = uiElementEnabled('anomaly_hints');
  const showScreenFx = uiElementEnabled('screen_fx');
  const showSamosborText = uiElementEnabled('samosbor_text');
  const reducedHudMotion = hudMotionMode() === 'reduced';
  const interferenceMode = screenInterferenceMode();
  const netSphereOpen = isNetSphereOpen();
  const netTerminalGenOpen = isNetTerminalGenOpen();
  const emergencyPanelOpen = isEmergencyPanelMenuOpen();
  const mapEditorOpen = isMapEditorOpen();
  const netTerminalGenDeniedOpen = isNetTerminalGenDeniedOpen();
  const netTerminalBankOpen = isNetTerminalBankOpen();
  const gamblingOpen = isGamblingOverlayOpen();
  const computerOpen = isComputerOverlayOpen();
  const hackOpen = isNetHackOverlayOpen();
  const fastElevatorOpen = isFastElevatorOverlayOpen();
  const arenaOpen = isArenaOverlayOpen();
  const centerModalOpen = state.showInventory || state.showQuests || state.showLog ||
    state.showFactions || state.showDemos || state.showMenu || state.showHelp || state.showControls || state.showUiSettings ||
    state.showNpcMenu || state.showContainerMenu || state.showCraftMenu || netSphereOpen || netTerminalGenOpen ||
    emergencyPanelOpen || mapEditorOpen || gamblingOpen || computerOpen || hackOpen ||
    netTerminalGenDeniedOpen || netTerminalBankOpen || fastElevatorOpen || arenaOpen;
  const quietHud = centerModalOpen || state.mapMode === 2;
  const showCompactPanels = !quietHud;
  const screenFxVisible = !quietHud && showScreenFx && interferenceMode !== 'off';
  const combatFxVisible = !quietHud;
  const damageFeedbackVisible = showDamageFeedback && !quietHud;
  const smogStatus = getProceduralSmogStatus(world, player, state);
  const anomalySafetyVisible = showHazardWarning || showAnomalyHints;
  if (showCompactPanels && anomalySafetyVisible && smogStatus.inside) drawSmogVeil(ctx, w, h, time, smogStatus.intensity);

  // ── Bottom status bar (neuro-interface) ─────────────────
  const bottomVitals = slots.bottomVitals;
  const barY = bottomVitals.y;
  if (showCompactPanels && showBottomTabs) {
    drawNeuroPanel(ctx, bottomVitals.x, bottomVitals.y, bottomVitals.w, bottomVitals.h, time, 1);
  }

  if (showCompactPanels && showBottomTabs && player.needs) {
    const bars: [string, number, number, string][] = [
      ['ХП', player.hp ?? 100, player.maxHp ?? 100, '#e44'],
    ];
    if (player.rpg) {
      bars.push(['ПСИ', player.rpg.psi, player.rpg.maxPsi, '#a4f']);
    }
    bars.push(
      ['ЕДА', player.needs.food, 100, '#8a4'],
      ['ВОДА', player.needs.water, 100, '#48c'],
      ['СОН', player.needs.sleep, 100, '#a8f'],
      ['ТУАЛ', Math.max(0, 100 - player.needs.pee), 100, '#da4'],
    );
    if (player.rpg) {
      const capped = player.rpg.level >= RPG_LEVEL_CAP;
      bars.push(['XP', capped ? 1 : player.rpg.xp, capped ? 1 : xpForLevel(player.rpg.level + 1), '#af4']);
    }
    const barAreaW = Math.max(1, bottomVitals.w - 16 * sx);
    const barSpacing = Math.max(26 * sx, Math.min(62 * sx, barAreaW / bars.length));
    const vitalTextScale = Math.max(1, Math.min(sx, sy));
    const barW = Math.max(18 * sx, Math.min(BAR_W * sx, barSpacing - 8 * sx));
    bars.forEach(([label, current, max, color], i) => {
      const bx = bottomVitals.x + 8 * sx + i * barSpacing;
      const by = barY + 3 * sy;
      const pct = toPercent(current, max);
      const labelFont = VITAL_LABEL_FONT * vitalTextScale;
      const percentFont = VITAL_PERCENT_FONT * vitalTextScale;
      drawRoutineHudText(ctx, label, bx, by, time, i * 13 + 7, '#8cc', labelFont, reducedHudMotion);
      ctx.save();
      ctx.textAlign = 'right';
      drawRoutineHudText(ctx, formatVitalPercent(pct), bx + barW, by + 0.6 * sy, time, i * 19 + 101, '#9ac', percentFont, reducedHudMotion);
      ctx.restore();
      ctx.font = `${labelFont}px monospace`;
      // Holo bar
      drawHoloBar(ctx, bx, by + 9 * sy, barW, BAR_H * sy, pct, color, time, i);
    });
  }
  const needsWeaponReadiness = showCompactPanels && (showWeaponPanel || showCrosshair);
  const combatWeapon = needsWeaponReadiness ? getWeaponReadiness(player) : null;
  const combatTarget = showCompactPanels && showCrosshair ? findAimTarget(world, player, state) : null;

  const zhelemishLine = showCompactPanels && showStatusHints ? zhelemishHudLine(player, gameTime) : null;
  if (zhelemishLine) {
    const panelW = Math.min(180 * sx, bottomVitals.w);
    const panelH = 14 * sy;
    const panelX = bottomVitals.x + 4 * sx;
    const panelY = barY - panelH - 4 * sy;
    drawNeuroPanel(ctx, panelX, panelY, panelW, panelH, time, 185);
    ctx.font = `${7 * sy}px monospace`;
    ctx.fillStyle = '#9c6';
    ctx.fillText(fitHudText(ctx, zhelemishLine, panelW - 10 * sx), panelX + 5 * sx, panelY + 4 * sy);
  }

  const routeCue = getActiveRouteCueHud(state.time, state.currentFloor);
  const routeHintsVisible = showCompactPanels && showRouteHints && !state.samosborActive;
  const objectiveRoute = routeHintsVisible ? getObjectiveRouteHud(state, world, player) : null;
  const currentObjective = routeHintsVisible ? getCurrentObjective(state, entities) : null;
  const routeCueVisible = !!routeCue && routeHintsVisible;
  const smallCaravan = showCompactPanels && showCaravanHints ? getNearestSmallCaravan(state, world, player) : undefined;
  const smogIndicatorVisible = showCompactPanels && anomalySafetyVisible && smogStatus.active && (smogStatus.inside || smogStatus.sourceFound || smogStatus.handled);
  const perfDebug = options.perf ?? (options.fps !== undefined ? { fps: options.fps } : undefined);

  if (showCompactPanels && uiElementEnabled('fps_counter') && perfDebug) {
    const s = Math.max(1, Math.min(sx, sy));
    const fpsH = 28 * s;
    const fpsW = Math.min(slots.topLeftEvent.w, 224 * s);
    if (fpsW >= 96 * s) {
      const rect = allocateHudSlot(slots.topLeftEvent, fpsH, fpsW, 'left');
      drawFpsCounter(ctx, perfDebug, rect, sx, sy);
    }
  }

  // ── Stenographic summary: top-left event band ─────────
  if (showCompactPanels && showMessages && !state.samosborActive) {
    const s = Math.max(1, Math.min(sx, sy));
    const pad = 4 * s;
    const headerH = 8 * s;
    const rowH = 7.2 * s;
    const rowGap = 1.8 * s;
    const minimapReserve = showMinimap ? HUD_MINIMAP_UNITS * s + 6 * s : 0;
    const summaryRight = showMinimap
      ? Math.max(slots.safe.left, w - slots.safe.right - minimapReserve)
      : w - slots.safe.right;
    const summaryW = Math.max(0, summaryRight - slots.safe.left);
    const summarySlot = { ...slots.topLeftEvent, w: summaryW };
    const availableH = Math.max(0, summarySlot.y + summarySlot.h - summarySlot.cursorY);
    const maxPanelH = Math.min(availableH, Math.max(40 * s, h * 0.33));
    const plannedMsgs: Array<{
      msg: GameState['msgs'][number];
      index: number;
      stamp: string;
      stampW: number;
      lines: string[];
      h: number;
    }> = [];
    const scanStart = Math.max(0, state.msgs.length - MSG_SCAN_MAX);
    ctx.save();
    ctx.font = `${5.8 * s}px monospace`;
    const bodyW = Math.max(1, summaryW - pad * 2);
    let usedH = 0;
    for (let i = state.msgs.length - 1; i >= scanStart && plannedMsgs.length < MSG_MAX; i--) {
      const m = state.msgs[i];
      if (!hudMessageVisible(m.time, gameTime)) continue;
      if (m.hud === false) continue;
      const day = m.day;
      const hour = String(m.hour).padStart(2, '0');
      const minute = String(m.minute).padStart(2, '0');
      const dist = m.distanceMeters !== undefined ? ` ${Math.max(0, Math.round(m.distanceMeters))}м` : '';
      const stamp = `Д${day} ${hour}:${minute}${dist}`;
      const stampW = Math.min(58 * s, Math.max(34 * s, ctx.measureText(stamp).width + 5 * s));
      const textW = Math.max(42 * s, bodyW - stampW);
      const remainingH = maxPanelH - pad * 2 - headerH - usedH;
      const remainingLines = Math.max(1, Math.floor((remainingH - rowGap) / rowH));
      const maxLines = Math.min(HUD_SUMMARY_MAX_LINES_PER_MSG, remainingLines);
      const lines = wrapHudText(ctx, m.text, textW, maxLines);
      const itemH = Math.max(rowH, lines.length * rowH) + rowGap;
      if (pad * 2 + headerH + usedH + itemH > maxPanelH) {
        if (plannedMsgs.length === 0 && remainingLines > 0) {
          const clipped = wrapHudText(ctx, m.text, textW, remainingLines);
          plannedMsgs.push({ msg: m, index: i, stamp, stampW, lines: clipped, h: clipped.length * rowH });
        }
        break;
      }
      plannedMsgs.push({ msg: m, index: i, stamp, stampW, lines, h: itemH });
      usedH += itemH;
    }
    ctx.restore();
    if (plannedMsgs.length > 0 && summaryW >= 128 * s) {
      const panelH = Math.min(maxPanelH, pad * 2 + headerH + plannedMsgs.reduce((sum, item) => sum + item.h, 0));
      const rect = allocateHudSlot(summarySlot, panelH, summaryW, 'left');
      slots.topLeftEvent.cursorY = summarySlot.cursorY;
      const reserveY = rect.y + rect.h + summarySlot.gap;
      slots.topCenterCritical.cursorY = Math.max(slots.topCenterCritical.cursorY, reserveY);
      drawNeuroPanel(ctx, rect.x, rect.y, rect.w, rect.h, time, 306);
      drawStaticNoise(ctx, rect.x, rect.y, rect.w, rect.h, time, 0.006);

      ctx.save();
      ctx.textAlign = 'left';
      ctx.shadowBlur = 0;
      ctx.font = `${6.2 * s}px monospace`;
      const titleY = rect.y + pad + 2.5 * s;
      ctx.fillStyle = 'rgba(130,235,230,0.88)';
      ctx.fillText(fitHudText(ctx, 'СТЕНОСВОДКА', 78 * s), rect.x + pad, titleY);
      ctx.font = `${5.4 * s}px monospace`;
      ctx.fillStyle = 'rgba(82,110,126,0.84)';
      ctx.fillText(fitHudText(ctx, 'последние сообщения', Math.max(16 * s, rect.w - 92 * s)), rect.x + pad + 82 * s, titleY + 0.4 * s);
      ctx.strokeStyle = 'rgba(70,220,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(rect.x + pad, rect.y + pad + headerH);
      ctx.lineTo(rect.x + rect.w - pad, rect.y + pad + headerH);
      ctx.stroke();

      let my = rect.y + pad + headerH + 4 * s;
      for (const item of plannedMsgs) {
        const m = item.msg;
        const age = hudMessageAgeSeconds(m.time, gameTime);
        const alpha = age > HUD_MESSAGE_FADE_START_SECONDS
          ? 1 - (age - HUD_MESSAGE_FADE_START_SECONDS) / (HUD_MESSAGE_TTL_SECONDS - HUD_MESSAGE_FADE_START_SECONDS)
          : 1;
        const rowJitter = routineJitter(reducedHudMotion, time, item.index * 17 + 300);
        const rowY = my + rowJitter.dy * 0.28;
        ctx.globalAlpha = alpha * flicker(time, item.index + 300);
        ctx.font = `${5.3 * s}px monospace`;
        ctx.fillStyle = 'rgba(120,145,160,0.82)';
        ctx.fillText(fitHudText(ctx, item.stamp, item.stampW - 4 * s), rect.x + pad + rowJitter.dx * 0.28, rowY);
        ctx.fillStyle = m.color;
        ctx.font = `${5.8 * s}px monospace`;
        const textX = rect.x + pad + item.stampW;
        const textW = Math.max(32 * s, rect.x + rect.w - pad - textX);
        for (let line = 0; line < item.lines.length; line++) {
          ctx.fillText(fitHudText(ctx, item.lines[line], textW), textX + rowJitter.dx * 0.28, rowY + line * rowH);
        }
        my += item.h;
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  if (showCompactPanels && showMinimap) {
    const s = Math.max(1, Math.min(sx, sy));
    const mapSize = Math.max(48 * s, Math.min(HUD_MINIMAP_UNITS * s, slots.topRightNavigation.w, slots.topRightNavigation.h));
    const mapRect = allocateHudSlot(slots.topRightNavigation, mapSize, mapSize, 'right');
    drawMinimap(ctx, world, entities, player, sx, sy, state.quests, currentFloorInstanceLabel(state), state.currentFloor, state, time, mapRect);
  }
  if (objectiveRoute) {
    const rect = allocateHudSlot(slots.topRightNavigation, 46 * sy, 188 * sx, 'right');
    drawObjectiveRouteHint(ctx, rect, sx, sy, time, objectiveRoute);
  }
  if (currentObjective && !objectiveRoute) {
    const rect = allocateHudSlot(slots.topRightNavigation, 28 * sy, 188 * sx, 'right');
    drawCurrentObjectiveHint(ctx, rect, sx, sy, time, currentObjective);
  }
  if (routeCueVisible) {
    const rect = allocateHudSlot(slots.topRightNavigation, 35 * sy, 176 * sx, 'right');
    drawRouteCueHint(ctx, rect, sx, sy, time, gameTime, player, world, routeCue);
  }
  if (smallCaravan) {
    const rect = allocateHudSlot(slots.topRightNavigation, 29 * sy, 176 * sx, 'right');
    drawSmallCaravanHint(ctx, rect, sx, sy, time, smallCaravan);
  }
  if (smogIndicatorVisible) {
    const rect = allocateHudSlot(slots.topRightNavigation, 30 * sy, 154 * sx, 'right');
    drawSmogIndicator(ctx, rect, sx, sy, time, smogStatus);
  }
  // Weapon state — compact bottom-right panel, hidden under fullscreen overlays.
  if (showCompactPanels && showWeaponPanel && combatWeapon) {
    const weaponPanel = drawCombatWeaponPanel(ctx, combatWeapon, bottomVitals, sx, sy, time);

    if (player.tool) {
      const toolName = ITEMS[player.tool]?.name ?? player.tool;
      const toolDur = getEquippedToolDurability(player);
      const toolLabel = toolDur ? `${toolName} [${Math.max(0, Math.ceil(toolDur.cur))}/${toolDur.max}]` : toolName;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#8cf';
      if (weaponPanel.y > 14 * sy) {
        const s = Math.max(1, Math.min(sx, sy));
        ctx.fillText(fitHudText(ctx, toolLabel, weaponPanel.w), weaponPanel.x + weaponPanel.w - 2 * s, weaponPanel.y - 8 * s);
      }
      ctx.fillStyle = '#ccc';
    }
    ctx.textAlign = 'left';
  }

  if (showCompactPanels && showRouteHints) {
    drawVoidReturnPortalHint(ctx, slots.centerInteraction, sx, sy, time, player, state, world);
  }

  // Universal [E] interaction prompt (color changes per target object)
  const manualItemPickup = !autoPickupEnabled();
  if ((showInteractionPrompt || manualItemPickup) && showCompactPanels && !emergencyPanelOpen && !state.showControls && !state.showUiSettings) {
    const lookX = player.x + Math.cos(player.angle) * 1.5;
    const lookY = player.y + Math.sin(player.angle) * 1.5;
    const interaction = findInteractionTarget({
      world,
      state,
      player,
      entities,
      nextEntityId: { v: 0 },
      lookX,
      lookY,
      readOnly: true,
      routeHintsVisible,
      manualItemPickup,
    });
    if (interaction) {
      if (interaction.kind === 'item_drop') {
        drawItemPickupPanel(ctx, interaction, slots.centerInteraction, sx, sy, time);
      }
      if (showInteractionPrompt || interaction.kind === 'item_drop') {
        const targetId = interaction.colorSeed;
        // Deterministic color from targetId — shifted to cyan/teal palette
        const h0 = ((targetId * 2654435761) >>> 0) % 360;
        const er = Math.round(100 + 80 * Math.cos(h0 * Math.PI / 180));
        const eg = Math.round(200 + 55 * Math.cos((h0 + 120) * Math.PI / 180));
        const eb = Math.round(200 + 55 * Math.cos((h0 + 240) * Math.PI / 180));
        const eAlpha = flicker(time, targetId + 500);
        ctx.fillStyle = `rgba(${er},${eg},${eb},${eAlpha})`;
        ctx.font = `${9 * sy}px monospace`;
        ctx.textAlign = 'center';
        // Subtle glow behind
        ctx.shadowColor = `rgba(${er},${eg},${eb},0.4)`;
        ctx.shadowBlur = 6;
        const prompt = fitHudText(ctx, `${interactionPromptHint()}${interaction.prompt}`, slots.centerInteraction.w);
        ctx.fillText(prompt, slots.centerInteraction.x + slots.centerInteraction.w * 0.5, slots.centerInteraction.y);
        ctx.shadowBlur = 0;
        ctx.textAlign = 'left';
      }
    }
  }

  if (showCompactPanels && options.pointerLockHint && !state.gameOver) {
    drawPointerLockPrompt(ctx, w, h, sx, sy, time);
  }

  const hazardWarning = getPlayerHazardWarning(world, player);
  const hazardWarningVisible = !!hazardWarning && (showHazardWarning || hazardWarning.critical);

  const seroburmalineFx = showCompactPanels && showStatusHints ? getSeroburmalineHudFx(state) : null;
  if (seroburmalineFx) drawSeroburmalineNoLookFx(ctx, w, h, time, seroburmalineFx);

  // ── Crosshair (neuro-style) ──────────────────────────────
  if (showCompactPanels && showCrosshair) {
    const cj = routineJitter(reducedHudMotion, time, 999);
    const cAlpha = 0.4 + Math.sin(time * 2) * 0.08;
    const crossRgb = combatWeapon?.cannotFireReason ? '255,95,55'
      : combatTarget ? '255,210,80'
      : combatWeapon && combatWeapon.cooldown > 0.05 ? '90,180,255'
      : '0,220,200';
    ctx.strokeStyle = `rgba(${crossRgb},${cAlpha})`;
    ctx.lineWidth = 1;
    const cx = w / 2 + cj.dx * 0.3, cy = h / 2 + cj.dy * 0.3;
    ctx.beginPath();
    ctx.moveTo(cx - 6 * sx, cy); ctx.lineTo(cx - 2 * sx, cy);
    ctx.moveTo(cx + 2 * sx, cy); ctx.lineTo(cx + 6 * sx, cy);
    ctx.moveTo(cx, cy - 6 * sy); ctx.lineTo(cx, cy - 2 * sy);
    ctx.moveTo(cx, cy + 2 * sy); ctx.lineTo(cx, cy + 6 * sy);
    ctx.stroke();
    // Small dot center
    ctx.fillStyle = `rgba(${crossRgb},${cAlpha * 0.6})`;
    ctx.fillRect(cx - 0.5, cy - 0.5, 1, 1);
    if (combatWeapon && combatWeapon.cooldownPct > 0.02) {
      const r = 10 * Math.min(sx, sy);
      ctx.strokeStyle = `rgba(${crossRgb},0.48)`;
      ctx.lineWidth = Math.max(1, Math.min(sx, sy));
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * combatWeapon.readyPct);
      ctx.stroke();
    }
    drawCombatSightFeedback(ctx, combatTarget, sx, sy);
  }

  if (!quietHud && uiElementEnabled('npc_barks')) {
    drawWorldSpeechBubbles(ctx, world, player, entities, sx, sy, time);
  }

  // ── Zone info + time + room (neuro-interface left panel) ──
  if (showCompactPanels && showLocationPanel) {
    const pci = world.idx(Math.floor(player.x), Math.floor(player.y));
    const zid = world.zoneMap[pci];
    const zone = world.zones[zid];
    const territoryOwner = territoryOwnerAtIndex(world, pci);
    const floorEntry = currentFloorRunEntry(state);

    // Game clock + day counter — just above status bar
    const hh = String(state.clock.hour).padStart(2, '0');
    const mm = String(state.clock.minute).padStart(2, '0');
    const day = Math.floor(state.clock.totalMinutes / 1440);
    const floorInstance = currentFloorInstanceLabel(state);
    const leftX = bottomVitals.x + 4 * sx;
    const leftInfoW = Math.max(70 * sx, Math.min(220 * sx, bottomVitals.w - 8 * sx));
    if (floorInstance) {
      drawRoutineHudText(ctx, fitHudText(ctx, `Лифт ${floorInstance}`, leftInfoW), leftX, barY - 52 * sy, time, 404, '#f4a', 8 * sy, reducedHudMotion);
    }
    drawRoutineHudText(ctx, `День ${day}  ${hh}:${mm}`, leftX, barY - 42 * sy, time, 400, '#8ac', 9 * sy, reducedHudMotion);
    ctx.font = `${9 * sy}px monospace`;

    // Zone
    if (zone) {
      const [zr, zg, zb] = ZONE_COLORS[zid % 64];
      const fLabel = ZONE_FACTION_NAMES[territoryOwner];
      const zj = routineJitter(reducedHudMotion, time, 410);
      ctx.fillStyle = `rgba(${zr},${zg},${zb},${flicker(time, 411)})`;
      ctx.font = `${8 * sy}px monospace`;
      ctx.fillText(fitHudText(ctx, `■ Сектор ${zid + 1}  Ур.${zone.level ?? 1}`, leftInfoW), leftX + zj.dx, barY - 32 * sy + zj.dy);
      const fColor = territoryOwner === ZoneFaction.SAMOSBOR ? '#c4f' : '#7aa';
      drawRoutineHudText(ctx, fitHudText(ctx, `Терр. ${fLabel}`, leftInfoW), leftX, barY - 22 * sy, time, 412, fColor, 7 * sy, reducedHudMotion);
      ctx.font = `${7 * sy}px monospace`;
    }

    // Room info
    const room = world.roomAt(player.x, player.y);
    if (room) {
      drawRoutineHudText(ctx, fitHudText(ctx, room.name, leftInfoW), leftX, barY - 13 * sy, time, 420, '#688', 7 * sy, reducedHudMotion);
      ctx.font = `${7 * sy}px monospace`;
    }
    drawRoutineHudText(
      ctx,
      fitHudText(ctx, compactFloorLabel(floorEntry), leftInfoW),
      leftX,
      barY - 5.5 * sy,
      time,
      424,
      floorEntry.color,
      5.6 * sy,
      reducedHudMotion,
    );
  }

  // ── Full map menu ────────────────────────────────────────
  if (state.mapMode === 2) {
    drawFullMap(ctx, world, entities, player, sx, sy, state.quests, currentFloorInstanceLabel(state), state.currentFloor, state, time);
  }

  if (state.showMapLegend) {
    drawMapLegendMenu(ctx, world, player, state, sx, sy, time);
  }

  // ── Inventory (if toggled) ───────────────────────────────
  if (state.showInventory) {
    drawInventory(ctx, player, state, sx, sy, time);
  }

  // ── Quest log (if toggled) ───────────────────────────────
  if (state.showQuests) {
    drawQuestLog(ctx, state, msx, msy, time, getCurrentObjective(state, entities));
  }

  // ── Faction relations matrix (F) ─────────────────────────
  if (state.showFactions) {
    drawFactionMenu(ctx, player, entities, state, msx, msy, time);
  }

  // ── Инфосеть Демос ─────────────────────────────────────
  if (state.showDemos) {
    drawDemosMenu(ctx, state, entities, msx, msy, time);
  }

  // ── Message log (L) ─────────────────────────────────────
  if (state.showLog) {
    drawLogMenu(ctx, state, msx, msy, time);
  }

  // ── Controls / keybinds (Tab) ────────────────────────────
  if (state.showControls) {
    drawControlsMenu(ctx, state, msx, msy, time);
  }

  // ── One-page HELP poster (F1) ────────────────────────────
  if (state.showHelp) {
    drawHelpMenu(ctx, state, msx, msy, time);
  }

  // ── UI orchestrator (U) ──────────────────────────────────
  if (state.showUiSettings) {
    drawUiSettingsMenu(ctx, state, msx, msy, time);
  }

  // ── Game menu (Enter) ────────────────────────────────────
  if (state.showMenu) {
    drawGameMenu(ctx, state, msx, msy, time);
  }

  // ── Feedback / Credits menu ──────────────────────────────
  if (state.showFeedback) {
    drawFeedbackMenu(ctx, state, msx, msy, time);
  }

  // ── NPC interaction menu ─────────────────────────────────
  if (state.showNpcMenu) {
    drawNpcMenu(ctx, player, state, entities, msx, msy, time);
  }

  // ── Container menu ──────────────────────────────────────
  if (state.showContainerMenu) {
    drawContainerMenu(ctx, player, state, world, msx, msy);
  }

  if (state.showCraftMenu) {
    drawCraftMenu(ctx, player, state, msx, msy, time);
  }

  if (emergencyPanelOpen) {
    drawEmergencyPanelMenu(ctx, player, msx, msy, time);
  }

  const liftArachnaWarning = getLiftArachnaWarningSnapshot(state);
  if (liftArachnaWarning && !state.gameOver) {
    const rect = allocateHudSlot(
      slots.topCenterCritical,
      32 * sy,
      Math.min(w - 12 * sx, 210 * sx),
      'center',
    );
    drawLiftArachnaWarning(ctx, w, sx, sy, time, liftArachnaWarning, rect.y);
  }
  if (showSamosborText && !state.samosborActive && !state.gameOver) {
    const samosborWarning = getSamosborWarningSnapshot(state);
    if (samosborWarning) {
      const compactCritical = centerModalOpen;
      const rect = allocateHudSlot(
        slots.topCenterCritical,
        (compactCritical ? 24 : 32) * sy,
        Math.min(w - 12 * sx, (compactCritical ? 250 : 310) * sx),
        'center',
      );
      drawSamosborWarningInstruction(ctx, w, sx, sy, time, samosborWarning, rect.y, compactCritical);
    }
  }
  if (hazardWarningVisible && hazardWarning && !state.gameOver && (!centerModalOpen || hazardWarning.critical)) {
    const panelW = Math.min(w - 16 * sx, 230 * sx);
    const panelH = 28 * sy;
    const rect = allocateHudSlot(slots.topCenterCritical, panelH, panelW, 'center');
    drawNeuroPanel(ctx, rect.x, rect.y, rect.w, rect.h, time, 520);
    ctx.textAlign = 'center';
    ctx.shadowColor = hazardWarning.color;
    ctx.shadowBlur = hazardWarning.trapped ? 9 : 4;
    drawGlitchText(ctx, hazardWarning.title, rect.x + rect.w * 0.5, rect.y + 4 * sy, time * 2, 521, hazardWarning.color, 10 * sy);
    ctx.shadowBlur = 0;
    ctx.font = `${7 * sy}px monospace`;
    ctx.fillStyle = '#f0c8c8';
    ctx.fillText(fitHudText(ctx, hazardWarning.detail, rect.w - 12 * sx), rect.x + rect.w * 0.5, rect.y + 17 * sy);
    ctx.textAlign = 'left';
  }
  if (showSamosborText && state.samosborActive) {
    const activeInstruction = getSamosborActiveInstructionSnapshot(state);
    if (activeInstruction) {
      const compactCritical = centerModalOpen;
      const rect = allocateHudSlot(
        slots.topCenterCritical,
        (compactCritical ? 24 : 30) * sy,
        w - 12 * sx,
        'center',
      );
      drawSamosborActiveInstruction(ctx, w, sx, sy, time, activeInstruction, rect.y, compactCritical);
      drawSamosborCrawl(ctx, w, h, sx, sy, time, activeInstruction.variantId, activeInstruction.tint);
    }
    if (screenFxVisible && activeInstruction) {
      drawStaticNoise(ctx, 0, 0, w, h, time, 0.04);
      if (activeInstruction.variantId === 'maronary') drawMaronaryProofNoise(ctx, w, h, time, 0.85);
      if (activeInstruction.variantId === 'veretar') drawVeretarVeil(ctx, w, h, time, 0.85);
    }
  }
  // ── Damage vignette (procedural blood edges) ──────────────
  if (damageFeedbackVisible && state.dmgFlash > 0) {
    drawDamageVignette(ctx, w, h, state.dmgFlash, state.dmgSeed, time);
  }

  // ── PSI Beam visual (Kamehameha) ──────────────────────────
  if (combatFxVisible && state.beamFx > 0) {
    drawBeamFx(ctx, w, h, state.beamFx, state.beamAngle, state.beamLen, player.angle, time);
  }
  if (combatFxVisible && state.uvBeamFx > 0) {
    drawUvSpotlightFx(ctx, w, h, state.uvBeamFx, state.uvBeamLen, time);
  }

  // ── Game over (neuro-interface death) ─────────────────────
  if (state.gameOver && state.gameWon) {
    // Victory end screen — black fade-in
    const winAlpha = Math.min(1, state.deathTimer * 0.4);
    ctx.fillStyle = `rgba(0,0,0,${winAlpha})`;
    ctx.fillRect(0, 0, w, h);

    if (state.deathTimer > 1) {
      const textAlpha = Math.min(1, (state.deathTimer - 1) * 0.5);
      const dj = textJitter(time * 0.5, 999);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,255,128,0.4)';
      ctx.shadowBlur = 20;
      ctx.fillStyle = `rgba(200,255,200,${textAlpha})`;
      ctx.font = `bold ${28 * sy}px monospace`;
      ctx.fillText('КОНЕЦ ИГРЫ', w / 2 + dj.dx, h / 2 - 20 * sy + dj.dy);
      ctx.fillStyle = `rgba(0,200,100,${textAlpha * 0.15})`;
      ctx.fillText('КОНЕЦ ИГРЫ', w / 2 + dj.dx + 3, h / 2 - 20 * sy + dj.dy + 1);
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(136,170,136,${Math.min(1, (state.deathTimer - 2) * 0.4)})`;
      ctx.font = `${10 * sy}px monospace`;
      ctx.fillText(fitHudText(ctx, voidReturnVictoryLine(state), w * 0.82), w / 2, h / 2 + 10 * sy);
      ctx.fillText('[R] — заново', w / 2, h / 2 + 30 * sy);
      ctx.textAlign = 'left';
      ctx.restore();
    }
  } else if (state.gameOver) {
    const deathAlpha = Math.min(0.5, state.deathTimer * 0.15);
    const grd = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.min(w, h) * 0.7);
    grd.addColorStop(0, `rgba(0,0,0,0)`);
    grd.addColorStop(1, `rgba(0,0,0,${deathAlpha})`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);

    // Intense static noise
    drawStaticNoise(ctx, 0, 0, w, h, time, 0.06 * Math.min(1, state.deathTimer * 0.3));

    const textAlpha = 0.6 + Math.sin(time * 3) * 0.3;
    const dj = textJitter(time * 2, 777);
    ctx.save();
    ctx.shadowColor = 'rgba(255,0,0,0.5)';
    ctx.shadowBlur = 15;
    ctx.fillStyle = `rgba(200,0,0,${textAlpha})`;
    ctx.font = `bold ${24 * sy}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('ВЫ ПОГИБЛИ', w / 2 + dj.dx * 2, h / 2 - 20 * sy + dj.dy);
    // RGB split ghost
    ctx.fillStyle = `rgba(0,200,200,${textAlpha * 0.15})`;
    ctx.fillText('ВЫ ПОГИБЛИ', w / 2 + dj.dx * 2 + 3, h / 2 - 20 * sy + dj.dy + 1);
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(136,136,136,${Math.min(1, state.deathTimer * 0.5)})`;
    const deathCause = inferDeathCause(state, player, world);
    ctx.font = `${10 * sy}px monospace`;
    ctx.fillText(deathCause.title, w / 2, h / 2 + 10 * sy);
    ctx.font = `${8 * sy}px monospace`;
    ctx.fillText(fitHudText(ctx, deathCause.detail, w * 0.82), w / 2, h / 2 + 24 * sy);
    ctx.font = `${10 * sy}px monospace`;
    ctx.fillText('[R] — заново', w / 2, h / 2 + 44 * sy);
    ctx.fillText('[Enter] — продолжить путь', w / 2, h / 2 + 60 * sy);
    ctx.fillText('за случайного человека', w / 2, h / 2 + 74 * sy);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // ── Debug screen (~) ─────────────────────────────────────
  if (state.showDebug) {
    drawDebugOverlay(ctx, sx, sy, w, h, world, entities, state, state.debugSel);
  }

  // ── NET Sphere terminal (N) ──────────────────────────────
  if (netSphereOpen) {
    drawNetSphereMenu(ctx, msx, msy, time, getNetSphereSnapshot());
  }


  if (arenaOpen) {
    const arena = getArenaOverlaySnapshot();
    drawArenaOverlay(ctx, msx, msy, time, arena);
  }

  if (gamblingOpen) {
    const gambling = getGamblingOverlaySnapshot(player);
    drawGamblingOverlay(ctx, msx, msy, time, gambling);
  }

  if (computerOpen) {
    const computer = getComputerOverlaySnapshot(world, state);
    drawComputerOverlay(ctx, msx, msy, time, computer);
  }

  if (hackOpen) {
    const hack = getNetHackOverlaySnapshot(world, state, player);
    drawNetHackOverlay(ctx, msx, msy, time, hack);
  }

  if (fastElevatorOpen) {
    drawFastElevatorOverlay(ctx, msx, msy, time, getFastElevatorOverlaySnapshot(player), player);
  }

  if (netTerminalGenDeniedOpen) {
    const terminal = getNetTerminalGenRuntimeSnapshot();
    drawNetTerminalGenDenied(ctx, msx, msy, time, {
      status: 'locked',
      code: terminal.terminalIdx >= 0 ? `IDX ${terminal.terminalIdx}` : undefined,
      lines: [
        'НЕТ-ГЕН не найден.',
        'Банковский счёт доступен, редактор карты закрыт.',
      ],
      footer: `${menuCloseHint()} закрыть  |  счёт без ГЕН`,
    });
  }

  if (netTerminalBankOpen) {
    drawNetTerminalBank(ctx, msx, msy, time, getNetTerminalBankSnapshot(state, player));
  }

  if (mapEditorOpen) {
    drawMapEditor(ctx, msx, msy, time, world, entities, player, {
      ...getMapEditorSnapshot(state),
      terminals: getNetTerminalGenTerminals(),
    });
  }

  // ── Sleep overlay (Z held) ───────────────────────────────
  if (damageFeedbackVisible && state.sleeping) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#a8f';
    ctx.font = `bold ${16 * sy}px monospace`;
    ctx.textAlign = 'center';
    const sleepPct = Math.floor(player.needs?.sleep ?? 0);
    ctx.fillText(`Сон: ${sleepPct}%`, w / 2, h / 2 - 10 * sy);
    ctx.fillStyle = '#666';
    ctx.font = `${8 * sy}px monospace`;
    ctx.fillText('[Z] — отпустите чтобы проснуться', w / 2, h / 2 + 10 * sy);
    ctx.textAlign = 'left';
  }

  // ── Global neuro-interface overlay ──────────────────────
  if (screenFxVisible) {
    drawStaticNoise(ctx, 0, 0, w, h, time * 0.55, interferenceMode === 'full' ? 0.008 : 0.0035);
    drawGlitchLine(ctx, w, h, time);
  }

  if (options.pointerCaptureGate) {
    drawPointerCaptureGate(ctx, time);
  }

  ctx.restore();
}

/* ── Procedural damage vignette (blood vessel edges) ──────────── */
function drawDamageVignette(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  intensity: number, seed: number, time: number,
): void {
  ctx.save();

  // BFG green flash (seed === 2), explosion orange (seed === 3), normal red damage
  const isGreen = seed === 2;
  const isOrange = seed === 3;
  const cR = isGreen ? 0 : 1;
  const cG = isGreen ? 1 : isOrange ? 0.6 : 0;

  // Edge darkening — radial gradient from center
  const darkA = intensity * 0.4;
  const grd = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.min(w, h) * 0.65);
  grd.addColorStop(0, `rgba(0,0,0,0)`);
  grd.addColorStop(0.6, `rgba(${40 * cR},${Math.floor(40 * cG)},0,${darkA * 0.3})`);
  grd.addColorStop(1, `rgba(0,0,0,${darkA})`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  // Color overlay with radial gradient (transparent center, colored edges)
  const colA = intensity * (isGreen ? 0.7 : 0.5);
  const grd2 = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.min(w, h) * 0.6);
  grd2.addColorStop(0, `rgba(${180 * cR},${180 * cG},0,0)`);
  grd2.addColorStop(0.5, `rgba(${140 * cR},${140 * cG},0,${colA * 0.2})`);
  grd2.addColorStop(1, `rgba(${120 * cR},${120 * cG},0,${colA})`);
  ctx.fillStyle = grd2;
  ctx.fillRect(0, 0, w, h);

  // Procedural blood vessel lines from edges
  ctx.globalCompositeOperation = 'source-over';
  const numVeins = 8 + Math.floor(intensity * 12);
  const s = seed;
  for (let i = 0; i < numVeins; i++) {
    // Seeded pseudo-random for consistent pattern per hit
    const r1 = ((Math.sin(s + i * 127.1) * 43758.5453) % 1 + 1) % 1;
    const r2 = ((Math.sin(s + i * 269.5 + 311.7) * 43758.5453) % 1 + 1) % 1;
    const r3 = ((Math.sin(s + i * 419.2 + 631.2) * 43758.5453) % 1 + 1) % 1;
    const r4 = ((Math.sin(s + i * 173.9 + 967.3) * 43758.5453) % 1 + 1) % 1;

    // Start from a random edge
    const edge = Math.floor(r1 * 4);
    let sx: number, sy: number;
    if (edge === 0) { sx = r2 * w; sy = 0; }           // top
    else if (edge === 1) { sx = r2 * w; sy = h; }      // bottom
    else if (edge === 2) { sx = 0; sy = r2 * h; }      // left
    else { sx = w; sy = r2 * h; }                       // right

    // Draw branching vein toward center
    const veinAlpha = intensity * (0.2 + r3 * 0.4);
    const veinLen = (0.1 + r4 * 0.25) * Math.min(w, h);
    const toX = w / 2 + (r3 - 0.5) * w * 0.3;
    const toY = h / 2 + (r4 - 0.5) * h * 0.3;
    const dx = toX - sx, dy = toY - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx = dx / dist, ny = dy / dist;

    ctx.beginPath();
    ctx.moveTo(sx, sy);

    // Main vein with slight organic wobble
    const steps = 6;
    let cx = sx, cy = sy;
    for (let j = 1; j <= steps; j++) {
      const t = j / steps;
      const wobbleT = Math.sin(time * 3 + i * 2 + j) * (4 + r2 * 8);
      cx = sx + nx * veinLen * t + ny * wobbleT;
      cy = sy + ny * veinLen * t - nx * wobbleT;
      ctx.lineTo(cx, cy);
    }

    const lineW = 1 + r3 * 2.5 * intensity;
    ctx.strokeStyle = `rgba(${160 * cR},${160 * cG},10,${veinAlpha})`;
    ctx.lineWidth = lineW;
    ctx.stroke();

    // Thinner branch
    if (r2 > 0.4 && i < numVeins - 2) {
      const bx = sx + nx * veinLen * 0.5 + ny * (r4 - 0.5) * 20;
      const by = sy + ny * veinLen * 0.5 - nx * (r4 - 0.5) * 20;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + nx * veinLen * 0.2 + ny * (r1 - 0.5) * 30,
                 by + ny * veinLen * 0.2 - nx * (r1 - 0.5) * 30);
      ctx.strokeStyle = `rgba(${130 * cR},${130 * cG},10,${veinAlpha * 0.6})`;
      ctx.lineWidth = lineW * 0.5;
      ctx.stroke();
    }
  }

  ctx.restore();
}

/* ── UV spotlight visual — centered cyan-white utility cone ───── */
function drawUvSpotlightFx(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  intensity: number,
  beamLen: number,
  time: number,
): void {
  ctx.save();
  const alpha = Math.min(1, intensity * 4);
  const beamT = Math.min(1, Math.max(0, beamLen / 10));
  const cx = w / 2;
  const originY = h * 0.64;
  const focusY = h * (0.44 - beamT * 0.06);
  const nearW = h * (0.014 + intensity * 0.014);
  const farW = Math.min(w * 0.34, h * (0.12 + beamT * 0.11));
  const wobble = Math.sin(time * 42) * h * 0.003;

  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const layer = i / 2;
    const grd = ctx.createLinearGradient(cx, originY, cx, focusY);
    grd.addColorStop(0, `rgba(235,255,255,${alpha * (0.28 - layer * 0.05)})`);
    grd.addColorStop(0.48, `rgba(150,230,255,${alpha * (0.22 - layer * 0.04)})`);
    grd.addColorStop(1, 'rgba(130,220,255,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(cx - nearW * (1 + layer), originY + wobble);
    ctx.lineTo(cx - farW * (1 + layer * 0.35), focusY);
    ctx.lineTo(cx + farW * (1 + layer * 0.35), focusY);
    ctx.lineTo(cx + nearW * (1 + layer), originY + wobble);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = `rgba(230,255,255,${alpha * 0.72})`;
  ctx.lineWidth = Math.max(1, h * 0.003);
  ctx.beginPath();
  ctx.moveTo(cx, originY + wobble);
  ctx.lineTo(cx + Math.sin(time * 58) * h * 0.006, focusY);
  ctx.stroke();

  for (let i = 0; i < 5; i++) {
    const t0 = (i + 1) / 6;
    const x = cx + Math.sin(time * 24 + i * 1.7) * farW * 0.34 * t0;
    const y = originY + (focusY - originY) * t0;
    ctx.strokeStyle = `rgba(150,235,255,${alpha * 0.22})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - farW * 0.06 * t0, y);
    ctx.lineTo(x + farW * 0.05 * t0, y + Math.cos(time * 31 + i) * farW * 0.08);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

/* ── PSI Beam visual (Kamehameha) — bright purple beam from center ── */
function drawBeamFx(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  intensity: number,
  _beamAngle: number,
  _beamLen: number,
  _playerAngle: number,
  time: number,
): void {
  ctx.save();
  const alpha = Math.min(1, intensity * 2.5); // fade from ~0.85 to 0

  const cx = w / 2;
  const cy = h / 2;
  const beamEndX = w;

  // ── Fullscreen purple flash ──
  const flashA = intensity * 0.4;
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
  grd.addColorStop(0, `rgba(180,40,255,${flashA})`);
  grd.addColorStop(0.3, `rgba(120,20,200,${flashA * 0.6})`);
  grd.addColorStop(1, `rgba(40,0,80,0)`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  // ── Central beam core — horizontal bands ──
  const beamH = h * 0.12 * (0.5 + intensity * 0.5);
  const wobble = Math.sin(time * 30) * beamH * 0.08;

  for (let i = 0; i < 3; i++) {
    const spread = beamH * (0.15 + i * 0.3);
    const lineA = alpha * (1 - i * 0.3);
    const r = i === 0 ? 255 : i === 1 ? 200 : 140;
    const g = i === 0 ? 220 : i === 1 ? 80 : 20;
    const b = 255;
    const grdBeam = ctx.createLinearGradient(0, cy, w, cy);
    grdBeam.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grdBeam.addColorStop(0.15, `rgba(${r},${g},${b},${lineA * 0.3})`);
    grdBeam.addColorStop(0.4, `rgba(${r},${g},${b},${lineA})`);
    grdBeam.addColorStop(0.5, `rgba(${r},${g},${b},${lineA})`);
    grdBeam.addColorStop(0.6, `rgba(${r},${g},${b},${lineA})`);
    grdBeam.addColorStop(0.85, `rgba(${r},${g},${b},${lineA * 0.3})`);
    grdBeam.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grdBeam;
    ctx.fillRect(0, cy - spread + wobble, w, spread * 2);
  }

  // ── Energy tendrils along beam ──
  ctx.globalCompositeOperation = 'lighter';
  const tendrilCount = 6;
  for (let i = 0; i < tendrilCount; i++) {
    const phase = time * 20 + i * 1.7;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const segs = 12;
    for (let j = 1; j <= segs; j++) {
      const t = j / segs;
      const px = cx + (beamEndX - cx) * t;
      const py = cy + Math.sin(phase + t * 8) * beamH * 0.5 * t
        + Math.cos(phase * 1.3 + t * 12) * beamH * 0.2;
      ctx.lineTo(px, py);
    }
    ctx.strokeStyle = `rgba(180,100,255,${alpha * 0.4})`;
    ctx.lineWidth = 1.5 + intensity * 2;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';

  // ── Muzzle flash (hot center dot) ──
  const dotR = Math.min(w, h) * 0.04 * (0.5 + intensity);
  const dotGrd = ctx.createRadialGradient(cx, cy + wobble, 0, cx, cy + wobble, dotR);
  dotGrd.addColorStop(0, `rgba(255,255,255,${alpha})`);
  dotGrd.addColorStop(0.3, `rgba(220,180,255,${alpha * 0.8})`);
  dotGrd.addColorStop(1, `rgba(140,40,220,0)`);
  ctx.fillStyle = dotGrd;
  ctx.fillRect(cx - dotR, cy - dotR + wobble, dotR * 2, dotR * 2);

  ctx.restore();
}
