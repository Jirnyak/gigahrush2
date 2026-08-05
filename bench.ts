import { performance } from 'perf_hooks';

const quests = Array.from({ length: 1000 }, (_, i) => ({ done: i % 2 === 0 }));

function benchFilter() {
  return quests.filter(q => !q.done).length;
}

function benchLoop() {
  let count = 0;
  for (let i = 0; i < quests.length; i++) {
    if (!quests[i].done) count++;
  }
  return count;
}

function run(name: string, fn: () => number) {
  const start = performance.now();
  let res = 0;
  for (let i = 0; i < 10000; i++) {
    res += fn();
  }
  const end = performance.now();
  return (end - start);
}

// Warmup
run('filter', benchFilter);
run('loop', benchLoop);

// Measurement
const filterTime = run('filter', benchFilter);
const loopTime = run('loop', benchLoop);

console.log(`Baseline (.filter().length): ${filterTime.toFixed(2)}ms`);
console.log(`Optimized (for loop): ${loopTime.toFixed(2)}ms`);
console.log(`Improvement: ${((filterTime - loopTime) / filterTime * 100).toFixed(2)}% faster (${(filterTime / loopTime).toFixed(1)}x faster)`);
