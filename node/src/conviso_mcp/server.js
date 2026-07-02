#!/usr/bin/env node

import 'dotenv/config';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { GraphQLClient } from './graphql_client.js';
import { listMutations, describeMutation } from './mutations.js';
import pkg from '../../package.json' with { type: 'json' };

console.error('[+] Starting Conviso MCP Server (MCP SDK)');

const BASE_URL = 'https://app.convisoappsec.com';
const gql = new GraphQLClient(`${BASE_URL}/graphql`, process.env.CONVISO_API_KEY || '');

function sanitizeError(err, message = 'Request failed') {
  const error_id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const status =
    err?.response?.status ??
    err?.response?.statusCode ??
    err?.status ??
    err?.statusCode ??
    (err?.code === 'ECONNREFUSED' ? 503 : undefined) ??
    (err?.code === 'ETIMEDOUT' ? 504 : undefined) ??
    500;

  console.error('[tool_error]', {
    error_id,
    name: err?.name,
    code: err?.code,
    message: err?.message?.slice(0, 200),
    status,
  });

  const result = { error: message, status, error_id };
  // GraphQL errors describe the caller's own request (e.g. a missing required field) — pass
  // them through so the model can fix the input on the next attempt.
  if (Array.isArray(err?.graphqlErrors) && err.graphqlErrors.length) {
    result.details = err.graphqlErrors;
  }
  if (err?.authHint) {
    result.hint = err.authHint;
  }
  return result;
}

function ok(data) {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data),
      },
    ],
  };
}

// Shared enum strings so tool descriptions state each list exactly once.
const SEVERITIES = 'NOTIFICATION, LOW, MEDIUM, HIGH, CRITICAL';
const ISSUE_STATUSES = 'CREATED, DRAFT, IDENTIFIED, IN_PROGRESS, AWAITING_VALIDATION, FIX_ACCEPTED, RISK_ACCEPTED, FALSE_POSITIVE, SUPPRESSED';

/**
 * Build a fresh McpServer with all tools registered. stdio mode uses one instance for the
 * whole session; HTTP mode builds one per request (the SDK's stateless pattern — reusing a
 * single instance across concurrent transports leaks state between requests).
 */
