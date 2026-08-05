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
  // Put them near the end so find() has to search a lot
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

function optimizedIterateOnce() {
  let sealedEyes = 0;
  const targetIds = new Set(eyeIds);
  let found = 0;
  const targetCount = targetIds.size;

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (targetIds.has(entity.id)) {
      if (entity.alive) {
        sealedEyes++;
      }
      found++;
      if (found === targetCount) break;
    }
  }
  return sealedEyes;
}

function optimizedBuildMap() {
  let sealedEyes = 0;
  // Building a map of all entities
  const map = new Map();
  for (let i = 0; i < entities.length; i++) {
    map.set(entities[i].id, entities[i]);
  }
  for (const id of eyeIds) {
    const eye = map.get(id);
    if (eye?.alive) {
      sealedEyes++;
    }
  }
  return sealedEyes;
}


function runBenchmark() {
  for (let i = 0; i < 1000; i++) {
    baseline();
    optimizedIterateOnce();
    optimizedBuildMap();
  }

  const iterations = 10000;

  let start = performance.now();
  for (let i = 0; i < iterations; i++) baseline();
  console.log(`Baseline (find): ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedIterateOnce();
  console.log(`Optimized (Set + 1 pass): ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedBuildMap();
  console.log(`Optimized (Build Map): ${performance.now() - start} ms`);
}

runBenchmark();
