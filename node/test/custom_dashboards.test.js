import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as dashboards from '../src/conviso_mcp/custom_dashboards.js';
import {
  buildDefinition,
  clearCatalogCache,
  createCustomDashboard,
  getCustomDashboard,
  listCustomDashboards,
  mapDashboardError,
  packLayout,
  parseMetricRef,
  summarizeCatalog,
  summarizePreview,
  updateCustomDashboard,
  widgetKey,
} from '../src/conviso_mcp/custom_dashboards.js';
import { GraphQLClient } from '../src/conviso_mcp/graphql_client.js';
import { DEDICATED_MUTATIONS } from '../src/conviso_mcp/operation_allowlist.js';
import { isKnownMutation } from '../src/conviso_mcp/mutations.js';

const APP = 'https://app.example.com';

// A slice of the real customDashboardMetricCatalog shape.
const CATALOG = {
  definitionVersion: 1,
  metrics: [
    {
      key: 'issues.count', version: 1, label: 'Vulnerabilities', description: 'd', semantics: 's',
      dataset: 'ISSUES', entityGrain: 'issue', timeBasis: 'CURRENT',
      filters: ['assetIds', 'assetTags', 'archived', 'statuses', 'severities', 'issueTypes', 'branchScope', 'slaStates'],
      groupings: [[], ['severity'], ['asset_tag', 'severity'], ['assigned_team']],
      visualizations: [{ groupDepth: 0, kinds: ['NUMBER', 'RECORD_LIST'] }, { groupDepth: 1, kinds: ['TABLE', 'BAR', 'HORIZONTAL_BAR'] }],
      parameters: [], measureLabel: 'Vulnerabilities', unit: 'count', aggregation: 'COUNT', maxLimit: 50,
    },
    {
      key: 'issues.created', version: 1, label: 'Vulnerabilities recorded', description: 'd', semantics: 's',
      dataset: 'ISSUES', entityGrain: 'issue', timeBasis: 'EVENT_IN_PERIOD', filters: ['statuses'],
      groupings: [[], ['severity']], visualizations: [{ groupDepth: 0, kinds: ['LINE', 'TABLE'] }],
      parameters: [
        { key: 'bucket', kind: 'ENUM', values: ['DAY', 'WEEK', 'MONTH'], minimum: null, maximum: null, default: 'WEEK', required: false },
      ],
      measureLabel: 'Recorded', unit: 'count', aggregation: 'COUNT', maxLimit: 10,
    },
    {
      key: 'remediation.mttr', version: 1, label: 'MTTR', description: 'd', semantics: 's', dataset: 'ISSUES',
      entityGrain: 'cycle', timeBasis: 'EVENT_IN_PERIOD', filters: [], groupings: [[], ['severity']],
      visualizations: [{ groupDepth: 0, kinds: ['NUMBER'] }], parameters: [], measureLabel: 'Mean', unit: 'days',
      aggregation: 'MEAN', maxLimit: 50,
    },
    {
      key: 'remediation.mttr', version: 2, label: 'MTTR v2', description: 'd', semantics: 's', dataset: 'ISSUES',
      entityGrain: 'cycle', timeBasis: 'EVENT_IN_PERIOD', filters: [], groupings: [[]],
      visualizations: [{ groupDepth: 0, kinds: ['NUMBER'] }], parameters: [], measureLabel: 'Mean', unit: 'days',
      aggregation: 'MEAN', maxLimit: 50,
    },
  ],
  dimensions: [
    { key: 'severity', label: 'Severity', datasets: ['ISSUES'], valueKind: 'SEVERITY', additive: true, listSelectable: true, values: ['CRITICAL', 'HIGH'], ungroupedIn: [] },
  ],
  vocabularies: { statuses: ['IDENTIFIED'], severities: ['CRITICAL', 'HIGH'], issueTypes: ['SAST'], assetTypes: ['WEB'] },
  limits: { widgetsPerDashboard: 12, dashboardsPerOwner: 50, defaultTopN: 10, maxTopN: 50, lineSeries: 10, clientConcurrency: 3 },
};

