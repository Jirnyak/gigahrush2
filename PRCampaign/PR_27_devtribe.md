# PR 27: DevTribe Lane 1/6 - 2026-05-27

Scope: DevTribe only. No public post, comment, vote, project creation, account change, confirmation resend, deletion, captcha bypass or final publish click was performed. No credentials were printed, stored or repeated.

Timebox: 2026-05-27 21:03 UTC / 22:03 BST.

## Required Inputs Read

- `KPI.md`
- `PRCampaign/campaign_plan_ru.md`
- `PRCampaign/kpi_report_2026-05-27.md`
- `PRCampaign/PR_24_devtribe.md`

## Public Status

DevTribe remains a suitable RU/CIS dev diary target, but no public GIGAH|RUSH page/post was found or published during this pass.

Checked public URLs:

- `https://devtribe.ru/` redirects to `https://devtribe.ru/welcome` and describes DevTribe as an indie game community with developer diaries, feedback from players/developers and project pages.
- `https://devtribe.ru/feed/games-dev` is the relevant `В разработке` lane and contains devlog/project posts.
- `https://devtribe.ru/p/admin/rules` forbids spam/flood/third-party advertising, but allows outside links inside articles when the useful content outweighs advertising links.
- Public `https://devtribe.ru/p/games-dev/add` returns HTTP `403` and page heading `:( Ошибка #403`.
- Public search check for `site:devtribe.ru GIGAH RUSH OR ГИГАХРУЩ OR gigahrush` did not find a GIGAH|RUSH DevTribe result.

## Authenticated Status

The usable DevTribe editor path is still blocked under the Tenevik account.

Tenevik-authenticated Chrome checks:

- Existing DevTribe add tab shows top identity `TENEVIK`.
- `https://devtribe.ru/p/games-dev/add` returns `403`, page title `Ошибка #403 — В разработке — DevTribe: инди-игры, разработка, сообщество`, and no editor.
- Same-session `/dialog/create/projects` returned HTTP `200`, `projects: 0`, and section `В разработке` with create URL `/p/games-dev/add`.
- Same-session security fetch from the Tenevik tab returned HTTP `200`, contained `TENEVIK`, did not contain `jirnyak`, showed `tenevik.games@gmail.com`, and still contained `Почтовый адрес еще не был подтвержден`.
- Same-session route checks all returned HTTP `403` with no editor:
  - `/p/games-dev/add`
  - `/p/games/add`
  - `/p/media/add`
  - `/p/game-design/add`
- Existing Gmail search tab for `tenevik.games@gmail.com` did not expose a visible DevTribe hit; no message was opened and no confirmation token/link was read.

Important identity caveat:

- A separate DevTribe settings tab in Chrome still showed the retired `jirnyak` identity. That tab/session was not used for publishing, project creation or account changes. Do not use it for this campaign lane.

## Publication Result

Live URL: none.

No DevTribe diary was prepared in the editor or published because the Tenevik account cannot access any tested creation route yet. This is an account confirmation / permission blocker, not a copy or media blocker.

## Exact Blocker

`TENEVIK` is authenticated on a DevTribe add tab, but `tenevik.games@gmail.com` is still unconfirmed and DevTribe returns `403` for all tested create routes. The expected blocker phrase is:

`Предупреждение! Почтовый адрес еще не был подтвержден.`

The expected blocked editor phrase is:

`:( Ошибка #403`

## Exact User Steps

1. Open `https://devtribe.ru/profile/settings/security` in the Tenevik DevTribe session, not in any retired `jirnyak` session.
2. Confirm the top account name is `TENEVIK`.
3. Under `Настройки почты`, verify the email is `tenevik.games@gmail.com`.
4. If the page still shows `Предупреждение! Почтовый адрес еще не был подтвержден.`, click the confirmation/resend control on that page if available.
5. Open Gmail for `tenevik.games@gmail.com`.
6. Search `from:devtribe OR devtribe.ru`.
7. Open the DevTribe confirmation email only if it is clearly for `tenevik.games@gmail.com`, then click the confirmation link.
8. Return to `https://devtribe.ru/profile/settings/security`.
9. Expected success phrase/state: the warning `Предупреждение! Почтовый адрес еще не был подтвержден.` is gone.
10. Open `https://devtribe.ru/p/games-dev/add`.
11. Expected success state: an article editor opens instead of `:( Ошибка #403`.
12. If DevTribe requires a project first, use the create dialog/project route under `TENEVIK` and create a GIGAH|RUSH project page before the `В разработке` diary.
13. Do not publish from any page that shows `jirnyak`, and do not paste the DTF post.

## Ready Publish Plan After Unlock

Use a unique DevTribe diary, media first, with this angle:

`Как я собираю вылазку в ГИГАХРУЩЕ: подготовка, САМОСБОР, контракты и A-Life в браузерном survival horror`

Recommended media order from `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/`:

1. `01_hero_gif_hell_blinking_eyes.gif`
2. `08_inventory_prep_loadout.png`
3. `07_contract_quest_log.png`
4. `04_active_samosbor_monsters.png`
5. `09_trade_grid.png`
6. `11_factions_alife_rank_panel.png`

Required link order:

1. MyIndie RU/CIS primary: `https://myindie.ru/games/game/gigahrush`
2. Direct browser build: `https://gigahrush.bileter.workers.dev`
3. itch mirror / EN: `https://tenevik.itch.io/gigahrush`
4. Telegram contact/updates: `https://t.me/gigah_rush`

Required wording:

- Clear disclosure: `Я разработчик ГИГАХРУЩА / Tenevik Games`.
- Use `безграничная бетонная структура` or `безграничная структура`; do not reveal implementation geometry.
- Ask for narrow feedback: first 10 minutes, preparation loop readability, Samosbor pressure, inventory/contracts UI, and whether the next decision is clear.
- Keep the article content-heavy enough that links are supporting material, not the body of the post.

Before final publish:

1. Open preview.
2. Verify media is visible before or near the opening text.
3. Verify MyIndie, direct build, itch and Telegram are clickable rendered links, not bare unlinked text.
4. Verify the visible author/account is `TENEVIK`.
5. Verify there is no `jirnyak`, no `jirny.uk`, no DTF copy-paste, and no implementation-geometry wording.
6. Only then click the final publish button.

## Next Agent Notes

- The DevTribe blocker from `PRCampaign/PR_24_devtribe.md` persists.
- If the editor opens after confirmation, publish one unique DevTribe diary only; do not duplicate DTF and do not create a link-only bump.
- After a successful public publish, verify the public URL logged out/publicly if possible and then let the parent update `KPI.md`, `campaign_plan_ru.md` and the dated KPI report.
