#!/usr/bin/env node
/**
 * Build-time generator: turns the Conviso GraphQL SDL (sdl.gql) into a compact,
 * runtime-loadable catalog of every mutation, the input types they reference, and
 * the enums those inputs use.
 *
 * The catalog powers the generic mutation engine (mutations.js) so the MCP can reach
 * all platform mutations with a tiny tool surface and zero new *runtime* dependency
 * (graphql is a devDependency, used only here).
 *
 * Usage: npm run gen:mutations
 * Output: src/conviso_mcp/mutations_catalog.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSchema,
  getNamedType,
  isScalarType,
  isEnumType,
  isObjectType,
  isInterfaceType,
  isInputObjectType,
  isNonNullType,
} from 'graphql';
import { ALLOWED_MUTATIONS } from '../src/conviso_mcp/operation_allowlist.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SDL_PATH = resolve(__dirname, '..', '..', 'sdl.gql');
const OUT_PATH = resolve(__dirname, '..', 'src', 'conviso_mcp', 'mutations_catalog.json');

// Mutations whose name implies an irreversible / destructive write. Used to set
// destructiveHint and to warn the model via list_mutations / describe_mutation.
const DESTRUCTIVE = /^(delete|bulkDelete|remove|disassociate|revoke|cancel|debit|refund|unlink|archive)/i;

// Coarse domain bucket used by list_mutations({ category }). Order matters — the first
// match wins — so more specific domains are checked before broader ones (e.g. application
// before asset, threat_model/requirement before project).
function categoryOf(name) {
  const n = name.toLowerCase();
  if (n.includes('finding') || n.includes('vulnerab') || n.includes('issue')) return 'issue';
  if (n.includes('ticket')) return 'ticket';
  if (n.includes('pentest')) return 'pentest';
  if (n.includes('threat')) return 'threat_model';
  if (n.includes('requirement')) return 'requirement';
  if (n.includes('application')) return 'application';
  if (n.includes('dast') || n.includes('asset')) return 'asset';
  if (n.includes('project')) return 'project';
  return 'other';
}

const sdl = readFileSync(SDL_PATH, 'utf8');
const schema = buildSchema(sdl, { assumeValidSDL: true });

const neededInputs = new Set();
const neededEnums = new Set();

function noteType(type) {
  const named = getNamedType(type);
  if (isInputObjectType(named)) neededInputs.add(named.name);
  else if (isEnumType(named)) neededEnums.add(named.name);
}

// A safe, compact default selection set for a mutation payload (depth 1):
//   - scalar / enum fields  -> select by name
//   - object / interface    -> `field { __typename id }` when an `id` field exists, else `{ __typename }`
//   - fields with required args are skipped (can't be selected blindly)
function payloadSelection(outType) {
  const named = getNamedType(outType);
  if (!isObjectType(named) && !isInterfaceType(named)) return '';
  const parts = [];
  const fields = named.getFields();
  for (const fname of Object.keys(fields)) {
    const sf = fields[fname];
    if (sf.args && sf.args.some((a) => isNonNullType(a.type))) continue;
    const sfNamed = getNamedType(sf.type);
    if (isScalarType(sfNamed) || isEnumType(sfNamed)) {
      parts.push(fname);
    } else if (isObjectType(sfNamed) || isInterfaceType(sfNamed)) {
      parts.push(sfNamed.getFields().id ? `${fname} { __typename id }` : `${fname} { __typename }`);
    }
  }
  return parts.join(' ');
}

const mutationType = schema.getMutationType();
if (!mutationType) {
  console.error('[gen] No Mutation type found in SDL');
  process.exit(1);
}

const mfields = mutationType.getFields();

// Restrict the catalog to the allowlist — every other platform mutation is excluded.
const allowed = new Set(ALLOWED_MUTATIONS);
const missing = ALLOWED_MUTATIONS.filter((n) => !mfields[n]);
if (missing.length) {
  console.error(`[gen] WARNING: ${missing.length} allowlisted mutation(s) not found in SDL: ${missing.join(', ')}`);
}

const mutations = [];
for (const name of Object.keys(mfields).sort()) {
  if (!allowed.has(name)) continue;
  const f = mfields[name];
  f.args.forEach((a) => noteType(a.type));
  const inputArg = f.args.find((a) => a.name === 'input');
  mutations.push({
    name,
    description: (f.description || '').trim(),
    args: f.args.map((a) => ({ name: a.name, type: String(a.type) })),
    inputType: inputArg ? getNamedType(inputArg.type).name : null,
    payloadType: getNamedType(f.type).name,
    payloadSelection: payloadSelection(f.type),
    destructive: DESTRUCTIVE.test(name),
    category: categoryOf(name),
  });
}

// Transitive closure of every input object reachable from a mutation argument.
const inputs = {};
const queue = [...neededInputs];
while (queue.length) {
  const tname = queue.shift();
  if (inputs[tname]) continue;
  const t = schema.getType(tname);
  if (!t || !isInputObjectType(t)) continue;
  const fields = t.getFields();
  const arr = [];
  for (const fn of Object.keys(fields)) {
    const fld = fields[fn];
    const named = getNamedType(fld.type);
    const entry = { name: fn, type: String(fld.type), required: isNonNullType(fld.type) };
    const desc = (fld.description || '').trim();
    if (desc) entry.description = desc;
    arr.push(entry);
    if (isInputObjectType(named) && !inputs[named.name]) queue.push(named.name);
    else if (isEnumType(named)) neededEnums.add(named.name);
  }
  inputs[tname] = arr;
}

const enums = {};
for (const en of [...neededEnums].sort()) {
  const t = schema.getType(en);
  if (t && isEnumType(t)) enums[en] = t.getValues().map((v) => v.name);
}

const catalog = {
  generatedAt: new Date().toISOString(),
  schemaSource: 'sdl.gql',
  mutationCount: mutations.length,
  mutations,
  inputs,
  enums,
};

writeFileSync(OUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
console.error(
  `[gen] ${mutations.length} mutations, ${Object.keys(inputs).length} input types, ` +
  `${Object.keys(enums).length} enums -> ${OUT_PATH}`
);
