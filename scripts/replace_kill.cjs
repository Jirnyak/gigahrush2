const fs = require('fs');
const file = 'src/gen/maintenance/black_slime_eyes.ts';
let code = fs.readFileSync(file, 'utf8');

const search = `  const remaining = ctx.eyeIds.filter(id => ctx.entities.some(e => e.id === id && e.alive)).length;`;

const replace = `  const entityMap = new Map();
  for (const e of ctx.entities) {
    entityMap.set(e.id, e);
  }
  const remaining = ctx.eyeIds.filter(id => {
    const e = entityMap.get(id);
    return e && e.alive;
  }).length;`;

if (code.includes(search)) {
  code = code.replace(search, replace);
  fs.writeFileSync(file, code);
  console.log('Replacement successful in handleKillEvent');
} else {
  console.log('Search string not found in handleKillEvent');
}
