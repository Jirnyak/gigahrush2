# PR 68 - VK/TG/Form Continuation

Date: 2026-06-03.

Window: 22:20-23:20 BST.

Owner context: the provided pasted logs included an interrupted continuation after PR 67. This pass recovered those unrecorded facts, avoided duplicate Telegram bot sends, ran six read-only subagents for fresh targets/media/copy, completed one VK proposal, completed one public catalog form submission, and recorded blockers for routes that were not safely publishable.

No votes, likes, fake comments, mass repost requests, paid placements, captcha bypass, account creation, account-security bypass or moderation evasion were made.

## Submitted / Counted

| Surface | Result | Evidence | Notes |
| --- | --- | --- | --- |
| TheDRZJ / `@drzj_predlojka_bot` | Counted from owner-provided pasted continuation; not resent | The pasted log shows `DRZJ - ПРЕДЛОЖКА` accepted a Tenevik Games news-tip with MyIndie, direct build, itch, Telegram, content note and a 1920x1080 `live_05_samosbor_wave.png` screenshot. Bot replied `Спасибо за новость`. | Do not duplicate. Monitor `https://t.me/thedrzj` for publication. |
| DIGITALRAZOR / `@drpredloga_bot` | Counted from owner-provided pasted continuation; not resent | The pasted log shows the bot flow selected `Новость`, accepted a separate tech/player pitch, required and received `live_08_wall_snake_anomaly.png`, then received author line `Tenevik Games / @gigah_rush`. | Do not duplicate unless the bot asks for more fields. Monitor DIGITALRAZOR channels/publication. |
| VK `GameDev по-русски` | Suggested post submitted | Page: `https://vk.com/gamedevinrussian`. Rules article `https://vk.com/@gamedevinrussian-format-postov-dlya-razmescheniya-v-pablike-gamedev-po-russki` says proposal opens after following, requires author/source/tags/media, and forbids direct game/download/sales links in the post body. The account followed the page, opened `https://vk.com/wall-194760187?own=1`, used `Suggest post`, inserted a no-direct-download-link architecture/web post and clicked final `Suggest post`. After submit, VK showed `Suggested posts 1`. | This is a private moderation queue, not public reach yet. Text only: native screenshot upload was attempted but could not be verified as attached. Source link used: `https://t.me/gigah_rush`, not MyIndie/direct/itch, to respect their rules. |
| MMOGOVNO.ru / add game | Public webform submission accepted | Form: `https://mmogovno.ru/add-game`. Drupal form `webform_client_form_663` accepted the submission and redirected to `https://mmogovno.ru/node/663/done?sid=32086&token=...`; confirmation text: `Спасибо, ваша запись получена.` | Treat as a moderated catalog/blog submission, not live publication. Do not resubmit; monitor for listing/blog response. |

## Checked / Not Submitted

| Surface | Result | Reason / next action |
| --- | --- | --- |
| Rythm Group / `@RythmOffers_Bot` | Opened/started in pasted continuation, not submitted | Bot exposed a route to send a post/message to editors, but the Telegram input could not be reliably focused by automation. Do not count as sent. Retry manually only with visible composer focus. |
| `Быть Инди` Telegram | Opened in pasted continuation, not submitted | Channel asked to propose posts, but Telegram UI automation could not click `JOIN CHANNEL` or expose a composer. Use manual Telegram or the `https://sergeypomorin.com/bytindi/` route from subagent research. |
| AG.ru feedback | Checked, not sent | `https://ag.ru/feedback` is a general feedback/contact form, not a game-submission route. React API shape was not safely confirmed in this pass. If used later, send only a short catalog-route inquiry, not a claimed submission. |

## Six-Agent Research Output

The six subagents did not edit files or use accounts. Their useful outputs for the next wave:

- Telegram targets: `@KwagaGames_robot`, `@bytindi` / `@bytindichat`, `@indie_gamedev_r`, `@horror_games_hell`, `@PerviiHorrorKanal`, `@Delvir_chatbot`, `@Free_Gaming`, `@play4free`, `@gcapixel`, `@litegameyt`, `@steamvk`, `@smthaboutgame`.
- VK targets: `https://vk.com/bytindi`, `https://vk.com/indie_space`, `https://vk.com/chipin.games`, `https://vk.com/geeknews`, `https://vk.com/gologamesgroup`, `https://vk.com/indie_ag`, `https://vk.com/indiefan`, `https://vk.com/gaminme`, `https://vk.com/indiegomsk`, `https://vk.com/last_indie_standing`, `https://vk.com/world_indie_progress`, `https://vk.com/gamedev56`.
- RU press/forum/platform targets: GameMAG, AppTime email, GoHa forums/editorial route, Stratege.ru, Yandex Games, VK Play Developer Cabinet, `@SikriPredlozhka_bot` only with duplicate caution, `@EasyPlease` for `Девочка играет`, `@Menecitybot`, `@artkoblov` / `@unreal_alesia`, 2ch.life `/gd/` only with imageboard-risk acceptance.
- Public-form route: MMOGOVNO was the best submit-today candidate and was used in this pass. IndiVindi is a strong fit but needs account registration; IndieHub remains duplicate-sensitive/support-blocked.
- Media recommendation: use `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/01_hero_gif_hell_blinking_eyes.gif`, `02_gif_underhell_maronary_samosbor_loop.gif`, `contact_sheet_3x3.png`, `04_active_samosbor_monsters.png`, `08_inventory_prep_loadout.png` and `11_factions_alife_rank_panel.png` before the newer `PRCampaign/roadmap_2026-06-02/live_screenshots_2026-06-02/*.png`, because the newer live captures can include browser mouse-capture overlays.
- Copy variants produced: Telegram bot proposal, VK proposal without direct playable links, permission-first curator DM, architecture/devlog intro and short email pitch.

## Current Best Next Order

1. Monitor DRZJ, DIGITALRAZOR, VK `GameDev по-русски` suggested post and MMOGOVNO moderation before any follow-up.
2. Use `@KwagaGames_robot` next: explicit `Предложить игру` bot, low duplicate risk, attach a clean GIF/contact sheet.
3. Use `Быть Инди` manually through `https://sergeypomorin.com/bytindi/` or visible Telegram/community route; do not force the Telegram channel UI.
4. Try one VK Indie Space style community with proposed-post/community-message route and native media; keep developer disclosure and avoid link dumping.
5. Put IndiVindi into an account/cabinet queue.
6. Keep AG.ru as a short inquiry only if a safe API/composer path is confirmed.
