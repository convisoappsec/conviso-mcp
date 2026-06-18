// node/test/filters.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as f from '../src/conviso_mcp/filters.js';

test('normalizeEnumList uppercases and filters unknown', () => {
  assert.deepEqual(f.normalizeEnumList(['critical', 'High', 'bogus'], f.SEVERITIES), ['CRITICAL', 'HIGH']);
});

test('normalizeEnumList empty/null', () => {
  assert.deepEqual(f.normalizeEnumList(null, f.SEVERITIES), []);
  assert.deepEqual(f.normalizeEnumList([], f.SEVERITIES), []);
});

test('normalizeEnumList lowercase allowed for asset sort', () => {
  assert.deepEqual(f.normalizeEnumList(['RISK_SCORE', 'Name'], f.ASSET_SORT_BY, false), ['risk_score', 'name']);
});

test('normalizeEnum single', () => {
  assert.equal(f.normalizeEnum('internal', f.EXPLOITABILITY), 'INTERNAL');
  assert.equal(f.normalizeEnum('nope', f.EXPLOITABILITY), null);
  assert.equal(f.normalizeEnum(null, f.EXPLOITABILITY), null);
});

test('buildDateRange', () => {
  assert.deepEqual(f.buildDateRange('2026-01-01', '2026-02-01'), { startDate: '2026-01-01', endDate: '2026-02-01' });
  assert.deepEqual(f.buildDateRange('2026-01-01', null), { startDate: '2026-01-01' });
  assert.equal(f.buildDateRange(null, null), null);
});

test('buildIssueSortOptions', () => {
  assert.deepEqual(f.buildIssueSortOptions('severity', 'asc'), [{ sortBy: 'SEVERITY', order: 'ASC' }]);
  assert.deepEqual(f.buildIssueSortOptions('bogus', 'desc'), []);
  assert.deepEqual(f.buildIssueSortOptions(null, null), []);
});

test('prune drops empty', () => {
  assert.deepEqual(f.prune({ a: 1, b: null, c: [], d: '', e: {}, f: [1] }), { a: 1, f: [1] });
});