const DASHBOARD = {
  id: '77', name: 'Board', description: '', timezone: 'UTC', lockVersion: 3, definitionVersion: 1,
  widgetCount: 1, origin: 'CREATED', createdAt: 't0', updatedAt: 't1', accessRole: 'OWNER', ownerActive: true,
  owner: { name: 'Ana', email: 'ana@example.com' }, capabilities: { canEdit: true, canDelete: true, canShare: true },
};

/** Fake execute(): picks the response by the GraphQL operation name. */
function fakeExecute(responses) {
  const calls = [];
  const execute = async (query, variables) => {
    const op = /(?:query|mutation)\s+(\w+)/.exec(query)[1];
    calls.push({ op, query, variables });
    const r = responses[op];
    if (r === undefined) throw new Error(`unexpected operation ${op}`);
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r(variables, calls) : r;
  };
  return { execute, calls };
}

function graphqlError(code, extra = {}, message = 'error') {
  const e = new Error('GraphQL error');
  e.status = 400;
  e.graphqlErrors = [message];
  e.graphqlExtensions = [{ code, ...extra }];
  return e;
}

beforeEach(() => clearCatalogCache());

test('buildDefinition fills version, time basis, latest metric version, keys, layout and editor defaults', () => {
  const def = buildDefinition({
    name: 'Postura',
    widgets: [
      { title: 'Críticas abertas', metric: 'issues.count', visualization: 'NUMBER', filters: { severities: ['CRITICAL'] } },
      { title: 'MTTR', metric: 'remediation.mttr', visualization: 'NUMBER' },
    ],
  }, CATALOG);

  assert.equal(def.definitionVersion, 1);
  assert.equal(def.timezone, 'UTC');
  assert.deepEqual(def.defaultTimeRange, { mode: 'LAST_COMPLETE_DAYS', days: 30 });
  assert.deepEqual(def.defaultFilters, { archived: 'ACTIVE' });
  const [first, second] = def.widgets;
  assert.equal(first.key, 'criticas-abertas');
  assert.deepEqual(first.metric, { key: 'issues.count', version: 1 });
  assert.equal(first.query.timeBasis, 'CURRENT');
  assert.deepEqual(first.query.filters, { severities: ['CRITICAL'] });
  assert.deepEqual(first.visualization, { kind: 'NUMBER' });
  assert.equal(first.enabled, true);
  assert.deepEqual(second.metric, { key: 'remediation.mttr', version: 2 }, 'latest version by default');
  assert.equal(second.query.timeBasis, 'EVENT_IN_PERIOD');
  assert.deepEqual(first.layout, { x: 0, y: 0, width: 3, height: 2, order: 0 });
  assert.deepEqual(second.layout, { x: 3, y: 0, width: 3, height: 2, order: 1 });
});

