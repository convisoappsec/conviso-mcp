import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChangeIssueStatusInput,
  buildSourceCodeVulnerabilityInput,
  buildCreateProjectInput,
  buildCreateAssetInput,
  buildCreateTicketInput,
  buildCreatePentestArtifactInput,
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

test('extra is merged into the input', () => {
  const v = buildCreateAssetInput({ company_id: 1, name: 'n', tags: ['a'], extra: { repoUrl: 'https://x' } });
  assert.equal(v.input.companyId, 1);
  assert.equal(v.input.name, 'n');
  assert.deepEqual(v.input.assetsTagList, ['a']);
  assert.equal(v.input.repoUrl, 'https://x');
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
