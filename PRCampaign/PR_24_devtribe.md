# PR 24: DevTribe Lane Recheck - 2026-05-27

Scope: DevTribe only. No source files, public posts, comments, votes, account deletions, captcha bypasses or final publish clicks were performed.

Timebox: 2026-05-27 20:27-20:39 UTC / 21:27-21:39 BST.

## Sources Checked

- Campaign continuity docs: `KPI.md`, `PRCampaign/campaign_plan_ru.md`, `PRCampaign/kpi_report_2026-05-27.md`, `PRCampaign/dtf_devtribe_safe_path_2026-05-27.md`.
- Public DevTribe pages:
  - `https://devtribe.ru/` -> redirects to `https://devtribe.ru/welcome`.
  - `https://devtribe.ru/feed/games-dev`.
  - `https://devtribe.ru/p/admin/rules`.
  - `https://devtribe.ru/projects`.
  - `https://devtribe.ru/register`.
  - `https://devtribe.ru/p/games-dev/add`.
- Authenticated Chrome DevTribe session under `TENEVIK`.
- Tenevik Gmail search for DevTribe confirmation mail.

## Public Fit

DevTribe remains a good RU/CIS devlog target:

- The welcome page describes DevTribe as a site for indie games, dev diaries, player/developer feedback and project pages.
- `https://devtribe.ru/feed/games-dev` is the right content lane for active development notes.
- Rules allow third-party links inside articles when useful content outweighs advertising links, and prohibit spam/flood/third-party advertising.

## Authenticated State

Chrome is logged into DevTribe as `TENEVIK`.

Exact checks:

- `https://devtribe.ru/p/games-dev/add` returns `Ошибка #403`.
- Authenticated create dialog endpoint `/dialog/create/projects` returns `projects: []`.
- The same endpoint exposes `В разработке` with create URL `/p/games-dev/add`, but opening that URL returns `403`.
- Checked publish routes:
  - `/p/games-dev/add` -> `403`, no editor.
  - `/p/games/add` -> `403`, no editor.
  - `/p/media/add` -> `403`, no editor.
  - `/p/game-design/add` -> `403`, no editor.
- `https://devtribe.ru/profile/settings/security` shows `Предупреждение! Почтовый адрес еще не был подтвержден.`
- Security settings show email `tenevik.games@gmail.com`.
- The security page lists confirmation requests already sent on 2026-05-27 at `22:42:31` and `22:42:41` site time.
- Gmail search in `tenevik.games@gmail.com` for `DevTribe` and `in:anywhere (devtribe OR devtribe.ru OR TENEVIK)` did not find a DevTribe confirmation message.

## Publication Result

Live URL: none.

No DevTribe post was published because the account cannot access the editor yet. This is not a content-prep blocker; it is an account state blocker.

## Exact Blocker

`TENEVIK` is logged in, but email is unconfirmed and DevTribe blocks all tested article/project publish routes with `403`. The confirmation email is not visible in the Tenevik Gmail account yet.

## Safe Next Action

1. Wait for the DevTribe confirmation email or request a fresh confirmation from `https://devtribe.ru/profile/settings/security`.
2. Confirm only `tenevik.games@gmail.com`; do not use old `jirnyak` identity.
3. Reopen `https://devtribe.ru/p/games-dev/add`.
4. If the editor opens, publish a unique DevTribe diary, not the DTF text:
   - media first from `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/`;
   - MyIndie first: `https://myindie.ru/games/game/gigahrush`;
   - direct build second: `https://gigahrush.bileter.workers.dev`;
   - itch only as mirror/EN fallback;
   - Telegram only as contact/updates;
   - clear developer disclosure from `Tenevik Games`;
   - no implementation geometry wording.
5. Before final publish, verify preview/rendered editor state: media visible, links clickable, no link-only body, no old identity, no captcha/permission bypass.

## Suggested DevTribe Angle

Use a practical development-diary hook rather than an announcement:

`Как я собираю вылазку в ГИГАХРУЩЕ: подготовка, САМОСБОР, контракты и A-Life в браузерном survival horror`

Ask for narrow feedback: whether the first 10 minutes make the preparation loop understandable, whether Samosbor pressure is readable, and whether inventory/contract UI communicates the next decision.
