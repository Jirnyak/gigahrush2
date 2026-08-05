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

function baselineRemaining() {
  return eyeIds.filter(id => entities.some(e => e.id === id && e.alive)).length;
}

function optimizedRemaining() {
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
  for (let i = 0; i < iterations; i++) baselineRemaining();
  console.log(`Baseline remaining: ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedRemaining();
  console.log(`Optimized remaining: ${performance.now() - start} ms`);
}

runBenchmark();
