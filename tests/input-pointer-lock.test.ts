import { afterEach, test } from 'node:test';
import * as assert from 'node:assert/strict';

import { bindInput, createInput } from '../src/input';
import {
  beginControlCapture,
  controlBindings,
  getControlCaptureAction,
  resetAllControlBindings,
} from '../src/systems/controls';

afterEach(() => {
  resetAllControlBindings();
});

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event = new Event(type)): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener.call(this, event);
      else listener.handleEvent(event);
    }
  }
}

class FakeDocument extends FakeEventTarget {
  hidden = false;
  pointerLockElement: Element | null = null;
}

class FakeWindow extends FakeEventTarget {}

class FakeCanvas extends FakeEventTarget {
  requestCount = 0;

  constructor(private readonly doc: FakeDocument) {
    super();
  }

  requestPointerLock(): void {
    this.requestCount++;
    this.doc.pointerLockElement = this as unknown as Element;
  }
}

function installInputDom(): { canvas: FakeCanvas; document: FakeDocument; restore: () => void } {
  const doc = new FakeDocument();
  const win = new FakeWindow();
  const canvas = new FakeCanvas(doc);
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  return {
    canvas,
    document: doc,
    restore: () => {
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else Reflect.deleteProperty(globalThis, 'document');
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    },
  };
}

function mouseEvent(type: string, button = 0, movementX = 0, movementY = 0): MouseEvent {
  const event = new Event(type, { cancelable: true }) as MouseEvent;
  Object.defineProperty(event, 'button', { value: button });
  Object.defineProperty(event, 'movementX', { value: movementX });
  Object.defineProperty(event, 'movementY', { value: movementY });
  return event;
}

function keyboardEvent(type: string, code: string, key: string): KeyboardEvent {
  const event = new Event(type, { cancelable: true }) as KeyboardEvent;
  Object.defineProperty(event, 'code', { value: code });
  Object.defineProperty(event, 'key', { value: key });
  return event;
}

function wheelEvent(deltaY: number): WheelEvent {
  const event = new Event('wheel', { cancelable: true }) as WheelEvent;
  Object.defineProperty(event, 'deltaY', { value: deltaY });
  return event;
}

test('canvas click requests pointer lock only when gameplay capture is allowed', () => {
  const env = installInputDom();
  try {
    let menuOpen = true;
    const blockedUnbind = bindInput(createInput(), env.canvas as unknown as HTMLCanvasElement, {
      shouldRequestPointerLock: () => !menuOpen,
    });
    env.canvas.dispatch('click');
    assert.equal(env.canvas.requestCount, 0);
    menuOpen = false;
    env.canvas.dispatch('click');
    assert.equal(env.canvas.requestCount, 1);
    blockedUnbind();

    const allowedUnbind = bindInput(createInput(), env.canvas as unknown as HTMLCanvasElement, {
      shouldRequestPointerLock: () => true,
    });
    env.canvas.dispatch('click');
    assert.equal(env.canvas.requestCount, 1);
    allowedUnbind();
  } finally {
    env.restore();
  }
});

test('synchronous requestPointerLock exceptions are caught silently', () => {
  const env = installInputDom();
  try {
    env.canvas.requestPointerLock = () => {
      throw new Error('sync error');
    };
    const unbind = bindInput(createInput(), env.canvas as unknown as HTMLCanvasElement, {
      shouldRequestPointerLock: () => true,
    });

    assert.doesNotThrow(() => {
      env.canvas.dispatch('click');
    });

    unbind();
  } finally {
    env.restore();
  }
});

test('asynchronous requestPointerLock rejections are caught silently', async () => {
  const env = installInputDom();
  try {
    env.canvas.requestPointerLock = () => Promise.reject(new Error('async error')) as any;

    const unbind = bindInput(createInput(), env.canvas as unknown as HTMLCanvasElement, {
      shouldRequestPointerLock: () => true,
    });

    assert.doesNotThrow(() => {
      env.canvas.dispatch('click');
    });

    // Wait a tick to ensure the unhandled rejection hook would fire if uncaught
    await new Promise((resolve) => setTimeout(resolve, 0));

    unbind();
  } finally {
    env.restore();
  }
});

