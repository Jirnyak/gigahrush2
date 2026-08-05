# PR 78 - Habr architecture layer diagram image

Date: 2026-06-08.
Time window: 2026-06-08 BST.
Owner instruction: create the first Habr architecture image for the placeholder describing `core -> data -> gen -> systems -> render` over one `World`.

## Result

Created a publication-ready architecture diagram:

- PNG for Habr upload: `PRCampaign/habr_architecture_layers_world_2026-06-08.png`.
- SVG source: `PRCampaign/habr_architecture_layers_world_2026-06-08.svg`.

The PNG is `1600x900`, RGB, approximately `212 KiB`. It shows five responsibility layers above one `World` block, with arrows for:

- `gen builds`
- `systems mutate`
- `render reads`

Caption to use on Habr:

`Общий контракт: генераторы строят World, системы меняют состояние, рендер только читает.`

## Notes

Gemini was not used. This diagram is deterministic vector work, so a local SVG/PNG gives cleaner labels and safer Habr text readability than a generative image.

The image was visually checked after PNG generation. No public Habr action, upload, edit, publication, comment, vote or moderation action was made.
