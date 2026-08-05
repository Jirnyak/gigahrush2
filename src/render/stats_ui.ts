/* ── Inventory panel (fullscreen) ──────────────────────────────── */

import { type Entity, type GameState, ItemType, DamageType } from '../core/types';
import { ITEMS, WEAPON_STATS } from '../data/catalog';
import { getEquippedToolDurability, getWeaponReadiness } from '../systems/inventory';
import { MAX_INVENTORY_SLOTS } from '../data/inventory_limits';
import { controlHint, menuCloseHint } from '../systems/controls';
import {
  rpgStatEffects,
  rpgStatEffectsAfterSpend,
  RPG_LEVEL_CAP,
  xpForLevel,
  type RPGStatEffects,
} from '../systems/rpg';
import { zhelemishStatsLine } from '../systems/status';
import { drawNeuroPanel, drawGlitchText, textJitter, flicker } from './hud_fx';
import { fitText as fitStatText, formatUiNumber, wrapTextLines } from './ui_text';
import { drawInventoryFinanceBlock, readFinanceSnapshot } from './economy_ui';
import { fullscreenInventoryLayout } from './ui_layout';
import { drawItemGridIcon } from './item_sprites';

export function drawInventory(
  ctx: CanvasRenderingContext2D,
  player: Entity, state: GameState,
  sx: number, sy: number,
  uiTime = state.time,
): void {
  const inv = player.inventory ?? [];
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const time = uiTime;
  const layout = fullscreenInventoryLayout(cw, ch, sx, sy);
  sx = layout.scale;
  sy = layout.scale;
  const ts = layout.textScale;
  const gridCols = layout.grid.cols;
  const gridRows = layout.grid.rows;

  // Fullscreen neuro-panel background
  ctx.fillStyle = '#00040a';
  ctx.fillRect(0, 0, cw, ch);
  drawNeuroPanel(ctx, 0, 0, cw, ch, time, 80);

  // Title + money + close hint
  drawGlitchText(ctx, 'ИНВЕНТАРЬ', 8 * sx, 9 * ts, time, 800, '#6cf', 7.2 * ts);
  ctx.font = `${7.2 * ts}px monospace`;
  const finance = readFinanceSnapshot(player, state);
  const mj = textJitter(time, 801);
  ctx.fillStyle = `rgba(238,238,68,${flicker(time, 802)})`;
  const titleMoney = finance.hasBanking
    ? `₽${Math.round(finance.cash)} сч ${Math.round(finance.accountRubles)}`
    : `₽${Math.round(finance.cash)}`;
  ctx.fillText(fitStatText(ctx, titleMoney, 92 * ts), 96 * ts + mj.dx, 9 * ts + mj.dy);
  ctx.fillStyle = '#456';
  ctx.font = `${5.8 * ts}px monospace`;
  ctx.textAlign = 'right';
  ctx.fillText(`${menuCloseHint()} закрыть`, cw - 8 * ts, 9 * ts);
  ctx.textAlign = 'left';

  // ── LEFT COLUMN: grid + item desc + weapon + money ───────
  const cellSz = layout.grid.cell;
  const gridX = layout.grid.x;
  const gridY = layout.grid.y;

  // Armor slot
  const armorRect = layout.armor;
  const armorSelected = state.invSel === MAX_INVENTORY_SLOTS;
  ctx.fillStyle = armorSelected ? 'rgba(0,60,50,0.6)' : 'rgba(5,15,20,0.8)';
  ctx.fillRect(armorRect.x, armorRect.y, armorRect.w - 2, armorRect.h - 2);
  ctx.strokeStyle = armorSelected ? 'rgba(0,255,200,0.6)' : 'rgba(0,100,80,0.25)';
  ctx.strokeRect(armorRect.x, armorRect.y, armorRect.w - 2, armorRect.h - 2);

  ctx.fillStyle = '#888';
  ctx.font = `${5 * sy}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('БРОНЯ', armorRect.x + armorRect.w / 2, armorRect.y - 4 * sy);
  ctx.textAlign = 'left';

  if (player.armorDefId) {
    const armorDef = ITEMS[player.armorDefId];
    drawItemGridIcon(ctx, player.armorDefId, armorDef?.name ?? player.armorDefId, armorRect.x, armorRect.y, armorRect.w, sx * 2, sy * 2, armorSelected, armorSelected ? 1 : 0.86);
  }

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const idx = row * gridCols + col;
      const cx = gridX + col * cellSz;
      const cy = gridY + row * cellSz;
      const selected = idx === state.invSel;

      ctx.fillStyle = selected ? 'rgba(0,60,50,0.6)' : 'rgba(5,15,20,0.8)';
      ctx.fillRect(cx, cy, cellSz - 2, cellSz - 2);
      ctx.strokeStyle = selected ? 'rgba(0,255,200,0.6)' : 'rgba(0,100,80,0.25)';
      ctx.strokeRect(cx, cy, cellSz - 2, cellSz - 2);

      if (idx < inv.length) {
        const item = inv[idx];
        const def = ITEMS[item.defId];
        drawItemGridIcon(ctx, item.defId, def?.name ?? item.defId, cx, cy, cellSz, sx, sy, selected, selected ? 1 : 0.86);
        if (item.count > 1) {
          ctx.fillStyle = '#6a8';
          ctx.font = `${5 * sy}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(`×${item.count}`, cx + cellSz / 2, cy + cellSz - 5 * sy);
          ctx.textAlign = 'left';
        }
      }
    }
  }

  const damageTypeLabel = (dt: DamageType | undefined) => {
    switch (dt) {
      case DamageType.FIRE: return { text: '🔴 огонь', color: '#f64' };
      case DamageType.ENERGY: return { text: '🔵 энерго', color: '#4cf' };
      case DamageType.PSI: return { text: '🟣 пси', color: '#c6f' };
      case DamageType.BUCKSHOT: return { text: '🟡 дробь', color: '#ec4' };
      case DamageType.KINETIC:
      default: return { text: '⚫ кинетика', color: '#aaa' };
    }
  };

  // Selected item details live in the right column so the 8x8 grid keeps the left side.
  const details = layout.details;
  ctx.textAlign = 'left';

  const isArmorSelected = state.invSel === MAX_INVENTORY_SLOTS;
  const validArmorSelection = isArmorSelected && player.armorDefId;
  const validInvSelection = !isArmorSelected && state.invSel < inv.length;

  if (validInvSelection || validArmorSelection) {
    const item = validInvSelection ? inv[state.invSel] : { defId: player.armorDefId!, count: 1 };
    const def = ITEMS[item.defId];
    if (def) {
      ctx.fillStyle = '#ccc';
      ctx.font = `${6.2 * ts}px monospace`;
      ctx.fillText(fitStatText(ctx, `${def.name} ×${item.count}`, details.w), details.x, details.y);
      ctx.fillStyle = '#888';
      ctx.font = `${4.8 * ts}px monospace`;
      let infoY = details.y + 7.5 * ts;
      const descLines = wrapTextLines(ctx, def.desc, details.w, 2, { stable: true, mode: 'clip' });
      for (const line of descLines) {
        ctx.fillText(line, details.x, infoY);
        infoY += 5.8 * ts;
      }
      if (def.type === ItemType.WEAPON) {
        const ws = WEAPON_STATS[def.id];
        if (ws) {
          const dt = damageTypeLabel(ws.damageType);
          ctx.fillStyle = dt.color;
          ctx.fillText(`Урон: ${dt.text}`, details.x, infoY);
          infoY += 5.8 * ts;
        }
      }

      if (def.resistances) {
        ctx.fillStyle = '#8cf';
        ctx.fillText('Сопротивления:', details.x, infoY);
        infoY += 5.8 * ts;
        for (const [dtStr, val] of Object.entries(def.resistances)) {
          const dt = parseInt(dtStr, 10) as DamageType;
          if (!isNaN(dt) && val) {
            const dtInfo = damageTypeLabel(dt);
            ctx.fillStyle = dtInfo.color;
            ctx.fillText(`  ${dtInfo.text}: ${val}%`, details.x, infoY);
            infoY += 5.8 * ts;
          }
        }
      }

      ctx.fillStyle = '#da4';
      ctx.font = `${5.1 * ts}px monospace`;
      ctx.fillText(fitStatText(ctx, `Цена: ${def.value ?? 0}₽`, details.w), details.x, infoY + 1.4 * ts);

      if (isArmorSelected) {
        ctx.fillStyle = '#a86';
        ctx.fillText(fitStatText(ctx, `${controlHint('gameMenu')} снять броню`, layout.use.w), layout.use.x, layout.use.y + 7.4 * ts);
      } else if (def.use || def.type === ItemType.WEAPON || def.type === ItemType.TOOL) {
        ctx.fillStyle = '#6a6';
        ctx.fillText(fitStatText(ctx, `${controlHint('gameMenu')} использовать`, layout.use.w), layout.use.x, layout.use.y + 7.4 * ts);
      }
      ctx.fillStyle = '#a86';
      ctx.fillText(fitStatText(ctx, `${controlHint('drop')} выкинуть`, layout.drop.w), layout.drop.x, layout.drop.y + 7.4 * ts);
    }
  } else {
    ctx.fillStyle = '#555';
    ctx.font = `${5.2 * ts}px monospace`;
    ctx.fillText('Пустой слот', details.x, details.y + 6.5 * ts);
  }

  // ── RIGHT COLUMN: stats ──────────────────────────────────
  const stX = details.x;
  const barW = Math.max(24 * sx, details.w);
  let stY = details.y + details.h + 5 * ts;
  const contentBottom = Math.min(ch - 6 * ts, layout.grid.y + layout.grid.h - 2 * ts);

  // Name + Level + Attributes on same row
  ctx.fillStyle = '#ee4';
  ctx.font = `${6.4 * ts}px monospace`;
  const nameStr = player.name ?? 'Вы';
  const titleLine = player.rpg ? `${nameStr}  Ур.${player.rpg.level}` : nameStr;
  ctx.fillText(fitStatText(ctx, titleLine, barW), stX, stY);
  stY += 8.2 * ts;

  // Attributes in their own compact row to avoid name/level overlap.
  if (player.rpg) {
    const rpg = player.rpg;
    const apLabel = rpg.attrPoints > 0 ? `  +${rpg.attrPoints}` : '';
    const attrLine = `${controlHint('attrStr')}СИЛ:${rpg.str}  ${controlHint('attrAgi')}ЛОВ:${rpg.agi}  ${controlHint('attrInt')}ИНТ:${rpg.int}${apLabel}`;
    ctx.font = `${5.3 * ts}px monospace`;
    ctx.fillStyle = '#e84';
    ctx.fillText(fitStatText(ctx, attrLine, barW), stX, stY);
    stY += 7.2 * ts;
  }

  // Attribute points (always visible)
  if (player.rpg) {
    ctx.fillStyle = player.rpg.attrPoints > 0 ? '#ee4' : '#888';
    ctx.font = `${5.1 * ts}px monospace`;
    ctx.fillText(`Очков характеристик: ${player.rpg.attrPoints}`, stX, stY);
    stY += 6.4 * ts;
    stY = drawRpgEffectBlock(ctx, player, stX, stY, barW, ts);
  }

  // XP bar
  if (player.rpg) {
    const capped = player.rpg.level >= RPG_LEVEL_CAP;
    const xpNeeded = capped ? 1 : xpForLevel(player.rpg.level + 1);
    stY = drawCompactMeter(
      ctx,
      capped ? `XP: максимум ${RPG_LEVEL_CAP}` : `XP: ${player.rpg.xp}/${xpNeeded}`,
      stX,
      stY,
      barW,
      ts,
      capped ? 1 : player.rpg.xp / xpNeeded,
      '#af4',
      '#8a8',
    );
  }

  // HP bar
  stY = drawCompactMeter(
    ctx,
    `ХП: ${formatUiNumber(player.hp)}/${formatUiNumber(player.maxHp ?? 100)}`,
    stX,
    stY,
    barW,
    ts,
    (player.hp ?? 0) / (player.maxHp ?? 100),
    '#e44',
    '#aaa',
  );

  // PSI bar
  if (player.rpg) {
    stY = drawCompactMeter(
      ctx,
      `ПСИ: ${formatUiNumber(player.rpg.psi)}/${formatUiNumber(player.rpg.maxPsi)}`,
      stX,
      stY,
      barW,
      ts,
      player.rpg.maxPsi > 0 ? player.rpg.psi / player.rpg.maxPsi : 0,
      '#a4f',
      '#a4f',
    );
  }

  // Needs
  if (player.needs) {
    const needs: [string, number, string][] = [
      ['Еда', player.needs.food, '#8a4'],
      ['Вода', player.needs.water, '#48c'],
      ['Сон', player.needs.sleep, '#a8f'],
      ['Туалет', Math.max(0, 100 - player.needs.pee), '#da4'],
    ];
    for (const [label, val, color] of needs) {
      stY = drawCompactMeter(ctx, `${label}: ${Math.round(val)}`, stX, stY, barW, ts, val / 100, color, '#aaa');
    }
  }

  const equipmentLines = inventoryEquipmentLines(player);
  const equipmentH = inventoryEquipmentBlockHeight(equipmentLines.length, ts);
  const columnsH = Math.max(equipmentH, 39 * ts);
  const columnsY = Math.max(stY + 4 * ts, contentBottom - columnsH);
  const columnsGap = 7 * ts;
  const financeW = Math.max(34 * ts, Math.floor((barW - columnsGap) * 0.48));
  const equipmentW = Math.max(34 * ts, barW - financeW - columnsGap);

  const zhelemishLine = zhelemishStatsLine(player, time);
  if (zhelemishLine && stY + 6 * ts <= columnsY - 1 * ts) {
    stY += 2 * ts;
    ctx.fillStyle = '#9c6';
    ctx.font = `${5 * ts}px monospace`;
    ctx.fillText(fitStatText(ctx, zhelemishLine, barW), stX, stY);
    stY += 6 * ts;
  }

  drawInventoryFinanceBlock(ctx, player, state, stX, columnsY, financeW, ts, time, contentBottom);
  drawInventoryEquipmentBlock(ctx, equipmentLines, stX + financeW + columnsGap, columnsY, equipmentW, ts, time, contentBottom);

  // Stats
  const statsY = stY + 3 * ts;
  if (statsY + 4.8 * ts <= columnsY - 1 * ts) {
    ctx.fillStyle = '#888';
    ctx.font = `${4.5 * ts}px monospace`;
    const day = Math.floor(state.clock.totalMinutes / 1440);
    ctx.fillText(fitStatText(ctx, `Выжил дней: ${day}  |  Самосборов: ${state.samosborCount}`, barW), stX, statsY);
  }
}