function buildServer() {
  const server = new McpServer({
    name: pkg.name || 'conviso-mcp',
    version: pkg.version || '0.6.0',
  });

  // Registration helper: one place for the try/catch, error shape, and annotations.
  function tool(name, { title, desc, schema, write = false, destructive = false, local = false }, handler) {
    server.registerTool(
      name,
      {
        description: desc,
        inputSchema: schema,
        annotations: {
          title,
          readOnlyHint: !write,
          destructiveHint: destructive,
          idempotentHint: !write,
          openWorldHint: !local,
        },
      },
      async (args) => {
        try {
          return ok(await handler(args));
        } catch (err) {
          return ok(sanitizeError(err, `${name} failed`));
        }
      }
    );
  }

  /**
   * READS — companies, issues, projects, assets, metrics
   */

  tool('get_companies', {
    title: 'List Companies',
    desc: 'List companies accessible with the API key. search = name contains; label_eq = exact name match.',
    schema: z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      label_eq: z.string().optional(),
    }),
  }, ({ page = 1, limit = 10, search = '', label_eq = null }) =>
    gql.get_companies(page, limit, search, label_eq));

  tool('get_company_info', {
    title: 'Company Details',
    desc: 'Get a company by ID: plan, integrations, branding metadata.',
    schema: z.object({ company_id: z.number() }),
  }, ({ company_id }) => gql.get_company_by_id(company_id));

  tool('get_issue', {
    title: 'Issue Details',
    desc: 'Get full technical detail for one issue/vulnerability. Set return_vulnerable_data=true to include raw requests/responses and vulnerable code snippets (may contain sensitive data).',
    schema: z.object({
      id: z.number(),
      return_vulnerable_data: z.boolean().optional(),
    }),
  }, ({ id, return_vulnerable_data }) => gql.get_issue_by_id(id, return_vulnerable_data));

  tool('get_issues', {
    title: 'List Issues',
    desc: `List a company's vulnerabilities with filtering and sorting. Optional: search (title substring), project_id, asset_id, severities (${SEVERITIES}), statuses (${ISSUE_STATUSES}), sla_states (ON_TRACK, APPROACHING, BREACHED, RESOLVED, NOT_TRACKED, NOT_PARAMETERIZED), created_after/created_before (YYYY-MM-DD — call get_today_date for relative ranges), assignee_emails, sort_by (RISK_SCORE, SEVERITY, ID, CREATED_AT, UPDATED_AT, SLA_DUE_AT) with order ASC|DESC, and extra_filters (raw IssuesFiltersInput keys, e.g. cves, categories, businessImpact — sent as-is). Returns collection + metadata (totalCount/totalPages) for pagination.`,
    schema: z.object({
      company_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      project_id: z.number().optional(),
      asset_id: z.number().optional(),
      search: z.string().optional(),
      severities: z.array(z.string()).optional(),
      statuses: z.array(z.string()).optional(),
      sla_states: z.array(z.string()).optional(),
      created_after: z.string().optional(),
      created_before: z.string().optional(),
      assignee_emails: z.array(z.string()).optional(),
      sort_by: z.string().optional(),
      order: z.string().optional(),
      extra_filters: z.record(z.string(), z.any()).optional(),
    }),
  }, ({
    company_id, page = 1, limit = 10, project_id, asset_id, search = '',
    severities, statuses, sla_states, created_after, created_before,
    assignee_emails, sort_by, order = 'DESC', extra_filters,
  }) => gql.getIssues(company_id, {
    page,
    limit,
    projectId: project_id,
    assetIds: asset_id ? [asset_id] : undefined,
    search,
    severities,
    statuses,
    slaStates: sla_states,
    createdAfter: created_after,
    createdBefore: created_before,
    assigneeEmails: assignee_emails,
    sortBy: sort_by,
    order,
    extraFilters: extra_filters,
  }));

  tool('get_top_vulnerabilities', {
    title: 'Top Vulnerabilities',
    desc: `Vulnerability counts grouped by title/severity for a company (risk overview). Optional filters: severities (${SEVERITIES}), statuses (${ISSUE_STATUSES}), asset_ids, asset_tags, created_after/created_before (YYYY-MM-DD).`,
    schema: z.object({
      company_id: z.number(),
      severities: z.array(z.string()).optional(),
      statuses: z.array(z.string()).optional(),
      asset_ids: z.array(z.number()).optional(),
      asset_tags: z.array(z.string()).optional(),
      created_after: z.string().optional(),
      created_before: z.string().optional(),
    }),
  }, ({ company_id, severities, statuses, asset_ids, asset_tags, created_after, created_before }) =>
    gql.get_top_vulnerabilities(company_id, {
      severities,
      statuses,
      assetIds: asset_ids,
      assetTags: asset_tags,
      createdAfter: created_after,
      createdBefore: created_before,
    }));

  tool('get_projects', {
    title: 'List Projects',
    desc: 'List a company\'s security projects (paginated, default 25/page). Optional: search (label substring), statuses and project_types (platform labels, free text e.g. "Fixing", "Pentest"), created_after/created_before (YYYY-MM-DD), tags, analyst_emails, sort_by (default createdAt) + descending.',
    schema: z.object({
      company_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      statuses: z.array(z.string()).optional(),
      project_types: z.array(z.string()).optional(),
      created_after: z.string().optional(),
      created_before: z.string().optional(),
      tags: z.array(z.string()).optional(),
      analyst_emails: z.array(z.string()).optional(),
      sort_by: z.string().optional(),
      descending: z.boolean().optional(),
    }),
  }, ({
    company_id, page = 1, limit = 25, search = '', statuses, project_types,
    created_after, created_before, tags, analyst_emails, sort_by = 'createdAt',
    descending = true,
  }) => gql.get_projects(company_id, page, limit, search, {
    statuses,
    projectTypes: project_types,
    createdAfter: created_after,
    createdBefore: created_before,
    tags,
    analystEmails: analyst_emails,
    sortBy: sort_by,
    descending,
  }));

  tool('get_project', {
    title: 'Project Details',
    desc: 'Get a project by ID.',
    schema: z.object({ project_id: z.number() }),
  }, ({ project_id }) => gql.get_project_by_id(project_id));

  tool('get_asset', {
    title: 'Asset Details',
    desc: 'Get an asset by ID.',
    schema: z.object({ asset_id: z.number() }),
  }, ({ asset_id }) => gql.get_asset_by_id(asset_id));

  tool('get_assets', {
    title: 'List Assets',
    desc: 'List a company\'s assets (paginated, default 25/page). Optional: name/search (substring), tags, technology, business_impact (LOW, MEDIUM, HIGH, NOT_DEFINED), exploitability (INTERNET_FACING, INTERNAL, NOT_DEFINED), asset_type, environment_compromised, covered_by_scan, sort_by (updated_at, name, business_impact, risk_score) + order, extra_filters (raw AssetsSearch keys). Returns collection + metadata.',
    schema: z.object({
      company_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      name: z.string().optional(),
      search: z.string().optional(),
      tags: z.array(z.string()).optional(),
      technology: z.array(z.string()).optional(),
      business_impact: z.array(z.string()).optional(),
      exploitability: z.array(z.string()).optional(),
      asset_type: z.string().optional(),
      environment_compromised: z.boolean().optional(),
      covered_by_scan: z.boolean().optional(),
      sort_by: z.string().optional(),
      order: z.string().optional(),
      extra_filters: z.record(z.string(), z.any()).optional(),
    }),
  }, ({
    company_id, page = 1, limit = 25, name, search, tags, technology,
    business_impact, exploitability, asset_type, environment_compromised,
    covered_by_scan, sort_by, order, extra_filters,
  }) => gql.get_assets_by_company(company_id, page, limit, {
    name,
    search,
    tags,
    technology,
    businessImpact: business_impact,
    exploitability,
    assetType: asset_type,
    environmentCompromised: environment_compromised,
    coveredByScan: covered_by_scan,
    sortBy: sort_by,
    order,
    extraFilters: extra_filters,
  }));

  tool('create_project_url', {
    title: 'Project URL',
    desc: 'Build the direct Conviso Platform URL for a project.',
    schema: z.object({ company_id: z.number(), project_id: z.number() }),
    local: true,
  }, ({ company_id, project_id }) =>
    `${BASE_URL}/spa/company/${company_id}/projects/${project_id}`);

  tool('create_issue_url', {
    title: 'Issue URL',
    desc: 'Build the direct Conviso Platform URL for an issue.',
    schema: z.object({ company_id: z.number(), issue_id: z.number() }),
    local: true,
  }, ({ company_id, issue_id }) =>
    `${BASE_URL}/spa/company/${company_id}/vulnerabilities?title=&search=${issue_id}`);

  tool('get_mttr_over_time', {
    title: 'MTTR Over Time',
    desc: 'Mean Time To Resolution over a date range, broken down by severity. Optional filters: severities, statuses, asset_ids, asset_tags.',
    schema: z.object({
      company_id: z.number(),
      start_date: z.string(),
      end_date: z.string(),
      severities: z.array(z.string()).optional(),
      statuses: z.array(z.string()).optional(),
      asset_ids: z.array(z.number()).optional(),
      asset_tags: z.array(z.string()).optional(),
    }),
  }, (a) => gql.get_mttr_over_time(a.company_id, a.start_date, a.end_date, a.severities, a.statuses, a.asset_ids, a.asset_tags));

  tool('get_overall_risk_score_history', {
    title: 'Risk Score History',
    desc: 'Historical overall risk score for a company (current value + difference from last period).',
    schema: z.object({ company_id: z.number() }),
  }, ({ company_id }) => gql.get_overall_risk_score_history(company_id));

  tool('get_today_date', {
    title: 'Get Today Date',
    desc: 'Current day/month/year — use to compute relative date ranges before filtering by dates.',
    schema: z.object({}),
    local: true,
  }, () => {
    const d = new Date();
    return { day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() };
  });

  /**
   * READS — tickets, requirements, applications, scans, supply chain, AI-pentest, threat modeling
   */

  tool('get_tickets', {
    title: 'List Tickets',
    desc: 'List a company\'s tickets (paginated). Optional: search, sort_by + descending, params (raw TicketSearch keys: types, statuses, priorities, impacts, tags, mineOnly...).',
    schema: z.object({
      company_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      sort_by: z.string().optional(),
      descending: z.boolean().optional(),
      params: z.record(z.string(), z.any()).optional(),
    }),
  }, ({ company_id, page, limit, search, sort_by, descending, params }) =>
    gql.get_tickets(company_id, { page, limit, search, sort_by, descending, params }));

  tool('get_ticket', {
    title: 'Ticket Details',
    desc: 'Get a ticket by ID (status, priority, impact, assignee).',
    schema: z.object({ company_id: z.number(), ticket_id: z.number() }),
  }, ({ company_id, ticket_id }) => gql.get_ticket(company_id, ticket_id));

  tool('get_requirements', {
    title: 'List Requirements',
    desc: 'List security requirements/checklists for a scope (company) id, paginated. Optional: filters (raw RequirementsFilterInput).',
    schema: z.object({
      scope_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      filters: z.record(z.string(), z.any()).optional(),
    }),
  }, ({ scope_id, page, limit, filters }) => gql.get_requirements(scope_id, { page, limit, filters }));

  tool('get_requirement', {
    title: 'Requirement Details',
    desc: 'Get a requirement/checklist by ID.',
    schema: z.object({ company_id: z.number(), requirement_id: z.number() }),
  }, ({ company_id, requirement_id }) => gql.get_requirement(company_id, requirement_id));

  tool('get_project_requirements', {
    title: 'Project Requirements',
    desc: 'List the requirements/checklists attached to a project.',
    schema: z.object({ project_id: z.number() }),
  }, ({ project_id }) => gql.get_project_requirements(project_id));

  tool('get_applications', {
    title: 'List Applications',
    desc: 'List a company\'s applications (name, url, riskScore, assetsCount). Optional: search by name.',
    schema: z.object({ company_id: z.number(), search: z.string().optional() }),
  }, ({ company_id, search }) => gql.get_applications(company_id, search));

  tool('get_application', {
    title: 'Application Details',
    desc: 'Get an application by ID, including its linked assets.',
    schema: z.object({ company_id: z.number(), application_id: z.number() }),
  }, ({ company_id, application_id }) => gql.get_application(company_id, application_id));

  tool('get_scan_histories', {
    title: 'List Scan Histories',
    desc: 'List scan executions for a company (status, integration, duration, vulnerability counts). Optional: asset_ids, filters (raw ScansHistoriesFiltersInput).',
    schema: z.object({
      company_id: z.number(),
      asset_ids: z.array(z.number()).optional(),
      page: z.number().optional(),
      limit: z.number().optional(),
      filters: z.record(z.string(), z.any()).optional(),
    }),
  }, ({ company_id, asset_ids, page, limit, filters }) =>
    gql.get_scan_histories(company_id, { assetIds: asset_ids, page, limit, filters }));

  tool('get_asset_scans_count', {
    title: 'Asset Scans Count',
    desc: 'Scan coverage for a company: assets with/without scans and which scan types count.',
    schema: z.object({ company_id: z.number() }),
  }, ({ company_id }) => gql.get_asset_scans_count(company_id));

  tool('get_sbom_components', {
    title: 'List SBOM Components',
    desc: 'List SBOM / supply-chain components (name, version, technology, package manager, license, issues by severity). Optional: search (raw SbomComponentSearchInput).',
    schema: z.object({
      company_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.record(z.string(), z.any()).optional(),
    }),
  }, ({ company_id, page, limit, search }) => gql.get_sbom_components(company_id, { page, limit, search }));

  tool('get_pentest_artifacts', {
    title: 'List Pentest Artifacts',
    desc: 'List AI-Pentest artifacts (label, type, scheduling, latest execution). Optional: search, assignee_email, pentest_type, application_id.',
    schema: z.object({
      company_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      assignee_email: z.string().optional(),
      pentest_type: z.string().optional(),
      application_id: z.number().optional(),
    }),
  }, ({ company_id, page, limit, search, assignee_email, pentest_type, application_id }) =>
    gql.get_pentest_artifacts(company_id, {
      page, limit, search, assigneeEmail: assignee_email, pentestType: pentest_type, applicationId: application_id,
    }));

  tool('get_pentest_artifact', {
    title: 'Pentest Artifact Details',
    desc: 'Get an AI-Pentest artifact by ID, including scope and executions.',
    schema: z.object({ artifact_id: z.number() }),
  }, ({ artifact_id }) => gql.get_pentest_artifact(artifact_id));

  tool('get_pentest_execution', {
    title: 'Pentest Execution Result',
    desc: 'Get an AI-Pentest execution by ID: status, vulnerability count, severity breakdown, retest progress.',
    schema: z.object({ execution_id: z.number() }),
  }, ({ execution_id }) => gql.get_pentest_execution(execution_id));

  tool('get_threat_model_artifacts', {
    title: 'List Threat Model Artifacts',
    desc: 'List Threat Modeling artifacts (label, scope, latest version). Optional: search, assignee_email, has_version.',
    schema: z.object({
      company_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      assignee_email: z.string().optional(),
      has_version: z.boolean().optional(),
    }),
  }, ({ company_id, page, limit, search, assignee_email, has_version }) =>
    gql.get_threat_model_artifacts(company_id, {
      page, limit, search, assigneeEmail: assignee_email, hasVersion: has_version,
    }));

  tool('get_threat_model_artifact', {
    title: 'Threat Model Artifact Details',
    desc: 'Get a Threat Modeling artifact by ID, including its versions (diagrams, notes, scope).',
    schema: z.object({ artifact_id: z.number() }),
  }, ({ artifact_id }) => gql.get_threat_model_artifact(artifact_id));

  /**
   * MUTATIONS — engine (discover -> describe -> execute over the allowlist)
   */

  tool('list_mutations', {
    title: 'List Mutations',
    desc: 'Discover the permitted write operations (name, description, category, destructive flag). Step 1 of the write workflow: list_mutations -> describe_mutation -> execute_mutation. Optional: search (substring), category (issue, ticket, project, asset, requirement, pentest, application, threat_model), limit (default 50).',
    schema: z.object({
      search: z.string().optional(),
      category: z.string().optional(),
      limit: z.number().optional(),
    }),
    local: true,
  }, ({ search, category, limit }) => listMutations({ search, category, limit }));

  tool('describe_mutation', {
    title: 'Describe Mutation',
    desc: 'Full input schema for one mutation: fields with types, required flags, enum values, nested inputs, plus the default returned fields. Call before execute_mutation.',
    schema: z.object({ name: z.string() }),
    local: true,
  }, ({ name }) => describeMutation(name));

  tool('execute_mutation', {
    title: 'Execute Mutation',
    desc: 'Run any permitted write operation by name (see list_mutations). variables is the mutation input — pass { input: {...} } or the input fields directly (auto-wrapped). Optional return_fields overrides the returned selection set. WARNING: performs writes; delete/bulk operations are destructive — confirm intent first.',
    schema: z.object({
      name: z.string(),
      variables: z.record(z.string(), z.any()).optional(),
      return_fields: z.string().optional(),
    }),
    write: true,
    destructive: true,
  }, ({ name, variables = {}, return_fields = null }) =>
    gql.executeMutation(name, variables, return_fields));

  /**
   * MUTATIONS — typed shortcuts for the most common writes
   */

  tool('change_issue_status', {
    title: 'Change Issue Status',
    desc: `Change an issue's status. status: one of ${ISSUE_STATUSES}. Optional reason; extra = advanced ChangeIssueStatusInput fields (e.g. riskAcceptedUntil).`,
    schema: z.object({
      issue_id: z.number(),
      status: z.string(),
      reason: z.string().optional(),
      extra: z.record(z.string(), z.any()).optional(),
    }),
    write: true,
  }, (a) => gql.change_issue_status(a));

  tool('create_source_code_vulnerability', {
    title: 'Create Source Code Vulnerability',
    desc: `Create a manual source-code (SAST-style) vulnerability on an asset. severity: ${SEVERITIES}. impact_level/probability_level: LOW, MEDIUM, HIGH (default MEDIUM). status defaults to DRAFT. extra = any other CreateSourceCodeVulnerabilityInput field.`,
    schema: z.object({
      asset_id: z.number(),
      title: z.string(),
      description: z.string(),
      solution: z.string(),
      severity: z.string(),
      code_snippet: z.string(),
      file_name: z.string(),
      first_line: z.number(),
      vulnerable_line: z.number(),
      project_id: z.number().optional(),
      impact_level: z.string().optional(),
      probability_level: z.string().optional(),
      status: z.string().optional(),
      category: z.string().optional(),
      reference: z.string().optional(),
      summary: z.string().optional(),
      impact_description: z.string().optional(),
      steps_to_reproduce: z.string().optional(),
      compromised_environment: z.boolean().optional(),
      source: z.string().optional(),
      sink: z.string().optional(),
      patterns: z.array(z.string()).optional(),
      extra: z.record(z.string(), z.any()).optional(),
    }),
    write: true,
  }, (a) => gql.create_source_code_vulnerability(a));

  tool('create_project', {
    title: 'Create Project',
    desc: 'Create a project. Required: company_id, type_id (project type id), label, goal, scope, start_date (YYYY-MM-DD). Optional: end_date; extra = advanced CreateProjectInput fields (assetsIds, tags, allocatedPortalUserEmails...).',
    schema: z.object({
      company_id: z.number(),
      type_id: z.number(),
      label: z.string(),
      goal: z.string(),
      scope: z.string(),
      start_date: z.string(),
      end_date: z.string().optional(),
      extra: z.record(z.string(), z.any()).optional(),
    }),
    write: true,
  }, (a) => gql.create_project(a));

  tool('create_asset', {
    title: 'Create Asset',
    desc: 'Create an asset. Required: company_id, name. Optional: asset_type, url, description, business_impact (LOW, MEDIUM, HIGH, NOT_DEFINED), exploitability (INTERNET_FACING, INTERNAL, NOT_DEFINED), tags; extra = advanced CreateAssetInput fields.',
    schema: z.object({
      company_id: z.number(),
      name: z.string(),
      asset_type: z.string().optional(),
      url: z.string().optional(),
      description: z.string().optional(),
      business_impact: z.string().optional(),
      exploitability: z.string().optional(),
      tags: z.array(z.string()).optional(),
      extra: z.record(z.string(), z.any()).optional(),
    }),
    write: true,
  }, (a) => gql.create_asset(a));

  tool('create_ticket', {
    title: 'Create Ticket',
    desc: 'Open a ticket. Required: company_id, type (BUG, FEATURE_REQUEST, PROJECT_REQUEST, SUPPORT_REQUEST), title, description. Optional: priority (P1, P2, P3), impact (LOW, MEDIUM, HIGH); extra = advanced CreateTicketInput fields.',
    schema: z.object({
      company_id: z.number(),
      type: z.string(),
      title: z.string(),
      description: z.string(),
      priority: z.string().optional(),
      impact: z.string().optional(),
      extra: z.record(z.string(), z.any()).optional(),
    }),
    write: true,
  }, (a) => gql.create_ticket(a));

  tool('run_dast', {
    title: 'Run DAST',
    desc: 'Start a Conviso DAST scan on an asset (startConvisoDast). Required: asset_id.',
    schema: z.object({ asset_id: z.number(), extra: z.record(z.string(), z.any()).optional() }),
    write: true,
  }, (a) => gql.run_dast(a));

  tool('trigger_pentest', {
    title: 'Trigger AI-Pentest',
    desc: 'Trigger an AI-Pentest execution from an existing pentest artifact (createPentestExecution). Required: artifact_id.',
    schema: z.object({ artifact_id: z.number(), extra: z.record(z.string(), z.any()).optional() }),
    write: true,
  }, (a) => gql.trigger_pentest(a));

  tool('create_pentest_artifact', {
    title: 'Create Pentest Artifact',
    desc: 'Create an AI-Pentest artifact (the scope/config a pentest runs against). Required: company_id, application_id, label, pentest_type. Optional: description, scope_text, assignee_email, domains, in_scope, out_scope; extra = advanced fields (scheduling, repositories, documentation, size/depth).',
    schema: z.object({
      company_id: z.number(),
      application_id: z.number(),
      label: z.string(),
      pentest_type: z.string(),
      description: z.string().optional(),
      scope_text: z.string().optional(),
      assignee_email: z.string().optional(),
      domains: z.array(z.string()).optional(),
      in_scope: z.array(z.string()).optional(),
      out_scope: z.array(z.string()).optional(),
      extra: z.record(z.string(), z.any()).optional(),
    }),
    write: true,
  }, (a) => gql.create_pentest_artifact(a));

  return server;
}

/**
 * START
 */

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : null;

if (PORT) {
  const httpServer = http.createServer(async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
      res.writeHead(405).end();
      return;
    }
    // Stateless HTTP: a fresh server + transport per request (SDK pattern). Reusing one
    // McpServer across concurrent transports leaks state between requests.
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  httpServer.listen(PORT, () => {
    console.error(`Conviso MCP Server running on HTTP port ${PORT}`);
  });
} else {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Conviso MCP Server running on stdio');
}
