import test from "node:test";
import assert from "node:assert/strict";

import {
  canUseMobileFullscreen,
  canUseNativeFullscreen,
  enterNativeFullscreen,
  standaloneLaunchUrl,
} from "../src/fullscreen";

interface FullscreenEnvOptions {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  embedded?: boolean;
  requestFullscreen?: boolean | "webkit" | "ms" | "error";
  href?: string;
  lockOrientation?: boolean | "error";
}

function installFullscreenEnv(options: FullscreenEnvOptions): () => void {
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousScreen = Object.getOwnPropertyDescriptor(globalThis, "screen");

  let documentElement: any = {};
  if (
    options.requestFullscreen === true ||
    options.requestFullscreen === undefined
  ) {
    documentElement.requestFullscreen = async () => {};
  } else if (options.requestFullscreen === "webkit") {
    documentElement.webkitRequestFullscreen = async () => {};
  } else if (options.requestFullscreen === "ms") {
    documentElement.msRequestFullscreen = async () => {};
  } else if (options.requestFullscreen === "error") {
    documentElement.requestFullscreen = async () => {
      throw new Error("denied");
    };
  }

  const top = {};
  const self = options.embedded ? {} : top;

  let orientation: any = {};
  if (
    options.lockOrientation === true ||
    options.lockOrientation === undefined
  ) {
    orientation.lock = async () => {};
  } else if (options.lockOrientation === "error") {
    orientation.lock = async () => {
      throw new Error("lock failed");
    };
  }

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement, fullscreenElement: null },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: options.userAgent,
      platform: options.platform ?? "",
      maxTouchPoints: options.maxTouchPoints ?? 0,
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      self,
      top,
      location: { href: options.href || "https://example.com/" },
    },
  });
  Object.defineProperty(globalThis, "screen", {
    configurable: true,
    value: {
      orientation: options.lockOrientation === false ? undefined : orientation,
    },
  });

  return () => {
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (previousNavigator)
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousScreen)
      Object.defineProperty(globalThis, "screen", previousScreen);
    else Reflect.deleteProperty(globalThis, "screen");
  };
}

test("mobile fullscreen is hidden for direct iPhone WebKit pages", () => {
  const restore = installFullscreenEnv({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    platform: "iPhone",
  });
  try {
    assert.equal(canUseNativeFullscreen(), false);
    assert.equal(canUseMobileFullscreen(), false);
  } finally {
    restore();
  }
});

test("mobile fullscreen remains available for compatible direct pages and hidden in embeds", () => {
  let restore = installFullscreenEnv({
    userAgent:
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36",
    platform: "Linux armv8l",
  });
  try {
    assert.equal(canUseNativeFullscreen(), true);
    assert.equal(canUseMobileFullscreen(), true);
  } finally {
    restore();
  }

  restore = installFullscreenEnv({
    userAgent:
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36",
    platform: "Linux armv8l",
    embedded: true,
  });
  try {
    assert.equal(canUseNativeFullscreen(), true);
    assert.equal(canUseMobileFullscreen(), false);
  } finally {
    restore();
  }
});

test("standaloneLaunchUrl appends standalone query parameter", () => {
  let restore = installFullscreenEnv({
    userAgent: "Mozilla/5.0",
    href: "https://example.com/game",
  });
  try {
    assert.equal(
      standaloneLaunchUrl(),
      "https://example.com/game?standalone=1",
    );
  } finally {
    restore();
  }

  restore = installFullscreenEnv({
    userAgent: "Mozilla/5.0",
    href: "https://example.com/game?foo=bar",
  });
  try {
    assert.equal(
      standaloneLaunchUrl(),
      "https://example.com/game?foo=bar&standalone=1",
    );
  } finally {
    restore();
  }

  restore = installFullscreenEnv({
    userAgent: "Mozilla/5.0",
    href: "https://example.com/game?standalone=0",
  });
  try {
    assert.equal(
      standaloneLaunchUrl(),
      "https://example.com/game?standalone=1",
    );
  } finally {
    restore();
  }
});

test("enterNativeFullscreen succeeds with standard requestFullscreen", async () => {
  const restore = installFullscreenEnv({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    requestFullscreen: true,
  });
  try {
    assert.equal(await enterNativeFullscreen(), true);
  } finally {
    restore();
  }
});

test("enterNativeFullscreen succeeds with webkit prefix", async () => {
  const restore = installFullscreenEnv({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    requestFullscreen: "webkit",
  });
  try {
    assert.equal(await enterNativeFullscreen(), true);
  } finally {
    restore();
  }
});

test("enterNativeFullscreen succeeds with ms prefix", async () => {
  const restore = installFullscreenEnv({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    requestFullscreen: "ms",
  });
  try {
    assert.equal(await enterNativeFullscreen(), true);
  } finally {
    restore();
  }
});

test("enterNativeFullscreen returns false if fullscreen is denied/throws", async () => {
  const restore = installFullscreenEnv({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    requestFullscreen: "error",
  });
  try {
    assert.equal(await enterNativeFullscreen(), false);
  } finally {
    restore();
  }
});

test("enterNativeFullscreen returns false if native fullscreen cannot be used", async () => {
  const restore = installFullscreenEnv({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    platform: "iPhone",
    requestFullscreen: true,
  });
  try {
    assert.equal(await enterNativeFullscreen(), false);
  } finally {
    restore();
  }
});

test("enterNativeFullscreen succeeds even if orientation lock is missing", async () => {
  const restore = installFullscreenEnv({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    requestFullscreen: true,
    lockOrientation: false,
  });
  try {
    assert.equal(await enterNativeFullscreen(), true);
  } finally {
    restore();
  }
});

test("enterNativeFullscreen succeeds even if orientation lock fails", async () => {
  const restore = installFullscreenEnv({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    requestFullscreen: true,
    lockOrientation: "error",
  });
  try {
    assert.equal(await enterNativeFullscreen(), true);
  } finally {
    restore();
  }
});
