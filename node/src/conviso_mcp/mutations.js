/**
 * Generic, catalog-driven mutation engine.
 *
 * Loads the build-time catalog (mutations_catalog.json, produced from sdl.gql by
 * scripts/generate_mutation_catalog.mjs) and exposes pure helpers — no network — that
 * let the MCP discover, describe, and build a GraphQL string for ANY of the platform's
 * mutations. Execution itself goes through GraphQLClient.execute().
 *
 * Every Conviso mutation is Relay-style: a single `input: <Name>Input!` argument
 * returning `<Name>Payload`. buildMutationQuery stays generic over `args` anyway, so it
 * keeps working if the schema ever adds a multi-argument mutation.
 */
import catalog from './mutations_catalog.json' with { type: 'json' };

const byName = new Map(catalog.mutations.map((m) => [m.name, m]));

export function getCatalog() {
  return catalog;
}

export function isKnownMutation(name) {
  return byName.has(name);
}

/** Strip list/non-null decoration to get the base type name (e.g. "[Foo!]!" -> "Foo"). */
function namedOf(typeStr) {
  return String(typeStr).replace(/[[\]!]/g, '').trim();
}

/**
 * Discover mutations. Filters by case-insensitive substring on name/description and by
 * coarse category. Returns lightweight rows so the model can pick one, then call
 * describe_mutation for its full input schema.
 */
export function listMutations({ search = '', category = null, limit = 50 } = {}) {
  const q = (search || '').toLowerCase();
  let out = catalog.mutations;
  if (category) out = out.filter((m) => m.category === category);
  if (q) {
    out = out.filter(
      (m) => m.name.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q)
    );
  }
  const total = out.length;
  const mutations = out.slice(0, Math.max(0, limit)).map((m) => ({
    name: m.name,
    description: m.description,
    category: m.category,
    destructive: m.destructive,
  }));
  return { total, count: mutations.length, mutations };
}

/** Recursively expand an input object type into a field tree (nested inputs to `maxDepth`). */
function expandInput(typeName, depth, seen, maxDepth = 2) {
  const fields = catalog.inputs[typeName];
  if (!fields) return null;
  if (seen.has(typeName)) return `<recursive ${typeName}>`;
  const nextSeen = new Set(seen);
  nextSeen.add(typeName);
  return fields.map((f) => {
    const base = namedOf(f.type);
    const d = { name: f.name, type: f.type, required: !!f.required };
    if (f.description) d.description = f.description;
    if (catalog.enums[base]) {
      d.enumValues = catalog.enums[base];
    } else if (catalog.inputs[base] && depth < maxDepth) {
      d.fields = expandInput(base, depth + 1, nextSeen, maxDepth);
    }
    return d;
  });
}

/**
 * Full schema for one mutation: argument list, expanded input fields (with enum values
 * and nested input objects inlined), and the default payload selection used when the
 * caller does not pass return_fields.
 */
export function describeMutation(name) {
  const m = byName.get(name);
  if (!m) {
    return {
      error: `Unknown mutation '${name}'. Call list_mutations to discover valid names.`,
    };
  }
  return {
    name: m.name,
    description: m.description,
    category: m.category,
    destructive: m.destructive,
    args: m.args,
    inputType: m.inputType,
    input: m.inputType ? expandInput(m.inputType, 0, new Set()) : null,
    payloadType: m.payloadType,
    defaultReturnFields: m.payloadSelection,
    usage: `execute_mutation({ name: "${m.name}", variables: { input: { ... } } })`,
  };
}

/**
 * Build the GraphQL document + variables for a catalog mutation. Pure and side-effect
 * free so it can be unit-tested without a network. Throws on unknown names — only
 * catalogued mutations are runnable (whitelist; no raw-string passthrough).
 */
export function buildMutationQuery(name, variables = {}, returnFields = null) {
  const m = byName.get(name);
  if (!m) {
    throw new Error(`Unknown mutation '${name}'. Call list_mutations to discover valid names.`);
  }
  // Every catalogued mutation takes a single `input` object. Callers often pass the input
  // fields bare (without the { input: ... } wrapper) — accept that instead of failing.
  if (
    m.args.length === 1 && m.args[0].name === 'input' &&
    variables && typeof variables === 'object' && !Array.isArray(variables) &&
    !('input' in variables) && Object.keys(variables).length > 0
  ) {
    variables = { input: variables };
  }
  const opName = name.charAt(0).toUpperCase() + name.slice(1);
  const decls = m.args.map((a) => `$${a.name}: ${a.type}`).join(', ');
  const pass = m.args.map((a) => `${a.name}: $${a.name}`).join(', ');
  const sel = (returnFields && String(returnFields).trim()) || m.payloadSelection || 'clientMutationId';
  const selBlock = sel ? ` {\n    ${sel}\n  }` : '';
  const query = `mutation ${opName}(${decls}) {\n  ${name}(${pass})${selBlock}\n}`;
  return { query, variables };
}
