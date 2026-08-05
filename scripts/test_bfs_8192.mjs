const W = 1024;
const SUBDIV = 8;
const SUB_W = W * SUBDIV;
const TOTAL_CELLS = SUB_W * SUB_W;

console.log("==========================================");
console.log(`World size: ${W}x${W} cells`);
console.log(`Subcellular size: ${SUB_W}x${SUB_W} cells`);
console.log(`Total nodes for BFS: ${TOTAL_CELLS.toLocaleString()}`);
console.log("==========================================\n");

const startMem = process.memoryUsage().heapUsed;

console.time("Allocation time");
const _navParent = new Int32Array(TOTAL_CELLS);
const _navDepth = new Int32Array(TOTAL_CELLS);
const _navComponent = new Int32Array(TOTAL_CELLS);
const _navQueue = new Int32Array(TOTAL_CELLS);
console.timeEnd("Allocation time");

const endMem = process.memoryUsage().heapUsed;
const allocatedMB = (endMem - startMem) / 1024 / 1024;
console.log(`Memory allocated just for 4 navigation arrays: ${allocatedMB.toFixed(2)} MB\n`);

console.log("Starting mock BFS traversal (simulating bakeNavigationTree)...");
console.time("BFS Bake Simulation time");

// Очищаем карту как в реальном движке
_navParent.fill(-1);

let head = 0;
let tail = 0;

// Начинаем BFS из центра мира
const startX = Math.floor(SUB_W / 2);
const startY = Math.floor(SUB_W / 2);
const startIdx = startY * SUB_W + startX;

_navQueue[tail++] = startIdx;
_navParent[startIdx] = startIdx;
_navDepth[startIdx] = 0;

let visitedCount = 0;

// Упрощенный BFS (без проверок стен и дверей, только голая математика прохода по сетке)
while(head < tail) {
    const curr = _navQueue[head++];
    const depth = _navDepth[curr] + 1;
    
    const y = Math.floor(curr / SUB_W);
    const x = curr % SUB_W;
    
    // Up
    if (y > 0) {
        const n = curr - SUB_W;
        if (_navParent[n] === -1) {
            _navParent[n] = curr;
            _navDepth[n] = depth;
            _navQueue[tail++] = n;
            visitedCount++;
        }
    }
    // Down
    if (y < SUB_W - 1) {
        const n = curr + SUB_W;
        if (_navParent[n] === -1) {
            _navParent[n] = curr;
            _navDepth[n] = depth;
            _navQueue[tail++] = n;
            visitedCount++;
        }
    }
    // Left
    if (x > 0) {
        const n = curr - 1;
        if (_navParent[n] === -1) {
            _navParent[n] = curr;
            _navDepth[n] = depth;
            _navQueue[tail++] = n;
            visitedCount++;
        }
    }
    // Right
    if (x < SUB_W - 1) {
        const n = curr + 1;
        if (_navParent[n] === -1) {
            _navParent[n] = curr;
            _navDepth[n] = depth;
            _navQueue[tail++] = n;
            visitedCount++;
        }
    }
}

console.timeEnd("BFS Bake Simulation time");
console.log(`Visited ${visitedCount.toLocaleString()} nodes.`);
console.log("\nNote: The real bakeNavigationTree does 3-5x more logic per cell (door checks, component tracking, bitmask reads).");
console.log("==========================================");
