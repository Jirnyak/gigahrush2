export * from './registry';
export * from './procedural';
export * from './defs/olga';

import { registerRenderAnimationClips } from './registry';
import { OLGA_RENDER_ANIMATION_CLIPS } from './defs/olga';

registerRenderAnimationClips(OLGA_RENDER_ANIMATION_CLIPS);
