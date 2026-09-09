import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphQLClient } from '../src/conviso_mcp/graphql_client.js';

test('get_project_by_id requests rich project planning and relationship details', async () => {
  const client = new GraphQLClient('https://example.invalid/graphql', 'test');
  let request;
  client.execute = async (query, variables) => {
    request = { query, variables };
    return { project: { id: '42', estimatedHours: '80' } };
  };

  const result = await client.get_project_by_id(42);

  assert.equal(result.project.estimatedHours, '80');
  assert.deepEqual(request.variables, { id: 42 });
  assert.match(request.query, /estimatedDays\s+estimatedHours/);
  assert.match(request.query, /goal\s+objective\s+scope/);
  assert.match(request.query, /assignedUsers\s*{\s*id\s+allocatedHours/);
  assert.doesNotMatch(request.query, /allocatedAnalyst/);
  assert.match(request.query, /projectScopeUrls\s*{\s*id\s+url/);
  assert.match(request.query, /requirementsProgress\s*{\s*done\s+open\s+pending\s+total/);
  assert.match(request.query, /assets\s*{\s*id\s+name/);
  assert.match(request.query, /playbooks\s*{\s*id\s+label\s+description/);
});
