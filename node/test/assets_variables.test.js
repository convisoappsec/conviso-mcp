import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAssetsVariables } from '../src/conviso_mcp/graphql_client.js';

test('assets search built and normalized', () => {
  const v = buildAssetsVariables(248, 1, 20, {
    name: 'api',
    businessImpact: ['high', 'bogus'],
    exploitability: ['internet_facing'],
    sortBy: 'RISK_SCORE',
    order: 'asc',
    environmentCompromised: true,
  });
  const s = v.search;
  assert.equal(v.companyId, 248);
  assert.equal(v.page, 1);
  assert.equal(v.limit, 20);
  assert.equal(s.name, 'api');
  assert.deepEqual(s.businessImpact, ['HIGH']);
  assert.deepEqual(s.exploitability, ['INTERNET_FACING']);
  assert.equal(s.sortBy, 'risk_score');
  assert.equal(s.order, 'ASC');
  assert.equal(s.environmentCompromised, true);
});

test('assets search empty is omitted', () => {
  const v = buildAssetsVariables(248, 1, 20);
  assert.deepEqual(v.search, {});
});
