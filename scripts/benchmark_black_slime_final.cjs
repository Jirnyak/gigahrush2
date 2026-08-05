const { performance } = require('perf_hooks');

const N_ENTITIES = 10000;
const N_EYES = 8;

const entities = [];
for (let i = 0; i < N_ENTITIES; i++) {
  entities.push({ id: i, alive: true, hp: 10 });
}

const eyeIds = [];
for (let i = 0; i < N_EYES; i++) {
  eyeIds.push(N_ENTITIES - 100 + i);
}

function baselineSeal() {
  let sealedEyes = 0;
  for (const id of eyeIds) {
    const eye = entities.find(e => e.id === id);
    if (eye?.alive) {
      sealedEyes++;
    }
  }
  return sealedEyes;
}

function optimizedSeal() {
  let sealedEyes = 0;
  if (eyeIds.length === 0) return 0;

  const entityMap = new Map();
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    entityMap.set(e.id, e);
  }

  for (const id of eyeIds) {
    const eye = entityMap.get(id);
    if (eye?.alive) {
      sealedEyes++;
    }
  }
  return sealedEyes;
}

function optimizedSealSet() {
  let sealedEyes = 0;
  if (eyeIds.length === 0) return 0;
  const targetIds = new Set(eyeIds);
  let found = 0;
  const targetCount = targetIds.size;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (targetIds.has(entity.id)) {
      if (entity.alive) sealedEyes++;
      found++;
      if (found === targetCount) break;
    }
  }
  return sealedEyes;
}

function baselineKill() {
  return eyeIds.filter(id => entities.some(e => e.id === id && e.alive)).length;
}

function optimizedKill() {
  const entityMap = new Map();
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    entityMap.set(e.id, e);
  }
  return eyeIds.filter(id => {
    const e = entityMap.get(id);
    return e && e.alive;
  }).length;
}

function optimizedKillSet() {
  if (eyeIds.length === 0) return 0;
  let remaining = 0;
  const targetIds = new Set(eyeIds);
  let found = 0;
  const targetCount = targetIds.size;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (targetIds.has(entity.id)) {
      if (entity.alive) remaining++;
      found++;
      if (found === targetCount) break;
    }
  }
  return remaining;
}

function runBenchmark() {
  const iterations = 1000;

  let start = performance.now();
  for (let i = 0; i < iterations; i++) baselineSeal();
  console.log(`Baseline Seal (Array.find): ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedSeal();
  console.log(`Optimized Seal (Build Map): ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedSealSet();
  console.log(`Optimized Seal (Set.has): ${performance.now() - start} ms`);

  console.log('---');

  start = performance.now();
  for (let i = 0; i < iterations; i++) baselineKill();
  console.log(`Baseline Kill (Array.some): ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedKill();
  console.log(`Optimized Kill (Build Map): ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedKillSet();
  console.log(`Optimized Kill (Set.has): ${performance.now() - start} ms`);
}

runBenchmark();
