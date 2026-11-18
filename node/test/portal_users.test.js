import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphQLClient } from '../src/conviso_mcp/graphql_client.js';

function mockClient(response) {
  const client = new GraphQLClient('https://example.invalid/graphql', 'test');
  const calls = [];
  client.execute = async (query, variables) => {
    calls.push({ query, variables });
    return response;
  };
  return { client, calls };
}

test('get_portal_users requests users with profile, teams and pagination metadata', async () => {
  const { client, calls } = mockClient({
    portalUserByCompany: { collection: [], metadata: { totalCount: 0 } },
  });

  const result = await client.get_portal_users(430);

  assert.equal(result.portalUserByCompany.metadata.totalCount, 0);
  const [{ query, variables }] = calls;
  assert.match(query, /portalUserByCompany\(companyId: \$companyId, page: \$page, limit: \$limit, params: \$params\)/);
  assert.match(query, /\$params: PortalUserSearch/);
  assert.match(query, /id name email blocked inactive sso twoFactor kind createdAt updatedAt/);
  assert.match(query, /profile\(companyId: \$companyId\)\s*{\s*name\s*}/);
  assert.match(query, /teams\(companyId: \$companyId\)\s*{\s*id label\s*}/);
  assert.match(query, /metadata\s*{\s*totalCount totalPages currentPage limitValue\s*}/);
  assert.deepEqual(variables, { companyId: 430, page: 1, limit: 25, params: {} });
});

test('get_portal_users maps search and activeOnly into PortalUserSearch params', async () => {
  const { client, calls } = mockClient({});

  await client.get_portal_users(430, { page: 2, limit: 10, search: 'ana', activeOnly: true });

  assert.deepEqual(calls[0].variables, {
    companyId: 430,
    page: 2,
    limit: 10,
    params: { search: 'ana', activeOnly: true },
  });
});

test('get_portal_users keeps activeOnly=false and drops empty search', async () => {
  const { client, calls } = mockClient({});

  await client.get_portal_users(430, { search: '', activeOnly: false });

  assert.deepEqual(calls[0].variables.params, { activeOnly: false });
});

test('get_portal_user requests the user access within a company', async () => {
  const { client, calls } = mockClient({
    portalUserAccess: { portalUser: { id: '4419' }, accessProfile: { id: '199' }, teams: [] },
  });

  const result = await client.get_portal_user(430, 4419);

  assert.equal(result.portalUserAccess.portalUser.id, '4419');
  const [{ query, variables }] = calls;
  // Argument types must match the Platform schema: portalUserAccess(portalUserId: ID!, companyId: Int!)
  assert.match(query, /\$portalUserId: ID!, \$companyId: Int!/);
  assert.match(query, /portalUserAccess\(portalUserId: \$portalUserId, companyId: \$companyId\)/);
  assert.match(query, /portalUser\s*{\s*id name email blocked inactive sso twoFactor kind createdAt updatedAt\s*}/);
  assert.match(query, /accessProfile\s*{\s*id name\s*}/);
  assert.match(query, /teams\s*{\s*id label\s*}/);
  assert.deepEqual(variables, { portalUserId: 4419, companyId: 430 });
});