interface EquipmentLine {
  text: string;
  color: string;
}

function inventoryEquipmentLines(player: Entity): EquipmentLine[] {
  const weapon = getWeaponReadiness(player);
  const weaponState = weapon.cannotFireReason
    ? `${weapon.resourceLabel}  ${weapon.cannotFireReason}`
    : `${weapon.resourceLabel}  ${weapon.cooldownLabel}`;
  const toolName = player.tool ? (ITEMS[player.tool]?.name ?? player.tool) : 'нет';
  const toolDur = getEquippedToolDurability(player);
  const toolDurLabel = toolDur ? `${Math.max(0, Math.ceil(toolDur.cur))}/${toolDur.max}` : '--';

  const armorName = player.armorDefId ? (ITEMS[player.armorDefId]?.name ?? player.armorDefId) : 'нет';
  let armorResists = '';
  if (player.armorDefId && ITEMS[player.armorDefId]?.resistances) {
    const res = ITEMS[player.armorDefId].resistances;
    const parts = [];
    if (res![DamageType.KINETIC]) parts.push(`КИН:${res![DamageType.KINETIC]}%`);
    if (res![DamageType.BUCKSHOT]) parts.push(`ДРБ:${res![DamageType.BUCKSHOT]}%`);
    if (res![DamageType.ENERGY]) parts.push(`ЭНР:${res![DamageType.ENERGY]}%`);
    if (res![DamageType.FIRE]) parts.push(`ОГН:${res![DamageType.FIRE]}%`);
    if (res![DamageType.PSI]) parts.push(`ПСИ:${res![DamageType.PSI]}%`);
    if (parts.length > 0) armorResists = ` Защита: ${parts.join(' ')}`;
  }

  const lines: EquipmentLine[] = [
    { text: `Броня: ${armorName}${armorResists}`, color: '#fff' },
    { text: `Оружие: ${weapon.name}`, color: '#ccc' },
    { text: `${weapon.role}  ур.${weapon.damageLabel}  ${weaponState}`, color: weapon.warning ? '#f84' : '#9d9' },
    { text: `Инструмент: ${toolName}`, color: '#8cf' },
    { text: `износ ${toolDurLabel}`, color: '#8cf' },
  ];
  const weaponExtra = weapon.statLabel || [weapon.reachLabel, weapon.controlLabel].filter(Boolean).join('  ');
  if (weaponExtra) {
    lines.splice(3, 0, { text: weaponExtra, color: '#8ad' });
  }
  return lines;
}

