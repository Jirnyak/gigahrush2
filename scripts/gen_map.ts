import { writeFileSync } from 'fs';
import { makeProceduralFloorSpec } from '../src/data/procedural_floors';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import { dumpCanvas } from '../tests/test_utils';

async function generate() {
  const spec = makeProceduralFloorSpec(39039, 9);
  spec.geometryId = 'archive_warrens';
  const gen = generateProceduralFloor(spec);
  dumpCanvas(gen.world, 'archive_warrens_stitched.png');
  console.log('Done.');
}
generate();
