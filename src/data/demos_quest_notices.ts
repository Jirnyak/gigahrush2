import type { QuestRouteTarget } from './contracts';

export const DEMOS_QUEST_NOTICE_CAP = 128;
export const DEMOS_QUEST_NOTICES_PER_SOCIAL_TICK = 2;
export const DEMOS_QUEST_NOTICES_PER_PROFILE = 6;

export interface DemosQuestNotice {
  id: number;
  giverAlifeId: number;
  createdAt: number;
  floorKey: string;
  templateId: string;
  contractId?: string;
  targetRoute?: QuestRouteTarget;
  tags: readonly string[];
  urgency: number;
  expiresAtMinutes?: number;
  sourcePostId?: number;
  sourceEventId?: number;
  acceptedQuestId?: number;
  acceptedAtMinutes?: number;
  failedReason?: string;
  failedAtMinutes?: number;
}

export interface DemosQuestNoticeView {
  id: number;
  giverAlifeId: number;
  label: string;
  detail: string;
  floorLabel: string;
  urgencyLabel: string;
  canAcceptHere: boolean;
  requiresVisit: true;
}

export interface DemosQuestBoardView {
  notices: readonly DemosQuestNoticeView[];
  total: number;
  capped: boolean;
  requiresVisitHint: string;
}
