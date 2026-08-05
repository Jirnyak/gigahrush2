# GIGAH|RUSH Release Artifacts - 2026-05-23

Purpose: historical local artifact manifest for the big-redesign PR/upload pass. These files were local generated artifacts, not source files to commit.

Cleanup note, 2026-05-31: the physical local generated ZIP bundles from this dated pass were removed to reduce repository weight. Keep this file as a checksum/history record only; regenerate current release/upload artifacts before using any ZIP in a new upload flow.

## Build Artifacts

| Artifact | Path | Size | SHA-256 | Use |
| --- | --- | ---: | --- | --- |
| Single-file HTML | `dist/index.html` | 10 673 018 bytes | `732ced4bc2d7bcf91edaec7382ca67d5f4707d1e75ed3c5a29f0ed5df3424d18` | Cloudflare/static host source. |
| Itch/portal HTML | `itch/index.html` | 10 673 018 bytes | `732ced4bc2d7bcf91edaec7382ca67d5f4707d1e75ed3c5a29f0ed5df3424d18` | Direct HTML upload fallback. |
| HTML5 ZIP | `itch/gigahrush-itch.zip` | 4 999 557 bytes | `fa63dd2be47292814989234482f40597b23fa58df2ec3ab823992953f6c66321` | Primary HTML5 portal upload ZIP; root contains `index.html`. |

`npm run check:release` passed on 2026-05-23 after one transient full-suite retry. The first run failed once in `tests/population-profiles.test.ts` (`HELL starts as a five-thousand actor AI floor`), then that file passed 5/5 isolated reruns and the second full release gate passed.

Size warnings are present but non-blocking:

- single-file HTML exceeds the 9.50 MB warning line;
- gzip/ZIP output exceeds the 4.50 MB warning line;
- the heaviest rendered bucket remains Bad Apple frame data.

## Local PR Archives

| Archive | Path | Size | SHA-256 | Contents |
| --- | --- | ---: | --- | --- |
| HTML5 portal build copy | removed local ZIP: `gigahrush_html5_portal_build_2026-05-23.zip` | 4.8 MB | `fa63dd2be47292814989234482f40597b23fa58df2ec3ab823992953f6c66321` | Historical copy of the then-current HTML5 ZIP for portal upload forms. |
| Portal visuals | removed local ZIP: `gigahrush_portal_visuals_2026-05-23.zip` | 13 MB | `84691e790ba997053d036f68afcf15e0f93bb95211f6dc8ddfcbd26762b07ef0` | Historical strong screenshots plus cover/social/capsule assets. |
| Press kit media | removed local ZIP: `gigahrush_press_kit_media_2026-05-23.zip` | 20 MB | `f14256545f9593fbc86bb9014847cedd6f933b86b5692fadd9c8e52a27c7c077` | Historical visuals, GIFs, cover/social/capsules/poster, RU/EN copy docs. |
| Itch gallery pack | removed local ZIP: `gigahrush_itch_gallery_2026-05-23.zip` | 28 MB | `d3b85c8997309d149a83cec27f3cfe3b84df1483b366b6d5fe5d904f5b338eff` | Historical approved frontpage screenshots plus optimized GIFs. |

## Current Selected Media

Owner-updated best picks are now in `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/`. Future PR/upload agents should take screenshots, GIFs and the contact sheet from that folder first, not from older loose hunt folders.

- Square 3x3 sheet: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/contact_sheet_3x3.png`, 1 920 x 1 920 PNG, 2 253 839 bytes, SHA-256 `c9a45173c944fa6074aa4cf2a0b9894acff484c4d3082251c1ea522a96f37c39`.
- Compatibility filename: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/contact_sheet_png.png` is the same 3x3 image.
- Motion hooks: `01_hero_gif_hell_blinking_eyes.gif`, `02_gif_underhell_maronary_samosbor_loop.gif`.
- Static 3x3 source PNGs: `04_active_samosbor_monsters.png`, `06_underhell_gate_pack.png`, `12_living_monster_ring_clean.png`, `07_contract_quest_log.png`, `08_inventory_prep_loadout.png`, `09_trade_grid.png`, `08_living_full_map.png`, `10_full_map_route_context.png`, `11_factions_alife_rank_panel.png`.

