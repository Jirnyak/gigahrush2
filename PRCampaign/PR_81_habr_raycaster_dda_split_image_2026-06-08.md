# PR 81 - Habr raycaster DDA split image

Date: 2026-06-08.
Time window: 2026-06-08 BST.
Owner instruction: create the third Habr architecture image: split-image with a game corridor/combat frame on the left and a simple DDA ray-through-cells scheme on the right. Owner attached a raw combat/corridor frame as visual direction.

## Result

Created a publication-ready raycaster/DDA split image:

- PNG for Habr upload: `PRCampaign/habr_raycaster_dda_split_2026-06-08.png`.
- SVG source: `PRCampaign/habr_raycaster_dda_split_2026-06-08.svg`.

The left side uses the owner's raw corridor/combat screenshot from:

- `screenshots/habr/Screenshot 2026-06-08 at 22.00.32.png`

The right side is a manual DDA scheme:

- grid cells;
- highlighted traversed cells;
- camera origin;
- ray line;
- hit wall;
- `sideDist += deltaDist` step label.

Caption to use on Habr:

`Геометрия остается клеточной, WebGL строит 2.5D-проекцию специализированным raycasting pass.`

## Validation

- `PRCampaign/habr_raycaster_dda_split_2026-06-08.png`: `1600x900`, RGB, about `449 KiB`.
- `PRCampaign/habr_raycaster_dda_split_2026-06-08.svg`: SVG source.
- Visual check: full-size PNG opened and inspected.
- Downscale check: temporary `800x450` copy opened and inspected.
- Fixed one failed source-image path, one overlapped DDA label, then replaced the fallback PR screenshot with the owner's `screenshots/habr` source and rechecked full/downscaled views.

No Habr upload, edit, publication, comment, vote, DM or moderation action was made.
