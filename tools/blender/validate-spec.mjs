import fs from 'node:fs';
import { createRequire } from 'node:module';

// Reuse the canonical package's installed validator, with no new dependencies.
const require = createRequire(new URL('../../packages/contracts/package.json', import.meta.url));
const { Ajv2020 } = require('ajv/dist/2020.js');
const schema = JSON.parse(fs.readFileSync(new URL('../../packages/contracts/schemas/furniture-spec.schema.json', import.meta.url)));
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
if (!validate(spec)) {
  console.error(validate.errors);
  process.exit(1);
}
console.log(`FurnitureSpec valid: ${spec.name} (${spec.parts.length} part recipes)`);
