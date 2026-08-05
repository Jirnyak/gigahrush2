/* ── Инфосеть Демос: read-only A-Life profile browser ─────────── */

import { type Entity, type GameState } from '../core/types';
import { DEMOS_SOCIAL_PUBLIC_SLOTS } from '../data/demos_social';
import { generateNpcProfileSprite } from '../entities/procedural_visuals';
import { type DemosProfile, getDemosSnapshot } from '../systems/demos';
import {
  buildDemosProfileFeedView,
  buildDemosSocialLinksView,
  getDemosProfileDetails,
} from '../systems/demos_profiles';
import {
  renderDemosMarkovPostText,
  type DemosMarkovPost,
} from '../systems/demos_posts';
import type {
  DemosPersistentPost,
  DemosPersistentReaction,
  DemosSocialSaveState,
} from '../systems/demos_save';
import { controlBindingLabel, menuCloseHint } from '../systems/controls';
import { routeDemosSpeech } from '../systems/markov_router_adapters';
import { S } from './pixutil';
import { drawGlitchText, drawNeuroPanel } from './hud_fx';
import { drawDemosFeedPanel } from './demos_feed_ui';
import {
  drawDemosProfileFeedPanel,
  drawDemosProfilePanel,
  drawDemosTabsHeader,
} from './demos_profile_ui';
import { drawDemosSocialLinksPanel } from './demos_social_ui';
import { fitText } from './ui_text';

const PORTRAIT_CACHE_MAX = 24;
const portraitCache = new Map<string, HTMLCanvasElement>();
const DEMOS_TAB_LABELS: Record<GameState['demosTab'], string> = {
  profile: 'Профиль',
  links: 'Связи',
  feed: 'Лента',
  post: 'Пост',
  quests: 'Квесты',
};
const DEMOS_TAB_ORDER: GameState['demosTab'][] = ['profile', 'links', 'feed', 'post', 'quests'];

function cacheKey(profile: DemosProfile): string {
  return `${profile.npcVisualId ?? ''}:${profile.spriteSeed}:${profile.sprite}:${profile.occupation}:${profile.faction}:${profile.female ? 1 : 0}`;
}

function trimPortraitCache(): void {
  while (portraitCache.size > PORTRAIT_CACHE_MAX) {
    const first = portraitCache.keys().next().value;
    if (first === undefined) return;
    portraitCache.delete(first);
  }
}

function portraitCanvas(profile: DemosProfile): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const key = cacheKey(profile);
  const cached = portraitCache.get(key);
  if (cached) {
    portraitCache.delete(key);
    portraitCache.set(key, cached);
    return cached;
  }
  const data = generateNpcProfileSprite(
    profile.spriteSeed,
    profile.occupation,
    profile.faction,
    profile.female,
    profile.sprite,
    profile.npcVisualId,
  );
  const side = Math.floor(Math.sqrt(data.length));
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const bytes = new Uint8ClampedArray(side * side * 4);
  bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  ctx.putImageData(new ImageData(bytes, side, side), 0, 0);
  portraitCache.set(key, canvas);
  trimPortraitCache();
  return canvas;
}

function drawFallbackPortrait(
  ctx: CanvasRenderingContext2D,
  profile: DemosProfile,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const data = generateNpcProfileSprite(
    profile.spriteSeed,
    profile.occupation,
    profile.faction,
    profile.female,
    profile.sprite,
    profile.npcVisualId,
  );
  const side = Math.floor(Math.sqrt(data.length));
  const scale = side / S;
  const srcX0 = Math.floor(10 * scale);
  const srcX1 = Math.floor(54 * scale);
  const srcY0 = Math.floor(0 * scale);
  const srcY1 = Math.floor(40 * scale);
  const px = w / (srcX1 - srcX0 + 1);
  const py = h / (srcY1 - srcY0 + 1);
  for (let sy = srcY0; sy <= srcY1; sy++) {
    for (let sx = srcX0; sx <= srcX1; sx++) {
      const c = data[sy * side + sx];
      const a = c >>> 24;
      if (a === 0) continue;
      const r = c & 0xff;
      const g = (c >>> 8) & 0xff;
      const b = (c >>> 16) & 0xff;
      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      ctx.fillRect(x + (sx - srcX0) * px, y + (sy - srcY0) * py, Math.ceil(px), Math.ceil(py));
    }
  }
}

