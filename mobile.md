# Mobile Port Guide

> Центральный документ mobile/browser adaptation.
>
> Роль: описывает мобильный ввод, viewport, touch controls, fullscreen/direct-page behavior, interface constraints, build checks and platform-specific QA. Это параллельный документ: mobile must feed the same game systems without changing core simulation.

This document is a practical checklist for adding mobile support to an already
working browser game without breaking the desktop build.

Use it when a game already works on PC and needs the minimum mobile layer:
movement, camera rotation, menu buttons, correct viewport sizing, and reliable
deployment to itch.io / static hosts / Cloudflare.

## Goal

Keep the desktop implementation intact. Add a mobile input and layout layer that
feeds the same game state and movement functions as keyboard/mouse input.

Do not rewrite gameplay, rendering, maps, AI, saving, audio, or desktop input
unless mobile support exposes a real compatibility bug.

## First Check The Real Build

Before changing code, verify what is actually served:

```bash
npm run build
npm run preview
curl -L https://your-live-url.example/ | rg "mobile-controls|viewport-fit|touch"
```

If a phone shows the old UI, the problem may be deployment/cache, not code.
Always check the live URL after deploying. In this project, the local build was
fixed, but `workers.dev` still served an older bundle until Wrangler deployed
the new `dist/`.

## Preserve Desktop Input

Keep keyboard and mouse paths working exactly as before:

- Do not remove `keydown` / `keyup`.
- Do not remove pointer lock or mouse look.
- Do not make desktop depend on touch events.
- Add mobile input values to the existing input values, then clamp to `-1..1`.

Pattern:

```ts
let forward = keyboardForward;
let strafe = keyboardStrafe;
let rotate = keyboardRotate;

forward = clampInput(forward + touchInput.forward);
strafe = clampInput(strafe + touchInput.strafe);
rotate = clampInput(rotate + touchInput.rotate);

movePlayer(state, forward, strafe, rotate, dt);
```

This keeps the gameplay system unchanged.

## Prefer Pointer Events

Use `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, and
`lostpointercapture`. They work for touch, mouse, and stylus and avoid separate
touch/mouse code.

Use pointer capture so the control does not get stuck when the finger leaves the
button:

```ts
function capturePointer(target: EventTarget | null, pointerId: number): void {
	if (target instanceof HTMLElement) {
		target.setPointerCapture(pointerId);
	}
}

function releasePointer(target: EventTarget | null, pointerId: number): void {
	if (target instanceof HTMLElement && target.hasPointerCapture(pointerId)) {
		target.releasePointerCapture(pointerId);
	}
}
```

Always reset mobile input on:

- `pointerup`
- `pointercancel`
- `lostpointercapture`

## Touch Controls

For a first-person canvas game, two simple virtual pads are usually enough:

- left pad: forward/back and strafe
- right pad: camera rotation

Keep controls as a plain DOM overlay above the canvas:

```ts
const controls = document.createElement('div');
controls.className = 'mobile-controls';
controls.style.pointerEvents = 'none';

const movePad = document.createElement('button');
movePad.className = 'mobile-pad mobile-pad--move';
movePad.type = 'button';
movePad.setAttribute('aria-label', 'Move');
movePad.style.pointerEvents = 'auto';

const turnPad = document.createElement('button');
turnPad.className = 'mobile-pad mobile-pad--turn';
turnPad.type = 'button';
turnPad.setAttribute('aria-label', 'Look');
turnPad.style.pointerEvents = 'auto';

controls.append(movePad, turnPad);
document.body.appendChild(controls);
```

The wrapper should be `pointer-events: none`; the actual controls should be
`pointer-events: auto`. This prevents the overlay from blocking the game except
where controls are meant to be touched.

Use `button` elements, not plain `div`s, unless there is a strong reason. Add
short `aria-label`s.

## Do Not Rely Only On CSS Media Queries

`@media (hover: none)` and `(pointer: coarse)` are useful, but not sufficient on
real phones, embedded browsers, and game portals.

Prefer explicit runtime detection:

```ts
function shouldUseTouchControls(): boolean {
	const ua = navigator.userAgent;
	const mobileUa = /android|iphone|ipad|ipod|mobile/i.test(ua);
	const touchCapable = navigator.maxTouchPoints > 0 || 'ontouchstart' in globalThis;
	const compactViewport = Math.min(window.innerWidth, window.innerHeight) < 900;
	return mobileUa || (touchCapable && compactViewport);
}
```

Update this on resize and `visualViewport.resize`.

Desktop machines with a touch screen should not automatically lose the desktop
experience. The compact viewport check helps avoid showing pads on large
desktop displays.

## Viewport And Page CSS

For mobile browser games, set the viewport and disable page gestures:

```html
<meta
	name="viewport"
	content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no"
