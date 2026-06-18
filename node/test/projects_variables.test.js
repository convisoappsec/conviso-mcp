import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectsVariables } from '../src/conviso_mcp/graphql_client.js';

test('projects params built', () => {
  const v = buildProjectsVariables(248, 1, 50, {
    search: 'api',
    statuses: ['Fixing'],
    projectTypes: ['Pentest'],
    createdAfter: '2026-01-01',
    createdBefore: '2026-02-01',
    tags: ['pci'],
    analystEmails: ['a@x.com'],
  });
  const p = v.params;
  assert.equal(p.scopeIdEq, 248);
  assert.equal(p.labelCont, 'api');
  assert.deepEqual(p.projectStatusLabelIn, ['Fixing']);
  assert.deepEqual(p.projectTypeLabelIn, ['Pentest']);
  assert.equal(p.createdAtGteq, '2026-01-01');
  assert.equal(p.createdAtLteq, '2026-02-01');
  assert.deepEqual(p.tags, ['pci']);
  assert.deepEqual(p.analystsEmailIn, ['a@x.com']);
  assert.equal(v.sortBy, 'createdAt');
  assert.equal(v.descending, true);
});

test('projects params minimal omits empty', () => {
  const v = buildProjectsVariables(248, 1, 50);
  assert.deepEqual(v.params, { scopeIdEq: 248 });
});
