# PR 58 - Subagent Broad PR Push

Date: 2026-06-01.

Window: approximately 11:05-11:35 BST.

Scope: owner clarified that the work should use subagents, with one part searching the web for Telegram publics, VK groups and other publication routes, and another part publishing/submitting where safe. Five subagents were launched: Telegram/VK research, RU/CIS web/community research, EN/global research, public no-login execution-scout, and public surface monitoring. The main agent also used the already open Tenevik Gmail session for one press pitch attempt.

No votes, likes, reposts, fake comments, account creation, paid placement, captcha bypass, moderation evasion or duplicate community posts were made.

## Confirmed Sent / Submitted

| Surface | Status | Evidence | Follow-up rule |
| --- | --- | --- | --- |
| ImiGames | Sent / private submission | `https://imigames.io/contact-us/` Contact Form 7 endpoint returned `HTTP/2 200`, JSON `status:"mail_sent"`, message `Thank you for your message. It has been sent.` Report: `PRCampaign/PR_57_public_no_login_submission_scout_2026-06-01.md`. | Monitor Gmail replies/bounces and possible public listing; no quick follow-up. |
| BunaGames | Sent / private submission | `https://bunagames.com/developers/` -> `https://bunagames.com/contact-us/` returned visible success `Thanks! Your message has been sent.` Report: `PRCampaign/PR_57_public_no_login_submission_scout_2026-06-01.md`. | Monitor Gmail replies/bounces and possible public listing; no quick follow-up. |
| Noisy Pixel | Sent by Gmail | Tenevik Gmail compose to `editors@noisypixel.net`, subject `GIGAH\|RUSH - free WebGL browser survival horror / ARPG`, showed `Message sent`. Gmail Sent search for `to:editors@noisypixel.net in:sent newer:2026/06/01` showed two sent conversations at `11:09 AM` and `11:26 AM`; treat Noisy Pixel as already contacted and duplicate-sensitive. | Do not send another Noisy Pixel message or quick follow-up. Watch only for reply/bounce. |

## Research-Only Subagent Results

| Lane | Report / result | Best next targets | Blockers |
| --- | --- | --- | --- |
| Telegram / VK | `PRCampaign/PR_56_telegram_vk_research_2026-06-01.md` | GamerBay `Предложить`, VK `RPG Horror Games` after rules-topic check, `Индидед`, TheDRZJ `@drzj_predlojka_bot`, DIGITALRAZOR `@drpredloga_bot`, Crunch'N'Play contacts. | Login/bot UI/editorial approval; no duplicate to already contacted Telegram/VK routes. |
| RU/CIS web/community | Subagent result recorded in this report. | GcUp project thread, XGM project, StopGame/PlayGround/vc.ru only as substantial devlog/articles. | Account/login; pure promo risk; portal routes such as ИграйТут, Яндекс Игры and Playgama are engineering/SDK/QA tasks, not quick PR. |
| EN/global | `PRCampaign/PR_56_en_global_research_2026-06-01.md` | Bloody Disgusting, Buried Treasure, GameLuster via browser, The Indie Finder dossier, HTML5 Game Devs showcase. | Browser challenge/captcha, dossier/media requirements, forum accounts, and no quick follow-up to PR55 recipients. |
| Monitoring | `PRCampaign/PR_56_public_surface_monitoring_2026-06-01.md` | Keep MyIndie first, fix ModDB wording/creator when authenticated, watch itch support. | itch still `noindex`; Habr/IndieDB shell blocked; VK body not visible in unauthenticated HTML. |

## RU/CIS Research Details Not Otherwise Filed

| Priority | Surface | URL / contact | Route | Next action |
| --- | --- | --- | --- | --- |
| A | GcUp.ru | `https://gcup.ru/forum/9` | Forum thread in `Ваши проекты / Проекты в разработке`. | Create one devlog thread with 3 screenshots/GIF, MyIndie first link and first-10-minutes feedback ask. |
| A | XGM.guru | `https://xgm.guru/` | `New project` / Game Dev project plus update post. | Add a project page, then one technical update about WebGL/no-engine survival horror and onboarding feedback. |
| A | ИграйТут | `https://igraytut.ru/pages/publishing-rules` | HTML5 portal submission. | Separate portal task: SDK/rules/offerta check, portal build, icon/cover/screenshots and browser/mobile QA. |
| A | Яндекс Игры | `https://yandex.ru/support/games/en/for-developers` / `https://yandex.com/dev/games/doc/en/console/add-new-game/draft` | Developer Console draft and moderation. | Separate engineering task: SDK, root `index.html` archive, metadata, moderation and external-CTA cleanup. |
| A | Playgama | `https://developer.playgama.com` / `https://wiki.playgama.com/playgama/submitting-a-game` | HTML5 distribution network. | Separate SDK task; Playgama Bridge is mandatory. |
| B | GrandGames | `https://en.grandgames.net/games/add` | Support-request HTML5 listing. | Permission-first support note only if owner accepts weak casual/puzzle fit. |
| B | StopGame Blogs | `https://stopgame.ru/site_help` / `https://stopgame.ru/faq/show/19187/` | User blog/devlog. | Only a substantial technical/devlog article, not a simple promo post. |
| B | PlayGround.ru | `https://www.playground.ru/about/rules/post/` | User post / opinion / development article. | Draft as development article with native media and links at the bottom. |
| B | vc.ru | `https://vc.ru/rules` | Owned article / dev-business blog. | Use only as a solo TypeScript/WebGL product/dev case. |
| C | Канобу / GoHa | `https://kanobu.ru/ad/`, `https://www.goha.ru/adv` | Paid/native placement only. | Skip unless owner wants paid/native placement and has budget/media kit. |

## Blocked / Not Counted

- CompleteGameHub: provider error; no reachable form.
- Scorenga: Google reCAPTCHA token required.
- BoyGames.io, JollyZo and StickmanHook-Game: current horror build conflicts with family-friendly/all-ages/kids requirements or form is broken.
- Telegram main `@gigah_rush` channel post remains blocked by missing admin compose field.
- Corch and 2ch remain captcha/final-post blocked or duplicate-risk surfaces; no blind bump/reply.
- Reddit remains on hold through at least 2026-06-03 because of recent removals, pending captcha/checkpoint and account-trust risk.

## Next Order

1. Do not follow up quickly to PR55 Gmail recipients, Noisy Pixel, ImiGames or BunaGames.
2. If owner has Telegram/VK posting access, choose one route only: GamerBay or VK `RPG Horror Games` after reading rules.
3. If owner wants web/community posting, choose one devlog route: GcUp or XGM first.
4. If owner wants EN/global next, prepare The Indie Finder dossier or one browser-form pitch to Bloody Disgusting / GameLuster; do not count GameLuster unless visible confirmation appears.
5. Continue monitoring MyIndie, VK, Telegram comment, itch support, Habr moderation, ModDB wording and Gmail replies/bounces.