test('canvas click does not request pointer lock after a menu click closes the menu', () => {
  const env = installInputDom();
  try {
    let menuOpen = true;
    const unbind = bindInput(createInput(), env.canvas as unknown as HTMLCanvasElement, {
      shouldRequestPointerLock: () => !menuOpen,
    });

    env.canvas.dispatch('mousedown', mouseEvent('mousedown'));
    menuOpen = false;
    env.canvas.dispatch('click');
    assert.equal(env.canvas.requestCount, 0);

    env.canvas.dispatch('mousedown', mouseEvent('mousedown'));
    env.canvas.dispatch('click');
    assert.equal(env.canvas.requestCount, 1);
    unbind();
  } finally {
    env.restore();
  }
});

test('menu mouse buttons latch accept and close without requesting pointer lock', () => {
  const env = installInputDom();
  try {
    let menuOpen = true;
    const input = createInput();
    const unbind = bindInput(input, env.canvas as unknown as HTMLCanvasElement, {
      shouldRequestPointerLock: () => true,
      shouldHandleMenuPointer: () => menuOpen,
    });

    const accept = mouseEvent('mousedown', 0);
    env.document.dispatch('mousedown', accept);
    assert.equal(input.menuAccept, true);
    assert.equal(input.menuClose, false);
    assert.equal(accept.defaultPrevented, true);

    env.canvas.dispatch('click');
    assert.equal(env.canvas.requestCount, 0);

    input.menuAccept = false;
    const close = mouseEvent('mousedown', 2);
    env.document.dispatch('mousedown', close);
    assert.equal(input.menuAccept, false);
    assert.equal(input.menuClose, true);
    assert.equal(close.defaultPrevented, true);

    menuOpen = false;
    env.canvas.dispatch('click');
    assert.equal(env.canvas.requestCount, 0);
    env.canvas.dispatch('mousedown', mouseEvent('mousedown', 0));
    env.canvas.dispatch('click');
    assert.equal(env.canvas.requestCount, 1);
    unbind();
  } finally {
    env.restore();
  }
});

test('mouse buttons can be captured as key binding codes', () => {
  const env = installInputDom();
  try {
    const input = createInput();
    const unbind = bindInput(input, env.canvas as unknown as HTMLCanvasElement, {
      shouldRequestPointerLock: () => true,
      shouldHandleMenuPointer: () => true,
    });

    beginControlCapture('quests');
    const left = mouseEvent('mousedown', 0);
    env.document.dispatch('mousedown', left);
    assert.deepEqual([...controlBindings('quests')], ['KeyQ', 'MouseLeft']);
    assert.equal(getControlCaptureAction(), null);
    assert.equal(input.menuAccept, false);
    assert.equal(left.defaultPrevented, true);
    env.canvas.dispatch('click');
    assert.equal(env.canvas.requestCount, 0);

    beginControlCapture('quests');
    const right = mouseEvent('mousedown', 2);
    env.document.dispatch('mousedown', right);
    assert.deepEqual([...controlBindings('quests')], ['KeyQ', 'MouseLeft', 'MouseRight']);
    assert.equal(getControlCaptureAction(), null);
    assert.equal(input.menuClose, false);
    assert.equal(right.defaultPrevented, true);
    unbind();
  } finally {
    env.restore();
  }
});

test('menu wheel can be latched independently from menu pointer buttons', () => {
  const env = installInputDom();
  try {
    let menuWheelOpen = true;
    const input = createInput();
    const unbind = bindInput(input, env.canvas as unknown as HTMLCanvasElement, {
      shouldHandleMenuPointer: () => true,
      shouldHandleMenuWheel: () => menuWheelOpen,
    });

    const down = wheelEvent(120);
    env.document.dispatch('wheel', down);
    assert.equal(input.menuWheel, 1);
    assert.equal(down.defaultPrevented, true);

    const up = wheelEvent(-120);
    env.document.dispatch('wheel', up);
    assert.equal(input.menuWheel, 0);
    assert.equal(up.defaultPrevented, true);

    menuWheelOpen = false;
    const ignored = wheelEvent(120);
    env.document.dispatch('wheel', ignored);
    assert.equal(input.menuWheel, 0);
    assert.equal(ignored.defaultPrevented, false);
    unbind();
  } finally {
    env.restore();
  }
});

test('right mouse button drives its bound equipped tool input under pointer lock', () => {
  const env = installInputDom();
  try {
    const input = createInput();
    const unbind = bindInput(input, env.canvas as unknown as HTMLCanvasElement, {
      shouldRequestPointerLock: () => true,
    });

    env.canvas.dispatch('mousedown', mouseEvent('mousedown', 2));
    assert.equal(input.use, false);

    env.document.pointerLockElement = env.canvas as unknown as Element;
    const down = mouseEvent('mousedown', 2);
    env.canvas.dispatch('mousedown', down);
    assert.equal(input.use, true);
    assert.equal(down.defaultPrevented, true);

    const context = mouseEvent('contextmenu', 2);
    env.canvas.dispatch('contextmenu', context);
    assert.equal(context.defaultPrevented, true);

    const up = mouseEvent('mouseup', 2);
    env.document.dispatch('mouseup', up);
    assert.equal(input.use, false);
    assert.equal(up.defaultPrevented, true);
    unbind();
  } finally {
    env.restore();
  }
});

