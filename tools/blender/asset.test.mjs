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
