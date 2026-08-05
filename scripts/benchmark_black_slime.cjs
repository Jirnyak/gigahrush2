const { performance } = require('perf_hooks');

// Mock data
const N_ENTITIES = 10000;
const N_EYES = 50;

const entities = [];
for (let i = 0; i < N_ENTITIES; i++) {
  entities.push({ id: i, alive: true, hp: 10 });
}

const eyeIds = [];
for (let i = 0; i < N_EYES; i++) {
  eyeIds.push(Math.floor(Math.random() * N_ENTITIES));
}

function baseline() {
  let sealedEyes = 0;
  for (const id of eyeIds) {
    const eye = entities.find(e => e.id === id);
    if (eye?.alive) {
      // Don't mutate for benchmark to be repeatable easily, or mutate back
      sealedEyes++;
    }
  }
  return sealedEyes;
}

function optimizedMap() {
  let sealedEyes = 0;
  const entityMap = new Map();
  for (let i = 0; i < entities.length; i++) {
    entityMap.set(entities[i].id, entities[i]);
  }

  for (const id of eyeIds) {
    const eye = entityMap.get(id);
    if (eye?.alive) {
      sealedEyes++;
    }
  }
  return sealedEyes;
}

function optimizedSetBreak() {
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

function runBenchmark() {
  // Warmup
  for (let i = 0; i < 1000; i++) {
    baseline();
    optimizedMap();
    optimizedSetBreak();
  }

  const iterations = 1000;

  let start = performance.now();
  for (let i = 0; i < iterations; i++) baseline();
  console.log(`Baseline: ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedMap();
  console.log(`Optimized Map: ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedSetBreak();
  console.log(`Optimized Set Break: ${performance.now() - start} ms`);
}

runBenchmark();
