# PR 27 - Upload Portals And Legal/Account Gates

Date: 2026-05-27.

Time window: 21:00-21:02 UTC / 22:00-22:02 BST / 00:00-00:02 MSK on 2026-05-28.

Scope: Yandex Games, VK Play developer/browser project, Newgrounds upload bug check-only, and Gamemoor reply/contact state. No source code, upload, publish, legal declaration, developer application, mailbox/account change, support duplicate, or Newgrounds project mutation was performed. The repo is dirty with unrelated campaign/code/build work; this pass wrote only this file.

## Result

No live URL, portal draft, upload, developer application, legal attestation or support message was created.

| Surface | Current check | Safe decision |
| --- | --- | --- |
| Yandex Games | Official docs still make this a separate portal build: SDK is mandatory, `LoadingAPI.ready()` is required when the game is ready, sound/pause and save behavior must satisfy platform rules, unzipped files are capped at `100 MB`, root `index.html` is required, and moderation is usually `3-5 working days`. Public shell access to `https://games.yandex.com/console` hit Yandex Passport/captcha. Read-only Chrome title/URL check reached `https://games.yandex.com/console/developer/create` with title `Yandex Games. Console`; no form body was inspected and no developer/account step was taken. | Safe dashboard draft is not reachable before account/developer setup and the separate `portal=yandex` build. Owner must complete Yandex account/developer setup; engineering must add SDK loader, ready signal, pause/audio lifecycle, save policy and no external CTA before any upload. |
| VK Play browser project | Official docs still support a `Browser` project type where the developer hosts an HTTPS iframe URL; dashboard tracks moderation/publication state; test iFrames allow up to 10 test pages; the checklist requires first-load success, adaptive layout, no external leading links/page links/game links, no custom fullscreen button and complete Basic Features fields. Public shell and read-only Chrome checks land on `https://developers.vkplay.ru/welcome` with title `Developer Dashboard \| VK Play`; the guessed `/dashboard` path also returned the same welcome surface. No project/create form was reached in this pass. | No safe draft was possible. Previous blocker remains the operative one: developer registration/legal/tax/contact/18+ facts must be supplied by the owner before a non-public Browser draft/test iframe can be created. |
| Newgrounds | Official wiki still accepts HTML5 ZIP uploads and says root `index.html` is required, the game is iframe-previewed before publish, and a `403` after ZIP upload usually means `index.html` is not at ZIP root. Public `https://www.newgrounds.com/portal/view/1033564` still redirects to RIP/eulogy; shell and Chrome checks saw `Eulogy for: GIGAH RUSH` at `/portal/rip/1033564` and `This entry was deleted.` Read-only Chrome check of `https://www.newgrounds.com/projects/games/7759223/details` now redirects to login, so the old project is not accessible in the current browser state and the prior `9B` attach bug was not retested. Current local artifact at check time: `itch/gigahrush-itch.zip` is `5 194 645` bytes and contains root `index.html` of `11 303 784` bytes. | Keep Newgrounds out of active links. Do not upload, call `/parkfile`, publish, or edit the project until the owner restores correct project/account access or Newgrounds support gives a clean path. If support wording is prepared, first confirm which dirty local ZIP is the intended release artifact; do not reuse PR 25's older byte counts blindly. |
| Gamemoor | Public contact page still says the developer portal is open, account-specific submission questions should use the contact form, and submissions go through review usually within a few days. Public terms still classify submitted games as `PEGI 3-16 only, no NSFW content`. Public `/developer` redirects to login; read-only Chrome check of `/developer` redirects to the homepage with title `Gamemoor - Free Browser Games`. Contact page is reachable at `https://gamemoor.com/contact`. Private mailbox reply state was not independently rechecked because Chrome currently blocks JavaScript-from-Apple-Events DOM access and no safe mailbox read path was available. No duplicate contact was sent. | Treat PR 25's sent-form state as still pending until the owner checks mailbox/support manually or provides a safe readable session. Do not submit or send another contact request until Gamemoor confirms the developer portal/submit URL and account identity path. Frame the game as non-NSFW survival horror, likely max PEGI 16, if a submission path opens. |

## Owner Steps

1. Yandex Games: finish account/developer setup manually, then open a separate `portal=yandex` engineering task before upload.
2. VK Play: owner supplies/enters company/commercial name, tax residence, contact and age/legal facts if choosing this route; after that, create only a non-public Browser draft/test iframe and verify preview before any publication request.
3. Newgrounds: restore the correct account/project access or contact Newgrounds support; only retest upload after preview can show the real ZIP size and playable game.
4. Gamemoor: check for a reply to the previously sent support/contact request; do not resend while still waiting.

## Sources Checked

- Yandex requirements: `https://yandex.ru/dev/games/doc/ru/concepts/requirements`
- Yandex upload guide: `https://yandex.com/dev/games/doc/en/console/add-new-game`
- VK Play project creation: `https://documentation.vkplay.ru/hotbox/devdocs/pdfcopy/en/1100.pdf`
- VK Play browser page prep: `https://documentation.vkplay.ru/hotbox/devdocs/pdfcopy/en/1118.pdf`
- VK Play dashboard overview: `https://documentation.vkplay.ru/hotbox/devdocs/pdfcopy/en/1102.pdf`
- VK Play test iframe/checklist: `https://documentation.vkplay.ru/hotbox/devdocs/pdfcopy/en/1397.pdf`
- Newgrounds games/movies wiki: `https://www.newgrounds.com/wiki/help-information/content-submission/games-and-movies`
- Newgrounds public RIP URL: `https://www.newgrounds.com/portal/view/1033564`
- Gamemoor contact: `https://gamemoor.com/contact`
- Gamemoor terms: `https://gamemoor.com/terms`
- Gamemoor developer gate: `https://gamemoor.com/developer`
