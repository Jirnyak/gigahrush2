# PR 51: itch.io indexing follow-up - 2026-05-31

Time window: 2026-05-31 04:30-04:37 BST.

Owner request: itch.io page for GIGAH|RUSH is still effectively unlisted / not indexed despite real traffic, so investigate and fix what can be fixed without recreating the page.

## Public Checks

- Public game page `https://tenevik.itch.io/gigahrush` returned `200 OK`.
- Public game HTML still contains `<meta content="noindex" name="robots"/>`.
- Public page footer shows `Updated 30 May 2026 @ 05:55 UTC`.
- Current public HTML5 iframe points to `https://html-classic.itch.zone/html/17736214/index.html?v=1780120523`.
- Public search pages for `gigahrush`, `GIGAH|RUSH` and `ГИГАХРУЩ` did not show `https://tenevik.itch.io/gigahrush`; they showed older unrelated/similar projects.
- Public devlog index `https://tenevik.itch.io/gigahrush/devlog` returned `200` but also carried `noindex`.
- Public devlog permalink `https://tenevik.itch.io/gigahrush/devlog/1530909/-` returned `404` and the page text said it was flagged for moderator review and restricted to logged-in users.

## Dashboard Checks

Authenticated dashboard/source check through the existing Opera GX session showed the main blockers are not enabled:

- `published: true`
- `active: true`
- `restricted: false`
- `unlisted: false`
- project id `4587160`, slug `gigahrush`
- classification `game`, kind `html`, release status `in_development`
- price `0`
- HTML upload `gigahrush-itch.zip`, upload id `17736214`, size `5,418,300`, state `ready`, `embed: true`, uploaded `2026-05-30 05:55:05`
- cover image present
- 14 screenshots/GIFs present
- tags present: `arpg`, `atmospheric-horror`, `browser-game`, `html5`, `life-simulation`, `procedural`, `shooter`, `singleplayer`, `survival-horror`, `webgl`
- AI disclosure fields all false

Authenticated analytics at `https://itch.io/game/summary/4587160` showed:

- `548` views
- `147` browser plays
- `0` ratings
- `0` collections
- `0` comments

Largest visible referrers included Reddit, GameDev.ru, VK redirect, the Tenevik itch profile, Google, Pikabu, ModDB, DTF, Newgrounds, Fake Portal, Gamin.me and IndieDB.

## Action Taken

Sent a follow-up email from the logged-in Gmail session `tenevik.games@gmail.com` to `support@itch.io`.

Subject:

```text
Follow-up: GIGAH|RUSH still noindex / not in Search & Browse
```

The email reported:

- previous support email on 2026-05-23;
- project URL and project id;
- current public `noindex`;
- failed direct itch searches;
- dashboard state `published: true`, `active: true`, `restricted: false`, `unlisted: false`;
- cover, gallery, ready embedded HTML upload and accurate metadata;
- current analytics `548` views / `147` browser plays;
- explicit confirmation that we read itch indexing docs and are not trying to bypass review by recreating the page/account;
- devlog permalink `404` / moderator-review symptom.

Gmail displayed `Message sent` after the send action.

Immediate Gmail search `from:support@itch.io newer:1d` showed no receipt/ticket yet.

## Decision

This does not look like a local dashboard misconfiguration. The page satisfies the visible baseline requirements but is still deindexed/noindexed, and the devlog permalink is explicitly under moderator review. The next effective fix is itch support/manual review, not page recreation or spammy re-uploading.

No dashboard setting change, page deletion/recreation, duplicate project, vote/rating/comment request, fake engagement, or moderation-evasion action was made.

## Next Actions

1. Watch `tenevik.games@gmail.com` for the support receipt / ticket id and any exact response text.
2. Recheck `https://tenevik.itch.io/gigahrush` for removal of `noindex`.
3. Recheck itch search for `GIGAH|RUSH`, `gigahrush` and `ГИГАХРУЩ`.
4. Recheck the devlog permalink after support responds.
5. Until indexed, use MyIndie as RU/CIS primary and itch as direct mirror/EN page in public copy.
