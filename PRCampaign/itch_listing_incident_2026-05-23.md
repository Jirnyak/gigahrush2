# itch.io Listing Incident - 2026-05-23

Purpose: resolve the current itch.io discovery/listing problem without page recreation, spam bumps or guesswork.

Update 2026-05-31 04:30-04:37 BST: see `PRCampaign/PR_51_itch_indexing_followup_2026-05-31.md`. The issue is still active. Public game page `https://tenevik.itch.io/gigahrush` returns `200 OK` but still contains `<meta content="noindex" name="robots"/>`; exact itch searches for `gigahrush`, `GIGAH|RUSH` and `ГИГАХРУЩ` still do not show the Tenevik project. Authenticated dashboard/source check through Opera GX shows visible blockers are off: `published: true`, `active: true`, `restricted: false`, `unlisted: false`, with ready embedded HTML upload `gigahrush-itch.zip` / id `17736214`, cover, 14 screenshots/GIFs, accurate tags and AI disclosure false. Analytics show `548` views / `147` browser plays. The devlog permalink `https://tenevik.itch.io/gigahrush/devlog/1530909/-` still returns `404` and now clearly says the page is flagged for moderator review and restricted to logged-in users. A follow-up email was sent from `tenevik.games@gmail.com` to `support@itch.io`; Gmail displayed `Message sent`. No dashboard setting change, page recreation or moderation-evasion action was made.

Checked publicly on 2026-05-23 19:40 UTC / 20:40 BST, again after dashboard work on 2026-05-23 20:20 UTC / 21:20 BST, and again during PR 10 monitoring at 2026-05-23 20:59-21:06 UTC / 21:59-22:06 BST.

## Current Facts

| Check | Result |
| --- | --- |
| Game page | `https://tenevik.itch.io/gigahrush` returns `200 OK`. |
| Public robots state | Public HTML still contains `<meta content="noindex" name="robots"/>`. |
| Latest visible page update | PR 10 public recheck says `Updated 23 May 2026 @ 20:04 UTC`; page was originally `Published 18 May 2026 @ 04:20 UTC`. |
| Browser build | Current iframe points to `https://html-classic.itch.zone/html/17651708/index.html?v=1779563799`; page has a `Run game` HTML5 embed. |
| Profile visibility | `https://tenevik.itch.io` publicly lists `GIGAH\|RUSH` under `Creator of`, with cover, description and `Play in browser`. |
| Search visibility | Itch search for `gigahrush`, `GIGAH\|RUSH`, `ГИГАХРУЩ` does not show `tenevik.itch.io/gigahrush`; it shows older unrelated/similarly named projects. |
| Browse/tag visibility | Public survival-horror browse checks did not show `GIGAH\|RUSH` in the checked result page. |
| Devlog index | `https://tenevik.itch.io/gigahrush/devlog` returns `200` and lists the launch post. |
| Devlog permalink | `https://tenevik.itch.io/gigahrush/devlog/1530909/-` still returns public `404`, even though the devlog index and RSS expose that URL. PR 10 recheck shows the 404 body now explicitly says the page has been flagged for moderator review and access is restricted to logged-in users. |

Conclusion: the page is public and playable by direct URL/profile, but it is not indexed in itch.io Search & Browse. The devlog post also has a public permalink/status/slug problem.

## Dashboard State And Actions

2026-05-23 19:40-19:50 UTC: attempted a safe Chrome DOM-only check of `https://itch.io/game/edit/4587160` without passwords or final clicks.

Result:

- Chrome was redirected to `https://itch.io/login`.
- Page title: `Just a moment...`.
- Body text: `Performing security verification`.
- Cloudflare Ray ID shown: `a0069099f91dc198`.

Follow-up browser check at 2026-05-23 19:52 UTC: Chrome had an itch tab at `https://itch.io/login`; Opera GX had no itch dashboard tab. No authenticated dashboard session was available for safe DOM edits or `Save changes`.

Follow-up Opera GX dashboard check at 2026-05-23 20:10-20:20 UTC succeeded with the owner session. Safe source/DOM checks found:

