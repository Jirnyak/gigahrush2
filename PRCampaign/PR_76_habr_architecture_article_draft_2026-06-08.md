# PR 76 - Habr architecture article draft with media placeholders

Date: 2026-06-08.
Time window: 2026-06-08 BST.
Owner instruction: prepare a Habr architecture article draft, account for existing public Habr feedback/comments, and mark where screenshots/images should be added and how to add them on Habr.

## Result

Prepared a new local Habr draft:

- Draft file: `PRCampaign/habr_architecture_article_draft_2026-06-08.md`.
- Recommended title: `Как устроен ГИГАХРУЩ: клеточный мир, WebGL-рейкастер и A-Life без движка`.
- Status: local draft only; no Habr post, edit, comment, vote, DM, publication, scheduled post or moderation action was made.

This is a more publishable architecture article than the previous low-level physmath draft. It keeps the actual architecture but removes rough placeholder prose, adds explicit Habr media insertion instructions, uses a consistent `мы` narrative, and includes image slots with concrete screenshot/diagram requirements and captions.

## Public Habr Context Checked

Sources checked:

- Public profile: `https://habr.com/ru/users/TENEVIK/`.
- Live article: `https://habr.com/ru/articles/1043232/`.
- Comments: `https://habr.com/ru/articles/1043232/comments/`.
- Habr editor/docs:
  - `https://habr.com/ru/docs/help/wysiwyg/`
  - `https://habr.com/ru/docs/help/markdown/`
  - `https://habr.com/ru/docs/authors/design/`
  - `https://habr.com/ru/docs/authors/post/`

Public profile context observed: profile `TENEVIK`, one published article, visible reach around `8K+`, one karma, ten rating, and recent activity on 2026-06-08.

Useful public-comment requirements folded into the draft:

- Do not promise "architecture" abstractly; explain concrete layers and data flow.
- Fix `raycasting vs honest 3D` wording: raycasting is not fake; the project is specifically not a mesh-scene pipeline.
- Explain A-Life as identity/materialization/foldback, not "NPCs are not rendered".
- Answer why no Three.js and why no ready ECS without turning it into ideology.
- Acknowledge first-run/UI/readability/control criticism as a real architecture-adjacent problem.
- Keep the story in `we/Tenevik Games` voice after the public thread noticed the mismatch between single-author title and team wording.

## Source Context Used

Read before drafting:

- `README.md`
- `architecture.md`
- `PRCampaign/KPI.md`
- `PRCampaign/campaign_plan_ru.md`
- `PRCampaign/kpi_report_2026-06-05.md`
- `PRCampaign/PR_72_habr_low_level_architecture_draft_2026-06-04.md`
- `PRCampaign/habr_low_level_architecture_draft_2026-06-04.md`
- `PRCampaign/habr_gigahrush_article_draft_2026-05-31.md`
- focused source context from `src/core/world.ts`, `src/systems/procedural_floors.ts`, `src/systems/alife.ts`

Key implementation facts used:

- One active `1024x1024` toroidal `World`.
- Dense typed-array fields for cells, rooms, textures, features, light, fog, territory and render/path helper layers.
- Sparse maps/arrays for doors, rooms, containers, surface pixels and entities.
- Five-layer contract: core/data/gen/systems/render.
- WebGL raycasting as a specialized renderer over grid data, not a generic mesh-scene pipeline.
- Flat entity array plus spatial index/bounded nearby queries.
- Active-floor AI should be isotropic rather than player-spawn-bubble based.
- A-Life stores persistent identities, materializes current-floor NPCs and folds back consequences.
- Samosbor mutates world fields and invalidates render/path caches through dirty versions.
- Save stores current-shape compact facts and rejects stale shapes rather than preserving legacy migrations.

## Habr Media Instructions Added

The draft contains a dedicated `How To Add Images On Habr` section for the owner, not for public publication.

Included instructions:

- upload feed cover on the second Habr editor screen under `Отображение публикации в ленте`;
- use a `780x440` jpg/png cover;
- in WYSIWYG, insert article images with `/` or `+` -> `Изображение`;
- add captions through image settings;
- in markdown mode use `![alt](image-url "title")`;
- preview before publication;
- for large screenshots, add a caption/link to full-size media.

Image slots in body:

1. architecture layer diagram;
2. `World` field/overlay diagram;
3. corridor + ray/DDA split image;
4. NPC/Demos/A-Life screenshot;
5. samosbor before/after or GIF;
6. optional UI/first-minutes readable screenshot.

## Next Action

Owner should merge this with private Habr draft comments, remove non-public `MEDIA TODO` and checklist sections before publication, upload native Habr images, preview the article, then publish only after checking all links and captions.

Do not ask for votes, karma, likes, bookmarks or coordinated comments.

