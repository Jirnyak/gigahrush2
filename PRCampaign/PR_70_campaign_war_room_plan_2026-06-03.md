# PR 70 - Campaign War Room Plan

Date: 2026-06-03.

Window: 23:35-23:55 BST.

Purpose: quick PR team planning meeting after the KPI/reach snapshot. This is a planning and operating-order pass, not a publication pass. No post, email, DM, form submission, upload, vote, like, comment, rating, account action, captcha action or paid placement was made.

## Current Situation

The campaign is past the first visibility threshold:

- DTF is the strongest measurable attention surface: `3,987` combined views and `847` hits across three posts.
- MyIndie is the strongest measurable player funnel: `350` web plays and `21` downloads.
- The new DTF post is still moving: `88` views / `19` hits at 19:10 BST -> `684` views / `86` hits by 23:25 BST.
- Telegram owned channel is small but real: `18` subscribers.
- ModDB and Fake Portal give global indexed traces.
- Several promising routes are submitted but not public yet: DRZJ, DIGITALRAZOR, VK `GameDev по-русски`, RavenStories VK, MMOGOVNO, Perelesoq, Индикатор and CoreMission.

The bottleneck is not a lack of targets. The bottleneck is converting queued/submitted routes into public posts, avoiding duplicate spam, and getting better analytics.

## Meeting Decisions

1. Keep MyIndie as the RU/CIS primary playable link because it exposes the best public play/download counters.
2. Use `GIGAH|RUSH` in EN/global titles and search-facing copy; use `ГИГАХРУЩ / GIGAH|RUSH` in RU posts.
3. Stop treating "one more generic post" as progress. Each new action must be either:
   - a public publication,
   - a submitted editorial/moderation queue with evidence,
   - a playable-platform/portal step,
   - or an analytics/measurement unlock.
4. Do not touch Reddit until captcha/account-trust is fixed and a native-media recovery plan is used.
5. Do not count PlayGround until the malformed/session-only post is repaired or removed.
6. Keep StopGame as editorial/contact only; do not publish a self-promo blog there under current rules.

## 24-Hour Objectives

Target by the next daily KPI check:

- MyIndie: `400+` web plays.
- DTF combined: `4,300+` views.
- Telegram: `20+` subscribers.
- At least `2` additional real outbound actions from the approved queue.
- At least `1` moderation/publication status resolved from current pending routes.
- Zero duplicate submissions to already-contacted bots/outlets.

## Operating Lanes

### Lane A - Immediate RU/TG/VK Outreach

Goal: produce quick additional distribution without duplicating current queues.

Order:

1. `@KwagaGames_robot` - next best Telegram bot. Send a concise developer-disclosed pitch with MyIndie first, direct build second, itch third, Telegram contact, and one clean GIF/contact sheet.
2. `Быть Инди` - use `https://sergeypomorin.com/bytindi/` or a visible manual Telegram/community route. Do not force the Telegram channel UI if composer focus is unreliable.
3. One VK indie community route from the PR 68 list, preferably `https://vk.com/indie_space` or `https://vk.com/bytindi`, after checking current group rules and native media attachment path.

Definition of done:

- Sent/submitted state is visible.
- Exact route, timestamp, copy, media and response are recorded.
- If public, record URL and visible counters.

Expected result:

- `+1` to `+3` moderation queues today.
- If one publishes: `+300` to `+3,000` views/impressions and `+20` to `+200` play actions.

### Lane B - Pending Queue Monitoring

Goal: turn hidden progress into measured results.

Monitor and record:

- DRZJ `@drzj_predlojka_bot` / `https://t.me/thedrzj`.
- DIGITALRAZOR `@drpredloga_bot`.
- VK `GameDev по-русски` suggested post.
- RavenStories VK private proposal.
- MMOGOVNO add-game submission `sid=32086`.
- Perelesoq and Индикатор form submissions.
- CoreMission comment `unapproved=129636`.

Definition of done:

- For each route, status is one of `public`, `still pending`, `rejected`, `needs owner reply`, `needs more assets`.
- Public URLs and counters are recorded immediately.

Expected result:

- Clearer funnel state; potential `+1` earned publication without extra outreach.