## Public Recheck

2026-05-23 19:45 UTC / 20:45 BST:

- itch.io: `200 OK`, updated `23 May 2026 @ 20:04 UTC` on the latest public recheck, still contains `noindex`.
- Cloudflare: `200 OK`, title `ГИГАХРУЩ - САМОСБОР`, body size `10 673 018` bytes, no `noindex`.
- DiscoverGG: `https://discovergg.com/game/gigahrush` is live with `200 OK`; guessed `/game/gigah-rush` remains non-canonical.
- GamHub, Fake Portal and FreeZonePlay guessed public slugs still return `404`.
- Game Jolt is live and synced: public API reports package `1093814`, release `1474942`, build `1960153`, primary file `gigahrush-itch.zip` at `4 999 557` bytes; direct served `index.html` matches the local `dist/index.html` hash and opens with visible canvases.

2026-05-23 21:02-21:06 UTC / 22:02-22:06 BST follow-up:

- itch.io game page still returns `200 OK` and still contains `noindex`; page timestamp is now `23 May 2026 @ 20:04 UTC`.
- The public itch iframe `index.html` returned `10 673 105` bytes and SHA-256 `6bc3eff141f26853f32c460db5c231d8b6639a54cd22a8deb6e826b3b289374c`, which does not match local `dist/index.html` / ZIP root `index.html` (`10 673 018` bytes, SHA-256 `732ced4bc2d7bcf91edaec7382ca67d5f4707d1e75ed3c5a29f0ed5df3424d18`).
- Cloudflare still matches local `dist/index.html`.
- DiscoverGG remains live/indexable with one vote and the itch.io play link retained.
- Game Jolt public API still reports package `1093814`, release `1474942`, build `1960153`; early counters are `profileCount 2`, `playCount 0`, `downloadCount 0`, `like_count 1`, `follower_count 0`.
- Before more portal sync claims, verify whether the public itch iframe is the intended build or whether the known local ZIP should be re-uploaded.

2026-05-23 21:23-21:45 UTC / 22:23-22:45 BST public upload follow-up:

- MyIndie published public page `https://myindie.ru/games/game/gigahrush` with the current `itch/gigahrush-itch.zip` (`4 999 557` bytes), cover and 3 screenshots.
- MyIndie public page shows `WEB VERSION`, version `0.2.0`, Web (HTML5), engine `Another`, RU/EN, genres Shooter/RPG/Action/Survival/Horror and date `23.05.2026`.
- MyIndie page data exposes ZIP download `https://storage.yandexcloud.net/myindie/games/b43d90cd-a696-4afa-a326-ee7f6a491987/gigahrush_1779572489186.zip`, size `4 999 557` bytes, and Web build path `/games/b43d90cd-a696-4afa-a326-ee7f6a491987/web/gigahrush_1779572489186.zip/index.html`.
- Kongregate Developer Application submitted; no artifact was uploaded there yet.

## Upload Notes

- Regenerate `itch/gigahrush-itch.zip` for generic HTML5 ZIP upload forms, then verify it remains the intended current build; public itch served a different `index.html` hash during the 2026-05-23 check.
- Do not publish Newgrounds until project `7759223` accepts a real archive instead of the known `9B` attachment and preview plays.
- Game Jolt no longer needs package upload access for this release; use it as an active campaign link and reserve future dashboard work for extra media, devlog/update posts or replies to real comments.
- MyIndie now has the current HTML5 ZIP uploaded and public; future MyIndie dashboard work should be limited to corrections, media polish or moderation/comment response.
- For any remaining instant-public portals, stop before final upload unless the owner explicitly confirms that immediate publication is acceptable.
