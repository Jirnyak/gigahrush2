# PR 27 - RU Portals / Community Blockers

Date: 2026-05-27.

Time window: 21:00-21:06 UTC / 22:00-22:06 BST / 00:00-00:06 MSK on 2026-05-28.

Scope: lane 4/6 recheck for StopGame blogs/contact, IndieHub `/game/add`, Pikabu Games add form and DevTribe. Read continuity from `KPI.md`, `PRCampaign/campaign_plan_ru.md`, `PRCampaign/kpi_report_2026-05-27.md`, `PRCampaign/PR_21.md`, `PRCampaign/PR_26.md` and the latest DevTribe report. No shared KPI/campaign docs were edited. No credentials were printed, stored or repeated.

## Result

No public post, portal listing, SDK/legal attestation, vote, comment or game submission was made.

A safe StopGame contact route existed and was attempted through the logged-in browser session: the `Пресс-релизы` topic was selected on `https://stopgame.ru/contact`, a concise Tenevik Games editorial tip was filled with MyIndie first, direct build second, itch mirror third and Telegram as contact, and the visible `Отправить` button was clicked. The page stayed on `/contact`, showed no durable success or error banner, and the checked contact tabs had empty subject/message fields afterward. Treat this as an unconfirmed StopGame contact attempt, not a guaranteed delivered pitch. Do not immediately resend the same message unless a reply, bounce, or visible platform state clarifies the outcome.

| Surface | Fresh public/session check | Safe action | Current decision |
| --- | --- | --- | --- |
| StopGame blogs | Authenticated browser opens `https://stopgame.ru/blogs/add` as `Блог Tenevik` with `Gamedev`, cover upload, `Опубликовать` and `В черновик`. Public help still says blogs are not for advertising or promoting own games/projects and points would-be promotion to `https://stopgame.ru/contact`. | Used the contact route once under `Пресс-релизы`; no blog post was created. Confirmation is not durable, so count as contact attempt only. | Do not publish a StopGame blog for GIGAH\|RUSH. Monitor for StopGame reply; if none appears, owner can later send a cleaner press-kit follow-up manually, not a duplicate blog. |
| IndieHub | Public `curl` returned `200` for `https://indiehub.ru/game/add`, but the page content still says `Произошла ошибка` / page does not exist. Authenticated session shows `TENEVIK`, `выход`, and the same Telegram support prompt. | No support message sent because the only support path is an external Telegram invite and no unambiguous Tenevik-owned Telegram composer was verified. | Support-blocked. Use Telegram support only after opening it under the intended campaign identity. No listing/final click until a real add-game form or manual submission path exists. |
| Pikabu Games | Public `curl` returned `200` for `https://games.pikabu.ru/add-own-game/form`. Authenticated form still shows step 1 `Авторизация в GamePush`; no local upload/draft fields are exposed. | No GamePush authorization, legal/payment assertion, upload or moderation submission was made. | Separate `portal=gamepush` engineering/legal task only. Current Cloudflare/itch build is not submit-ready for Pikabu Games. |
| DevTribe | Public `curl` returned `403` for `https://devtribe.ru/p/games-dev/add`. Authenticated session is `TENEVIK`; the same add route shows `Ошибка #403`, and security settings still say the campaign email is unconfirmed with confirmation requests already sent on 2026-05-27 at `22:42:31` and `22:42:41` site time. | No post, resend click or identity change was made. | Account-state blocked. Confirm the Tenevik email first, then retry `/p/games-dev/add` and publish only a unique DevTribe diary. |

## Exact Owner Steps

1. StopGame: do not use `https://stopgame.ru/blogs/add` for this campaign. Watch the campaign mailbox/StopGame account for a reply to the unconfirmed `Пресс-релизы` contact attempt. If a manual retry is needed later, use `https://stopgame.ru/contact`, topic `Пресс-релизы`, attach current GIF/screens/media only if the form accepts them, and do not repeat a generic link dump.
2. IndieHub: open `https://indiehub.ru/game/add`. If it still points to `IndieHub | Поддержка`, open the Telegram support link only from the intended Tenevik campaign Telegram identity and ask for the current add-game URL or manual submission requirements. Wait for a working form/preview before final submit.
3. Pikabu Games: start a separate GamePush/Pikabu Games build task before using `https://games.pikabu.ru/add-own-game/form`: GamePush project/auth, SDK bridge, cloud-save bridge, no external-link policy except support, icon/capsule pack, mobile/performance QA, and legal/payment readiness.
4. DevTribe: confirm the Tenevik email from mailbox/spam or DevTribe security settings, then reopen `https://devtribe.ru/p/games-dev/add`. If the editor opens, use a fresh media-first diary about preparation/Samosbor/contracts/A-Life, not the DTF copy.

## Checked Sources

- StopGame blog editor: `https://stopgame.ru/blogs/add`
- StopGame help/rules: `https://stopgame.ru/site_help#kak_sozdat_blog_pomestnym_ponyatiyam`
- StopGame contact form: `https://stopgame.ru/contact`
- IndieHub add path: `https://indiehub.ru/game/add`
- IndieHub profile/session page: `https://indiehub.ru/profile`
- Pikabu Games submit gate: `https://games.pikabu.ru/add-own-game/form`
- Pikabu Games technical documentation: `https://games.pikabu.ru/page/tehnicheskaya-dokumentatsiya`
- DevTribe add path: `https://devtribe.ru/p/games-dev/add`
- DevTribe security settings: `https://devtribe.ru/profile/settings/security`
- DevTribe rules: `https://devtribe.ru/p/admin/rules`
