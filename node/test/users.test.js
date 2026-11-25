import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphQLClient, withScopeWarning } from '../src/conviso_mcp/graphql_client.js';

function mockClient(response) {
  const client = new GraphQLClient('https://example.invalid/graphql', 'test');
  const calls = [];
  client.execute = async (query, variables) => {
    calls.push({ query, variables });
    return response;
  };
  return { client, calls };
}

// `visible` is the unfiltered probe (`visibility` alias); `ids` the requested, possibly filtered, page.
const page = (ids, callerId = '1', visible = ids) => ({
  currentUserProfile: { id: callerId },
  visibility: {
    collection: visible.slice(0, 2).map((id) => ({ id })),
    metadata: { totalCount: visible.length },
  },
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
  // Unfiltered probe of the same scope; `params: {}` must stay literal (resolver has no default).
  assert.match(query, /visibility: portalUserByCompany\(companyId: \$companyId, page: 1, limit: 2, params: {}\)\s*{\s*collection\s*{\s*id\s*}\s*metadata\s*{\s*totalCount\s*}\s*}/);
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
  // The probe stays out of the model's context.
  assert.equal(result.visibility, undefined);
});

test('withScopeWarning warns on every shape a key without permission gets back', () => {
  // User key, no filters: caller only.
  assert.ok(withScopeWarning(page(['1'], '1')).warning);
  // User key, search that misses the caller (or page > 1): empty page, probe holds the caller.
  assert.ok(withScopeWarning(page([], '1', ['1'])).warning);
  // Company service key: the service caller is filtered out too, so probe and page are empty.
  assert.ok(withScopeWarning(page([], '1', [])).warning);
});

test('withScopeWarning leaves real company lists untouched', () => {
  // Several users, including the caller.
  assert.equal(withScopeWarning(page(['1', '2', '3'], '1')).warning, undefined);
  // A single user who is not the caller.
  assert.equal(withScopeWarning(page(['2'], '1')).warning, undefined);
  // Search with no match in a company the key can see.
  assert.equal(withScopeWarning(page([], '1', ['1', '2'])).warning, undefined);
  // Search that matches only the caller in a company the key can see.
  assert.equal(withScopeWarning(page(['1'], '1', ['1', '2'])).warning, undefined);
  // No probe in the response: nothing to decide on.
  assert.equal(withScopeWarning({ portalUserByCompany: page(['1']).portalUserByCompany }).warning, undefined);
});

test('withScopeWarning compares ids regardless of string/number type', () => {
  assert.ok(withScopeWarning(page(['42'], 42)).warning);
});