- main edit page reports `published: true`, `active: true`, `restricted: false`, `unlisted: false`;
- current HTML upload `gigahrush-itch.zip` is `ready`, embedded/playable, and `4 999 557` bytes;
- cover image and 14 screenshots/GIFs are present;
- classification is Games / HTML / In development, genre `shooter`;
- tags are `doom`, `life-simulation`, `maze`, `no-ai`, `procedural`, `retro`, `sandbox`, `shooter`, `sprites`, `survival-horror`;
- AI disclosure fields are all false;
- Release info is saved as code license `none`, assets license `none`, release date `2026-05-21 23:00:00 UTC` (22/05/2026 00:00 BST), blank publisher;
- Classification metadata is saved as inputs `keyboard,mouse,touchscreen`, average duration `hour`, languages `en,ru`, accessibility `subtitles,tutorial`, NSFW/content warning off;
- Engines & tools has no selected tools, which is correct because itch has no custom TypeScript/Vite/WebGL/canvas entry and false Unity/Godot/Three.js tagging would be inaccurate;
- External links are saved compactly: official site, Telegram, direct browser build, IndieDB and Game Jolt;
- Promo images are optional and currently empty; the page already has cover/screenshots/GIFs. Use the approved local/public assets below if adding these later.

Fresh public recheck at 2026-05-23 20:20 UTC / 21:20 BST still found:

- game page `200 OK`, still `noindex`;
- devlog index `200 OK`, still `noindex`;
- devlog permalink `/devlog/1530909/-` still `404`;
- itch search for `gigahrush`, `GIGAH|RUSH` and `ГИГАХРУЩ` still did not show `tenevik.itch.io/gigahrush`.

PR 10 public recheck at 2026-05-23 20:59-21:06 UTC / 21:59-22:06 BST still found:

- game page `200 OK`, still `noindex`;
- latest visible update changed to `23 May 2026 @ 20:04 UTC`;
- current iframe still points to `html/17651708/index.html?v=1779563799`;
- public itch iframe `index.html` is `10 673 105` bytes / SHA-256 `6bc3eff141f26853f32c460db5c231d8b6639a54cd22a8deb6e826b3b289374c`, which differs from local `dist/index.html` and the ZIP root `index.html` at `10 673 018` bytes / SHA-256 `732ced4bc2d7bcf91edaec7382ca67d5f4707d1e75ed3c5a29f0ed5df3424d18`;
- exact itch searches for `gigahrush`, `GIGAH|RUSH` and `ГИГАХРУЩ` still did not show `tenevik.itch.io/gigahrush`;
- devlog permalink `/devlog/1530909/-` still returns public `404`, and the body now says the page is flagged for moderator review and requires login.

Support email was sent from Gmail `jirnyak@gmail.com` to `support@itch.io` at 2026-05-23 20:22 UTC / 21:22 BST. Gmail DOM verification found the correct recipient, subject and body before send; Gmail then showed `Message sent`.

Devlog editor source was checked after the email. The post is already `Published`, comments are enabled, and the type is `Major Update or Launch`, but the edit form exposes no slug/permalink field. The broken `/-` permalink appears to come from itch's generated slug for the Cyrillic title. Do not change the public post title just to force a Latin slug unless the owner explicitly accepts that content change or itch support recommends it.

## Official itch.io Rules To Apply

The official indexing guide says Search & Browse indexing requires:

- project visibility set to `Public`;
- no public-access restrictions such as `Disable new downloads & purchases` or `Unlisted in search & browse`;
- a cover image;
- a playable/downloadable/purchasable project, not an empty placeholder.

Itch also says some indexing operations are asynchronous; new seller/project review or automated checks can delay indexing; published pages remain functional by direct URL/profile; and creators should not try to bypass restrictions by deleting/recreating pages or making new accounts.

Quality rules relevant to this page:

- keep metadata and tags accurate;
- do not select unrelated platforms/languages/tags;
- label adult content only if it is actually adult;
- provide cover/screenshots;
- avoid misleading imagery/claims;
- use the designated release announcements area for self-promo.

## Immediate Dashboard Checklist

This checklist is now complete except for the devlog slug/status fix. Do not recreate the page.

