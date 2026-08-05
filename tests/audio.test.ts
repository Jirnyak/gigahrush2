import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  playSoundAt,
  resetAudioSuspensionForTests,
  setAudioSuspendedForPage,
  setAudioSuspendedForPlatform,
} from '../src/systems/audio';

class FakeGainNode {
  gain = { value: 0 };
  connect(): FakeGainNode { return this; }
  disconnect(): void {}
}

class FakeAudioContext {
  static constructed = 0;
  static last: FakeAudioContext | null = null;
  currentTime = 0;
  destination = {};
  sampleRate = 44100;
  state: AudioContextState = 'running';

  constructor() {
    FakeAudioContext.constructed++;
    FakeAudioContext.last = this;
  }

  createGain(): FakeGainNode {
    return new FakeGainNode();
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
}

test('positional audio does not wake context while page audio is suspended', () => {
  const globalWithAudio = globalThis as typeof globalThis & { AudioContext?: typeof AudioContext };
  const originalAudioContext = globalWithAudio.AudioContext;
  let played = false;

  globalWithAudio.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  FakeAudioContext.constructed = 0;
  FakeAudioContext.last = null;
  resetAudioSuspensionForTests();
  setAudioSuspendedForPage(true);

  try {
    playSoundAt(() => { played = true; }, 0, 0);
    assert.equal(played, false);
    assert.equal(FakeAudioContext.constructed, 0);
  } finally {
    resetAudioSuspensionForTests();
    if (originalAudioContext) {
      globalWithAudio.AudioContext = originalAudioContext;
    } else {
      delete globalWithAudio.AudioContext;
    }
  }
});

test('audio resumes only after every suspend reason is cleared', async () => {
  const globalWithAudio = globalThis as typeof globalThis & { AudioContext?: typeof AudioContext };
  const originalAudioContext = globalWithAudio.AudioContext;

  globalWithAudio.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  FakeAudioContext.constructed = 0;
  FakeAudioContext.last = null;
  resetAudioSuspensionForTests();

  try {
    playSoundAt(() => {}, 0, 0);
    const ac = FakeAudioContext.last;
    assert.ok(ac);
    setAudioSuspendedForPage(true);
    await Promise.resolve();
    assert.equal(ac.state, 'suspended');

    setAudioSuspendedForPlatform(true);
    setAudioSuspendedForPage(false);
    await Promise.resolve();
    assert.equal(ac.state, 'suspended');

    setAudioSuspendedForPlatform(false);
    await Promise.resolve();
    assert.equal(ac.state, 'running');
  } finally {
    resetAudioSuspensionForTests();
    if (originalAudioContext) {
      globalWithAudio.AudioContext = originalAudioContext;
    } else {
      delete globalWithAudio.AudioContext;
    }
  }
});
