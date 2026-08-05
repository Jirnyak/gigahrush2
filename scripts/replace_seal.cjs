const fs = require('fs');
const file = 'src/gen/maintenance/black_slime_eyes.ts';
let code = fs.readFileSync(file, 'utf8');

const search = `  let sealedEyes = 0;
  for (const id of ctx.eyeIds) {
    const eye = ctx.entities.find(e => e.id === id);
    if (eye?.alive) {
      eye.alive = false;
      eye.hp = 0;
      sealedEyes++;
    }
  }`;

const replace = `  let sealedEyes = 0;
  if (ctx.eyeIds.length > 0) {
    const entityMap = new Map();
    for (const e of ctx.entities) {
      entityMap.set(e.id, e);
    }
    for (const id of ctx.eyeIds) {
      const eye = entityMap.get(id);
      if (eye?.alive) {
        eye.alive = false;
        eye.hp = 0;
        sealedEyes++;
      }
    }
  }`;

if (code.includes(search)) {
  code = code.replace(search, replace);
  fs.writeFileSync(file, code);
  console.log('Replacement successful in sealBlackSlime');
} else {
  console.log('Search string not found in sealBlackSlime');
}