test('buildDefinition accepts the shorthands and snake_case spellings', () => {
  const def = buildDefinition({
    name: 'D',
    timezone: 'America/Sao_Paulo',
    period_days: 90,
    default_filters: { asset_ids: [10, 11], archived: 'ALL' },
    widgets: [
      {
        title: 'Por severidade', metric: 'issues.count@1', visualization: { kind: 'bar' },
        group_by: [{ dimension: 'severity', values: ['CRITICAL', 'HIGH'] }],
        filters: { sla_states: ['BREACHED'], asset_ids: [5] }, filter_mode: 'override', order_by: 'desc', limit: 5,
      },
      { title: 'Tendência', metric: { key: 'issues.created' }, visualization: 'LINE', parameters: { bucket: 'MONTH' }, timeRange: { mode: 'LAST_COMPLETE_DAYS', days: 180 } },
      { title: 'Vencidas', metric: 'issues.count', visualization: 'RECORD_LIST', record_list: { columns: ['title', 'dueAt'] } },
    ],
  }, CATALOG);

  assert.deepEqual(def.defaultTimeRange, { mode: 'LAST_COMPLETE_DAYS', days: 90 });
  assert.deepEqual(def.defaultFilters, { assetIds: ['10', '11'], archived: 'ALL' });
  assert.equal(def.timezone, 'America/Sao_Paulo');
  const [bars, line, list] = def.widgets;
  assert.deepEqual(bars.query.groupBy, [{ dimension: 'severity', selection: { mode: 'LIST', values: ['CRITICAL', 'HIGH'] } }]);
  assert.deepEqual(bars.query.filters, { slaStates: ['BREACHED'], assetIds: ['5'] });
  assert.equal(bars.query.filterMode, 'OVERRIDE');
  assert.deepEqual(bars.query.orderBy, { measure: 'value', direction: 'DESC' });
  assert.equal(bars.query.limit, 5);
  assert.deepEqual(bars.visualization, { kind: 'BAR' });
  assert.equal(bars.query.group_by, undefined, 'aliases do not leak into the definition');
  assert.deepEqual(line.query.parameters, { bucket: 'MONTH' });
  assert.deepEqual(line.query.timeRange, { mode: 'LAST_COMPLETE_DAYS', days: 180 });
  assert.deepEqual(list.query.recordList, { columns: ['title', 'dueAt'], sort: { column: 'title', direction: 'DESC' }, pageSize: 10 });
  assert.deepEqual(list.layout, { x: 0, y: 4, width: 12, height: 4, order: 2 }, 'RECORD_LIST defaults to FULL on a new row');
});

test('widgetKey slugs titles into unique definition keys', () => {
  const used = new Set();
  assert.equal(widgetKey('Vulnerabilidades por Ação!', used), 'vulnerabilidades-por-acao');
  assert.equal(widgetKey('Vulnerabilidades por ação', used), 'vulnerabilidades-por-acao-2');
  assert.equal(widgetKey('***', used), 'widget');
  assert.equal(widgetKey('kept', used, 'my-key'), 'my-key', 'a valid preferred key is kept');
  assert.equal(widgetKey('Other', used, 'my-key'), 'other', 'a taken preferred key is replaced');
  assert.equal(widgetKey('x', used, 'Not Valid'), 'x');
  const long = widgetKey('a'.repeat(80), used);
  assert.match(long, /^[a-z0-9][a-z0-9-]{0,63}$/);
  assert.match(widgetKey('a'.repeat(80), used), /^a+-2$/);
  assert.ok(widgetKey('a'.repeat(80), used).length <= 64);
});

test('packLayout flows left to right and wraps like the platform editor', () => {
  const sizes = [[3, 2], [3, 2], [3, 2], [3, 2], [6, 4], [8, 4], [6, 4]];
  const widgets = sizes.map(([width, height], order) => ({ key: `w${order}`, layout: { x: 0, y: 0, width, height, order } }));
  const placed = packLayout(widgets).map((w) => [w.layout.x, w.layout.y]);
  assert.deepEqual(placed, [[0, 0], [3, 0], [6, 0], [9, 0], [0, 2], [0, 6], [0, 10]]);
});

