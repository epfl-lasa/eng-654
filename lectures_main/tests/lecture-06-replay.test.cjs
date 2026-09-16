'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
let createJointPathPlayback;
before(async () => {
  ({ createJointPathPlayback } = await import(pathToFileURL(path.join(__dirname, '../js/viz/jointPathPlayback.js')).href));
});

function player() {
  const frames = new Map(), samples = [], updates = [];
  let id = 0, visible = true, available = true;
  const playback = createJointPathPlayback({
    onFrame: progress => samples.push(Math.round(progress * 100)),
    onState: state => updates.push(state),
    canPlay: () => available,
    isVisible: () => visible,
    duration: () => 1000,
    requestFrame: callback => { frames.set(++id, callback); return id; },
    cancelFrame: key => frames.delete(key)
  });
  return {
    playback, samples, updates, frames,
    hide: () => { visible = false; }, show: () => { visible = true; },
    clearPath: () => { available = false; playback.reset(); },
    tick: timestamp => {
      const callbacks = [...frames.values()]; frames.clear();
      callbacks.forEach(callback => callback(timestamp));
    }
  };
}

test('a completed path can replay repeatedly, with its first sample shown immediately', () => {
  const p = player();
  for (let cycle = 0; cycle < 4; cycle += 1) {
    p.playback.play();
    assert.equal(p.samples.at(-1), 0, 'Replay must reset the displayed configuration before the first RAF.');
    assert.equal(p.frames.size, 1);
    p.tick(cycle * 3000); p.tick(cycle * 3000 + 500); p.tick(cycle * 3000 + 1000);
    assert.equal(p.samples.at(-1), 100);
    assert.deepEqual(p.updates.at(-1), { progress: 1, playing: false });
    assert.equal(p.frames.size, 0);
  }
});

test('pause and resume keep the current sample; an old callback cannot move the new run', () => {
  const p = player(); p.playback.play(); p.tick(0); p.tick(400);
  const oldCallback = [...p.frames.values()][0];
  p.playback.pause(); assert.equal(p.samples.at(-1), 40);
  p.playback.play(); assert.equal(p.samples.at(-1), 40);
  oldCallback(99999); assert.equal(p.samples.at(-1), 40);
  p.tick(10000); p.tick(10300); assert.equal(p.samples.at(-1), 70);
  p.tick(10600); assert.equal(p.samples.at(-1), 100);
});

test('Reset to start stops a midpoint animation and retains the built path for another play', () => {
  const p = player(); p.playback.play(); p.tick(0); p.tick(500);
  const oldCallback = [...p.frames.values()][0];
  p.playback.reset();
  assert.equal(p.samples.at(-1), 0);
  assert.deepEqual(p.updates.at(-1), { progress: 0, playing: false });
  assert.equal(p.frames.size, 0);
  oldCallback(1000); assert.equal(p.samples.at(-1), 0);
  p.playback.play(); p.tick(2000); p.tick(3000);
  assert.equal(p.samples.at(-1), 100);
});

test('leaving the slide pauses playback and returning allows resume or reset', () => {
  const p = player(); p.playback.play(); p.tick(0); p.tick(300);
  p.hide(); p.tick(5000);
  assert.equal(p.samples.at(-1), 30);
  assert.equal(p.updates.at(-1).playing, false);
  p.playback.play(); assert.equal(p.frames.size, 0);
  p.show(); p.playback.play(); p.tick(6000); p.tick(6300);
  assert.equal(p.samples.at(-1), 60);
  p.playback.reset(); assert.equal(p.samples.at(-1), 0);
});

test('delayed first frames and earlier timestamps never skip the starting sample or yield negative indices', () => {
  const p = player(); p.playback.play(); p.tick(50000);
  assert.equal(p.samples.at(-1), 0);
  p.tick(49999); assert.equal(p.samples.at(-1), 0);
  p.tick(51000); assert.equal(p.samples.at(-1), 100);
});

test('changing the IK target prevents callbacks from the old path from running', () => {
  const p = player(); p.playback.play(); p.tick(0); p.tick(400);
  const oldCallback = [...p.frames.values()][0];
  p.clearPath(); const rendered = p.samples.length;
  oldCallback(800); p.playback.play();
  assert.equal(p.samples.length, rendered);
  assert.equal(p.frames.size, 0);
  assert.deepEqual(p.updates.at(-1), { progress: 0, playing: false });
});
