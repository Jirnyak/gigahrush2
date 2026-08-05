# PR 80 - Habr World cell layers image

Date: 2026-06-08.
Time window: 2026-06-08 BST.
Owner instruction: create the second Habr architecture image for the placeholder about a map/minimap or a `cells/rooms/doors/features/fog/territory` layer scheme. Owner attached a raw full-floor map example as visual direction.

## Result

Created a publication-ready map/layer diagram:

- PNG for Habr upload: `PRCampaign/habr_world_cell_layers_map_2026-06-08.png`.
- SVG source: `PRCampaign/habr_world_cell_layers_map_2026-06-08.svg`.

The image uses the owner's raw full-floor map from:

- `screenshots/habr/Screenshot 2026-06-08 at 21.52.04.png`

The final image keeps that raw map on the left and adds a clean right-side technical panel.

The diagram explains:

- one highlighted cell on a raw full-floor map;
- `idx = y * W + x`;
- the same index feeding `cells[i]`, `roomMap[i]`, `doors.get(i)`, `features[i]`, `fog[i]`, `territory[i]` and render.

Caption to use on Habr:

`Один индекс клетки связывает геометрию, комнаты, признаки, туман, территорию и рендер.`

## Validation

- `PRCampaign/habr_world_cell_layers_map_2026-06-08.png`: `1600x900`, RGB, about `586 KiB`.
- `PRCampaign/habr_world_cell_layers_map_2026-06-08.svg`: SVG source.
- Visual check: full-size PNG opened and inspected.
- Downscale check: temporary `800x450` copy opened and inspected after the raw screenshot replacement.

No Habr upload, edit, publication, comment, vote, DM or moderation action was made.
