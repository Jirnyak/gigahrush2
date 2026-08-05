# GIGAH|RUSH Media KPI Report - 2026-05-22

## Snapshot

| Surface | Status | Signal | Risk | Action |
| --- | --- | --- | --- | --- |
| itch.io game page | Live | `200 OK`, title `GIGAH|RUSH by Tenevik Games`; final release uploaded by owner. | Public HTML still contains `noindex`. | Recheck indexing later; if still `noindex`, inspect itch dashboard/indexing warning. |
| Cloudflare build | Live | `200 OK`, title `ГИГАХРУЩ - САМОСБОР`, no public `noindex`; HTML response 8,579,376 bytes. | Must stay in sync with itch final release. | Keep as direct browser link in PR. |
| Newgrounds | Updated and published | Project page live; final HTML5 archive uploaded through `/parkfile`, project changes published, public iframe returns 9,262,219 bytes. | Newgrounds embed dimensions remain 640x480; manual play preview still useful. | Watch votes/reviews and test public play in browser. |
| DTF | Live | Page returns `200 OK`; itch link visible. | Comments may surface first-run confusion or promo pushback. | Monitor comments and repeat complaints. |
| GameDev.ru | Live | Page returns `200 OK`; itch link visible. | Encoding in shell output is broken, but public page is reachable. | Monitor replies for technical feedback. |
| Fandom RU/EN pages | Live | Three Fandom pages published: two RU, one EN. | External links/categories could be edited by wiki users. | Monitor edits/reverts and link retention. |
| itch Release Announcement | Live | Published and fixed after bad initial Markdown. | Could look stale if final release changed materially. | Only update/comment if there is a real release note. |
| itch Devlog | Live | Launch devlog published. | Same as itch page: discovery limited while `noindex` remains. | Monitor comments/views in dashboard when needed. |
| GamHub | Submitted | Public form returned `{"code":200,"msg":"Submit success"}` for `GIGAH\|RUSH`. | Public search still shows no result; likely waiting for directory review. | Recheck in 24-48h and capture final listing URL if approved. |
| Reddit r/playmygame | Needs fix/manual | Old post exists, but is not the copy standard. | It was treated as NSFW in the earlier flow; current game is survival horror, not NSFW. | Use `PRCampaign/reddit_posts_en.md` non-NSFW text for any future manual Reddit post. |
| IndieDB | Blocked | Browser cookies exist, but shell requests still return Cloudflare `403` managed challenge. | Cannot automate page creation via HTTP right now. | Owner must complete live browser flow or submit manually using `PRCampaign/en_portal_store_copy.md`. |
| iDev.Games | Blocked | `publish-game` page live; `/login` and `/register` return Cloudflare challenge; no local cookies. | Needs manual browser login/registration. | Owner can log in, then retry automation. |
| ShoutWiki | Blocked | Abuse filter blocks all edits with `запрет правок`, rule `1==1`. | Not solvable by account login. | Revisit only if wiki editing is unfrozen. |

## Good Signs

- Cloudflare direct build is live and indexable.
- Newgrounds was updated from the fresh final ZIP and re-published.
- DTF, GameDev.ru and the Fandom pages are still reachable.
- GamHub accepted the directory submission for review.
- The campaign now has a reusable KPI operating brief in `KPI.md`.

## Bad Signs

- itch.io still emits `noindex`, so discovery from itch search/public indexing may lag.
- IndieDB and iDev.Games both have browser-challenge blockers.
- DiscoverGG, Gamemoor and Fake Portal need account/email before submission.
- Newgrounds still needs a manual public play preview, even though the iframe source now returns the game HTML.

## Feedback Themes

- No new public comments were collected in this pass.
- Next monitoring pass should specifically classify feedback into: onboarding, controls, UI readability, survival pressure, Samosbor danger, browser performance, English/Russian clarity.

## Fix Queue

1. Check itch.io dashboard/indexing state if `noindex` persists.
2. Manually preview Newgrounds public build and verify canvas, keyboard/mouse input, audio unlock and fullscreen.
3. Check GamHub search/listing in 24-48 hours.
4. Complete IndieDB in a live browser, or submit manually from `PRCampaign/en_portal_store_copy.md`.
5. Keep Reddit copy non-NSFW.

## Next Actions

1. Owner: open IndieDB live browser flow and finish Cloudflare/account validation.
2. Agent: after IndieDB is accessible, create/update the IndieDB game page with final release links.
3. Agent: run a KPI daily report after the first wave has comments/views.
4. Owner: provide contact email/signature for email-only catalog/media submissions.
5. Owner/agent: decide whether to pursue iDev.Games account login next or defer to media pitches.

## Owner Needed

- IndieDB: live browser access to `https://www.indiedb.com/games/add`.
- iDev.Games: login/registration if this portal is still desired.
- DiscoverGG/Gamemoor/Fake Portal: login/account access if these listings should be submitted next.
- Media pitches: contact email and signature name/nick before sending anything to Alpha Beta Gamer, Free Game Planet, Indie Games Plus or Games Pending.