/>
```

Global CSS:

```css
html,
body,
#app {
	width: 100%;
	height: 100%;
	margin: 0;
	padding: 0;
	overflow: hidden;
	overscroll-behavior: none;
	touch-action: none;
	user-select: none;
	-webkit-user-select: none;
	background: #000;
}
```

Use `100dvh` for the app root when possible:

```ts
const appRoot = document.getElementById('app');
if (appRoot) {
	appRoot.style.width = '100vw';
	appRoot.style.height = '100dvh';
	appRoot.style.overflow = 'hidden';
	appRoot.style.background = '#000';
}
```

This avoids incorrect sizing around mobile browser address bars.

## Canvas Sizing

Do not rely only on `window.innerWidth` / `innerHeight` on mobile. Prefer
`visualViewport` when available:

```ts
const viewport = globalThis.visualViewport;
const width = viewport?.width ?? window.innerWidth;
const height = viewport?.height ?? window.innerHeight;
canvas.width = Math.max(1, Math.round(width));
canvas.height = Math.max(1, Math.round(height));
```

Listen to:

- `window.resize`
- `visualViewport.resize`
- `visualViewport.scroll`

This handles address bar collapse, rotation, and embedded browsers.

## Safe Areas

Position mobile pads with safe-area insets:

```css
.mobile-pad {
	bottom: max(1rem, env(safe-area-inset-bottom));
}

.mobile-pad--move {
	left: max(1rem, env(safe-area-inset-left));
}