test('size presets override the default and existing widgets keep their size and key', () => {
  const base = {
    definitionVersion: 1, name: 'B', description: 'x', timezone: 'UTC',
    defaultTimeRange: { mode: 'LAST_COMPLETE_DAYS', days: 30 }, defaultFilters: {},
    widgets: [{
      key: 'old-key', title: 'Antigo', metric: { key: 'issues.count', version: 1 },
      query: { timeBasis: 'CURRENT', groupBy: [{ dimension: 'severity', selection: { mode: 'ALL' } }], filters: {} },
      visualization: { kind: 'BAR' }, layout: { x: 4, y: 0, width: 8, height: 6, order: 0 }, enabled: false,
    }],
  };
  const def = buildDefinition({
    widgets: [
      { title: 'Novo', metric: 'issues.count', visualization: 'NUMBER', size: 'WIDE' },
      ...base.widgets,
    ],
  }, CATALOG, base);

  assert.equal(def.name, 'B', 'fields left out keep their value');
  assert.equal(def.description, 'x');
  const [added, kept] = def.widgets;
  assert.deepEqual(added.layout, { x: 0, y: 0, width: 8, height: 4, order: 0 });
  assert.equal(kept.key, 'old-key');
  assert.deepEqual(kept.query.groupBy, [{ dimension: 'severity', selection: { mode: 'ALL' } }]);
  assert.deepEqual(kept.layout, { x: 0, y: 4, width: 8, height: 6, order: 1 });
  assert.equal(kept.enabled, false);
});

test('without widgets an update keeps the current widget list untouched', () => {
  const base = { definitionVersion: 1, name: 'B', timezone: 'UTC', defaultTimeRange: { mode: 'ABSOLUTE', startDate: '2026-01-01', endDate: '2026-03-31' }, defaultFilters: {}, widgets: [{ key: 'k', layout: { x: 6, y: 9, width: 3, height: 2, order: 4 } }] };
  const def = buildDefinition({ name: 'Renamed', period_days: 7 }, CATALOG, base);
  assert.equal(def.name, 'Renamed');
  assert.deepEqual(def.defaultTimeRange, { mode: 'LAST_COMPLETE_DAYS', days: 7 });
  assert.equal(def.widgets, base.widgets);
});

test('buildDefinition rejects what it cannot assemble, with a safe message', () => {
  const ok = { title: 'T', metric: 'issues.count', visualization: 'NUMBER' };
  const unknown = (() => { try { buildDefinition({ name: 'D', widgets: [{ ...ok, metric: 'nope.metric' }] }, CATALOG); } catch (e) { return e; } })();
  assert.equal(unknown.status, 400);
  assert.match(unknown.publicMessage, /unknown metric 'nope\.metric'/);
  assert.ok(unknown.publicData.available_metrics.includes('issues.count@1'));

  assert.throws(() => buildDefinition({ name: 'D', widgets: [{ ...ok, metric: 'issues.count@9' }] }, CATALOG),
    (e) => e.status === 400 && e.publicData.available_versions[0] === 1);
  assert.throws(() => buildDefinition({ name: 'D', widgets: Array(13).fill(ok) }, CATALOG),
    (e) => /at most 12 widgets/.test(e.publicMessage));
  assert.throws(() => buildDefinition({ name: 'D', widgets: [{ ...ok, title: ' ' }] }, CATALOG), (e) => /needs a title/.test(e.publicMessage));
  assert.throws(() => buildDefinition({ name: 'D', widgets: [{ ...ok, visualization: undefined }] }, CATALOG), (e) => /needs a visualization/.test(e.publicMessage));
  assert.throws(() => buildDefinition({ name: 'D', widgets: [{ ...ok, size: 'HUGE' }] }, CATALOG), (e) => /size must be one of/.test(e.publicMessage));
  assert.throws(() => buildDefinition({ widgets: [ok] }, CATALOG), (e) => e.publicMessage === 'name is required.');
  assert.throws(() => buildDefinition({ name: 'D', widgets: [] }, CATALOG), (e) => /at least one widget/.test(e.publicMessage));
});

test('parseMetricRef reads the three spellings', () => {
  assert.deepEqual(parseMetricRef('issues.count'), { key: 'issues.count', version: undefined });
  assert.deepEqual(parseMetricRef('issues.count@2'), { key: 'issues.count', version: 2 });
  assert.deepEqual(parseMetricRef({ key: 'issues.count', version: '1' }), { key: 'issues.count', version: 1 });
});