test('pointer lock release clears pointer state without erasing keyboard movement', () => {
  const env = installInputDom();
  try {
    const input = createInput();
    const unbind = bindInput(input, env.canvas as unknown as HTMLCanvasElement, {
      shouldRequestPointerLock: () => true,
    });

    env.document.dispatch('keydown', keyboardEvent('keydown', 'KeyW', 'w'));
    assert.equal(input.fwd, true);

    env.document.pointerLockElement = env.canvas as unknown as Element;
    env.document.dispatch('pointerlockchange');
    env.canvas.dispatch('mousedown', mouseEvent('mousedown'));
    env.document.dispatch('mousemove', mouseEvent('mousemove', 0, 12, -8));
    assert.equal(input.attack, true);
    assert.equal(input.mouse.dx, 12);

    env.document.pointerLockElement = null;
    env.document.dispatch('pointerlockchange');
    assert.equal(input.fwd, true);
    assert.equal(input.attack, false);
    assert.equal(input.mouse.dx, 0);

    env.document.dispatch('keyup', keyboardEvent('keyup', 'KeyW', 'w'));
    assert.equal(input.fwd, false);
    unbind();
  } finally {
    env.restore();
  }
});

test('mouse look is ignored while gameplay pointer input is blocked', () => {
  const env = installInputDom();
  try {
    let gameplayPointerActive = false;
    const input = createInput();
    const unbind = bindInput(input, env.canvas as unknown as HTMLCanvasElement, {
      shouldRequestPointerLock: () => true,
      shouldHandleGameplayPointer: () => gameplayPointerActive,
    });

    env.document.pointerLockElement = env.canvas as unknown as Element;
    input.mouse.dx = 12;
    input.mouse.dy = -8;
    env.document.dispatch('mousemove', mouseEvent('mousemove', 0, 30, -20));
    assert.equal(input.mouse.locked, true);
    assert.equal(input.mouse.dx, 0);
    assert.equal(input.mouse.dy, 0);

    gameplayPointerActive = true;
    env.document.dispatch('mousemove', mouseEvent('mousemove', 0, 4, 5));
    assert.equal(input.mouse.dx, 4);
    assert.equal(input.mouse.dy, 5);
    unbind();
  } finally {
    env.restore();
  }
});

test('mouse buttons are ignored while gameplay pointer input is blocked', () => {
  const env = installInputDom();
  try {
    let gameplayPointerActive = false;
    const input = createInput();
    const unbind = bindInput(input, env.canvas as unknown as HTMLCanvasElement, {
      shouldRequestPointerLock: () => true,
      shouldHandleGameplayPointer: () => gameplayPointerActive,
    });

    env.document.pointerLockElement = env.canvas as unknown as Element;
    env.canvas.dispatch('mousedown', mouseEvent('mousedown'));
    assert.equal(input.attack, false);
    const blockedTool = mouseEvent('mousedown', 2);
    env.canvas.dispatch('mousedown', blockedTool);
    assert.equal(input.use, false);
    assert.equal(blockedTool.defaultPrevented, true);

    gameplayPointerActive = true;
    env.canvas.dispatch('mousedown', mouseEvent('mousedown'));
    assert.equal(input.attack, true);
    input.attack = false;
    env.canvas.dispatch('mousedown', mouseEvent('mousedown', 2));
    assert.equal(input.use, true);
    unbind();
  } finally {
    env.restore();
  }
});

test('pointer lock synchronous throw is handled gracefully', () => {
  const env = installInputDom();
  try {
    env.canvas.requestPointerLock = () => {
      throw new Error('Pointer lock blocked');
    };
    const unbind = bindInput(createInput(), env.canvas as unknown as HTMLCanvasElement, {
      shouldRequestPointerLock: () => true,
    });
    // This click would trigger requestPointerLock
    assert.doesNotThrow(() => {
      env.canvas.dispatch('mousedown', mouseEvent('mousedown', 0));
      env.canvas.dispatch('click');
    });
    unbind();
  } finally {
    env.restore();
  }
});