function drawProfilePortrait(
  ctx: CanvasRenderingContext2D,
  profile: DemosProfile,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = 'rgba(2,12,16,0.92)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = profile.dead ? 'rgba(160,60,70,0.55)' : 'rgba(0,220,190,0.5)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const canvas = portraitCanvas(profile);
  const pad = Math.max(4, Math.floor(Math.min(w, h) * 0.07));
  if (canvas) {
    const scale = canvas.width / S;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 10 * scale, 0 * scale, 45 * scale, 40 * scale, x + pad, y + pad, w - pad * 2, h - pad * 2);
    ctx.imageSmoothingEnabled = true;
  } else {
    drawFallbackPortrait(ctx, profile, x + pad, y + pad, w - pad * 2, h - pad * 2);
  }
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  w: number,
  sy: number,
  color = '#cbd7d7',
): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `${7.5 * sy}px monospace`;
  ctx.fillStyle = '#668f91';
  const labelW = Math.min(84 * sy, w * 0.42);
  ctx.fillText(fitText(ctx, label, labelW), x, y);
  ctx.fillStyle = color;
  ctx.fillText(fitText(ctx, value, Math.max(16, w - labelW - 4 * sy)), x + labelW, y);
}

function demosSocialState(state: GameState): DemosSocialSaveState | undefined {
  return (state as GameState & { demosSocial?: DemosSocialSaveState }).demosSocial;
}

function savedPostAtCursor(state: GameState): DemosPersistentPost | undefined {
  const posts = demosSocialState(state)?.posts ?? [];
  if (posts.length === 0) return undefined;
  const cursor = Math.max(0, Math.min(posts.length - 1, Math.floor(state.demosPostCursor || 0)));
  return posts[posts.length - 1 - cursor];
}

function postAsMarkov(post: DemosPersistentPost): DemosMarkovPost {
  return {
    id: post.id,
    authorAlifeId: post.authorAlifeId,
    createdAt: post.createdAt,
    sourceEventId: post.sourceEventId,
    floorKey: post.floorKey,
    parentPostId: post.parentPostId,
    templateId: post.templateId,
    seed: post.seed,
    args: post.args,
    mentionedAlifeIds: post.mentionedAlifeIds,
    privacy: post.privacy,
    tags: post.tags,
    score: post.score,
  };
}

function reactionsForPost(state: GameState, postId: number): readonly DemosPersistentReaction[] {
  return (demosSocialState(state)?.reactions ?? [])
    .filter(reaction => reaction.postId === postId)
    .slice(-8)
    .reverse();
}

function drawDemosEmptyPanel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  sx: number,
  sy: number,
): void {
  ctx.fillStyle = 'rgba(0,10,14,0.84)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,220,190,0.34)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.font = `${8 * sy}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#789';
  ctx.fillText(fitText(ctx, text, w - 14 * sx), x + 7 * sx, y + 8 * sy);
}

