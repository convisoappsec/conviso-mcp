import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeMutation } from '../src/conviso_mcp/mutations.js';

test('describeMutation returns the input schema with required fields', () => {
  const d = describeMutation('changeIssueStatus');
  assert.equal(d.inputType, 'ChangeIssueStatusInput');
  assert.ok(Array.isArray(d.input));
  const required = d.input.filter((f) => f.required).map((f) => f.name);
  assert.ok(required.includes('id'), 'id is required');
  assert.ok(required.includes('status'), 'status is required');
  assert.ok(d.defaultReturnFields, 'exposes default return fields');
});

test('describeMutation inlines enum values for enum fields', () => {
  const d = describeMutation('changeIssueStatus');
  const status = d.input.find((f) => f.name === 'status');
  assert.ok(Array.isArray(status.enumValues));
  assert.ok(status.enumValues.includes('FALSE_POSITIVE'));
});

test('describeMutation reports an error for unknown names', () => {
  const d = describeMutation('nopeNotReal');
  assert.ok(d.error);
});
