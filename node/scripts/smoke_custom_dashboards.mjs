#!/usr/bin/env node
/**
 * Manual smoke test of the Metrics Studio tools against the real Conviso API.
 * Not part of `npm test` (it needs a real API key and writes to a real company).
 *
 * Usage (from node/):
 *   CONVISO_API_KEY=... node scripts/smoke_custom_dashboards.mjs --company 443 [--dry-only] [--keep]
 *
 * Steps: catalog -> dry_run of a sample dashboard -> create -> get -> update (change one
 * visualization, add a widget) -> list. The test dashboard is deleted at the end unless
 * --keep is passed. --dry-only stops after the dry run and writes nothing.
 */
import 'dotenv/config';
import { GraphQLClient } from '../src/conviso_mcp/graphql_client.js';

const argv = process.argv.slice(2);
const companyIndex = argv.indexOf('--company');
const companyId = companyIndex >= 0 ? Number(argv[companyIndex + 1]) : NaN;
const dryOnly = argv.includes('--dry-only');
const keep = argv.includes('--keep');

if (!process.env.CONVISO_API_KEY || !Number.isInteger(companyId)) {
  console.error('Usage: CONVISO_API_KEY=... node scripts/smoke_custom_dashboards.mjs --company <id> [--dry-only] [--keep]');
  process.exit(1);
}

const gql = new GraphQLClient('https://app.convisoappsec.com/graphql', process.env.CONVISO_API_KEY);
let failures = 0;

async function step(label, fn) {
  console.log(`\n# ${label}`);
  try {
    return await fn();
  } catch (err) {
    failures += 1;
    console.log(`  ✗ ${err.publicMessage || err.message}`);
    if (err.publicData) console.log(`  ${JSON.stringify(err.publicData)}`);
    if (err.graphqlErrors) console.log(`  ${JSON.stringify(err.graphqlErrors)}`);
    return null;
  }
}

function printWidgets(widgets) {
  for (const w of widgets || []) {
    const p = w.preview;
    const result = p ? ` -> ${p.state}${p.total !== undefined ? ` total=${p.total}` : ''}${p.row_count !== undefined ? ` rows=${p.row_count}` : ''}${p.message ? ` ${p.message}` : ''}` : '';
    console.log(`  - [${w.key}] ${w.title}: ${w.metric} ${w.visualization}${w.group_by?.length ? ` by ${w.group_by.join(', ')}` : ''} @${w.layout.x},${w.layout.y} ${w.layout.width}x${w.layout.height}${result}`);
    for (const e of p?.validation_errors || []) console.log(`      ${e.path} ${e.code}: ${e.message}`);
  }
}

const catalog = await step(`get_custom_dashboard_catalog(${companyId})`, async () => {
  const c = await gql.get_custom_dashboard_catalog({ company_id: companyId });
  console.log(`  ${c.metrics.length} metrics, ${c.dimensions.length} dimensions, limits ${JSON.stringify(c.limits)}`);
  console.log(`  statuses: ${c.vocabularies.statuses.join(', ')}`);
  return c;
});
if (!catalog) process.exit(1);

// "Críticas e altas abertas, por severidade e por time, MTTR do trimestre e lista das vencidas."
const open = catalog.vocabularies.statuses.filter((s) => ['IDENTIFIED', 'IN_PROGRESS', 'AWAITING_VALIDATION'].includes(s));
const name = `MCP smoke ${new Date().toISOString().slice(0, 16)}`;
const spec = {
  company_id: companyId,
  name,
  description: 'Created by scripts/smoke_custom_dashboards.mjs',
  timezone: 'America/Sao_Paulo',
  period_days: 90,
  widgets: [
    { title: 'Críticas e altas abertas', metric: 'issues.count', visualization: 'NUMBER', filters: { statuses: open, severities: ['CRITICAL', 'HIGH'] } },
    { title: 'MTTR do trimestre', metric: 'remediation.mttr', visualization: 'NUMBER' },
    { title: 'Abertas por severidade', metric: 'issues.count', visualization: 'BAR', groupBy: ['severity'], filters: { statuses: open } },
    { title: 'Abertas por time', metric: 'issues.count', visualization: 'HORIZONTAL_BAR', groupBy: ['assigned_team'], filters: { statuses: open }, limit: 10 },
    {
      title: 'Vencidas', metric: 'issues.count', visualization: 'RECORD_LIST', filters: { slaStates: ['BREACHED'] },
      recordList: { columns: ['title', 'severity', 'assetName', 'dueAt'], sort: { column: 'dueAt', direction: 'ASC' }, pageSize: 10 },
    },
  ],
};