function drawDemosPostPanel(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  x: number,
  y: number,
  w: number,
  h: number,
  sx: number,
  sy: number,
): void {
  const post = savedPostAtCursor(state);
  if (!post) {
    drawDemosEmptyPanel(ctx, 'Постов пока нет. Директор Демоса пишет только из реальных событий.', x, y, w, h, sx, sy);
    return;
  }
  ctx.fillStyle = 'rgba(0,10,14,0.84)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,220,190,0.42)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const pad = 7 * sx;
  let rowY = y + 7 * sy;
  const rowW = w - pad * 2;
  const rendered = renderDemosMarkovPostText(postAsMarkov(post), { routeSpeech: routeDemosSpeech });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${9 * sy}px monospace`;
  ctx.fillStyle = '#25ffd0';
  ctx.fillText(fitText(ctx, `post:${post.id}  alife:${post.authorAlifeId}`, rowW), x + pad, rowY);
  rowY += 15 * sy;

  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = '#6a9';
  const parent = post.parentPostId !== undefined ? `  parent:post:${post.parentPostId}` : '';
  ctx.fillText(fitText(ctx, `${Math.floor(post.createdAt)}s${parent}  ${post.privacy}`, rowW), x + pad, rowY);
  rowY += 12 * sy;

  ctx.font = `${8 * sy}px monospace`;
  ctx.fillStyle = '#d9f1ed';
  const text = fitText(ctx, rendered.text, rowW);
  ctx.fillText(text, x + pad, rowY);
  rowY += 16 * sy;

  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = '#789';
  const mentions = post.mentionedAlifeIds?.length ? post.mentionedAlifeIds.map(id => `alife:${id}`).join(', ') : 'нет';
  ctx.fillText(fitText(ctx, `упоминания: ${mentions}`, rowW), x + pad, rowY);
  rowY += 11 * sy;
  ctx.fillText(fitText(ctx, `теги: ${post.tags.slice(0, 6).join(', ') || 'нет'}`, rowW), x + pad, rowY);
  rowY += 15 * sy;

  ctx.fillStyle = '#25ffd0';
  ctx.fillText('реакции', x + pad, rowY);
  rowY += 11 * sy;
  const reactions = reactionsForPost(state, post.id);
  if (reactions.length === 0) {
    ctx.fillStyle = '#789';
    ctx.fillText(fitText(ctx, 'Реакций пока нет.', rowW), x + pad, rowY);
    return;
  }
  const bottom = y + h - 6 * sy;
  for (const reaction of reactions) {
    if (rowY + 10 * sy > bottom) break;
    const delta = reaction.relationDelta !== undefined ? ` ${reaction.relationDelta > 0 ? '+' : ''}${reaction.relationDelta}` : '';
    ctx.fillStyle = (reaction.relationDelta ?? 0) < 0 ? '#e99' : '#9dc';
    ctx.fillText(fitText(ctx, `alife:${reaction.reactorAlifeId} ${reaction.kind}${delta}`, rowW), x + pad, rowY);
    rowY += 10 * sy;
  }
}

function drawDemosQuestPanel(
  ctx: CanvasRenderingContext2D,
  profile: DemosProfile | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  sx: number,
  sy: number,
): void {
  ctx.fillStyle = 'rgba(0,10,14,0.84)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,220,190,0.38)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const pad = 7 * sx;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${9 * sy}px monospace`;
  ctx.fillStyle = '#25ffd0';
  ctx.fillText(fitText(ctx, 'ЗАЯВКИ ДЕМОСА', w - pad * 2), x + pad, y + 6 * sy);
  let rowY = y + 24 * sy;
  const rowW = w - pad * 2;
  ctx.font = `${7.2 * sy}px monospace`;
  ctx.fillStyle = '#89a';
  ctx.fillText(fitText(ctx, 'Чтобы принять дело, нужно найти человека на этаже и поговорить лично.', rowW), x + pad, rowY);
  rowY += 14 * sy;
  const notices = profile?.questNotices ?? [];
  if (notices.length === 0) {
    ctx.fillStyle = '#789';
    ctx.fillText(fitText(ctx, 'У выбранного профиля нет активных заявок.', rowW), x + pad, rowY);
    return;
  }
  const bottom = y + h - 6 * sy;
  for (const notice of notices) {
    if (rowY + 28 * sy > bottom) break;
    ctx.fillStyle = 'rgba(2,18,22,0.72)';
    ctx.fillRect(x + pad, rowY, rowW, 25 * sy);
    ctx.strokeStyle = notice.canAcceptHere ? 'rgba(70,220,130,0.34)' : 'rgba(0,140,130,0.22)';
    ctx.strokeRect(x + pad + 0.5, rowY + 0.5, rowW - 1, 25 * sy - 1);
    ctx.fillStyle = notice.canAcceptHere ? '#9fd' : '#d9f1ed';
    ctx.fillText(fitText(ctx, `${notice.urgencyLabel}: ${notice.label}`, rowW - 8 * sx), x + pad + 4 * sx, rowY + 3 * sy);
    ctx.fillStyle = '#89a';
    ctx.fillText(fitText(ctx, `${notice.floorLabel} / ${notice.detail}`, rowW - 8 * sx), x + pad + 4 * sx, rowY + 14 * sy);
    rowY += 29 * sy;
  }
}

