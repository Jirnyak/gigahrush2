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
  const iterations = 1000;

  let start = performance.now();
  for (let i = 0; i < iterations; i++) baselineSeal();
  console.log(`Baseline seal: ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedSeal();
  console.log(`Optimized seal: ${performance.now() - start} ms`);
}

runBenchmark();
