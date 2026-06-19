import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTopVulnsVariables } from '../src/conviso_mcp/graphql_client.js';

test('no filters omits filters key', () => {
  const v = buildTopVulnsVariables(248);
  assert.deepEqual(v, { companyId: 248 });
});

test('filters built and normalized', () => {
  const v = buildTopVulnsVariables(248, {
    severities: ['critical'],
    statuses: ['identified'],
    assetIds: [7],
    assetTags: ['pci'],
    createdAfter: '2026-01-01',
  });
  const fl = v.filters;
  assert.deepEqual(fl.severities, ['CRITICAL']);
  assert.deepEqual(fl.statuses, ['IDENTIFIED']);
  assert.deepEqual(fl.assetIds, [7]);
  assert.deepEqual(fl.assetTags, ['pci']);
  assert.deepEqual(fl.createdAtRange, { startDate: '2026-01-01' });
});