export function drawDemosMenu(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  entities: readonly Entity[],
  sx: number,
  sy: number,
  uiTime = state.time,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = 'rgba(0,0,5,0.88)';
  ctx.fillRect(0, 0, w, h);

  const marginX = Math.max(6 * sx, Math.min(24 * sx, w * 0.025));
  const marginY = Math.max(6 * sy, Math.min(18 * sy, h * 0.025));
  const panelW = Math.max(1, w - marginX * 2);
  const panelH = Math.max(1, h - marginY * 2);
  const px = (w - panelW) / 2;
  const py = (h - panelH) / 2;
  drawNeuroPanel(ctx, px, py, panelW, panelH, uiTime, 913);

  ctx.textBaseline = 'top';
  drawGlitchText(ctx, 'ИНФОСЕТЬ ДЕМОС', px + 12 * sx, py + 10 * sy, uiTime, 914, '#25ffd0', 13 * sy);

  const searchX = px + 12 * sx;
  const searchY = py + 32 * sy;
  const searchW = panelW - 24 * sx;
  const searchH = 18 * sy;
  ctx.fillStyle = state.demosSearchActive ? 'rgba(0,46,42,0.85)' : 'rgba(0,18,22,0.78)';
  ctx.fillRect(searchX, searchY, searchW, searchH);
  ctx.strokeStyle = state.demosSearchActive ? 'rgba(40,255,210,0.85)' : 'rgba(0,150,140,0.35)';
  ctx.strokeRect(searchX + 0.5, searchY + 0.5, searchW - 1, searchH - 1);
  ctx.font = `${8 * sy}px monospace`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#5e8';
  const cursor = state.demosSearchActive && Math.floor(uiTime * 2) % 2 === 0 ? '_' : '';
  const query = state.demosSearch || 'alife:ID / имя / plot:ID';
  ctx.fillText(fitText(ctx, `поиск: ${query}${cursor}`, searchW - 10 * sx), searchX + 5 * sx, searchY + 4 * sy);

  const tabLabels = DEMOS_TAB_ORDER.map(tab => DEMOS_TAB_LABELS[tab]);
  const selectedTab = DEMOS_TAB_LABELS[state.demosTab] ?? DEMOS_TAB_LABELS.profile;
  const tabsY = searchY + searchH + 5 * sy;
  drawDemosTabsHeader(ctx, tabLabels, selectedTab, searchX, tabsY, searchW, sy);

  const snapshot = getDemosSnapshot(state, entities, state.demosCursor, state.demosSearchActive ? '' : state.demosSearch);
  const contentX = px + 12 * sx;
  const contentY = tabsY + 17 * sy;
  const contentW = panelW - 24 * sx;
  const contentH = Math.max(42 * sy, py + panelH - 28 * sy - contentY);
  if (!snapshot.profile) {
    const text = snapshot.notFound ? 'Профиль не найден в текущей A-Life популяции.' : 'A-Life популяция ещё не готова.';
    drawDemosEmptyPanel(ctx, text, contentX, contentY, contentW, contentH, sx, sy);
  } else {
    const p = snapshot.profile;
    if (state.demosTab === 'profile') {
      const portraitW = Math.min(116 * sx, contentW * 0.32);
      const portraitH = Math.max(64 * sy, Math.min(contentH, 142 * sy));
      const portraitX = contentX;
      const portraitY = contentY;
      drawProfilePortrait(ctx, p, portraitX, portraitY, portraitW, portraitH);

      const infoX = portraitX;
      let y = portraitY + portraitH + 6 * sy;
      const infoW = portraitW;
      ctx.font = `bold ${8.5 * sy}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillStyle = p.dead ? '#a77' : '#eff';
      ctx.fillText(fitText(ctx, p.name, infoW), infoX, y); y += 12 * sy;
      ctx.font = `${7 * sy}px monospace`;
      ctx.fillStyle = '#789';
      const ids = [p.idLabel, p.packageIdLabel, p.plotIdLabel].filter((item): item is string => !!item).join(' ');
      ctx.fillText(fitText(ctx, ids, infoW), infoX, y); y += 12 * sy;
      drawLine(ctx, 'фракция', p.factionLabel, infoX, y, infoW, sy); y += 11 * sy;
      drawLine(ctx, 'где', p.locationLabel, infoX, y, infoW, sy, p.dead ? '#b77' : '#9cf');

      const details = getDemosProfileDetails(state, p.alifeId);
      const rightX = portraitX + portraitW + 8 * sx;
      const rightW = contentX + contentW - rightX;
      if (details && rightW > 80 * sx) {
        const upperH = Math.max(94 * sy, Math.floor(contentH * 0.58));
        drawDemosProfilePanel(ctx, details, rightX, contentY, rightW, Math.min(upperH, contentH), sx, sy, {
          title: p.name,
        });
        if (contentH - upperH > 42 * sy) {
          drawDemosProfileFeedPanel(
            ctx,
            buildDemosProfileFeedView(state, p.alifeId, 4),
            rightX,
            contentY + upperH + 6 * sy,
            rightW,
            contentH - upperH - 6 * sy,
            sx,
            sy,
          );
        }
      }
    } else if (state.demosTab === 'links') {
      drawDemosSocialLinksPanel(
        ctx,
        buildDemosSocialLinksView(state, p.alifeId, DEMOS_SOCIAL_PUBLIC_SLOTS),
        contentX,
        contentY,
        contentW,
        contentH,
        sx,
        sy,
      );
    } else if (state.demosTab === 'feed') {
      drawDemosFeedPanel(
        ctx,
        snapshot.feed,
        contentX,
        contentY,
        contentW,
        contentH,
        sx,
        sy,
        { scroll: state.demosFeedScroll },
      );
    } else if (state.demosTab === 'post') {
      drawDemosPostPanel(ctx, state, contentX, contentY, contentW, contentH, sx, sy);
    } else {
      drawDemosQuestPanel(ctx, p, contentX, contentY, contentW, contentH, sx, sy);
    }
  }

  ctx.font = `${7 * sy}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#456';
  const searchHint = state.demosSearchActive
    ? 'печать — фильтр  |  Backspace — стереть  |  Del — очистить  |  Enter — применить'
    : `${controlBindingLabel('menuLeft')}/${controlBindingLabel('menuRight')} — вкладки  |  ${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} или колесо — листать  |  Enter — поиск`;
  ctx.fillText(
    fitText(ctx, `${searchHint}  |  ${menuCloseHint()} — закрыть`, panelW - 18 * sx),
    px + panelW / 2,
    py + panelH - 18 * sy,
  );
  ctx.textAlign = 'left';
}
