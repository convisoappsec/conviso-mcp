import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GraphQLClient,
  buildProjectRequirementActivitiesVariables,
} from '../src/conviso_mcp/graphql_client.js';

test('project requirement activity variables map tool arguments to ActivitiesSearch', () => {
  const variables = buildProjectRequirementActivitiesVariables(27903, 12388, {
    page: 2,
    limit: 25,
    title: 'authentication',
    sortBy: 'TITLE',
    descending: true,
    attachmentActionsOnly: false,
  });

  assert.deepEqual(variables, {
    page: 2,
    limit: 25,
    sortBy: 'TITLE',
    descending: true,
    historyPagination: { page: 1, perPage: 25 },
    attachmentActionsOnly: false,
    params: {
      projectId: 27903,
      projectRequirementId: 12388,
      title: 'authentication',
    },
  });
});

test('get_project_requirement_activities requests activity details and pagination metadata', async () => {
  const client = new GraphQLClient('https://example.invalid/graphql', 'test');
  let request;
  client.execute = async (query, variables) => {
    request = { query, variables };
    return { activities: { collection: [], metadata: { totalCount: 0 } } };
  };

  const result = await client.get_project_requirement_activities(27903, 12388);

  assert.equal(result.activities.metadata.totalCount, 0);
  assert.match(request.query, /activities\(page: \$page, limit: \$limit/);
  assert.match(request.query, /status permittedStatus/);
  assert.match(request.query, /assignedUsers/);
  assert.deepEqual(request.variables.params, {
    projectId: 27903,
    projectRequirementId: 12388,
    title: '',
  });
  assert.equal(request.variables.sortBy, 'SORT');
  assert.equal(request.variables.descending, false);
});
