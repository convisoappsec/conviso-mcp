import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog, isKnownMutation } from '../src/conviso_mcp/mutations.js';
import { ALLOWED_MUTATIONS } from '../src/conviso_mcp/operation_allowlist.js';

test('catalog is restricted to exactly the allowlist', () => {
  const c = getCatalog();
  const names = c.mutations.map((m) => m.name).sort();
  assert.equal(names.length, ALLOWED_MUTATIONS.length);
  assert.equal(c.mutations.length, c.mutationCount);
  assert.deepEqual(names, [...ALLOWED_MUTATIONS].sort());
});

test('disallowed mutations are absent from the catalog', () => {
  for (const banned of ['deleteAsset', 'createCompany', 'createSlackIntegration', 'deleteTeam', 'addTicketMessage']) {
    assert.equal(isKnownMutation(banned), false, `${banned} must not be in the catalog`);
  }
});

test('every mutation is single-input Relay shape with a payload selection', () => {
  const c = getCatalog();
  for (const m of c.mutations) {
    assert.equal(m.args.length, 1, `${m.name} should take one arg`);
    assert.equal(m.args[0].name, 'input', `${m.name} arg should be 'input'`);
    assert.ok(m.inputType, `${m.name} should have an inputType`);
    assert.ok(c.inputs[m.inputType], `${m.name} inputType ${m.inputType} should be in inputs map`);
    assert.ok(m.payloadSelection, `${m.name} should have a payloadSelection`);
  }
});

test('changeIssueStatus is catalogued correctly', () => {
  const c = getCatalog();
  const m = c.mutations.find((x) => x.name === 'changeIssueStatus');
  assert.ok(m, 'changeIssueStatus exists');
  assert.equal(m.inputType, 'ChangeIssueStatusInput');
  assert.equal(m.destructive, false);
  assert.equal(m.category, 'issue');
});

test('bulk delete mutations are flagged destructive', () => {
  const c = getCatalog();
  const del = c.mutations.find((x) => x.name === 'bulkDeleteIssues');
  assert.ok(del, 'bulkDeleteIssues exists (allowlisted)');
  assert.equal(del.destructive, true);
});

test('isKnownMutation enforces the whitelist', () => {
  assert.equal(isKnownMutation('createProject'), true);
  assert.equal(isKnownMutation('totallyFakeMutation'), false);
});
