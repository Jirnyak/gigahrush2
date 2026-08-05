# PR 79 - Habr architecture image rework and image workflow

Date: 2026-06-08.
Time window: 2026-06-08 BST.
Owner instruction: fix the architecture diagram because arrows overlapped text, and add a reusable `PRCampaign/image.md` workflow for making campaign images through Google/Gemini or equivalent tools with proper quality control.

## Result

Reworked the first Habr architecture diagram:

- Final PNG: `PRCampaign/habr_architecture_layers_world_2026-06-08.png`.
- Final SVG source: `PRCampaign/habr_architecture_layers_world_2026-06-08.svg`.

The corrected diagram keeps the same idea but fixes the layout:

- labels are placed inside separate caption chips;
- arrows no longer visibly pass through text;
- top layer arrows are simple and unlabeled;
- the `gen builds`, `systems mutate` and `render reads` labels are separated from arrow paths;
- the image was checked at full `1600x900` and downscaled to `800x450`, which is close to Habr article body display width.

Created reusable image workflow:

- `PRCampaign/image.md`

The workflow says to use Google Gemini or another generator for atmospheric/key-art/promo images, but not for final label-heavy diagrams. For diagrams, use local SVG/Figma/Canva-style layout with exact labels and manual visual checks. For hybrid images, generate the mood/background with Gemini, then overlay all labels locally.

## Validation

- `PRCampaign/habr_architecture_layers_world_2026-06-08.png`: `1600x900`, RGB, about `214 KiB`.
- `PRCampaign/habr_architecture_layers_world_2026-06-08.svg`: SVG source.
- Visual check: full-size PNG opened and inspected.
- Downscale check: temporary `800x450` copy opened and inspected.

No Habr upload, edit, publication, comment, vote, DM or moderation action was made.
