import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { GraphQLClient } from '../src/conviso_mcp/graphql_client.js';

async function withGraphqlResponse(responseData, fn) {
  let requestBody;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requestBody = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: responseData }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await fn(new GraphQLClient(`http://127.0.0.1:${port}/graphql`, 'test-key'));
    return requestBody;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('assertMcpWriteEnabled checks the company policy', async () => {
  const body = await withGraphqlResponse(
    { policyControls: { enableMcpWrite: true } },
    (client) => client.assertMcpWriteEnabled(123),
  );
  assert.match(body.query, /policyControls\(companyId: \$companyId\)/);
  assert.match(body.query, /enableMcpWrite/);
  assert.deepEqual(body.variables, { companyId: 123 });
});

test('assertMcpWriteEnabled rejects disabled and missing policies', async () => {
  for (const policyControls of [{ enableMcpWrite: false }, null]) {
    await withGraphqlResponse({ policyControls }, async (client) => {
      await assert.rejects(
        client.assertMcpWriteEnabled(123),
        (error) => (
          error.status === 403 &&
          error.publicMessage === 'MCP write operations are disabled by company 123 policy' &&
          /policy controls for company 123/.test(error.authHint)
        ),
      );
    });
  }
});

test('assertMcpWriteEnabled allows writes when the backend lacks only the policy field', async () => {
  const client = new GraphQLClient('unused', 'test-key');
  const error = new Error('GraphQL error');
  error.graphqlErrors = [
    "Field 'enableMcpWrite' doesn't exist on type 'PolicyControls'",
  ];
  client.execute = async () => { throw error; };

  await client.assertMcpWriteEnabled(123);
});

test('assertMcpWriteEnabled still rejects other GraphQL errors', async () => {
  const client = new GraphQLClient('unused', 'test-key');
  const error = new Error('GraphQL error');
  error.graphqlErrors = ["Field 'companyId' is invalid"];
  client.execute = async () => { throw error; };

  await assert.rejects(client.assertMcpWriteEnabled(123), (caught) => caught === error);
});

test('assertMcpWriteEnabled rejects an unresolved company without making a request', async () => {
  const client = new GraphQLClient('http://127.0.0.1:1/graphql', 'test-key');
  await assert.rejects(
    client.assertMcpWriteEnabled(undefined),
    (error) => error.status === 400 && /determine company/.test(error.message),
  );
});

test('company resolver follows each supported object relationship', async () => {
  const calls = [];
  const client = new GraphQLClient('unused', 'test-key');
  client.execute = async (query, variables) => {
    calls.push({ query, variables });
    if (/asset\(id/.test(query)) return { asset: { company: { id: '11' } } };
    if (/issue\(id/.test(query)) return { issue: { asset: { company: { id: '12' } } } };
    if (/pentestArtifact\(id/.test(query)) return { pentestArtifact: { company: { id: '13' } } };
    if (/project\(id/.test(query)) return { project: { company: { id: '14' } } };
    if (/pentestExecution\(id/.test(query)) return { pentestExecution: { project: { company: { id: '15' } } } };
    if (/threatModelArtifact\(id/.test(query)) return { threatModelArtifact: { company: { id: '16' } } };
    throw new Error('unexpected query');
  };

  const cases = [['asset', 1, 11], ['issue', 2, 12], ['pentest_artifact', 3, 13], ['project', 4, 14], ['pentest_execution', 5, 15], ['threat_model_artifact', 6, 16]];
  for (const [object_type, object_id, company_id] of cases) {
    assert.deepEqual(await client.getCompanyIdFromObject(object_type, object_id), { object_type, object_id, company_id });
  }
  assert.deepEqual(calls.map((call) => call.variables), cases.map(([, object_id]) => ({ id: object_id })));
});

test('company resolver rejects objects without a resolvable company', async () => {
  const client = new GraphQLClient('unused', 'test-key');
  client.execute = async () => ({ issue: null });
  await assert.rejects(client.getCompanyIdFromObject('issue', 99), (error) => error.status === 404);
});
