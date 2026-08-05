/* ── Runtime NPC dialogue dispatch ───────────────────────────── */

import { type Entity } from '../core/types';
import { getNpcStateText } from './ai';
import { buildContextSnapshot, type ContextBuildOptions } from './context';
import { renderMarkovDialogueTalk } from './markov_dialogue';
import { routeAdapterSpeech } from './markov_router_adapters';
import {
  lowerNpcPackageSpeechContext,
  resolveNpcPackageForEntity,
  selectNpcLockedTalkLine,
} from './npc_package_speech';
import { markNpcSpokenTo } from './npc_memory';
import { observeRecentRumorEventsForNpc, selectRumorForNpc } from './rumor';
import { routeSpeech } from './speech_router';

/* ── Talk text (called from NPC menu "Talk" tab) ─────────────── */
export function generateTalkText(npc: Entity, options: ContextBuildOptions = {}): string {
  const now = options.time ?? performanceNowSeconds();
  const pack = resolveNpcPackageForEntity(npc);
  const locked = pack ? selectNpcLockedTalkLine(pack, npc, options.state?.quests, now) : undefined;
  if (pack && locked) {
    return routeSpeech({
      intent: 'locked_author_text',
      source: locked.source,
      context: lowerNpcPackageSpeechContext(pack, npc, 'dialogue'),
      lockedText: locked.text,
    }).text;
  }

  const snapshot = buildContextSnapshot(npc, options);
  const memory = markNpcSpokenTo(npc, now);
  observeRecentRumorEventsForNpc(npc, snapshot, now);

  const rumorLine = selectRumorForNpc(npc, snapshot, now);
  if (rumorLine) return rumorLine;

  if (npc.ai?.npcState !== undefined && Math.random() < 0.4) {
    return getNpcStateText(npc.ai.npcState);
  }

  return renderMarkovDialogueTalk(npc, snapshot, {
    memory,
    time: now,
    repeatIndex: Math.max(0, Math.floor(now)),
    routeSpeech: routeAdapterSpeech,
  }).text;
}

function performanceNowSeconds(): number {
  if (typeof performance !== 'undefined') return performance.now() / 1000;
  return Date.now() / 1000;
}
