const { performance } = require('perf_hooks');

const N_ENTITIES = 2000;
const N_EYES = 8;

const entities = [];
for (let i = 0; i < N_ENTITIES; i++) {
  entities.push({ id: i, alive: true, hp: 10 });
}

// Eyes are at random positions
const eyeIds = [];
for (let i = 0; i < N_EYES; i++) {
  eyeIds.push(Math.floor(Math.random() * N_ENTITIES));
}

function baseline() {
  let sealedEyes = 0;
  for (const id of eyeIds) {
    const eye = entities.find(e => e.id === id);
    if (eye?.alive) {
      sealedEyes++;
    }
  }
  return sealedEyes;
}

function optimizedFilterBackwards() {
  let sealedEyes = 0;
  const eyeIdSet = new Set(eyeIds);
  for (let i = entities.length - 1; i >= 0; i--) {
    const entity = entities[i];
    if (eyeIdSet.has(entity.id) && entity.alive) {
      sealedEyes++;
      eyeIdSet.delete(entity.id);
      if (eyeIdSet.size === 0) break;
    }
  }
  return sealedEyes;
}

function optimizedFilterForwards() {
  let sealedEyes = 0;
  const eyeIdSet = new Set(eyeIds);
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (eyeIdSet.has(entity.id) && entity.alive) {
      sealedEyes++;
      eyeIdSet.delete(entity.id);
      if (eyeIdSet.size === 0) break;
    }
  }
  return sealedEyes;
}

function optimizedMap() {
  let sealedEyes = 0;
  const map = new Map();
  // We only need to put entities that are in eyeIds into the map.
  // Wait, that's what we are trying to find!
  // But wait, what if we iterate through entities ONCE, check if they are in eyeIds, and then we have them.
  return sealedEyes;
}

function runBenchmark() {
  for (let i = 0; i < 1000; i++) {
    baseline();
    optimizedFilterBackwards();
    optimizedFilterForwards();
  }

  const iterations = 10000;

  let start = performance.now();
  for (let i = 0; i < iterations; i++) baseline();
  console.log(`Baseline (find): ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedFilterBackwards();
  console.log(`Optimized (Filter Backwards): ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedFilterForwards();
  console.log(`Optimized (Filter Forwards): ${performance.now() - start} ms`);
}

runBenchmark();
