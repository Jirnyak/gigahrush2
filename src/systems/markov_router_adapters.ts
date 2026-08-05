/* -- Bridges worker-local Markov adapter requests to routeSpeech -- */

import { finalizeMarkovContext } from './markov_context';
import { generateMarkovText, routeSpeech, type SpeechRouterRequest } from './speech_router';
import type {
  MarkovAdapterSpeechRequest,
  MarkovAdapterSpeechResult,
} from './markov_dialogue';
import type {
  MarkovSpeechRouterRequest,
  MarkovSpeechRouterResult,
} from './markov_barks';
import type {
  DemosSpeechRouterRequest,
  DemosSpeechRouterResult,
} from './demos_posts';

export function routeAdapterSpeech(request: MarkovAdapterSpeechRequest): MarkovAdapterSpeechResult {
  const routerRequest: SpeechRouterRequest = {
    intent: request.intent,
    source: request.source,
    context: finalizeMarkovContext(request.context),
    lockedText: request.lockedText,
    exactFallback: request.exactFallback,
    repeatIndex: request.repeatIndex,
    maxChars: request.maxChars,
    seed: request.seed,
  };
  const result = request.source === 'generated_markov'
    ? generateMarkovText(routerRequest)
    : routeSpeech(routerRequest);
  return {
    ...result,
    intent: result.intent as MarkovAdapterSpeechResult['intent'],
    source: result.source as MarkovAdapterSpeechResult['source'],
  };
}

export function routeBarkSpeech(request: MarkovSpeechRouterRequest): MarkovSpeechRouterResult {
  const context = request.context;
  const routerRequest: SpeechRouterRequest = {
    intent: request.intent,
    source: request.source,
    context: finalizeMarkovContext({
      actorId: context.actorId,
      targetId: context.targetId,
      floor: context.floor,
      roomType: context.roomType,
      roomName: context.roomName,
      zoneId: context.zoneId,
      faction: context.actorFaction,
      occupation: context.actorOccupation,
      itemId: context.itemId,
      itemName: context.itemName,
      eventType: typeof context.eventType === 'string' ? context.eventType : undefined,
      eventId: context.eventId,
      tags: [...context.tags, ...context.anchors.map(anchor => `anchor.${anchor}`)],
    }),
    lockedText: request.lockedText,
    exactFallback: request.exactFallback,
    repeatIndex: request.repeatIndex,
    maxChars: request.maxChars,
    seed: request.seed,
  };
  const result = request.source === 'generated_markov'
    ? generateMarkovText(routerRequest)
    : routeSpeech(routerRequest);
  return {
    ...result,
    intent: result.intent as MarkovSpeechRouterResult['intent'],
    source: result.source as MarkovSpeechRouterResult['source'],
  };
}

export function routeDemosSpeech(request: DemosSpeechRouterRequest): DemosSpeechRouterResult {
  const routerRequest: SpeechRouterRequest = {
    intent: request.intent,
    source: request.source,
    context: finalizeMarkovContext(request.context),
    lockedText: request.lockedText,
    exactFallback: request.exactFallback,
    repeatIndex: request.repeatIndex,
    maxChars: request.maxChars,
    seed: request.seed,
  };
  const result = request.source === 'generated_markov'
    ? generateMarkovText(routerRequest)
    : routeSpeech(routerRequest);
  return {
    ...result,
    intent: result.intent as DemosSpeechRouterResult['intent'],
    source: result.source as DemosSpeechRouterResult['source'],
  };
}
