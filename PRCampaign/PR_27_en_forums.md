# PR 27 - EN Forums Monitoring / Unlocks

Date: 2026-05-27.

Time window: 20:59-21:10 UTC / 21:59-22:10 BST.

Scope: HTML5GameDevs public/moderation status and TIGSource approval/posting status. Read `KPI.md`, `PRCampaign/campaign_plan_ru.md`, `PRCampaign/kpi_report_2026-05-27.md` and `PRCampaign/PR_23.md` before acting. No shared KPI/campaign docs were edited. No source code, upload package, vote/rating action, duplicate post, support message or blind final click was made.

## Snapshot

| Surface | Current status | Evidence | Action |
| --- | --- | --- | --- |
| HTML5GameDevs Game Showcase | Still submitted/author-visible only. Public/logged-out check does not see the topic. | Public direct fetch of `https://www.html5gamedevs.com/topic/73484-wip-gigahrush-free-html5webgl-survival-horror-arpg-shooter/` at 20:59 UTC returned HTTP `404`, title `Sorry, we could not find that!`, body marker `We could not find that topic.` and error `2F173/O`. Authenticated Chrome still shows the topic body, author marker `TENEVIK`, moderation banner, two itch-hosted GIFs and clickable direct browser / itch links. | Do not repost. Recheck public visibility at **2026-05-28 09:00 UTC / 10:00 BST**. Approval is confirmed only when a clean/logged-out browser shows the topic body and playable links. If it still returns `2F173/O`, next check is **2026-05-28 21:00 UTC / 22:00 BST**. |
| TIGSource Playtesting / DevLogs | Account still pending admin approval. No composer is reachable. | Authenticated Chrome tab at `https://forums.tigsource.com/index.php?action=register2` has title `Register`, still shows `Welcome, Guest`, and the registration result says an admin must approve the account before it can be used. DOM markers showed `pendingApproval:true`, `hasNewTopic:false`, no login marker. Shell/forum public routes still return Cloudflare managed-challenge `403`, so the browser state is the usable status source. | Do not post yet. Wait for admin approval/email unlock, then log in and verify the account is no longer `Welcome, Guest` before opening any `New Topic` composer. |

## HTML5GameDevs Details

Author-visible post facts remain intact:

- Topic URL: `https://www.html5gamedevs.com/topic/73484-wip-gigahrush-free-html5webgl-survival-horror-arpg-shooter/`
- Author/session marker: `TENEVIK`
- Moderation marker: `Your content will need to be approved by a moderator`
- Playable links still present in author view:
  - `https://gigahrush.bileter.workers.dev/`
  - `https://tenevik.itch.io/gigahrush`
- Media still present in author view:
  - `https://img.itch.zone/aW1hZ2UvNDU4NzE2MC8yNzQwNDQ4OS5naWY=/original/LTioNh.gif`
  - `https://img.itch.zone/aW1hZ2UvNDU4NzE2MC8yNzQwNDQ5MC5naWY=/original/xkmr2K.gif`

Public status is not approved yet. The clean check must show the title/body and the two playable links before this becomes a public campaign surface.

## TIGSource Next User Steps

Use these only after the account approval email arrives or the browser no longer shows the pending-admin message:

1. Open `https://forums.tigsource.com/index.php?action=login` and log in locally. Do not paste passwords or codes into chat.
2. Confirm the forum header no longer says `Welcome, Guest`.
3. Choose one path:
   - `Developer -> Playtesting` if the immediate goal is browser-build feedback.
   - `Community -> DevLogs` only if the owner will maintain updates in the same thread.
4. Open `New Topic`, then use unique TIGSource copy. Do not paste the HTML5GameDevs or Reddit text.
5. Before publish, use preview and verify:
   - at least one visible screenshot/GIF renders;
   - the direct browser build or itch link is clickable;
   - developer affiliation is explicit;
   - wording uses `unbounded concrete megastructure` or similar, with no map-size/topology implementation detail;
   - the post asks for concrete feedback, not votes, ratings, follows or bumps.
6. If preview is missing, links are stripped, images do not render, or the account still looks guest/pending, stop and record the blocker instead of posting.

Recommended first thread choice after approval: `Playtesting`, because it can ask for focused first-launch feedback without promising a long devlog cadence. A `DevLogs` thread is better only if follow-up updates will be maintained there.

## No-Go Conditions

- Do not create a second HTML5GameDevs topic while `73484` is still pending.
- Do not publish on TIGSource while the account is pending approval or still shows `Welcome, Guest`.
- Do not post a link-only announcement.
- Do not ask for votes, ratings, bumps or follows.
- Do not expose implementation geometry in public copy.