1. Open `Edit game` for `https://tenevik.itch.io/gigahrush`.
2. In `Visibility & access`, confirm the page is `Public`.
3. In public access settings, confirm both blockers are off:
   - `Disable new downloads & purchases`;
   - `Unlisted in search & browse`.
4. Confirm the uploaded HTML5 file is still enabled/playable and not restricted to owners, testers, keys or downloads-only.
5. Confirm cover image remains uploaded.
6. Confirm screenshots/GIFs remain uploaded and visible.
7. Confirm classification is not NSFW/adult. Current public positioning is survival horror with combat/blood/corpses, not adult/NSFW.
8. Confirm platform metadata only says HTML5/browser unless native executables are uploaded.
9. Confirm languages list only the languages actually supported in the current build/page; do not select all languages.
10. Confirm AI disclosure remains accurate. Current public row says `No generative AI was used`.
11. Devlog editor checked: the post is `Published`, but no slug/permalink field is exposed. Wait for support or owner approval before changing the public title to force a Latin generated slug.
12. After saving, recheck:
   - `curl -sSL https://tenevik.itch.io/gigahrush | rg -i "noindex|robots"`
   - itch search for `GIGAH|RUSH`, `gigahrush`, `ГИГАХРУЩ`
   - devlog permalink.

## Recommended Metadata Values

Use these values when updating the `Metadata` tab and neighboring sections shown in the owner screenshot on 2026-05-23. These recommendations are meant to remove bad metadata/blocker risk; they do not replace itch support if the page remains `noindex` after correct settings are saved.

### Release info

| Field | Recommended value | Reason |
| --- | --- | --- |
| License for code | `No license` | The repository uses a project-specific/source-available non-commercial license, not a standard MIT/GPL/Apache-style open-source grant. Do not select a standard open-source license unless the owner intentionally relicenses the code. |
| License for assets | `No license` | Current public assets are project-owned/procedural/campaign assets, not a Creative Commons asset pack. Do not select CC unless the owner intentionally grants those rights. |
| Release date | `22/05/2026` | Campaign launch date is 2026-05-22, while the itch page was first published earlier on 2026-05-18. If itch requires a time, use `00:00` local time unless the owner wants to record a more precise launch time. Do not set a future date. |
| Publisher | Leave blank | The screenshot says to leave this blank if self-publishing. If a nonblank publisher name is required later, use `Tenevik Games`. |

### Classification

| Field area | Recommended value |
| --- | --- |
| Project classification | Game. |
| Project kind/platform | Browser / HTML5 / playable in browser only, unless native executable builds are uploaded. |
| Release status | In development / Early Access. |
| Price | Free or pay-what-you-want if the current page pricing remains `0`. |
| Genre | Shooter as the primary itch genre; survival horror should remain in tags/copy where itch supports it. |
| Tags | Keep accurate tags only: `survival horror`, `horror`, `shooter`, `browser`, `HTML5`, `WebGL`, `singleplayer`, `procedural generation`, `survival`, `ARPG` if available. Avoid unrelated broad tags. |
| Maturity / NSFW | Not adult/NSFW. Use horror/combat/blood/corpses/weapon-use warnings if itch asks for content details. |
| Generative AI disclosure | No generative AI was used, matching the current public page row. |
| Languages | Select only languages actually supported by the current build/page. Do not select all languages for reach. |

### Engines & tools

Do not select Unity, Godot, Unreal, GameMaker, RPG Maker or another runtime engine. The current game is a custom TypeScript/Vite WebGL/canvas build.

If itch offers freeform or `Other` entries, use:

- `Custom engine`
- `TypeScript`
- `Vite`
- `WebGL`
- `Canvas`
- `HTML5`

If the UI only allows known engines and none fit, leave the engine field blank rather than choosing a false engine.

### External links

Use a compact link set. Too many links can make the page look like a link farm while the page is under indexing review.

Priority links:

