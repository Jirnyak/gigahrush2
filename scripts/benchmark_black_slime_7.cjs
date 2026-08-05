const { performance } = require('perf_hooks');

// But if the number of entities is very large (e.g. 100000) and number of eyes is large...
// Let's test with N_EYES = 50, N_ENTITIES = 100000
const N_ENTITIES = 100000;
const N_EYES = 50;

const entities = [];
for (let i = 0; i < N_ENTITIES; i++) {
  entities.push({ id: i, alive: true, hp: 10 });
}

const eyeIds = [];
for (let i = 0; i < N_EYES; i++) {
  eyeIds.push(N_ENTITIES - 100 + i); // Worst case for find()
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

function optimizedMap() {
  let sealedEyes = 0;
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

function optimizedSet() {
  let sealedEyes = 0;
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

function runBenchmark() {
  const iterations = 100;

  let start = performance.now();
  for (let i = 0; i < iterations; i++) baseline();
  console.log(`Baseline (find): ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedMap();
  console.log(`Optimized (Map): ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedSet();
  console.log(`Optimized (Set): ${performance.now() - start} ms`);
}

runBenchmark();
