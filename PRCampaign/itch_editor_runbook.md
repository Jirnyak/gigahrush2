# GIGAH|RUSH itch Editor Runbook

Live editor target: `https://itch.io/game/edit/4587160`
Public verification target: `https://tenevik.itch.io/gigahrush`

Use this order. It avoids relying on custom CSS first, because CSS access can be missing or stripped.

## 1. Core Page Fields

- Title: `GIGAH|RUSH`
- Short description: `Browser survival horror / ARPG shooter in an endless concrete apartment block.`
- Classification: `Game`
- Kind of project: `HTML`
- Genre: `Shooter`
- Suggested pricing: keep current setting unless intentionally changing monetization.

Tags:
`ARPG`, `Atmospheric Horror`, `Browser Game`, `HTML5`, `Life Simulation`, `Procedural Generation`, `Shooter`, `Singleplayer`, `Survival Horror`, `WebGL`

Description:
- Primary paste: `description_en_approved.html`
- Exact approved source: `description_en_approved.md`
- Do not rewrite, shorten, or replace this English store copy unless a new English public-page pass explicitly requires it.
- Public page copy markers for verification: `Browser survival horror / ARPG shooter inside a huge concrete apartment block.`, `GIGAH|RUSH is a free HTML5/WebGL browser game`, `Samosbor events with sirens, sealed doors, fog`

## 2. Theme

Colors:

- Background: `#08090A`
- Secondary background / inner column: `#12110F`
- Text: `#D8D0B8`
- Link: `#E6BC57`
- Button: `#B73A2F`
- Button text: `#FFF1D0`
- Border: `#4D4034`

Images:

- Use the current public itch cover if only a cover/card image is needed.
- For local upload work, regenerate cover/background/header/social assets from the current build and media set. The old local binary asset backup was removed during repository cleanup.
- If a header slot overlays the page title, prefer a clean no-title header in the regenerated set.

## 3. Screenshots And Media

Approved media order from `screenshots/frontpage-review/PICKLIST.md` (`upload=true` only). Use files directly from `screenshots/frontpage-review/`; do not expect the old `approved_frontpage*` backup folders to exist.

1. `screenshots/frontpage-review/anim_hell_blinking_eyes.gif`
2. `screenshots/frontpage-review/anim_underhell_maronary_samosbor_loop.gif`
3. `screenshots/frontpage-review/hell_02-hell-maronary-samosbor.png`
4. `screenshots/frontpage-review/hell_03-underhell-gate-pack.png`
5. `screenshots/frontpage-review/hell_05-void-eye-protocols.png`
6. `screenshots/frontpage-review/hell_06-darkness-route-blackout.png`
7. `screenshots/frontpage-review/hell_07-procedural-wall-snake.png`
8. `screenshots/frontpage-review/hell_09-smog-false-safe-block.png`
9. `screenshots/frontpage-review/loc_03-ministerstvo-raionsovet-archive.png`
10. `screenshots/frontpage-review/loc_04-kollektory-maintenance.png`
11. `screenshots/frontpage-review/loc_07-krysha-antenny.png`
12. `screenshots/frontpage-review/extra_01-living-start-hud.png`
13. `screenshots/frontpage-review/extra_03-living-monster-ring-clean.png`
14. `screenshots/frontpage-review/extra_04-living-combat-hud.png`

Do not upload `anim_hell_blinking_eyes_preview.png`, `anim_hell_blinking_eyes_strip.png`, or `contact_sheet.png`; those are marked service-only in the approved source folder.

Cover alternatives, if the default cover crops badly: regenerate fresh variants from the current public/media set before upload.

## 4. Layout

- Embed size: `1280 x 720`.
- Keep the game embed first.
- Make the screenshot/sidebar column visible. Current public page hides it with `.right_col { display: none; }`; remove that if visible in the editor.
- If custom CSS is available, paste `custom_css.css`. It is now paste-safe and contains no local URL placeholder.

## 5. Editor Preview Check

The editor preview only proves that authenticated editor state looks right. It does not prove that the public page has the saved page, latest upload, or uncached copy.

Before saving, use preview/editor UI only for these checks:

- title, short description, genre, tags, colors, approved screenshots/GIFs, and embed settings match this runbook;
- the frontpage copy markers are present in the description;
- the screenshot/sidebar column is visible in the editor preview;
- the game embed is still first and set to `1280 x 720`.

Do not report a live-page update from editor preview alone.

## 6. Public Logged-Out Verification

After saving, verify the page that itch actually serves while logged out. The normal probe path is a public `GET`; it does not need itch credentials and does not send cookies.

Dry-run the configured URL and required markers:

```bash
node ../gatbage/media/itch_page_pack/probe_itch_editor.js --dry-run
```

Probe the public page from `upload_manifest.json`:

```bash
node ../gatbage/media/itch_page_pack/probe_itch_editor.js
```

Override the URL if checking a staging or renamed itch page:

```bash
node ../gatbage/media/itch_page_pack/probe_itch_editor.js --url https://tenevik.itch.io/gigahrush
```

If a browser/cache mismatch is suspected, save the logged-out HTML and check the exact file:

```bash
curl -L https://tenevik.itch.io/gigahrush -o /tmp/gigahrush-itch.html
node ../gatbage/media/itch_page_pack/probe_itch_editor.js --html /tmp/gigahrush-itch.html
```

For a quick manual marker scan:

```bash
curl -L https://tenevik.itch.io/gigahrush | rg "GIGAH\\|RUSH|Browser survival horror|free HTML5/WebGL browser game|Samosbor events"
```

The script asserts:

- title marker: `GIGAH|RUSH`;
- copy markers: short description, frontpage description text, and `https://gigahrush.bileter.workers.dev`;
- key image markers: the 14 current live itch image ids from `upload_manifest.json`;
- version marker: none for the frontpage pass.

Also open the public page in an incognito or logged-out browser and check:

- the public page is no longer white/default;
- the description starts with `Browser survival horror / ARPG shooter inside a huge concrete apartment block.`;
- all 14 approved media files are visible in the itch media list or page gallery;
- the embed still launches;
- mobile width does not overflow;
- `https://gigahrush.bileter.workers.dev` is clickable.

Do not report the live page as updated until the logged-out public probe and the manual public check both pass.