test('mapDashboardError locates validation errors per widget and translates the error codes', () => {
  const definition = { widgets: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }] };
  const invalid = mapDashboardError(graphqlError('INVALID_DEFINITION', {
    details: [
      { path: '/widgets/1/visualization/kind', code: 'UNSUPPORTED_COMBINATION', message: 'is not supported for this metric and grouping' },
      { path: '/timezone', code: 'INVALID_TIMEZONE', message: 'must be an IANA time zone identifier' },
    ],
  }), { definition });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.publicData.validation_errors, [
    { path: '/widgets/1/visualization/kind', code: 'UNSUPPORTED_COMBINATION', message: 'is not supported for this metric and grouping', widget: { index: 1, key: 'b', title: 'B' } },
    { path: '/timezone', code: 'INVALID_TIMEZONE', message: 'must be an IANA time zone identifier' },
  ]);

  const denied = mapDashboardError(graphqlError('NOT_AUTHORIZED'), { companyId: 443 });
  assert.equal(denied.status, 403);
  assert.match(denied.authHint, /Metrics Studio permission.*443/);
  assert.equal(mapDashboardError(graphqlError('CUSTOM_DASHBOARD_CONFLICT', { reason: 'STALE_REVISION' })).status, 409);
  assert.equal(mapDashboardError(graphqlError('RECORD_NOT_FOUND')).status, 404);
  const limit = mapDashboardError(graphqlError('LIMIT_EXCEEDED', {}, 'A user can have at most 50 dashboards in a company'));
  assert.equal(limit.publicMessage, 'A user can have at most 50 dashboards in a company');

  const other = new Error('boom');
  assert.equal(mapDashboardError(other), other, 'unknown errors pass through to sanitizeError');
});

test('create sends the assembled definition and returns the links; the catalog is cached', async () => {
  const { execute, calls } = fakeExecute({
    CustomDashboardCatalog: { customDashboardMetricCatalog: CATALOG },
    CreateCustomDashboard: (v) => ({
      createCustomDashboard: { customDashboard: { ...DASHBOARD, lockVersion: 0, definition: v.input.definition } },
    }),
  });
  const args = { company_id: 443, name: 'Board', widgets: [{ title: 'Total', metric: 'issues.count', visualization: 'NUMBER' }] };
  const out = await createCustomDashboard(execute, args, { appUrl: APP });
  await createCustomDashboard(execute, args, { appUrl: APP });

  assert.equal(calls.filter((c) => c.op === 'CustomDashboardCatalog').length, 1);
  const create = calls.find((c) => c.op === 'CreateCustomDashboard');
  assert.equal(create.variables.input.companyId, 443);
  assert.equal(create.variables.input.definition.widgets[0].key, 'total');
  assert.equal(out.created, true);
  assert.equal(out.dashboard.id, '77');
  assert.equal(out.dashboard.lock_version, 0);
  assert.equal(out.dashboard.url, `${APP}/spa/company/443/dashboards/custom/77`);
  assert.equal(out.dashboard.edit_url, `${APP}/spa/company/443/dashboards/custom/77/edit`);
  assert.deepEqual(out.widgets, [{ key: 'total', title: 'Total', metric: 'issues.count@1', visualization: 'NUMBER', group_by: [], layout: { x: 0, y: 0, width: 3, height: 2, order: 0 } }]);
  assert.ok(out.notes.some((n) => /private/.test(n)));
});

test('create maps a server validation error back to the widget that caused it', async () => {
  const { execute } = fakeExecute({
    CustomDashboardCatalog: { customDashboardMetricCatalog: CATALOG },
    CreateCustomDashboard: graphqlError('INVALID_DEFINITION', {
      details: [{ path: '/widgets/0/query/groupBy', code: 'UNSUPPORTED_COMBINATION', message: 'is not a supported grouping for this metric' }],
    }),
  });
  await assert.rejects(
    createCustomDashboard(execute, { company_id: 1, name: 'D', widgets: [{ title: 'Por time', metric: 'issues.created', visualization: 'LINE', groupBy: ['assigned_team'] }] }),
    (e) => e.status === 400 && e.publicData.validation_errors[0].widget.title === 'Por time',
  );
});

