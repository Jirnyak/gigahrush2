import { readFileSync, writeFileSync } from 'node:fs';
let src = readFileSync('src/data/art_sprite_manifest.ts', 'utf8');
src = src.replace(/\n\{/g, '\n  {');
writeFileSync('src/data/art_sprite_manifest.ts', src);
