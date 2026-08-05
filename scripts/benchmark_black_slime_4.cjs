const { performance } = require('perf_hooks');

// Let's test with more realistic numbers.
// Entities count could be high, let's say 2000.
// eyeIds count might be small, let's say 5 (MAX_EYES_PER_SITE is 8?).
const N_ENTITIES = 2000;
const N_EYES = 8;

const entities = [];
for (let i = 0; i < N_ENTITIES; i++) {
  entities.push({ id: i, alive: true, hp: 10 });
}

const eyeIds = [];
for (let i = 0; i < N_EYES; i++) {
  eyeIds.push(N_ENTITIES - 10 + i);
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

function optimizedFilter() {
  let sealedEyes = 0;
  const eyeIdSet = new Set(eyeIds);
  // Iterating backwards might be faster if recently added?
  // We can just iterate over the entities and check if it's an eye
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

function runBenchmark() {
  for (let i = 0; i < 1000; i++) {
    baseline();
    optimizedFilter();
  }

  const iterations = 10000;

  let start = performance.now();
  for (let i = 0; i < iterations; i++) baseline();
  console.log(`Baseline (find): ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedFilter();
  console.log(`Optimized (Filter Backwards): ${performance.now() - start} ms`);
}

runBenchmark();
