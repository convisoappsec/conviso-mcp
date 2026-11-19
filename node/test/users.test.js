import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphQLClient, withSelfScopeWarning } from '../src/conviso_mcp/graphql_client.js';

function mockClient(response) {
  const client = new GraphQLClient('https://example.invalid/graphql', 'test');
  const calls = [];
  client.execute = async (query, variables) => {
    calls.push({ query, variables });
    return response;
  };
  return { client, calls };
}

const page = (ids, callerId = '1') => ({
  currentUserProfile: { id: callerId },
  portalUserByCompany: {
    collection: ids.map((id) => ({ id })),
    metadata: { totalCount: ids.length },
  },
});

test('get_users requests users, direct and team profiles, caller id and pagination metadata', async () => {
  const { client, calls } = mockClient(page([]));

  await client.get_users(430);

  const [{ query, variables }] = calls;
  assert.match(query, /currentUserProfile\s*{\s*id\s*}/);
  assert.match(query, /portalUserByCompany\(companyId: \$companyId, page: \$page, limit: \$limit, params: \$params\)/);
  assert.match(query, /\$params: PortalUserSearch/);
  assert.match(query, /id name email blocked inactive kind createdAt updatedAt/);
  assert.match(query, /profile\(companyId: \$companyId\)\s*{\s*name\s*}/);
  // Team profiles: a user may have access only through a team (direct profile null).
  assert.match(query, /teams\(companyId: \$companyId\)\s*{\s*id label profiles\s*{\s*name\s*}\s*}/);
  assert.match(query, /metadata\s*{\s*totalCount totalPages currentPage limitValue\s*}/);
  // Sensitive account-security fields stay out of the LLM context.
  assert.doesNotMatch(query, /twoFactor|\bsso\b/);
  assert.deepEqual(variables, { companyId: 430, page: 1, limit: 25, params: {} });
});

test('get_users maps search and activeOnly into PortalUserSearch params', async () => {
  const { client, calls } = mockClient(page([]));

  await client.get_users(430, { page: 2, limit: 10, search: 'ana', activeOnly: true });

  assert.deepEqual(calls[0].variables, {
    companyId: 430,
    page: 2,
    limit: 10,
    params: { search: 'ana', activeOnly: true },
  });
});

test('get_users keeps activeOnly=false and drops empty search', async () => {
  const { client, calls } = mockClient(page([]));

  await client.get_users(430, { search: '', activeOnly: false });

  assert.deepEqual(calls[0].variables.params, { activeOnly: false });
});

test('get_users warns when the Platform scopes the list down to the caller', async () => {
  const { client } = mockClient(page(['9809'], '9809'));

  const result = await client.get_users(600);

  assert.match(result.warning, /lacks permission to view users/);
  assert.equal(result.portalUserByCompany.metadata.totalCount, 1);
});

test('withSelfScopeWarning leaves real company lists untouched', () => {
  // Several users, including the caller.
  assert.equal(withSelfScopeWarning(page(['1', '2', '3'], '1')).warning, undefined);
  // A single user who is not the caller.
  assert.equal(withSelfScopeWarning(page(['2'], '1')).warning, undefined);
  // Empty result (e.g. search with no match).
  assert.equal(withSelfScopeWarning(page([], '1')).warning, undefined);
  // Caller id unavailable.
  assert.equal(withSelfScopeWarning({ portalUserByCompany: page(['1']).portalUserByCompany }).warning, undefined);
});

test('withSelfScopeWarning compares ids regardless of string/number type', () => {
  assert.ok(withSelfScopeWarning(page(['42'], 42)).warning);
});
