# PR 84 - Habr MESH PASS article rewrite

Date: 2026-06-08.
Time window: 2026-06-08 BST.
Owner instruction: remove the self-deprecating `Где архитектура не спасает` / UX section from the Habr architecture article, replace optional picture 6 with the MESH PASS system, and describe it as an elegant architecture feature inspired by Windows pipes/screensaver-style procedural generation.

## Result

Updated both article files:

- `PRCampaign/habr_architecture_article_habr_ready_2026-06-08.md`.
- `PRCampaign/habr_architecture_article_draft_2026-06-08.md`.

Removed:

- the `Где архитектура не спасает` section;
- the old optional UI/first-minutes image 6 placeholder;
- self-deprecating lines about poor UX from the intro/final copy.

Added:

- `MESH PASS: объемный водопровод поверх клеточного мира`;
- explanation that mesh pass is render-only and runs after raycaster/depth pass and before sprites;
- the seeded local-radius model: `seed`, cell index, room id, covering profile, hash-gates, radius/cap;
- the inspiration note: old Windows Pipes / водопроводный screensaver as an idea for procedural engineering dressing, not as imported assets;
- the gameplay boundary: mesh pass does not change `World.cells`, collision, pathfinding, save, floor memory or quest state.

Created a publication-ready image:

- PNG for Habr upload: `PRCampaign/habr_mesh_pass_seeded_radius_2026-06-08.png`.
- SVG source: `PRCampaign/habr_mesh_pass_seeded_radius_2026-06-08.svg`.

Raw sources used:

- game mesh screenshot: `screenshots/habr/meshes.png`;
- Windows pipes reference: `screenshots/habr/vodoprovod.jpg`.

Caption to use on Habr:

`MESH PASS добавляет объемные трубы и детали вокруг игрока, не превращая World в 3D-сцену.`

## Validation

- `PRCampaign/habr_mesh_pass_seeded_radius_2026-06-08.png`: `1600x900`, RGB, about `457 KiB`.
- Visual check: full-size PNG opened and inspected.
- Downscale check: temporary `800x450` copy opened and inspected.
- Article search checked that the old `Где архитектура не спасает`, `Архитектура не отменяет`, `плохой UX`, `ГИГАХРУЩ все еще грубый` and `UI местами требует ремонта` wording is removed from both article files.
- `git diff --check` passed for the touched campaign text files.
- `git diff --no-index --check` produced no warnings for this report and the new SVG source.

No Habr upload, edit, publication, comment, vote, DM or moderation action was made.
