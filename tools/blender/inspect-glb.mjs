import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { Box3, Vector3 } = await import(require.resolve('three'));
const { GLTFLoader } = await import(require.resolve('three/examples/jsm/loaders/GLTFLoader.js'));
const bytes = fs.readFileSync(process.argv[2]);
const expected = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).dimensionsM;
assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'GLB magic');
assert.equal(bytes.readUInt32LE(4), 2, 'GLB version');
assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB byte length');
const jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
assert.ok(!json.cameras?.length, 'No studio camera exported');
assert.ok(!json.extensions?.KHR_lights_punctual, 'No studio lighting exported');
for (const resource of [...(json.buffers ?? []), ...(json.images ?? [])]) {
  assert.equal(resource.uri, undefined, 'Asset must be self-contained');
}
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
gltf.scene.updateMatrixWorld(true);
const bounds = new Box3().setFromObject(gltf.scene, true);
const size = bounds.getSize(new Vector3()).toArray();
const near = (actual, wanted, label) => assert.ok(Math.abs(actual - wanted) < 1e-5, `${label}: ${actual} != ${wanted}`);
size.forEach((value, i) => near(value, expected[i], `dimension ${i}`));
near(bounds.min.y, 0, 'floor pivot');
near(bounds.max.x + bounds.min.x, 0, 'X centering');
near(bounds.max.z + bounds.min.z, 0, 'Z centering');
const seat = gltf.scene.getObjectByName('seat-cushion');
if (seat && expected.every((value, i) => Math.abs(value - [.48895, .8382, .5588][i]) < 1e-8)) {
  const seatBounds = new Box3().setFromObject(seat, true);
  near(seatBounds.max.y, .4699, 'Campus chair seat height');
  near(seatBounds.max.x - seatBounds.min.x, .4445, 'Campus chair seat width');
  near(seatBounds.max.z - seatBounds.min.z, .4445, 'Campus chair seat depth');
}
let meshCount = 0;
let triangles = 0;
gltf.scene.traverse(object => {
  if (!object.isMesh) return;
  meshCount++;
  triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  assert.ok(object.geometry.attributes.normal, 'Mesh has normals');
  assert.ok(object.material.isMeshStandardMaterial, 'Web-compatible PBR material');
  assert.ok(!object.name.includes('Preview'), 'No preview stage geometry');
});
assert.ok(triangles < 40000);
assert.ok(bytes.length < 2_000_000);
console.log(JSON.stringify({ loader: 'Three.js GLTFLoader', dimensionsM: size, bottomM: bounds.min.y, meshCount, triangles, bytes: bytes.length, result: 'PASS' }, null, 2));
