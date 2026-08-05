# PR 72 - Habr low-level architecture draft

Date: 2026-06-04.
Time window: 2026-06-04 BST.
Owner instruction: inspect the successful Habr article and comments, inspect current code, and prepare a new technical-physmath low-level architecture post about GIGAH|RUSH.

## Result

Prepared a new Habr draft:

- Draft file: `PRCampaign/habr_low_level_architecture_draft_2026-06-04.md`.
- Recommended title: `ГИГАХРУЩ под бетоном: тороидальная решетка, raycasting, A-Life и САМОСБОР`.
- Target: follow-up Habr technical article responding to the live comment thread, not a generic promo repost.
- Status: local draft only; no Habr post, comment, vote, DM, edit or moderation action was made.

## Live Habr Signal Checked

Source: https://habr.com/ru/articles/1043232/ and comments page `https://habr.com/ru/articles/1043232/comments/`.

Public visible values observed on 2026-06-04:

- reach/readers: `9.1K`;
- article rating: `+9`;
- bookmarks: `7`;
- comments: `30`.

Useful comment-derived requirements:

- explain the architecture instead of naming it abstractly;
- clarify that raycasting itself is not "fake" or "dishonest" 3D, while GIGAH|RUSH specifically is not a mesh-scene 3D pipeline;
- explain A-Life as persistent identity/materialization/foldback, not "NPCs are just not rendered";
- answer why no Three.js, no ready ECS and no asset-heavy route;
- acknowledge first-run and UI/readability complaints rather than hiding behind low-level elegance.

## Source Inspection Used

Read:

- `README.md`;
- `architecture.md`;
- `src/core/world.ts`;
- `src/core/types.ts`;
- `src/systems/alife.ts`;
- `src/systems/procedural_floors.ts`;
- `src/systems/samosbor.ts`;
- `src/systems/samosbor_hooks.ts`;
- `src/systems/ai/pathfinding.ts`;
- `src/systems/ai/index.ts`;
- `src/systems/entity_index.ts`;
- `src/render/webgl.ts`;
- `src/gen/procedural_screens.ts` and Bad Apple references via search.

Key facts used:

- `World` is a toroidal typed-array field with `cells`, `roomMap`, `wallTex`, `floorTex`, `features`, `light`, `fog`, `zoneMap`, `factionControl` and sparse maps for doors/surfaces/containers.
- Coordinates use `world.wrap`, `world.idx`, `world.delta`, `world.dist`, `world.dist2`.
- Runtime changes bump `cellVersion`, texture/feature/fog/surface versions and dirty rects.
- WebGL raycaster consumes world data as data textures and uses DDA over wrapped grid coordinates.
- Entity runtime is a flat `Entity[]` plus bucketed broadphase index, not subclasses.
- AI runs a full live-AI pass over the active floor through `entityIndex.ai`, while expensive choices use caps, caches and local scans.
- Pathfinding bakes a toroidal navigation tree and cached behavior flow fields keyed by world/cell version.
- A-Life stores persistent NPC identity through compact typed-array columns, materializes only current-floor records into live entities, and folds live state/deaths back.
- Samosbor is a world mutation system, not only a screen effect.
- Bad Apple world is a real procedural anomaly that stamps packed frames into map cells.

## Public-Copy Guardrail

This draft intentionally discusses toroidal topology because the owner explicitly requested a low-level physmath architecture article. It avoids making exact implementation dimensions the public hook and marks the topology disclosure as a technical Habr exception rather than reusable store/portal copy.

## Next Action

Owner should review tone and exact disclosure level before submission. If publishing:

1. Use the new draft as a Habr article, not as a comment reply.
2. Keep a short intro that acknowledges the previous comment thread without escalating.
3. Add one native image/GIF from the approved media pack if Habr editor allows it.
4. Preview and verify playable links at the end.
5. Do not ask for votes, karma, likes, bookmarks or coordinated comments.

