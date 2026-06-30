import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMutationQuery } from '../src/conviso_mcp/mutations.js';

test('buildMutationQuery builds a single-input mutation document', () => {
  const { query, variables } = buildMutationQuery('changeIssueStatus', {
    input: { id: 5, status: 'FALSE_POSITIVE' },
  });
  assert.match(query, /mutation ChangeIssueStatus\(\$input: ChangeIssueStatusInput!\)/);
  assert.match(query, /changeIssueStatus\(input: \$input\)/);
  assert.match(query, /clientMutationId/);
  assert.deepEqual(variables, { input: { id: 5, status: 'FALSE_POSITIVE' } });
});

test('return_fields overrides the default payload selection', () => {
  const { query } = buildMutationQuery('createProject', { input: {} }, 'project { id label }');
  assert.match(query, /project \{ id label \}/);
  assert.doesNotMatch(query, /clientMutationId errors/);
});

test('variables pass through untouched', () => {
  const vars = { input: { companyId: 1, name: 'x', tagsTagList: ['a'] } };
  const { variables } = buildMutationQuery('createAsset', vars);
  assert.deepEqual(variables, vars);
});

test('unknown mutation throws (whitelist)', () => {
  assert.throws(() => buildMutationQuery('nopeNotReal'), /Unknown mutation/);
});
