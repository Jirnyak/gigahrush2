type PrefixedFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type PrefixedFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  msFullscreenElement?: Element | null;
  msExitFullscreen?: () => Promise<void> | void;
};

function fullscreenDocument(): PrefixedFullscreenDocument {
  return document as PrefixedFullscreenDocument;
}

function fullscreenElement(): Element | null {
  const doc = fullscreenDocument();
  return document.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement || null;
}

function canRequestFullscreen(target: HTMLElement): boolean {
  const prefixed = target as PrefixedFullscreenElement;
  return Boolean(target.requestFullscreen || prefixed.webkitRequestFullscreen || prefixed.webkitRequestFullScreen || prefixed.msRequestFullscreen);
}

function lockLandscape(): void {
  const orientation = screen.orientation as (ScreenOrientation & {
    lock?: (orientation: 'landscape') => Promise<void>;
  }) | undefined;
  if (!orientation?.lock) return;
  void orientation.lock('landscape').catch(() => {});
}

function isIosWebKit(): boolean {
  const ua = navigator.userAgent;
  const iosDevice = /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iosDevice && /applewebkit/i.test(ua);
}

function isIPhoneWebKit(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipod/i.test(ua) && /applewebkit/i.test(ua);
}

async function requestNativeFullscreen(target: HTMLElement): Promise<boolean> {
  try {
    if (target.requestFullscreen) {
      await target.requestFullscreen({ navigationUI: 'hide' });
      lockLandscape();
      return true;
    }
    const prefixed = target as PrefixedFullscreenElement;
    const request = prefixed.webkitRequestFullscreen || prefixed.webkitRequestFullScreen || prefixed.msRequestFullscreen;
    if (!request) return false;
    await request.call(prefixed);
    lockLandscape();
    return true;
  } catch {
    return false;
  }
}

export function isEmbeddedViewport(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function standaloneLaunchUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.set('standalone', '1');
  return url.href;
}

export function openStandalonePage(): void {
  const url = standaloneLaunchUrl();
  try {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (opened) return;
  } catch {
    // Fall through to same-tab navigation.
  }
  try {
    window.top?.location.assign(url);
    return;
  } catch {
    window.location.assign(url);
  }
}

export function canUseNativeFullscreen(target: HTMLElement = document.documentElement): boolean {
  if (isIosWebKit()) return false;
  return canRequestFullscreen(target);
}

export async function enterNativeFullscreen(target: HTMLElement = document.documentElement): Promise<boolean> {
  if (!canUseNativeFullscreen(target)) return false;
  return requestNativeFullscreen(target);
}

export async function exitNativeFullscreen(): Promise<void> {
  const doc = fullscreenDocument();
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
    } else if (doc.msFullscreenElement && doc.msExitFullscreen) {
      await doc.msExitFullscreen();
    }
  } catch {
    // Browser fullscreen exit can reject if the user already left fullscreen.
  }
}

export function isNativeFullscreenActive(): boolean {
  return fullscreenElement() !== null;
}

export async function toggleNativeFullscreen(target: HTMLElement = document.documentElement): Promise<boolean> {
  if (isNativeFullscreenActive()) {
    await exitNativeFullscreen();
    return true;
  }
  return enterNativeFullscreen(target);
}

export function canUseMobileFullscreen(): boolean {
  if (isEmbeddedViewport()) return false;
  if (isIPhoneWebKit()) return false;
  return canRequestFullscreen(document.documentElement);
}

export async function enterMobileFullscreen(target: HTMLElement = document.documentElement): Promise<boolean> {
  if (!canUseMobileFullscreen()) return false;
  if (canRequestFullscreen(target)) {
    const ok = await requestNativeFullscreen(target);
    if (ok) return true;
  }
  return false;
}

export async function exitMobileFullscreen(): Promise<void> {
  await exitNativeFullscreen();
}

export function isMobileFullscreenActive(): boolean {
  return isNativeFullscreenActive();
}