| Label | URL |
| --- | --- |
| Official site | `https://jirny.uk` |
| Direct browser build | `https://gigahrush.bileter.workers.dev` |
| Telegram | `https://t.me/gigah_rush` |
| IndieDB | `https://www.indiedb.com/games/gigahrush` |
| Game Jolt | `https://gamejolt.com/games/gigahrush/1072064` |
| DiscoverGG | `https://discovergg.com/game/gigahrush` |
| Samosbor Archive RU | `https://samosborarchive.fandom.com/ru/wiki/ГИГАХРУЩ` |
| Samosbor Archive EN | `https://samosborarchive-en.fandom.com/wiki/GIGAH_RUSH` |

Avoid active Newgrounds links until the RIP/upload blocker is resolved. Keep DTF/GameDev.ru as campaign links, not necessarily as primary itch metadata links, unless the owner wants those visible from the store page.

### Promo images

Use current approved assets, not random screenshots. Current local media source:

- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/`
- square overview: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/contact_sheet_3x3.png`
- motion hooks: `01_hero_gif_hell_blinking_eyes.gif`, `02_gif_underhell_maronary_samosbor_loop.gif`
- static screenshot set: the nine PNGs currently present in `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/`

First-choice public assets:

- GIF: `https://img.itch.zone/aW1hZ2UvNDU4NzE2MC8yNzQwNDQ4OS5naWY=/original/LTioNh.gif`
- GIF: `https://img.itch.zone/aW1hZ2UvNDU4NzE2MC8yNzQwNDQ5MC5naWY=/original/xkmr2K.gif`
- Cover: `https://img.itch.zone/aW1nLzI3MzI4NTE0LnBuZw==/original/Pp7K5P.png`
- Local gallery/media ZIP bundles from 2026-05-23 were removed during repository cleanup; regenerate them from `selected_best/` before attaching files.

Use GIFs/screenshots that show actual gameplay, HUD, Samosbor/combat/exploration and readable visual state. Avoid dark generic atmospheric images as promo images because they do not prove the browser build is playable.

## Support Email Sent

Sent from Gmail `jirnyak@gmail.com` to `support@itch.io` on 2026-05-23 20:22 UTC / 21:22 BST.

```text
Subject: GIGAH|RUSH page remains noindex / not visible in Search & Browse

Hello itch.io support,

I am the creator of GIGAH|RUSH:
https://tenevik.itch.io/gigahrush

I read the Search & Browse indexing guide and checked the page configuration from my side:

- The project is public and reachable by direct URL.
- The game is visible from the public creator profile: https://tenevik.itch.io
- It has a cover image and screenshots/GIFs.
- It has a playable HTML5 browser build uploaded to itch.io.
- The latest public recheck saw the page updated on 23 May 2026 @ 20:04 UTC.
- The current public HTML5 iframe points to `html/17651708/index.html?v=1779563799`.
- The project is survival horror, not adult/NSFW.
- The page states that no generative AI was used.

However, as of 2026-05-23 20:20 UTC, the public HTML still contains:
`<meta content="noindex" name="robots"/>`

It also does not appear in itch.io search for:

- `GIGAH|RUSH`
- `gigahrush`
- `ГИГАХРУЩ`

The page was first published on 18 May 2026 @ 04:20 UTC, so this has persisted for several days. Could you check whether this page/account is still in review, or whether there is a dashboard setting/metadata issue I need to correct?

There is also a devlog URL issue: the public devlog index and RSS expose this URL:
https://tenevik.itch.io/gigahrush/devlog/1530909/-

but that permalink returns `404` publicly. The devlog index itself is live:
https://tenevik.itch.io/gigahrush/devlog

Could you advise whether this is a post status/slug issue I should fix in the dashboard?

Thank you,
jirnyak
```

## Campaign Decision Until Fixed

- Superseded by PR_18: for RU/CIS public copy, use MyIndie as the primary game page; keep itch.io as mirror/EN link while monitoring indexing.
- Use the direct Cloudflare build as a fallback play link when a community complains about MyIndie or itch loading/embedding.
- Do not create a new itch.io page, new account, duplicate devlog or duplicate release-announcement topic to bypass `noindex`.
- Do not ask for ratings, votes, collections or artificial engagement.
- If search still collides after indexing because older `gigahrush` pages rank above this project, consider a normal title refinement rather than a new page: `GIGAH|RUSH: Samosbor` or `GIGAH|RUSH - Samosbor Survival Horror`.
