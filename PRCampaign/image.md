# PR Campaign Image Workflow

This is the reusable image-production note for PR, Habr, portal pages, social posts and media pitches.

For the broader Google AI/Gemini routing across images, video, code, research and audio, use `PRCampaign/google_ai.md` first. This file owns image-specific QA and final diagram rules.

## Principle

Use the right production path for the image type:

- Use Google Gemini or another image generator for atmospheric key art, cover concepts, illustrative scenes, promo cards, stylized environment shots and mood variants.
- Use deterministic local layout for diagrams, architecture charts, UI callouts, screenshots with labels and anything where exact readable text matters.
- For hybrid assets, generate the background or mood image first, then add all labels, arrows, captions and logos locally in SVG/Figma/Canva-style layout.

Do not publish label-heavy AI output without manually checking every word. Generated text inside images is usually the first failure point.

## Quality Bar

Every image must pass these checks before upload:

1. No text-arrow overlap.
2. No clipped text.
3. No unreadable labels at Habr/body width.
4. No fake UI labels or misspelled Russian/English.
5. No accidental disclosure of internal-only implementation details on public store/portal media.
6. The image explains one idea, not five unrelated claims.
7. The caption can stand alone under the image.

For Habr diagrams, prefer `1600x900` PNG plus SVG source. Keep file size reasonable; under `1 MB` is usually enough for clean flat diagrams.

## Gemini Prompt Pattern

Use Gemini for image generation when the goal is visual mood or scene composition.

Prompt structure:

```text
Create a high-quality 16:9 image for a technical article about [topic].
Style: [cinematic / editorial / clean technical / dark concrete survival horror].
Subject: [exact subject].
Composition: [what is foreground, midground, background].
Lighting and palette: [concrete, cold light, readable contrast].
Do not include readable text, logos, UI labels or captions.
Leave clean space for local typography if needed.
```

Negative constraints:

```text
No text in the image. No fake interface labels. No watermark. No logo.
No cluttered arrows. No illegible diagrams. No random symbols.
```

## Diagram Prompt Pattern

Do not ask Gemini to make final diagrams with labels. Use Gemini only for inspiration or background.

Final diagrams should be built locally with:

- exact labels;
- manually placed arrows;
- stable margins;
- readable typography;
- one source SVG and one exported PNG.

For a diagram request, write a local layout brief first:

```text
Canvas: 1600x900.
Goal: explain [one contract].
Blocks: [list].
Arrows: [list, from -> to].
Caption: [exact caption].
Forbidden: arrow/text overlap, diagonal arrows through labels, tiny text, decorative clutter.
```

## Habr Upload Checklist

1. Upload feed cover separately on the Habr publication settings screen.
2. Insert article images natively in the editor.
3. Add captions through Habr image settings or immediately below the image.
4. Remove local placeholder lines like `[КАРТИНКА N: ...]`.
5. Preview the article at desktop width.
6. Recheck that all arrows, labels and captions are readable after Habr resizes the image.

## Current Habr Architecture Images

Ready:

- `PRCampaign/habr_architecture_layers_world_2026-06-08.png`
- `PRCampaign/habr_architecture_layers_world_2026-06-08.svg`
- `PRCampaign/habr_world_cell_layers_map_2026-06-08.png`
- `PRCampaign/habr_world_cell_layers_map_2026-06-08.svg`
- `PRCampaign/habr_raycaster_dda_split_2026-06-08.png`
- `PRCampaign/habr_raycaster_dda_split_2026-06-08.svg`
- `PRCampaign/habr_alife_demos_identity_2026-06-08.png`
- `PRCampaign/habr_alife_demos_identity_2026-06-08.svg`
- `PRCampaign/habr_samosbor_before_after_2026-06-08.png`
- `PRCampaign/habr_samosbor_before_after_2026-06-08.svg`
- `PRCampaign/habr_mesh_pass_seeded_radius_2026-06-08.png`
- `PRCampaign/habr_mesh_pass_seeded_radius_2026-06-08.svg`

Need next:

- Optional cover/key art: Gemini can help, but final cover must be checked for readability and no accidental text.
