import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIssuesVariables } from '../src/conviso_mcp/graphql_client.js';

const v = (opts = {}) => buildIssuesVariables(248, 1, 10, opts);

test('minimal', () => {
  const r = v();
  assert.equal(r.companyId, 248);
  assert.deepEqual(r.pagination, { page: 1, perPage: 10 });
  assert.deepEqual(r.filters, {});
  assert.deepEqual(r.sortOptions, []);
});

test('enums normalized and pruned', () => {
  const r = v({ severities: ['critical', 'bogus'], statuses: ['identified'], slaStates: ['breached'] });
  assert.deepEqual(r.filters.severities, ['CRITICAL']);
  assert.deepEqual(r.filters.statuses, ['IDENTIFIED']);
  assert.deepEqual(r.filters.slaStates, ['BREACHED']);
});

test('dates, search, sort', () => {
  const r = v({ createdAfter: '2026-01-01', createdBefore: '2026-02-01', search: 'sql', sortBy: 'severity', order: 'asc' });
  assert.deepEqual(r.filters.createdAtRange, { startDate: '2026-01-01', endDate: '2026-02-01' });
  assert.equal(r.filters.partialTitle, 'sql');
  assert.deepEqual(r.sortOptions, [{ sortBy: 'SEVERITY', order: 'ASC' }]);
});

test('ids and extraFilters merge', () => {
  const r = v({ projectId: 5, assetIds: [7, 8], issueIds: [1], extraFilters: { cves: ['CVE-2021-1'], compromisedEnvironment: true } });
  assert.deepEqual(r.filters.projectIds, [5]);
  assert.deepEqual(r.filters.assetIds, [7, 8]);
  assert.deepEqual(r.filters.ids, [1]);
  assert.deepEqual(r.filters.cves, ['CVE-2021-1']);
  assert.equal(r.filters.compromisedEnvironment, true);
});
