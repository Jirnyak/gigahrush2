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
      sealedEyes++;
    }
  }
  return sealedEyes;
}

function optimizedMapPrebuilt() {
  // If we can prebuild it or build it once and use it.
  // Actually the loop in the original code is:
  // for (const id of ctx.eyeIds) {
  //   const eye = ctx.entities.find(e => e.id === id);
  // }
  // So the map would need to be built inside the function if it's not passed in.

  let sealedEyes = 0;

  // Build lookup map of just the entities we care about or all entities?
  // Building map of all entities is slower if N_ENTITIES > N_EYES * N_ENTITIES_ITERATION.

  // Let's try finding all eyes first by iterating over entities once.
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

function runBenchmark() {
  // Warmup
  for (let i = 0; i < 1000; i++) {
    baseline();
    optimizedIterateOnce();
  }

  const iterations = 1000;

  let start = performance.now();
  for (let i = 0; i < iterations; i++) baseline();
  console.log(`Baseline: ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedIterateOnce();
  console.log(`Optimized Iterate Once: ${performance.now() - start} ms`);
}

runBenchmark();
