# DTF / DevTribe Safe Publish Path - 2026-05-27

Scope: DTF follow-up and DevTribe. No public post, comment, vote, deletion, account change or final publish click was made during this safe-path pass.

Update later the same day: the DTF follow-up exists and was repaired in place after a brief text-only/personal-blog incident. Current public URL is `https://dtf.ru/indie/5086991-gigahrusha-novaya-versiya-myindie-i-kadry-iz-samosbora`; the 20:46 UTC public recheck found native media, `5` DTF redirect anchors and no raw URL paragraphs. Keep the DevTribe blocker below active; treat the DTF section below as historical pre-publish state.

Timebox: 2026-05-27 20:09 UTC / 21:09 BST.

## Sources Checked

- Campaign continuity docs: `KPI.md`, `PRCampaign/campaign_plan_ru.md`, `PRCampaign/kpi_report_2026-05-27.md`, `PRCampaign/dtf_followup_myindie_post_2026-05-27.md`.
- DTF public pages: `https://dtf.ru/indie`, `https://dtf.ru/rules`, `https://dtf.ru/terms`.
- DevTribe public pages: `https://devtribe.ru/`, `https://devtribe.ru/feed/games-dev`, `https://devtribe.ru/p/admin/rules`, `https://devtribe.ru/register`, `https://devtribe.ru/p/games-dev/add`.
- Live link checks: MyIndie `https://myindie.ru/games/game/gigahrush` returned `200`; direct build `https://gigahrush.bileter.workers.dev` returned `200`; itch mirror `https://tenevik.itch.io/gigahrush` returned `200`; Telegram `https://t.me/gigah_rush` returned `200`.

## DTF

Status: historical pre-publish blocker; superseded by the repaired live DTF post noted above.

Exact state:

- Chrome active tab is `https://dtf.ru/?modal=editor&action=edit&id=5086991`.
- Page title is `С вами снова разработчик ГИГАХРУЩА: MyIndie, 0.3.0 и новые кадры из САМОСБОРА`.
- Visible account in editor: `Tenevik`.
- Draft title/body match the prepared follow-up angle with MyIndie first.
- Editor still shows `Без темы`.
- DOM check found no native media blocks in the editor draft.
- DOM check found the game URLs present as text, but not verified as clickable anchors/previews.
- `Опубликовать` is visible/enabled, but clicking it now would be a blind final click against the campaign rules.

Official/public rule basis:

- DTF `Инди` describes itself as the place to tell DTF about a game you are making.
- DTF rules allow links to own projects while useful to the community, but prohibit spam, aggressive external linking and repeated copies.
- DTF rules prohibit publishing new copies of previously published materials for feed/search manipulation.

Safe DTF path:

1. Keep MyIndie as the first RU/CIS playable link.
2. Assign the draft to `Инди` or the intended DTF topic; do not publish under `Без темы`.
3. Attach native media before the first external-link block, starting with `01_hero_gif_hell_blinking_eyes.gif`, then the Samosbor, inventory, contract, trade and factions PNGs from `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/`.
4. Use preview or public DOM to verify MyIndie, direct build, itch and Telegram are clickable links or DTF redirect links with clear visible labels.
5. Then publish is allowed by the current owner instruction; no extra owner approval is required, but no blind final click.

Live URL during this pass: none. Later same day repaired live URL: `https://dtf.ru/indie/5086991-gigahrusha-novaya-versiya-myindie-i-kadry-iz-samosbora`.

Historical blocker cleared later by editing the existing post: missing topic/community, missing native media and unverified clickable links in draft `5086991`.

## DevTribe

Status: good RU/CIS devlog target, but account/permission-gated.

Exact public state:

- `https://devtribe.ru/` positions DevTribe as a site for indie games, developer diaries, community feedback and project pages.
- `https://devtribe.ru/feed/games-dev` publicly lists devlog/project posts under `В разработке`.
- `https://devtribe.ru/p/admin/rules` allows third-party links inside articles when content usefulness exceeds advertising links, and forbids spam/flood/third-party advertising.
- Public `https://devtribe.ru/p/games-dev/add` returns HTTP `403` / `Ошибка #403`.
- `https://devtribe.ru/register` is reachable and exposes username, email, password, reCAPTCHA and VK auth.

Safe DevTribe path:

1. Use only a Tenevik-owned account/session.
2. Register/log in manually if needed; do not automate around reCAPTCHA.
3. First create or unlock a GIGAH|RUSH project page if DevTribe requires project ownership before `В разработке` posts.
4. Publish a unique DevTribe diary, not a paste of the DTF follow-up.
5. Use MyIndie first, direct build second, itch only as mirror/EN fallback and Telegram only for contact/updates.
6. Include native media or an allowed image gallery; if media upload is unavailable, do not make a link-only post.

Live URL: none, because DevTribe posting is blocked.

Blocker: public add path returns `403`; posting requires Tenevik-owned login/registration and likely project/post permissions.

## Docs Updated

- `KPI.md`
- `PRCampaign/campaign_plan_ru.md`
- `PRCampaign/kpi_report_2026-05-27.md`
- `PRCampaign/dtf_followup_myindie_post_2026-05-27.md`
- `PRCampaign/dtf_devtribe_safe_path_2026-05-27.md`
