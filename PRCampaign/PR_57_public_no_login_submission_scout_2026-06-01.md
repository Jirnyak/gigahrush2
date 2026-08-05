# PR 57 - Public No-Login Submission Scout

Date: 2026-06-01.

Window: approximately 11:15-11:28 BST.

Scope: execution-scout for public no-login/no-captcha HTTP routes suitable for immediate safe publication/submission of a free browser game. This pass did not use credentials, did not bypass captchas or native browser challenges, did not create accounts, did not vote/like/comment for engagement, and did not send duplicate pitches to PR 55 Gmail recipients or earlier contacted targets.

## Confirmed Sent

| Surface | Attempted URL | Payload summary | Response / status | Counted as sent |
| --- | --- | --- | --- | --- |
| ImiGames contact/developer route | `https://imigames.io/contact-us/`; POST endpoint `https://imigames.io/wp-json/contact-form-7/v1/contact-forms/245/feedback` | Tenevik Games developer submission for `GIGAH\|RUSH`; direct build, itch mirror, MyIndie, Telegram; HTML5/WebGL/canvas, action/adventure/shooter/RPG/survival-horror/3D WebGL categories; controls, desktop-first compatibility, no required player login, horror content note. | `HTTP/2 200` JSON: `{"status":"mail_sent","message":"Thank you for your message. It has been sent."}` | Yes |
| BunaGames contact/developer route | `https://bunagames.com/developers/` -> `https://bunagames.com/contact-us/` | Tenevik Games submission matching BunaGames requested fields: name/company, title, game URL, short description, category, controls/instructions, desktop/mobile compatibility details and horror content note. | `HTTP/2 200`; returned page displayed `<div class="gz-contact-notice is-success">Thanks! Your message has been sent.</div>` | Yes |

## Checked / Blocked / Not Sent

| Surface | Final URL | Result | Counted as sent |
| --- | --- | --- | --- |
| CompleteGameHub | `https://completegamehub.com/for-developers/` | Search result says HTML5/WebGL submissions can be emailed or sent through contact form, but direct page fetch returned `Error. Page cannot be displayed. Please contact your service provider for more details.` No reachable HTTP form was available in this pass. | No |
| Scorenga | `https://scorenga.com/affiliate` and `https://scorenga.com/contact/` | Affiliate page says game submissions can use the contact form, but the contact form injects Google reCAPTCHA v3 (`grecaptcha.execute(...)`) and requires a token. Do not submit from shell. | No |
| BoyGames.io | `https://boygames.io/developer-portal-boygames-io/` | Developer page accepts HTML5/Unity/WebGL submissions by form/email, but the form placeholder is broken (`Error: Contact form not found.`) and rules require family-friendly/all-ages content with no excessive violence. GIGAH\|RUSH survival-horror/blood/body-horror fit is unsafe. | No |
| JollyZo | `https://jollyzo.com/developer/` | Developer page is explicitly safe/family-friendly and says games must be free from graphic violence or inappropriate themes. Not safe for current horror build. | No |
| StickmanHook-Game | `https://stickmanhook-game.com/developers/` | Search result/page positioning is for family-friendly kids/stickman/action games. Not a safe fit for current horror build. | No |

## Notes

- ImiGames was considered safe because the public contact page says `Developers / Want to submit your game? Let's talk!`, FAQ says they are always looking for new HTML5 games, and the visible Contact Form 7 form had no captcha field or login gate.
- BunaGames was considered safe because its developer page explicitly says to submit HTML5/WebGL/browser games through the contact page, lists horror/action/shooting categories in site navigation, and the contact page had no captcha or login gate.
- Both sent payloads disclosed developer/representative status and content warnings, used direct hosted links rather than ZIP upload, and avoided public implementation-geometry wording.
- Do not send quick follow-ups to ImiGames or BunaGames. Monitor `tenevik.games@gmail.com` for replies/bounces and check whether any public listing appears before contacting again.

## Next Safe Scout Order

1. Monitor replies/bounces from ImiGames and BunaGames.
2. Recheck whether CompleteGameHub becomes reachable later; use email or a visible contact form only if the site loads cleanly.
3. Keep Scorenga as owner/browser-only because of reCAPTCHA.
4. Avoid kid/family-only portals unless a non-horror/family-safe build and owner approval exist.