test('dry_run previews each widget alone, saves nothing and reports per-widget problems', async () => {
  const previews = [];
  const { execute, calls } = fakeExecute({
    CustomDashboardCatalog: { customDashboardMetricCatalog: CATALOG },
    PreviewCustomDashboardWidget: (v) => {
      previews.push(v.definition);
      const [widget] = v.definition.widgets;
      if (widget.key === 'broken') {
        throw graphqlError('INVALID_DEFINITION', { details: [
          { path: '/widgets/0/visualization/kind', code: 'UNSUPPORTED_COMBINATION', message: 'is not supported for this metric and grouping' },
        ] });
      }
      if (widget.key === 'slow') throw graphqlError('LIMIT_EXCEEDED', {}, 'The request took too long; narrow it and try again');
      return { previewCustomDashboardWidget: {
        widgetKey: widget.key, state: 'READY', reasonCode: null, errors: [], measure: { label: 'Vulnerabilities', unit: 'count' },
        buckets: [], total: 42, totalSampleSize: null, truncated: false, notes: [], unavailableReferences: [],
        rows: [{ groups: [{ dimension: 'severity', key: 'CRITICAL', label: 'Critical', ungrouped: false, unavailable: false }], bucketIndex: null, value: 42 }],
      } };
    },
  });
  const out = await createCustomDashboard(execute, {
    company_id: 1, name: 'D', dry_run: true,
    widgets: [
      { title: 'Ok', metric: 'issues.count', visualization: 'BAR', groupBy: ['severity'] },
      { title: 'Broken', metric: 'issues.count', visualization: 'LINE' },
      { title: 'Slow', metric: 'issues.count', visualization: 'NUMBER' },
    ],
  });

  assert.ok(!calls.some((c) => c.op === 'CreateCustomDashboard'), 'nothing is saved');
  assert.equal(previews.length, 3);
  assert.ok(previews.every((d) => d.widgets.length === 1 && d.name === 'D'));
  assert.equal(out.dry_run, true);
  assert.equal(out.valid, false);
  const [ok, broken, slow] = out.widgets;
  assert.equal(ok.preview.state, 'READY');
  assert.equal(ok.preview.total, 42);
  assert.deepEqual(ok.preview.sample_rows, [{ groups: ['Critical'], value: 42 }]);
  assert.equal(broken.preview.state, 'INVALID_CONFIGURATION');
  assert.equal(broken.preview.validation_errors[0].path, '/widgets/1/visualization/kind', 'path points into the full dashboard');
  assert.equal(broken.preview.validation_errors[0].widget.index, 1);
  assert.deepEqual(slow.preview, { state: 'ERROR', message: 'The request took too long; narrow it and try again' });
});

test('dry_run reports dashboard-level errors once and stops on authorization errors', async () => {
  const { execute } = fakeExecute({
    CustomDashboardCatalog: { customDashboardMetricCatalog: CATALOG },
    PreviewCustomDashboardWidget: () => { throw graphqlError('INVALID_DEFINITION', { details: [{ path: '/timezone', code: 'INVALID_TIMEZONE', message: 'must be an IANA time zone identifier' }] }); },
  });
  const widgets = [{ title: 'A', metric: 'issues.count', visualization: 'NUMBER' }, { title: 'B', metric: 'issues.count', visualization: 'NUMBER' }];
  const out = await createCustomDashboard(execute, { company_id: 1, name: 'D', timezone: 'Mars/Base', dry_run: true, widgets });
  assert.equal(out.valid, false);
  assert.equal(out.dashboard_errors.length, 1);
  assert.ok(out.widgets.every((w) => w.preview.state === 'NOT_COMPUTED'));

  clearCatalogCache();
  const denied = fakeExecute({
    CustomDashboardCatalog: { customDashboardMetricCatalog: CATALOG },
    PreviewCustomDashboardWidget: () => { throw graphqlError('NOT_AUTHORIZED'); },
  });
  await assert.rejects(createCustomDashboard(denied.execute, { company_id: 1, name: 'D', dry_run: true, widgets }), (e) => e.status === 403);
});