.mobile-pad--turn {
	right: max(1rem, env(safe-area-inset-right));
}
```

If the game has bottom subtitles or HUD text, move it above the pads on mobile:

```css
.message-bar--mobile {
	bottom: calc(max(1rem, env(safe-area-inset-bottom)) + 7.25rem);
}
```

## Menus

Canvas menus should use pointer events, not click-only logic:

```ts
canvas.addEventListener('pointerup', onMenuClick);
canvas.addEventListener('pointermove', onMenuMove);
canvas.addEventListener('pointerleave', onMenuLeave);
```

Keep the same hit-test math, but make the displayed canvas responsive:

```css
width: min(640px, 100vw, calc(100dvh * 0.91));
height: auto;
touch-action: manipulation;
```

Fixed desktop menu sizes often overflow on phones.

## Audio Unlock

Mobile browsers block audio until a user gesture. Call the existing audio resume
function from first mobile interactions:

- menu pointer up
- movement pad pointer down
- turn pad pointer down
- canvas click / pointer interaction

Do not start new audio systems for mobile.

## Fullscreen And Embedded Hosts

The mobile `FULL` button is only a native fullscreen request on compatible
non-iOS top-level pages. Browser fullscreen is disabled for embedded hosts and
iPhone/WebKit. Embedded portals such as itch.io should show a direct-page launch
button instead, then the standalone page can use the full viewport.

iOS Safari and iOS WebViews do not provide the same reliable forced fullscreen
path as Android/desktop Chromium. Treat Home Screen standalone launch, viewport
resizing, and `viewport-fit=cover` safe-area layout as the supported iOS path.
Do not force a fullscreen request on iPhone/WebKit; it can fail or reload the
web view depending on the host.

## Browser Compatibility

Do not assume `OffscreenCanvas` exists. Some iOS/Safari/WebView environments may
not support it, and game portals can use embedded browsers.

Use a fallback:

```ts
function createRenderCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
	if (typeof OffscreenCanvas === 'function') {
		return new OffscreenCanvas(width, height);
	}

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}
```

Use the same fallback for temporary image canvases used by effects.

## Itch.io Package

For this project, build the itch package through the checked-in script:

```bash
npm run itch:build
unzip -l itch/gigahrush-itch.zip | rg "index.html|manifest.webmanifest|sw.js|icon-192.png|icon-512.png|apple-touch-icon.png"
```

`npm run itch:build` runs the production build, verifies the PWA shell files,
rewrites `dist/`, then rewrites `itch/` with `index.html`,
`gigahrush-itch.zip` and upload notes. For a release gate with read-only checks
first, run `npm run check:release`; it also runs `npm run itch:verify`.

Expected shape:

```text
index.html
manifest.webmanifest
sw.js
icon-192.png
icon-512.png
apple-touch-icon.png
```

If `index.html` is nested inside `dist/` in the zip, itch.io may not open the
game correctly.

Required itch.io HTML5 settings:

- Kind of game: HTML
- Upload: `itch/gigahrush-itch.zip`
- File setting: This file will be played in the browser
- Embed option for mobile: Mobile Friendly enabled
- Launch mode: Click to launch in fullscreen
- Scrollbars: disabled

The itch game still runs inside an iframe. The in-game `FULL` button must not
call native browser fullscreen from that iframe. On embedded mobile hosts it is
a direct-page launcher (`↗`) that opens the same build with `?standalone=1`.
The itch fullscreen setting gives the iframe a usable fill-window viewport; the
direct-page launcher is the escape path for fragile mobile WebViews.

## Cloudflare Workers / Static Host

If the live URL is a Worker, pushing Git may not deploy it. Verify the actual
served HTML.

Useful checks:

```bash
curl -L https://your-worker.workers.dev/?check=1 | rg "manifest.webmanifest|viewport-fit|apple-touch-icon"
curl -I -L https://your-worker.workers.dev/?check=1
curl -fsS https://your-worker.workers.dev/manifest.webmanifest | rg "start_url|display|icons"
curl -I -L https://your-worker.workers.dev/sw.js
curl -I -L https://your-worker.workers.dev/icon-192.png
curl -I -L https://your-worker.workers.dev/icon-512.png
curl -I -L https://your-worker.workers.dev/apple-touch-icon.png
```

Deploy static assets with Wrangler when appropriate. For this repository,
prefer the configured script so `wrangler.jsonc` stays the source of truth:

```bash
npm run cf:deploy
```

`npm run cf:deploy` rewrites `dist/` and requires Cloudflare auth/config for
Wrangler. Use `npm run build` alone only for static hosts that upload `dist/`
without the Worker API.

After deploy, re-check the live URL. Cloudflare may report cache hits even after
deploy; the content is what matters.

## Fullscreen And PWA Launch

Keep the launch paths separate:

- Direct HTTPS/static/Cloudflare page: manifest and icons are served from the
  root, `sw.js` registers on secure origins, and the mobile `FULL` control
  requests native fullscreen only when the browser exposes a compatible
  Fullscreen API.
- Embedded host or itch iframe: native fullscreen is not requested. The control
  is a direct-page launcher (`↗`) that opens `?standalone=1` in a top-level tab
  or page.
- iPhone/iPad WebKit browser tab: forced fullscreen is disabled because it can
  reload or destabilize the web view. The `FULL` control should be hidden on a
  direct iOS page and should only act as the direct-page launcher while embedded.
- iOS Home Screen launch: use Add to Home Screen. The Apple web-app meta tags
  and manifest provide standalone launch; do not add a JavaScript fullscreen
  fallback for iOS.
- Desktop: no mobile controls on a normal desktop viewport. Canvas click still
  owns pointer lock and keyboard/mouse startup.

## PWA Smoke Checks

Run local artifact checks after every PWA/deploy edit:

```bash
npm run check:browser
npm run itch:build
npm run itch:verify
unzip -l itch/gigahrush-itch.zip | rg "index.html|manifest.webmanifest|sw.js|icon-192.png|icon-512.png|apple-touch-icon.png"
```

Then run the live-host checks from the Cloudflare/static section against the
actual deployed URL. In browser DevTools Application panel, verify:

- Manifest loads without icon errors.
- `start_url` is `./?standalone=1`, scope is `./`, display is fullscreen or
  standalone, and orientation is landscape.
- Service worker is registered from `sw.js` on HTTPS, with same-origin scope.
- The service worker does not intercept `/api/net/*`; Net Sphere endpoints must
  stay network-only.
- Offline reload of the direct static page shows the cached shell after one
  successful online visit.

Manual device checks:

- Android Chrome direct page: mobile pads appear, `FULL` enters/exits native
  fullscreen without reloading, and the game keeps input after exit.
- iPhone Safari direct page: no native fullscreen control is shown, Add to Home
  Screen opens standalone, and there is no reload loop.
- itch/mobile iframe: launch through itch fullscreen, press `↗`, confirm a
  direct page opens with `?standalone=1`, and input is not trapped in the iframe.
- Desktop browser: mobile controls are absent, click-to-start still requests
  pointer lock, and keyboard/mouse movement still works.

## Testing Checklist

Run local checks:

```bash
npm run check:readonly
npm run check:browser
```

`check:readonly` does not write repo artifacts. `check:browser` rewrites
`dist/`, starts Vite preview, and requires Chrome or `CHROME_BIN`. For manual
phone testing after that, keep serving the built game with `npm run preview`.

Verify at least:

- desktop viewport: game starts, canvas is not blank, mobile controls are absent
- mobile viewport: game starts, canvas is not blank, both mobile pads are present
- mobile fallback without `OffscreenCanvas`: game still starts
- title/menu fits on a narrow screen
- message/HUD text is not hidden by pads
- existing keyboard/mouse still work on desktop

Headless checks are useful, but they are not enough. Test on a real phone before
declaring mobile done.

## Common Failure Signs

Phone shows the game but no controls:

- live site is still an old deployment
- controls depend only on `@media (hover: none)` / `(pointer: coarse)`
- controls exist but are behind another canvas or hidden by CSS
- overlay has `pointer-events: none` on the buttons too

Phone opens black screen or crashes before UI:

- unsupported browser API such as `OffscreenCanvas`
- audio context started outside a gesture and threw unexpectedly
- canvas size became `0x0`
- JavaScript bundle on live host is stale

Desktop regressed:

- touch code replaced keyboard/mouse instead of adding to it
- global `touch-action` or overlay blocks pointer lock
- controls are shown on desktop because the detection is too broad

## Final Rule

Mobile support is a thin adapter layer:

- same game state
- same movement function
- same render loop
- same content
- extra input source
- responsive canvas/page shell
- verified deployment

If the mobile port requires rewriting core gameplay, stop and re-check the
architecture. The safest mobile port is the one that changes the least.