### Lane C - Analytics Unlock

Goal: stop guessing total players.

Required access/actions:

- Cloudflare Worker analytics for `gigahrush.bileter.workers.dev`: requests, unique visitors if available, referrers, country/device.
- MyIndie authenticated dashboard: labeled meanings for `views/web plays/downloads`, referrers if available.
- itch dashboard: views, browser plays, downloads, referrers; confirm `noindex` support status.
- DTF analytics if author panel exposes link clicks/referrals.

Definition of done:

- One table with public counters vs dashboard counters.
- Current unique sessions estimate gets a confidence band instead of guesswork.

Expected result:

- Replace current `400-700` all-surface session estimate with a measured number or tighter range.

### Lane D - Portal / Platform Growth

Goal: move beyond post traffic into playable portal traffic.

Priority order:

1. Y8: wait for reply to existing developer-support email; if accepted, prepare clean HTML5/WebGL ZIP/package/screenshots/controls/content note.
2. Pikabu/GamePush: finish owner-only company/legal data and sandbox/browser/cloud-save QA before public announcement.
3. VK Play / Yandex Games: treat as product/legal tasks, not quick PR. Use only when SDK/legal requirements are ready.
4. PlayFeed / PlayMiniGames / Dustore / EXE.ru: hold until content/legal/upload QA is clear.

Definition of done:

- One portal has a valid accepted build, review queue, or exact rejection reason.

Expected result:

- If accepted by a real portal, reach moves from hundreds-per-post to thousands or tens of thousands of impressions, but only after QA/legal packaging.

### Lane E - EN/Global Index And Press

Goal: make `GIGAH|RUSH` easier to find outside RU/CIS.

Order:

1. ModDB wording cleanup under authenticated account: remove old/unsafe identity traces, keep Tenevik-safe wording, direct build, MyIndie/itch/Telegram.
2. One fresh EN pitch, not a batch blast: Bloody Disgusting, GameLuster or Buried Treasure from earlier queue, chosen by fit and current submission rules.
3. The Indie Finder dossier or HTML5GameDevs showcase continuation if a proper media-first format is available.

Definition of done:

- One public/search-facing EN surface improved or one tailored EN pitch sent.

Expected result:

- Better indexed `GIGAH|RUSH` footprint and possible global long-tail traffic.

## 7-Day Campaign Plan

Day 1:

- Execute Lane A item 1: `@KwagaGames_robot`.
- Monitor all Lane B queues.
- Pull at least one analytics dashboard if owner/session allows.

Day 2:

- Execute one VK or `Быть Инди` route.
- Fix/remove PlayGround malformed post if owner can access editor.
- Check DTF post `5100874` comments/counters and answer only concrete feedback.

Day 3:

- ModDB cleanup or one EN/global tailored pitch.
- Prepare IXBT/НАШЫ ИГРЫ assets only if there is a clean trailer/VK Video/YouTube route.

Day 4-5:

- Portal work: Y8 response handling or Pikabu/GamePush QA/legal completion.
- No extra DTF/GameDev duplicate posts unless there is a real build update or article angle.

Day 6-7:

- KPI review against targets.
- Choose next cycle: RU channel burst if Telegram/VK queues publish, or portal push if Y8/Pikabu moves.

## Owner Needed

These are not optional if the campaign wants stronger results:

- Cloudflare analytics access or exported stats.
- MyIndie dashboard labels/stats.
- itch dashboard stats and support/noindex reply.
- Telegram/VK manual composer access where automation cannot focus safely.
- PlayGround manual repair/delete path.
- GamePush/Pikabu legal/company data if portal growth is prioritized.

## What We Will Not Do

- No vote/like/comment asks.
- No fake player comments.
- No duplicate bot submissions.
- No Reddit retries while captcha/account trust is unresolved.
- No public claims of "all players" without analytics.
- No public map/topology implementation details.
- No PlayGround reach claim until repaired.

## Result Standard

A PR action only counts when it leaves one of these artifacts:

- public URL,
- accepted form/bot/editorial confirmation,
- visible moderation queue state,
- exact rejection/blocker,
- dashboard metric,
- or updated KPI/report entry.

Anything else is just effort, not result.