test('update checks the revision and edit access before writing, then sends expectedVersion', async () => {
  const definition = {
    definitionVersion: 1, name: 'Board', description: '', timezone: 'UTC',
    defaultTimeRange: { mode: 'LAST_COMPLETE_DAYS', days: 30 }, defaultFilters: { archived: 'ACTIVE' },
    widgets: [{ key: 'total', title: 'Total', metric: { key: 'issues.count', version: 1 }, query: { timeBasis: 'CURRENT' }, visualization: { kind: 'NUMBER' }, layout: { x: 0, y: 0, width: 3, height: 2, order: 0 }, enabled: true }],
  };
  const responses = {
    CustomDashboard: { customDashboard: { ...DASHBOARD, definition } },
    CustomDashboardCatalog: { customDashboardMetricCatalog: CATALOG },
    UpdateCustomDashboard: (v) => ({ updateCustomDashboard: { customDashboard: { ...DASHBOARD, lockVersion: 4, name: v.input.definition.name, definition: v.input.definition } } }),
  };

  await assert.rejects(updateCustomDashboard(fakeExecute(responses).execute, { company_id: 1, dashboard_id: 77 }), (e) => e.status === 400 && /expected_version/.test(e.publicMessage));

  const stale = fakeExecute(responses);
  await assert.rejects(updateCustomDashboard(stale.execute, { company_id: 1, dashboard_id: 77, expected_version: 2, name: 'X' }), (e) => e.status === 409);
  assert.ok(!stale.calls.some((c) => c.op === 'UpdateCustomDashboard'));

  const readOnly = fakeExecute({ ...responses, CustomDashboard: { customDashboard: { ...DASHBOARD, capabilities: { canEdit: false }, definition } } });
  await assert.rejects(updateCustomDashboard(readOnly.execute, { company_id: 1, dashboard_id: 77, expected_version: 3, name: 'X' }), (e) => e.status === 403);

  const ok = fakeExecute(responses);
  const out = await updateCustomDashboard(ok.execute, { company_id: 1, dashboard_id: 77, expected_version: 3, name: 'Renamed' }, { appUrl: APP });
  const update = ok.calls.find((c) => c.op === 'UpdateCustomDashboard');
  assert.deepEqual(
    { id: update.variables.input.id, expectedVersion: update.variables.input.expectedVersion, companyId: update.variables.input.companyId },
    { id: '77', expectedVersion: 3, companyId: 1 },
  );
  assert.equal(update.variables.input.definition.name, 'Renamed');
  assert.deepEqual(update.variables.input.definition.widgets, definition.widgets);
  assert.equal(out.updated, true);
  assert.equal(out.dashboard.lock_version, 4);
});

test('list and get return summaries with links and the canonical definition', async () => {
  const { execute, calls } = fakeExecute({
    CustomDashboards: { customDashboards: { collection: [DASHBOARD], metadata: { currentPage: 1, totalPages: 1, totalCount: 1, limitValue: 25 } } },
    CustomDashboard: { customDashboard: { ...DASHBOARD, definition: { name: 'Board', widgets: [] } } },
  });
  const list = await listCustomDashboards(execute, { company_id: 5, ownership: 'ALL' }, { appUrl: APP });
  assert.deepEqual(calls[0].variables, { companyId: 5, ownership: 'ALL', page: 1, limit: 25 });
  assert.equal(list.dashboards[0].url, `${APP}/spa/company/5/dashboards/custom/77`);
  assert.equal(list.dashboards[0].can_edit, true);
  assert.equal(list.dashboards[0].description, undefined);
  assert.equal(list.metadata.totalCount, 1);

  const one = await getCustomDashboard(execute, { company_id: 5, dashboard_id: 77 }, { appUrl: APP });
  assert.equal(calls[1].variables.id, '77');
  assert.deepEqual(one.definition, { name: 'Board', widgets: [] });
  assert.equal(one.dashboard.lock_version, 3);

  const missing = fakeExecute({ CustomDashboard: { customDashboard: null } });
  await assert.rejects(getCustomDashboard(missing.execute, { company_id: 5, dashboard_id: 1 }), (e) => e.status === 404);
});

