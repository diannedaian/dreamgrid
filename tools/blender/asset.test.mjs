import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const require = createRequire(new URL('packages/contracts/package.json', root));
const { Ajv2020 } = require('ajv/dist/2020.js');
const read = path => JSON.parse(fs.readFileSync(new URL(path, root), 'utf8'));
const spec = read('assets/specs/college-bed.json');
const asset = read('assets/specs/college-bed.asset.json');
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
  read('packages/contracts/schemas/furniture-spec.schema.json'),
);

test('college bed matches existing FurnitureSpec and ModelAsset contracts', () => {
  assert.ok(validate(spec), JSON.stringify(validate.errors));
  const validateAsset = new Ajv2020({ strict: true }).compile(
    read('packages/contracts/schemas/model-asset.schema.json'),
  );
  assert.ok(validateAsset(asset), JSON.stringify(validateAsset.errors));
  assert.deepEqual(spec.dimensionsM, asset.dimensionsM);
  const ids = new Set(spec.materials.map(item => item.id));
  for (const part of spec.parts) assert.ok(ids.has(part.materialId));
});

test('dimensions preserve the published envelope and 19-inch mattress underside', () => {
  [38, 37, 85.5].forEach((inches, i) => assert.ok(Math.abs(spec.dimensionsM[i] - inches * .0254) < 1e-8));
  const mattress = spec.parts.find(part => part.id === 'mattress');
  assert.ok(Math.abs(mattress.positionM[1] - mattress.dimensionsM[1] / 2 - 19 * .0254) < 1e-8);
});

test('schema rejects executable fields, unknown primitives, and excessive repetitions', () => {
  assert.equal(validate({ ...spec, python: 'untrusted code' }), false);
  assert.equal(validate({ ...spec, parts: [{ ...spec.parts[0], primitive: 'python' }] }), false);
  assert.equal(validate({ ...spec, parts: [{ ...spec.parts[0], repeat: { count: 99999, offsetM: [0, 0, 1] } }] }), false);
});

test('committed GLB loads in Three.js, stays normalized, and contains no studio geometry', () => {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('tools/blender/inspect-glb.mjs', root)),
    fileURLToPath(new URL('apps/web/public/demo-assets/college-bed.glb', root)),
    fileURLToPath(new URL('assets/specs/college-bed.json', root)),
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const slug of ['campus-chair', 'dorm-desk']) {
  test(`${slug}: canonical recipe and metadata agree`, () => {
    const recipe = read(`assets/specs/${slug}.json`);
    const metadata = read(`assets/specs/${slug}.asset.json`);
    assert.ok(validate(recipe), JSON.stringify(validate.errors));
    const validateAsset = new Ajv2020({ strict: true }).compile(
      read('packages/contracts/schemas/model-asset.schema.json'),
    );
    assert.ok(validateAsset(metadata), JSON.stringify(validateAsset.errors));
    assert.deepEqual(metadata.dimensionsM, recipe.dimensionsM);
    assert.equal(metadata.glbUrl, `/demo-assets/${slug}.glb`);
    const materialIds = new Set(recipe.materials.map(item => item.id));
    for (const part of recipe.parts) assert.ok(materialIds.has(part.materialId));
  });

  test(`${slug}: actual GLB loads with correct units, dimensions, pivot and materials`, () => {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('tools/blender/inspect-glb.mjs', root)),
      fileURLToPath(new URL(`apps/web/public/demo-assets/${slug}.glb`, root)),
      fileURLToPath(new URL(`assets/specs/${slug}.json`, root)),
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}

test('chair preserves the manufacturer seat height and seat width/depth', () => {
  const chair = read('assets/specs/campus-chair.json');
  assert.deepEqual(chair.dimensionsM, [.48895, .8382, .5588]);
  const seat = chair.parts.find(part => part.id === 'seat-cushion');
  assert.equal(seat.dimensionsM[0], .4445);
  assert.equal(seat.dimensionsM[2], .4445);
  assert.ok(Math.abs(seat.positionM[1] + seat.dimensionsM[1] / 2 - .4699) < 1e-8);
  assert.ok(chair.parts.find(part => part.id === 'back-cushion').positionM[2] < 0);
});

test('desk preserves the approved 42 x 24 x 30 inch size and right-side drawers', () => {
  const desk = read('assets/specs/dorm-desk.json');
  assert.deepEqual(desk.dimensionsM, [1.0668, .762, .6096]);
  const drawers = desk.parts.filter(part => part.id.endsWith('drawer-front'));
  assert.equal(drawers.length, 3);
  for (const drawer of drawers) assert.ok(drawer.positionM[0] > 0 && drawer.positionM[2] > 0);
  assert.ok(desk.parts.find(part => part.id === 'keyboard-tray').positionM[0] < 0);
});
