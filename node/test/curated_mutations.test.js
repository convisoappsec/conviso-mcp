import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChangeIssueStatusInput,
  buildSourceCodeVulnerabilityInput,
  buildCreateProjectInput,
  buildCreateAssetInput,
  buildCreateTicketInput,
  buildCreatePentestArtifactInput,
  GraphQLClient,
} from '../src/conviso_mcp/graphql_client.js';

test('change issue status input maps fields', () => {
  const v = buildChangeIssueStatusInput({ issue_id: 7, status: 'RISK_ACCEPTED', reason: 'accepted' });
  assert.deepEqual(v, { input: { id: 7, status: 'RISK_ACCEPTED', reason: 'accepted' } });
});

test('change issue status drops undefined optional reason', () => {
  const v = buildChangeIssueStatusInput({ issue_id: 7, status: 'IDENTIFIED' });
  assert.deepEqual(v, { input: { id: 7, status: 'IDENTIFIED' } });
});

test('source code vulnerability input applies required-field defaults', () => {
  const v = buildSourceCodeVulnerabilityInput({
    asset_id: 1, title: 't', description: 'd', solution: 's', severity: 'HIGH',
    code_snippet: 'x', file_name: 'a.js', first_line: 1, vulnerable_line: 2,
  });
  assert.equal(v.input.impactLevel, 'MEDIUM');
  assert.equal(v.input.probabilityLevel, 'MEDIUM');
  assert.equal(v.input.status, 'DRAFT');
  assert.equal(v.input.summary, '');
  assert.equal(v.input.impactDescription, '');
  assert.equal(v.input.stepsToReproduce, '');
  assert.equal(v.input.assetId, 1);
  assert.equal(v.input.codeSnippet, 'x');
  assert.equal(v.input.firstLine, 1);
});

test('create project input maps snake_case to camelCase', () => {
  const v = buildCreateProjectInput({
    company_id: 1, type_id: 2, label: 'L', goal: 'G', scope: 'S', start_date: '2026-01-01',
  });
  assert.deepEqual(v.input, {
    companyId: 1, typeId: 2, label: 'L', goal: 'G', scope: 'S', startDate: '2026-01-01',
  });
});

test('create project maps requirement_ids to playbooksIds and asset_ids to assetsIds', () => {
  const v = buildCreateProjectInput({
    company_id: 1, type_id: 2, label: 'L', goal: 'G', scope: 'S', start_date: '2026-01-01',
    requirement_ids: [7, 8], asset_ids: [30552],
  });
  assert.deepEqual(v.input.playbooksIds, [7, 8]);
  assert.deepEqual(v.input.assetsIds, [30552]);
});

test('extra is merged into the input', () => {
  const v = buildCreateAssetInput({
    company_id: 1, asset_type: 'fqdn', name: 'n', url: 'https://x.com', tags: ['a'], extra: { description: 'd' },
  });
  assert.equal(v.input.companyId, 1);
  assert.equal(v.input.name, 'n');
  assert.deepEqual(v.input.assetsTagList, ['a']);
  assert.equal(v.input.description, 'd');
});

test('each asset type lands in its inventory section', () => {
  assert.deepEqual(
    buildCreateAssetInput({ company_id: 1, asset_type: 'repository', repo_url: 'https://github.com/o/r' }).input,
    { companyId: 1, repoUrl: 'https://github.com/o/r' },
  );
  assert.deepEqual(
    buildCreateAssetInput({ company_id: 1, asset_type: 'FQDN', name: 'shop', url: 'shop.example.com' }).input,
    { companyId: 1, name: 'shop', assetType: 'domain', url: 'shop.example.com' },
  );
  assert.deepEqual(
    buildCreateAssetInput({ company_id: 1, asset_type: 'api', name: 'orders', url: 'https://api.example.com' }).input,
    { companyId: 1, name: 'orders', assetType: 'api', url: 'https://api.example.com' },
  );
});

test('an asset without a known type is refused with a hint to ask the user', () => {
  for (const asset_type of [undefined, '', 'web', 'domain']) {
    assert.throws(
      () => buildCreateAssetInput({ company_id: 1, asset_type, name: 'n', url: 'https://x.com' }),
      (e) => e.status === 400 && /asset_type is required/.test(e.publicMessage) && /Ask the user/.test(e.publicMessage),
    );
  }
});

test('each asset type demands its own identity fields', () => {
  const refused = (a, pattern) => assert.throws(
    () => buildCreateAssetInput({ company_id: 1, ...a }),
    (e) => e.status === 400 && pattern.test(e.publicMessage),
  );
  refused({ asset_type: 'repository', name: 'n' }, /needs repo_url/);
  refused({ asset_type: 'fqdn', name: 'n' }, /FQDN asset needs name and url/);
  refused({ asset_type: 'api', url: 'https://x.com' }, /API asset needs name and url/);
  refused({ asset_type: 'fqdn', name: 'n', url: 'x.com', repo_url: 'https://github.com/o/r' }, /only for repository/);
});

test('extra cannot change the asset type behind asset_type', () => {
  for (const extra of [{ assetType: 'web' }, { repoUrl: 'https://github.com/o/r' }, { companyId: 2 }, { url: '' }]) {
    assert.throws(
      () => buildCreateAssetInput({ company_id: 1, asset_type: 'fqdn', name: 'n', url: 'x.com', extra }),
      (e) => e.status === 400 && /not extra./.test(e.publicMessage),
    );
  }
});

test('execute_mutation refuses a createAsset that would default to a repository', async () => {
  const client = new GraphQLClient('unused', 'test-key');
  const sent = [];
  client.execute = async (query, variables) => { sent.push(variables); return {}; };

  for (const variables of [
    { companyId: 1, name: 'n' },
    { companyId: 1, name: 'n', assetType: 'none' },
    { companyId: 1, name: 'n', assetType: 'web', url: 'x.com' },
    { companyId: 1, name: 'n', assetType: 'domain', repoUrl: 'https://github.com/o/r' },
    { input: 'oops' },
  ]) {
    await assert.rejects(
      client.executeMutation('createAsset', variables),
      (e) => e.status === 400 && /createAsset/.test(e.publicMessage),
    );
  }
  await client.executeMutation('createAsset', { companyId: 1, name: 'n', assetType: 'domain', url: 'x.com' });
  await client.executeMutation('createAsset', { input: { companyId: 1, repoUrl: 'https://github.com/o/r' } });
  assert.equal(sent.length, 2);
});

test('create ticket input', () => {
  assert.deepEqual(
    buildCreateTicketInput({ company_id: 1, type: 'BUG', title: 't', description: 'd' }).input,
    { companyId: 1, type: 'BUG', title: 't', description: 'd' }
  );
});

test('create pentest artifact input maps fields and merges extra', () => {
  const v = buildCreatePentestArtifactInput({
    company_id: 1, application_id: 2, label: 'L', pentest_type: 'web',
    domains: ['x.com'], extra: { useScheduling: true },
  });
  assert.deepEqual(v.input, {
    companyId: 1, applicationId: 2, label: 'L', pentestType: 'web',
    domains: ['x.com'], useScheduling: true,
  });
});
