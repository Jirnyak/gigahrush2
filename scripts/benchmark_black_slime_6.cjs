const { performance } = require('perf_hooks');

const N_ENTITIES = 2000;
const N_EYES = 8;

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
  // If we can build an entity map from ID -> entity, it would be fast.
  // We can build this map as an index if not available.
  // But inside this function, building the map takes time.
  let sealedEyes = 0;
  const idMap = new Map();
  // Is there a way to build a map of just the entities we want without full loop? No.

  // Let's use the provided hint: "Can be optimized by building an entity ID lookup map."
  // So we build a map of ALL entities once, then look up.
  for (let i = 0; i < entities.length; i++) {
    idMap.set(entities[i].id, entities[i]);
  }

  for (const id of eyeIds) {
    const eye = idMap.get(id);
    if (eye?.alive) {
      sealedEyes++;
    }
  }
  return sealedEyes;
}

// But wait, the problem is we are doing this for EACH event...
// In sealBlackSlime it is called once when the seal event happens.
// Wait, ctx is BlackSlimeContext which is created once per slime site and kept in state/memory!
// We can't change BlackSlimeContext easily without checking where else it's used, but wait:
// "Can be optimized by building an entity ID lookup map." - The prompt specifically says "Can be optimized by building an entity ID lookup map."
// Let's try Map.

function runBenchmark() {
  const iterations = 10000;

  let start = performance.now();
  for (let i = 0; i < iterations; i++) baseline();
  console.log(`Baseline (find): ${performance.now() - start} ms`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) optimizedMapPrebuilt();
  console.log(`Optimized (Map): ${performance.now() - start} ms`);
}

runBenchmark();