function inventoryEquipmentBlockHeight(lineCount: number, sy: number): number {
  return (9.2 + lineCount * 6.2 + 2.2) * sy;
}

function drawInventoryEquipmentBlock(
  ctx: CanvasRenderingContext2D,
  lines: readonly EquipmentLine[],
  x: number,
  y: number,
  w: number,
  sy: number,
  time: number,
  maxBottom = Number.POSITIVE_INFINITY,
): number {
  if (y + 8.2 * sy > maxBottom) return y;
  drawGlitchText(ctx, 'ЭКИПИРОВКА', x, y, time, 840, '#6cf', 5.8 * sy);
  let cy = y + 8.2 * sy;
  ctx.font = `${4.7 * sy}px monospace`;
  const lineH = 6.2 * sy;
  for (const line of lines) {
    if (cy + lineH * 0.35 > maxBottom) break;
    ctx.fillStyle = line.color;
    ctx.fillText(fitStatText(ctx, line.text, w), x, cy);
    cy += lineH;
  }
  return cy + 2.2 * sy;
}

function signedPct(mult: number): string {
  const pct = Math.round((mult - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function reducedPct(mult: number): string {
  return `-${Math.max(0, Math.round((1 - mult) * 100))}%`;
}

function statDelta(current: RPGStatEffects, next: RPGStatEffects, key: keyof RPGStatEffects): string {
  const diff = next[key] - current[key];
  if (Math.abs(diff) < 0.005) return '';
  if (key === 'maxHp' || key === 'maxPsi') return `+${Math.round(diff)}`;
  return diff > 0 ? signedPct(next[key] / current[key]) : reducedPct(next[key] / current[key]);
}

function drawRpgEffectBlock(
  ctx: CanvasRenderingContext2D,
  player: Entity,
  x: number, y: number, w: number, sy: number,
): number {
  const rpg = player.rpg;
  if (!rpg) return y;
  const current = rpgStatEffects(rpg);
  const strNext = rpg.attrPoints > 0 ? rpgStatEffectsAfterSpend(rpg, 'str') : undefined;
  const agiNext = rpg.attrPoints > 0 ? rpgStatEffectsAfterSpend(rpg, 'agi') : undefined;
  const intNext = rpg.attrPoints > 0 ? rpgStatEffectsAfterSpend(rpg, 'int') : undefined;
  const suffix = (delta: string) => delta ? ` (${delta})` : '';
  const lines: [string, string][] = [
    [
      '#e84',
      `СИЛ HP ${current.maxHp}${suffix(strNext ? statDelta(current, strNext, 'maxHp') : '')}  ` +
      `ближ ${signedPct(current.meleeDamageMult)}  тяж ${reducedPct(current.heavyWeaponSpeedMult)}`,
    ],
    [
      '#4e8',
      `ЛОВ ход ${signedPct(current.moveSpeedMult)}  темп ${reducedPct(current.attackCooldownMult)}  ` +
      `разброс ${reducedPct(current.rangedSpreadMult)}${suffix(agiNext ? statDelta(current, agiNext, 'attackCooldownMult') : '')}`,
    ],
    [
      '#68f',
      `ИНТ ПСИ ${current.maxPsi}${suffix(intNext ? statDelta(current, intNext, 'maxPsi') : '')}  ` +
      `длит +${Math.round(current.psiDurationBonusSec)}с  цена ${reducedPct(current.psiCostMult)}  ` +
      `контр ${signedPct(current.contractRewardMult)}  док ${signedPct(current.documentRewardMult)}`,
    ],
  ];

  ctx.font = `${5.5 * sy}px monospace`;
  for (const [color, line] of lines) {
    ctx.fillStyle = color;
    ctx.fillText(fitStatText(ctx, line, w), x, y);
    y += 6.2 * sy;
  }
  return y + 1.5 * sy;
}

function drawCompactMeter(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  w: number,
  sy: number,
  pct: number,
  color: string,
  labelColor: string,
): number {
  ctx.fillStyle = labelColor;
  ctx.font = `${4.5 * sy}px monospace`;
  ctx.fillText(fitStatText(ctx, label, w), x, y);
  y += 6.4 * sy;
  drawStatBar(ctx, x, y, w, 1.8 * sy, pct, color);
  return y + 7.4 * sy;
}

function drawStatBar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  pct: number, color: string,
): void {
  ctx.fillStyle = '#222';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, pct)), h);
}
