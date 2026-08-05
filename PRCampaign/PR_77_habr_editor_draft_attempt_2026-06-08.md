# PR 77 - Habr editor draft paste attempt

Date: 2026-06-08.
Time window: 2026-06-08 BST.
Owner instruction: send the prepared architecture article to Habr as a draft if possible, and provide a concrete images-only list for what the owner should add.

## Result

Prepared Habr-ready article text and image-only checklist:

- Habr-ready article body: `PRCampaign/habr_architecture_article_habr_ready_2026-06-08.md`.
- Images-only checklist: `PRCampaign/habr_architecture_images_only_2026-06-08.md`.
- Source draft/report from the same pass: `PRCampaign/habr_architecture_article_draft_2026-06-08.md` and `PRCampaign/PR_76_habr_architecture_article_draft_2026-06-08.md`.

The Chrome session was logged in as `TENEVIK` and the Habr creation editor opened at:

- `https://habr.com/ru/article/new/`

The Habr-ready article text was copied from the local file and pasted into the open Habr editor. A visible browser screenshot after the paste showed the article body in the editor near the final sections, so the editor received the text.

Important limitation: no server-side draft ID, saved draft URL, preview URL, publication, scheduled post, moderation action or final save confirmation was verified. Chrome blocked JavaScript Apple Events with `Access not allowed`, and no blind final UI click was used. Treat the current Habr state as an open editor/autosave paste in the logged-in Chrome session, not as a confirmed published or server-saved draft.

## What Was Not Done

- No Habr publication.
- No click on a final publish or "ready to publish" action.
- No public comment, vote, DM, bookmark request or karma/action request.
- No image upload to Habr.
- No duplicate article was created after the editor paste.

## Images Owner Should Add

Minimum set:

1. Feed cover: `../gatbage/tmp/media/habr_post_2026-05-31/habr_cover_samosbor_780x440.jpg`.
2. Manual architecture diagram: `core`, `data`, `gen`, `systems`, `render` around one `World`; arrows `gen builds`, `systems mutate`, `render reads`.
3. World/map screenshot: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/08_living_full_map.png`.
4. Renderer proof screenshot: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/12_living_monster_ring_clean.png`.
5. A-Life/factions screenshot: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/11_factions_alife_rank_panel.png`.
6. Samosbor screenshot or GIF: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/04_active_samosbor_monsters.png` or `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/02_gif_underhell_maronary_samosbor_loop.gif`.

Optional:

- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/08_inventory_prep_loadout.png` for the first-route/readability section.
- Simple DDA/raycasting diagram with a corridor screenshot on the left and grid ray stepping on the right.

## Next Action

Owner should return to the open Habr editor, confirm the article text is still present, upload the images natively through the Habr editor, remove the `[КАРТИНКА N: ...]` placeholder lines after each image is inserted, preview the article, then manually save/publish only after links and captions are checked.

If the open Habr editor lost autosaved text, use `PRCampaign/habr_architecture_article_habr_ready_2026-06-08.md` as the source to paste again.
