#!/usr/bin/env node
/**
 * Local smoke test against the live Conviso API. READ-ONLY by default.
 *
 * Setup:  echo "CONVISO_API_KEY=..." > node/.env   (or export CONVISO_API_KEY=...)
 * Run:    node scripts/smoke.mjs [companyId]
 *
 * Exercises the catalog engine (offline) + a few read tools (live). It never runs a
 * mutation. Pass a companyId to skip the company lookup.
 */
import { FeedGateway } from '../src/conviso_mcp/feed_gateway.js';
import { listMutations, describeMutation } from '../src/conviso_mcp/mutations.js';

const show = (label, v) => console.log(`\n### ${label}\n` + JSON.stringify(v, null, 2).slice(0, 1200));

const gw = new FeedGateway();

// --- offline: catalog engine -------------------------------------------------
show('list_mutations({category:"pentest"})', listMutations({ category: 'pentest' }));
show('describe_mutation("changeIssueStatus").input (required only)',
  describeMutation('changeIssueStatus').input.filter((f) => f.required));

if (!process.env.CONVISO_API_KEY) {
  console.log('\n[!] CONVISO_API_KEY not set — skipping live read calls.');
  process.exit(0);
}

// --- live reads --------------------------------------------------------------
let companyId = Number(process.argv[2]);
if (!companyId) {
  const c = await gw.get_companies(1, 5);
  show('get_companies', c);
  companyId = c?.companies?.collection?.[0]?.id;
  console.log('\nusing companyId =', companyId);
}
if (!companyId) { console.log('[!] no company found'); process.exit(1); }

const safe = async (label, fn) => { try { show(label, await fn()); } catch (e) { console.log(`\n### ${label}\n[ERR] ${e.message}`); } };

await safe('get_tickets', () => gw.get_tickets(companyId, { limit: 3 }));
await safe('get_applications', () => gw.get_applications(companyId));
await safe('get_requirements', () => gw.get_requirements(companyId, { limit: 3 }));
await safe('get_sbom_components', () => gw.get_sbom_components(companyId, { limit: 3 }));
await safe('get_scan_histories', () => gw.get_scan_histories(companyId, { limit: 3 }));
await safe('get_asset_scans_count', () => gw.get_asset_scans_count(companyId));
await safe('get_pentest_artifacts', () => gw.get_pentest_artifacts(companyId, { limit: 3 }));
await safe('get_threat_model_artifacts', () => gw.get_threat_model_artifacts(companyId, { limit: 3 }));

console.log('\n[ok] smoke done (read-only).');