const dry = await step('create_custom_dashboard(dry_run)', async () => {
  const out = await gql.create_custom_dashboard({ ...spec, dry_run: true });
  console.log(`  valid=${out.valid} saved=${out.saved}`);
  for (const e of out.dashboard_errors || []) console.log(`  dashboard: ${e.path} ${e.code}: ${e.message}`);
  printWidgets(out.widgets);
  return out;
});

if (dryOnly || !dry?.valid) {
  console.log(dryOnly ? '\n--dry-only: nothing written.' : '\nDry run not valid: stopping before any write.');
  process.exit(failures || !dry?.valid ? 1 : 0);
}

const created = await step('create_custom_dashboard', async () => {
  const out = await gql.create_custom_dashboard(spec);
  console.log(`  id=${out.dashboard.id} lock_version=${out.dashboard.lock_version}`);
  console.log(`  url=${out.dashboard.url}`);
  printWidgets(out.widgets);
  return out;
});
const id = created?.dashboard?.id;

if (id) {
  const current = await step(`get_custom_dashboard(${id})`, async () => {
    const out = await gql.get_custom_dashboard({ company_id: companyId, dashboard_id: id });
    console.log(`  ${out.dashboard.name}: ${out.definition.widgets.length} widgets, lock_version=${out.dashboard.lock_version}, can_edit=${out.dashboard.can_edit}`);
    return out;
  });

  if (current) {
    await step('update_custom_dashboard(severity as TABLE, + recorded per month)', async () => {
      const widgets = current.definition.widgets.map((w) => (
        w.title === 'Abertas por severidade' ? { ...w, visualization: { kind: 'TABLE' } } : w
      ));
      widgets.push({ title: 'Registradas por mês', metric: 'issues.created', visualization: 'LINE', parameters: { bucket: 'MONTH' }, size: 'FULL' });
      const out = await gql.update_custom_dashboard({
        company_id: companyId, dashboard_id: id, expected_version: current.dashboard.lock_version, widgets,
      });
      console.log(`  lock_version=${out.dashboard.lock_version} widgets=${out.dashboard.widget_count}`);
      printWidgets(out.widgets);
    });

    await step('update_custom_dashboard(stale expected_version)', async () => {
      try {
        await gql.update_custom_dashboard({ company_id: companyId, dashboard_id: id, expected_version: current.dashboard.lock_version, name: 'stale' });
        throw new Error('a stale expected_version was accepted');
      } catch (err) {
        if (err.status !== 409) throw err;
        console.log(`  rejected as expected: ${err.publicMessage}`);
      }
    });
  }

  await step('get_custom_dashboards(search)', async () => {
    const out = await gql.get_custom_dashboards({ company_id: companyId, search: 'MCP smoke' });
    for (const d of out.dashboards) console.log(`  - #${d.id} ${d.name} (${d.widget_count} widgets, ${d.access_role})`);
    console.log(`  total=${out.metadata?.totalCount}`);
  });

  if (!keep) {
    await step(`cleanup: deleteCustomDashboard(${id})`, async () => {
      const data = await gql.execute(`
        mutation DeleteCustomDashboard($input: DeleteCustomDashboardInput!) {
          deleteCustomDashboard(input: $input) { deletedId }
        }
      `, { input: { companyId, id } });
      console.log(`  deleted ${data.deleteCustomDashboard.deletedId}`);
    });
  } else {
    console.log(`\n--keep: dashboard ${id} left in place: ${created.dashboard.url}`);
  }
}

console.log(failures ? `\n${failures} step(s) failed` : '\nAll steps passed');
process.exit(failures ? 1 : 0);