test('summarizeCatalog and summarizePreview give the model compact shapes', () => {
  const summary = summarizeCatalog(CATALOG);
  const count = summary.metrics.find((m) => m.metric === 'issues.count@1');
  assert.deepEqual(count.visualizations, { 0: ['NUMBER', 'RECORD_LIST'], 1: ['TABLE', 'BAR', 'HORIZONTAL_BAR'] });
  assert.ok(count.record_list_columns.includes('dueAt'));
  assert.equal(count.parameters, undefined);
  const created = summary.metrics.find((m) => m.metric === 'issues.created@1');
  assert.deepEqual(created.parameters, [{ key: 'bucket', kind: 'ENUM', values: ['DAY', 'WEEK', 'MONTH'], default: 'WEEK' }]);
  assert.equal(summary.dimensions[0].ungrouped_in, undefined);
  assert.ok(summary.widget_sizes.FULL);

  const preview = summarizePreview({
    state: 'READY', errors: [], buckets: [{ index: 0, start: '2026-11-01T00:00:00Z', end: 'x' }], notes: ['HISTORY_INCOMPLETE'],
    rows: Array.from({ length: 8 }, (_, i) => ({ groups: [{ key: null, label: null, ungrouped: true, unavailable: false }], bucketIndex: 0, value: i })),
    total: 8, truncated: true,
  }, { key: 'k', title: 'T' });
  assert.equal(preview.row_count, 8);
  assert.equal(preview.sample_rows.length, 5);
  assert.deepEqual(preview.sample_rows[0], { groups: ['(ungrouped)'], bucket_start: '2026-11-01T00:00:00Z', value: 0 });
  assert.equal(preview.truncated, true);
  assert.deepEqual(preview.notes, ['HISTORY_INCOMPLETE']);
});

test('the module sends only the dedicated mutations, which stay out of execute_mutation', () => {
  const sent = [];
  for (const value of Object.values(dashboards)) {
    if (typeof value !== 'string' || !/^\s*mutation\b/.test(value)) continue;
    sent.push(/mutation\s+\w+\([^)]*\)\s*{\s*(\w+)/.exec(value)[1]);
  }
  assert.deepEqual(sent.sort(), [...DEDICATED_MUTATIONS].sort());
  for (const name of DEDICATED_MUTATIONS) assert.equal(isKnownMutation(name), false, `${name} must not be in the generic catalog`);
});

test('GraphQLClient keeps error extensions so validation details reach the tool result', async () => {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const { query } = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      if (/CustomDashboardCatalog/.test(query)) {
        res.end(JSON.stringify({ data: { customDashboardMetricCatalog: CATALOG } }));
        return;
      }
      res.end(JSON.stringify({
        data: null,
        errors: [{
          message: 'The dashboard definition is invalid',
          extensions: { code: 'INVALID_DEFINITION', details: [{ path: '/widgets/0/title', code: 'INVALID_VALUE', message: 'must not be blank' }] },
        }],
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const client = new GraphQLClient(`http://127.0.0.1:${port}/graphql`, 'test-key');
    assert.equal(client.appUrl, `http://127.0.0.1:${port}`);
    await assert.rejects(
      client.create_custom_dashboard({ company_id: 1, name: 'D', widgets: [{ title: 'T', metric: 'issues.count', visualization: 'NUMBER' }] }),
      (e) => e.status === 400 && e.publicData.validation_errors[0].widget.title === 'T',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
