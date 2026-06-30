#!/usr/bin/env node

import 'dotenv/config';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { FeedGateway } from './feed_gateway.js';
import pkg from '../../package.json' with { type: 'json' };

const gateway = new FeedGateway();

console.error('[+] Starting Conviso MCP Server (MCP SDK)');

const server = new McpServer({
  name: pkg.name || 'conviso-mcp',
  version: pkg.version || '0.4.0',
});

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

function fail(err, msg) {
  return ok(sanitizeError(err, msg));
}

// Annotation presets to keep tool definitions terse.
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

server.registerTool(
  'get_companies',
  {
    description: 'Return a paginated list of companies accessible with the provided API key. search = name contains; label_eq = exact name match.',
    inputSchema: z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      label_eq: z.string().optional(),
    }),
    annotations: {
      title: 'List Companies',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ page = 1, limit = 10, search = '', label_eq = null }) => {
    try {
      return ok(await gateway.get_companies(page, limit, search, label_eq));
    } catch (err) {
      return fail(err, 'Failed to list companies');
    }
  }
);

server.registerTool(
  'get_company_info',
  {
    description: 'Retrieve detailed information about a specific company, including plan, integrations, and branding metadata.',
    inputSchema: z.object({ company_id: z.number() }),
    annotations: {
      title: 'Company Details',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ company_id }) => {
    try {
      return ok(await gateway.get_company_by_id(company_id));
    } catch (err) {
      return fail(err, 'Failed to get company info');
    }
  }
);

server.registerTool(
  'get_issue',
  {
    description: 'Fetch detailed technical data for a specific vulnerability/issue. Optionally include raw request/response and vulnerable code snippets when `return_vulnerable_data` is true. WARNING: setting `return_vulnerable_data=true` may return sensitive data (exploit code, raw HTTP requests/responses, or secrets) — use with caution.',
    inputSchema: z.object({
      id: z.number(),
      return_vulnerable_data: z.boolean().optional(),
    }),
    annotations: {
      title: 'Issue Details',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ id, return_vulnerable_data }) => {
    try {
      return ok(await gateway.get_issue_by_id(id, return_vulnerable_data));
    } catch (err) {
      return fail(err, 'Failed to get issue details');
    }
  }
);

server.registerTool(
  'get_issues',
  {
    description: `Get issues (vulnerabilities) for a company, with rich filtering and sorting.

Filters (all optional):
- search: substring match on issue title.
- severities: any of NOTIFICATION, LOW, MEDIUM, HIGH, CRITICAL.
- statuses: any of CREATED, DRAFT, IDENTIFIED, IN_PROGRESS, AWAITING_VALIDATION,
  FIX_ACCEPTED, RISK_ACCEPTED, FALSE_POSITIVE, SUPPRESSED.
- sla_states: any of ON_TRACK, APPROACHING, BREACHED, RESOLVED, NOT_TRACKED, NOT_PARAMETERIZED.
- created_after / created_before: ISO8601 dates (YYYY-MM-DD). For relative ranges
  ("last 30 days") call get_today_date first and compute the bounds.
- assignee_emails: list of assignee emails.
- project_id: restrict to one project. asset filtering: use get_issues_by_asset_id.
- sort_by: one of RISK_SCORE, SEVERITY, ID, CREATED_AT, UPDATED_AT, SLA_DUE_AT. order: ASC or DESC.
- extra_filters: dict mapping directly to IssuesFiltersInput for advanced keys, e.g.
  {"cves": [...], "categories": [...], "reachableBy": ["STATIC_ANALYSIS"],
   "businessImpact": ["HIGH"], "exploitability": "INTERNET_FACING",
   "compromisedEnvironment": true, "aiFpAnalyzed": true, "assetTags": [...]}.
  extra_filters values are sent as-is — omit a key rather than passing an empty list.

Returns issue collection (id, title, severity, status, dates, sla, assignedUsers,
asset, project) plus metadata (totalCount, totalPages, currentPage) for pagination.`,
    inputSchema: z.object({
        company_id: z.number(),
        page: z.number().optional(),
        limit: z.number().optional(),
        project_id: z.number().optional(),
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
    annotations: {
      title: 'List Issues',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({
    company_id, page = 1, limit = 10, project_id, search = '',
    severities, statuses, sla_states, created_after, created_before,
    assignee_emails, sort_by, order = 'DESC', extra_filters,
  }) => {
    try {
      return ok(await gateway.getIssues(company_id, {
        page,
        limit,
        projectId: project_id,
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
    } catch (err) {
      return fail(err, 'Failed to list issues');
    }
  }
);

server.registerTool(
  'get_issues_by_asset_id',
  {
    description: `List vulnerabilities for a company filtered by a single asset ID, with rich filtering and sorting.

Filters (all optional):
- search: substring match on issue title.
- severities: any of NOTIFICATION, LOW, MEDIUM, HIGH, CRITICAL.
- statuses: any of CREATED, DRAFT, IDENTIFIED, IN_PROGRESS, AWAITING_VALIDATION,
  FIX_ACCEPTED, RISK_ACCEPTED, FALSE_POSITIVE, SUPPRESSED.
- sla_states: any of ON_TRACK, APPROACHING, BREACHED, RESOLVED, NOT_TRACKED, NOT_PARAMETERIZED.
- created_after / created_before: ISO8601 dates (YYYY-MM-DD). For relative ranges
  ("last 30 days") call get_today_date first and compute the bounds.
- assignee_emails: list of assignee emails.
- sort_by: one of RISK_SCORE, SEVERITY, ID, CREATED_AT, UPDATED_AT, SLA_DUE_AT. order: ASC or DESC.
- extra_filters: dict mapping directly to IssuesFiltersInput for advanced keys, e.g.
  {"cves": [...], "categories": [...], "reachableBy": ["STATIC_ANALYSIS"],
   "businessImpact": ["HIGH"], "exploitability": "INTERNET_FACING",
   "compromisedEnvironment": true, "aiFpAnalyzed": true, "assetTags": [...]}.

Returns issue collection (id, title, severity, status, dates, sla, assignedUsers,
asset, project) plus metadata (totalCount, totalPages, currentPage) for pagination.`,
    inputSchema: z.object({
      company_id: z.number(),
      asset_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
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
    annotations: {
      title: 'List Issues by Asset ID',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({
    company_id, asset_id, page = 1, limit = 10, search = '',
    severities, statuses, sla_states, created_after, created_before,
    assignee_emails, sort_by, order = 'DESC', extra_filters,
  }) => {
    try {
      const asset_ids = Array.isArray(asset_id) ? asset_id : [asset_id];
      return ok(await gateway.get_issues_by_asset_ids(company_id, page, limit, asset_ids, search, {
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
    } catch (err) {
      return fail(err, 'Failed to list issues by asset id');
    }
  }
);

server.registerTool(
  'get_issues_by_project_id',
  {
    description: `List vulnerabilities for a company filtered by a project ID, with rich filtering and sorting.

Filters (all optional):
- search: substring match on issue title.
- severities: any of NOTIFICATION, LOW, MEDIUM, HIGH, CRITICAL.
- statuses: any of CREATED, DRAFT, IDENTIFIED, IN_PROGRESS, AWAITING_VALIDATION,
  FIX_ACCEPTED, RISK_ACCEPTED, FALSE_POSITIVE, SUPPRESSED.
- sla_states: any of ON_TRACK, APPROACHING, BREACHED, RESOLVED, NOT_TRACKED, NOT_PARAMETERIZED.
- created_after / created_before: ISO8601 dates (YYYY-MM-DD). For relative ranges
  ("last 30 days") call get_today_date first and compute the bounds.
- assignee_emails: list of assignee emails.
- sort_by: one of RISK_SCORE, SEVERITY, ID, CREATED_AT, UPDATED_AT, SLA_DUE_AT. order: ASC or DESC.
- extra_filters: dict mapping directly to IssuesFiltersInput for advanced keys, e.g.
  {"cves": [...], "categories": [...], "reachableBy": ["STATIC_ANALYSIS"],
   "businessImpact": ["HIGH"], "exploitability": "INTERNET_FACING",
   "compromisedEnvironment": true, "aiFpAnalyzed": true, "assetTags": [...]}.

Returns issue collection (id, title, severity, status, dates, sla, assignedUsers,
asset, project) plus metadata (totalCount, totalPages, currentPage) for pagination.`,
    inputSchema: z.object({
      company_id: z.number(),
      project_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
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
    annotations: {
      title: 'List Issues by Project ID',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({
    company_id, project_id, page = 1, limit = 10, search = '',
    severities, statuses, sla_states, created_after, created_before,
    assignee_emails, sort_by, order = 'DESC', extra_filters,
  }) => {
    try {
      return ok(await gateway.getIssues(company_id, {
        page,
        limit,
        projectId: project_id,
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
    } catch (err) {
      return fail(err, 'Failed to list issues by project id');
    }
  }
);

server.registerTool(
  'get_top_vulnerabilities',
  {
    description: 'Return a summary of vulnerability counts grouped by severity for a given company (risk overview). '
      + 'Optional filters (severities, statuses, asset_ids, asset_tags, created_after/created_before) narrow the '
      + 'overview; when none are set the response is identical to calling with no arguments at all. '
      + 'severities: NOTIFICATION, LOW, MEDIUM, HIGH, CRITICAL. statuses: CREATED, DRAFT, IDENTIFIED, IN_PROGRESS, '
      + 'AWAITING_VALIDATION, FIX_ACCEPTED, RISK_ACCEPTED, FALSE_POSITIVE, SUPPRESSED. created_after/created_before '
      + 'are ISO8601 dates (YYYY-MM-DD).',
    inputSchema: z.object({
      company_id: z.number(),
      severities: z.array(z.string()).optional(),
      statuses: z.array(z.string()).optional(),
      asset_ids: z.array(z.number()).optional(),
      asset_tags: z.array(z.string()).optional(),
      created_after: z.string().optional(),
      created_before: z.string().optional(),
    }),
    annotations: {
      title: 'Top Vulnerabilities',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ company_id, severities, statuses, asset_ids, asset_tags, created_after, created_before }) => {
    try {
      return ok(await gateway.get_top_vulnerabilities(company_id, {
        severities,
        statuses,
        assetIds: asset_ids,
        assetTags: asset_tags,
        createdAfter: created_after,
        createdBefore: created_before,
      }));
    } catch (err) {
      return fail(err, 'Failed to get top vulnerabilities');
    }
  }
);

server.registerTool(
  'get_projects',
  {
    description: `Return a paginated list of security projects for a company, with filtering and sorting. Defaults to 25 results per page to conserve tokens.

Filters (all optional):
- search: substring match on project label.
- statuses: platform status labels (free text, e.g. "Fixing"), not an enum.
- project_types: platform project type labels (free text, e.g. "Pentest"), not an enum.
- created_after / created_before: ISO8601 dates (YYYY-MM-DD) bounding createdAt.
- tags: list of project tags.
- analyst_emails: list of allocated analyst emails.
- sort_by: field to sort by (default "createdAt"). descending: sort direction (default true).`,
    inputSchema: z.object({
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
    annotations: {
      title: 'List Projects',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({
    company_id, page = 1, limit = 25, search = '', statuses, project_types,
    created_after, created_before, tags, analyst_emails, sort_by = 'createdAt',
    descending = true,
  }) => {
    try {
      return ok(await gateway.get_projects(company_id, page, limit, search, {
        statuses,
        projectTypes: project_types,
        createdAfter: created_after,
        createdBefore: created_before,
        tags,
        analystEmails: analyst_emails,
        sortBy: sort_by,
        descending,
      }));
    } catch (err) {
      return fail(err, 'Failed to list projects');
    }
  }
);

server.registerTool(
  'get_project',
  {
    description: 'Retrieve detailed metadata for a specific project by its ID.',
    inputSchema: z.object({ project_id: z.number() }),
    annotations: {
      title: 'Project Details',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ project_id }) => {
    try {
      return ok(await gateway.get_project_by_id(project_id));
    } catch (err) {
      return fail(err, 'Failed to get project');
    }
  }
);

server.registerTool(
  'get_asset',
  {
    description: 'Fetch information about a specific asset by its ID.',
    inputSchema: z.object({ asset_id: z.number() }),
    annotations: {
      title: 'Asset Details',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ asset_id }) => {
    try {
      return ok(await gateway.get_asset_by_id(asset_id));
    } catch (err) {
      return fail(err, 'Failed to get asset');
    }
  }
);

server.registerTool(
  'get_assets',
  {
    description: `Return a paginated list of assets for a company, with rich filtering and sorting. Defaults to 25 results per page to reduce token usage.

Filters (all optional):
- name / search: substring match on asset name.
- tags: list of asset tags.
- technology: list of technologies.
- business_impact: any of LOW, MEDIUM, HIGH, NOT_DEFINED.
- exploitability: any of INTERNET_FACING, INTERNAL, NOT_DEFINED.
- asset_type: asset type filter.
- environment_compromised: boolean filter for compromised environment.
- covered_by_scan: boolean filter for scan coverage.
- sort_by: one of updated_at, name, business_impact, risk_score. order: ASC or DESC.
- extra_filters: object mapping directly to AssetsSearch for advanced keys.
  extra_filters values are sent as-is — omit a key rather than passing an empty list.

Returns asset collection (id, name, assetType, environment, audience, dates, riskScore)
plus metadata (totalCount, totalPages, currentPage) for pagination.`,
    inputSchema: z.object({
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
    annotations: {
      title: 'List Assets',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({
    company_id, page = 1, limit = 25, name, search, tags, technology,
    business_impact, exploitability, asset_type, environment_compromised,
    covered_by_scan, sort_by, order, extra_filters,
  }) => {
    try {
      return ok(await gateway.get_assets(company_id, page, limit, {
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
    } catch (err) {
      return fail(err, 'Failed to list assets');
    }
  }
);

server.registerTool(
  'create_project_url',
  {
    description: 'Return a direct URL to open a project in the Conviso Platform for quick navigation.',
    inputSchema: z.object({
      company_id: z.number(),
      project_id: z.number(),
    }),
    annotations: {
      title: 'Project URL Generator',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ company_id, project_id }) => {
    try {
      return ok(await gateway.create_project_url(company_id, project_id));
    } catch (err) {
      return fail(err, 'Failed to create project URL');
    }
  }
);

server.registerTool(
  'create_issue_url',
  {
    description: 'Return a direct URL to open a specific issue in the Conviso Platform for triage or review.',
    inputSchema: z.object({
      company_id: z.number(),
      issue_id: z.number(),
    }),
    annotations: {
      title: 'Issue URL Generator',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ company_id, issue_id }) => {
    try {
      return ok(await gateway.create_issue_url(company_id, issue_id));
    } catch (err) {
      return fail(err, 'Failed to create issue URL');
    }
  }
);

server.registerTool(
  'get_mttr_over_time',
  {
    description: 'Get Mean Time To Resolution (MTTR) aggregated over a date range. Supports filtering by severities, statuses, and assets.',
    inputSchema: z.object({
      company_id: z.number(),
      start_date: z.string(),
      end_date: z.string(),
      severities: z.array(z.string()).optional(),
      statuses: z.array(z.string()).optional(),
      asset_ids: z.array(z.number()).optional(),
      asset_tags: z.array(z.string()).optional(),
    }),
    annotations: {
      title: 'MTTR Over Time',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (args) => {
    try {
      return ok(await gateway.get_mttr_over_time(
        args.company_id,
        args.start_date,
        args.end_date,
        args.severities,
        args.statuses,
        args.asset_ids,
        args.asset_tags
      ));
    } catch (err) {
      return fail(err, 'Failed to get MTTR metrics');
    }
  }
);

server.registerTool(
  'get_overall_risk_score_history',
  {
    description: 'Retrieve historical overall risk scores for a company, useful for trend analysis and reporting.',
    inputSchema: z.object({
      company_id: z.number(),
    }),
    annotations: {
      title: 'Risk Score History',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ company_id }) => {
    try {
      return ok(await gateway.get_overall_risk_score_history(company_id));
    } catch (err) {
      return fail(err, 'Failed to get risk score history');
    }
  }
);

server.registerTool(
  'get_today_date',
  {
    description: 'Utility tool returning the current date.',
    inputSchema: z.object({}),
    annotations: {
      title: 'Get Today Date',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      const d = new Date();
      return ok({ day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() });
    } catch (err) {
      return fail(err, 'Failed to get current date');
    }
  }
);

/**
 * MUTATIONS — generic catalog-driven engine (covers the allowlisted platform mutations;
 * see operation_allowlist.js)
 */

server.registerTool(
  'list_mutations',
  {
    description: `Discover available Conviso Platform mutations (write operations). Returns name, description, category and a destructive flag. This is step 1 of the write workflow: list_mutations (discover) -> describe_mutation (get the input schema) -> execute_mutation (run it).

Filters (all optional):
- search: case-insensitive substring matched against mutation name and description.
- category: one of issue, ticket, project, asset, requirement, pentest, application, threat_model.
- limit: max rows to return (default 50).`,
    inputSchema: z.object({
      search: z.string().optional(),
      category: z.string().optional(),
      limit: z.number().optional(),
    }),
    annotations: {
      title: 'List Mutations',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ search, category, limit }) => {
    try {
      return ok(gateway.list_mutations({ search, category, limit }));
    } catch (err) {
      return fail(err, 'Failed to list mutations');
    }
  }
);

server.registerTool(
  'describe_mutation',
  {
    description: `Return the full input schema for a single mutation: argument list, every input field (with type, whether it is required, descriptions, allowed enum values, and nested input objects expanded), plus the default fields returned by execute_mutation. Use this before execute_mutation to build a valid 'variables.input' object.`,
    inputSchema: z.object({
      name: z.string(),
    }),
    annotations: {
      title: 'Describe Mutation',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ name }) => {
    try {
      return ok(gateway.describe_mutation(name));
    } catch (err) {
      return fail(err, 'Failed to describe mutation');
    }
  }
);

server.registerTool(
  'execute_mutation',
  {
    description: `Execute any allowlisted Conviso Platform mutation by name (use list_mutations to see the full set). Covers writes for issues/vulnerabilities, assets (+ DAST), tickets, projects, requirements, AI-pentest, applications and threat modeling.

Usage: call describe_mutation(name) first to learn the input shape, then pass it here. Every mutation takes a single input object, so variables must be { "input": { ...fields... } }.

- name: the mutation name (e.g. "changeIssueStatus", "createProject", "deleteAsset").
- variables: GraphQL variables, normally { input: { ... } }.
- return_fields: optional raw GraphQL selection set to override the default returned fields.

WARNING: this performs writes and can be destructive (the catalog marks delete/bulk/remove/cancel/revoke operations as destructive). Confirm intent before running delete or bulk mutations.`,
    inputSchema: z.object({
      name: z.string(),
      variables: z.record(z.string(), z.any()).optional(),
      return_fields: z.string().optional(),
    }),
    annotations: {
      title: 'Execute Mutation',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ name, variables = {}, return_fields = null }) => {
    try {
      return ok(await gateway.execute_mutation(name, variables, return_fields));
    } catch (err) {
      return fail(err, 'Failed to execute mutation');
    }
  }
);

/**
 * MUTATIONS — curated typed shortcuts for the most common writes
 */

server.registerTool(
  'change_issue_status',
  {
    description: `Change the status of an issue/vulnerability. status must be one of CREATED, DRAFT, IDENTIFIED, IN_PROGRESS, AWAITING_VALIDATION, FIX_ACCEPTED, RISK_ACCEPTED, FALSE_POSITIVE, SUPPRESSED. Pass 'extra' for advanced ChangeIssueStatusInput fields (e.g. riskAcceptedUntil, externalAuthorIdentifier).`,
    inputSchema: z.object({
      issue_id: z.number(),
      status: z.string(),
      reason: z.string().optional(),
      extra: z.record(z.string(), z.any()).optional(),
    }),
    annotations: {
      title: 'Change Issue Status',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ issue_id, status, reason, extra }) => {
    try {
      return ok(await gateway.change_issue_status({ issue_id, status, reason, extra }));
    } catch (err) {
      return fail(err, 'Failed to change issue status');
    }
  }
);

server.registerTool(
  'create_source_code_vulnerability',
  {
    description: `Create a source-code (SAST-style) vulnerability/issue on an asset. severity is one of NOTIFICATION, LOW, MEDIUM, HIGH, CRITICAL; impact_level and probability_level are LOW, MEDIUM or HIGH (default MEDIUM); status defaults to DRAFT. Pass 'extra' for any other CreateSourceCodeVulnerabilityInput field.`,
    inputSchema: z.object({
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
    annotations: {
      title: 'Create Source Code Vulnerability',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (args) => {
    try {
      return ok(await gateway.create_source_code_vulnerability(args));
    } catch (err) {
      return fail(err, 'Failed to create source code vulnerability');
    }
  }
);

server.registerTool(
  'create_project',
  {
    description: `Create a project. Required: company_id, type_id (project type id), label, goal, scope, start_date (YYYY-MM-DD). Optional: end_date. Pass 'extra' for advanced CreateProjectInput fields (e.g. assetsIds, tags, allocatedPortalUserEmails, playbooksIds).`,
    inputSchema: z.object({
      company_id: z.number(),
      type_id: z.number(),
      label: z.string(),
      goal: z.string(),
      scope: z.string(),
      start_date: z.string(),
      end_date: z.string().optional(),
      extra: z.record(z.string(), z.any()).optional(),
    }),
    annotations: {
      title: 'Create Project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (args) => {
    try {
      return ok(await gateway.create_project(args));
    } catch (err) {
      return fail(err, 'Failed to create project');
    }
  }
);

server.registerTool(
  'create_asset',
  {
    description: `Create an asset. Required: company_id, name. Optional: asset_type, url, description, business_impact (LOW/MEDIUM/HIGH/NOT_DEFINED), exploitability (INTERNET_FACING/INTERNAL/NOT_DEFINED), tags (string list). Pass 'extra' for advanced CreateAssetInput fields.`,
    inputSchema: z.object({
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
    annotations: {
      title: 'Create Asset',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (args) => {
    try {
      return ok(await gateway.create_asset(args));
    } catch (err) {
      return fail(err, 'Failed to create asset');
    }
  }
);

server.registerTool(
  'create_ticket',
  {
    description: `Open a ticket. Required: company_id, type (BUG, FEATURE_REQUEST, PROJECT_REQUEST, SUPPORT_REQUEST), title, description. Optional: priority (P1/P2/P3), impact (LOW/MEDIUM/HIGH). Pass 'extra' for advanced CreateTicketInput fields.`,
    inputSchema: z.object({
      company_id: z.number(),
      type: z.string(),
      title: z.string(),
      description: z.string(),
      priority: z.string().optional(),
      impact: z.string().optional(),
      extra: z.record(z.string(), z.any()).optional(),
    }),
    annotations: {
      title: 'Create Ticket',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (args) => {
    try {
      return ok(await gateway.create_ticket(args));
    } catch (err) {
      return fail(err, 'Failed to create ticket');
    }
  }
);

/**
 * CURATED WRITES — DAST + AI-Pentest shortcuts
 */

server.registerTool(
  'run_dast',
  {
    description: 'Start a Conviso DAST scan on an asset (startConvisoDast). Required: asset_id.',
    inputSchema: z.object({ asset_id: z.number(), extra: z.record(z.string(), z.any()).optional() }),
    annotations: { title: 'Run DAST', ...WRITE },
  },
  async ({ asset_id, extra }) => {
    try {
      return ok(await gateway.run_dast({ asset_id, extra }));
    } catch (err) {
      return fail(err, 'Failed to start DAST');
    }
  }
);

server.registerTool(
  'trigger_pentest',
  {
    description: 'Trigger an AI-Pentest execution from an existing pentest artifact (createPentestExecution). Required: artifact_id.',
    inputSchema: z.object({ artifact_id: z.number(), extra: z.record(z.string(), z.any()).optional() }),
    annotations: { title: 'Trigger AI-Pentest', ...WRITE },
  },
  async ({ artifact_id, extra }) => {
    try {
      return ok(await gateway.trigger_pentest({ artifact_id, extra }));
    } catch (err) {
      return fail(err, 'Failed to trigger pentest');
    }
  }
);

server.registerTool(
  'create_pentest_artifact',
  {
    description: 'Create an AI-Pentest artifact (the scope/config a pentest runs against). Required: company_id, application_id, label, pentest_type. Optional: description, scope_text, assignee_email, domains, in_scope, out_scope. Pass \'extra\' for advanced fields (scheduling, repositories, documentation, size/depth).',
    inputSchema: z.object({
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
    annotations: { title: 'Create Pentest Artifact', ...WRITE },
  },
  async (args) => {
    try {
      return ok(await gateway.create_pentest_artifact(args));
    } catch (err) {
      return fail(err, 'Failed to create pentest artifact');
    }
  }
);

/**
 * READS — Tickets, Requirements, Applications, Scans, Supply chain, AI-Pentest, Threat Modeling
 */

server.registerTool(
  'get_tickets',
  {
    description: 'List tickets for a company (paginated). Optional: search (title/description), sort_by, descending, and params (TicketSearch: types, statuses, priorities, impacts, tags, mineOnly...).',
    inputSchema: z.object({
      company_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      sort_by: z.string().optional(),
      descending: z.boolean().optional(),
      params: z.record(z.string(), z.any()).optional(),
    }),
    annotations: { title: 'List Tickets', ...READ },
  },
  async ({ company_id, page, limit, search, sort_by, descending, params }) => {
    try {
      return ok(await gateway.get_tickets(company_id, { page, limit, search, sort_by, descending, params }));
    } catch (err) {
      return fail(err, 'Failed to list tickets');
    }
  }
);

server.registerTool(
  'get_ticket',
  {
    description: 'Get a single ticket by id, including status, priority, impact and assignee.',
    inputSchema: z.object({ company_id: z.number(), ticket_id: z.number() }),
    annotations: { title: 'Ticket Details', ...READ },
  },
  async ({ company_id, ticket_id }) => {
    try {
      return ok(await gateway.get_ticket(company_id, ticket_id));
    } catch (err) {
      return fail(err, 'Failed to get ticket');
    }
  }
);

server.registerTool(
  'get_requirements',
  {
    description: 'List security requirements/checklists for a scope (company) id, paginated. Optional: filters (RequirementsFilterInput).',
    inputSchema: z.object({
      scope_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      filters: z.record(z.string(), z.any()).optional(),
    }),
    annotations: { title: 'List Requirements', ...READ },
  },
  async ({ scope_id, page, limit, filters }) => {
    try {
      return ok(await gateway.get_requirements(scope_id, { page, limit, filters }));
    } catch (err) {
      return fail(err, 'Failed to list requirements');
    }
  }
);

server.registerTool(
  'get_requirement',
  {
    description: 'Get a single requirement/checklist by id.',
    inputSchema: z.object({ company_id: z.number(), requirement_id: z.number() }),
    annotations: { title: 'Requirement Details', ...READ },
  },
  async ({ company_id, requirement_id }) => {
    try {
      return ok(await gateway.get_requirement(company_id, requirement_id));
    } catch (err) {
      return fail(err, 'Failed to get requirement');
    }
  }
);

server.registerTool(
  'get_project_requirements',
  {
    description: 'List the requirements/checklists attached to a specific project.',
    inputSchema: z.object({ project_id: z.number() }),
    annotations: { title: 'Project Requirements', ...READ },
  },
  async ({ project_id }) => {
    try {
      return ok(await gateway.get_project_requirements(project_id));
    } catch (err) {
      return fail(err, 'Failed to list project requirements');
    }
  }
);

server.registerTool(
  'get_applications',
  {
    description: 'List applications for a company (id, name, url, riskScore, assetsCount). Optional: search by name.',
    inputSchema: z.object({ company_id: z.number(), search: z.string().optional() }),
    annotations: { title: 'List Applications', ...READ },
  },
  async ({ company_id, search }) => {
    try {
      return ok(await gateway.get_applications(company_id, search));
    } catch (err) {
      return fail(err, 'Failed to list applications');
    }
  }
);

server.registerTool(
  'get_application',
  {
    description: 'Get a single application by id, including its linked assets.',
    inputSchema: z.object({ company_id: z.number(), application_id: z.number() }),
    annotations: { title: 'Application Details', ...READ },
  },
  async ({ company_id, application_id }) => {
    try {
      return ok(await gateway.get_application(company_id, application_id));
    } catch (err) {
      return fail(err, 'Failed to get application');
    }
  }
);

server.registerTool(
  'get_scan_histories',
  {
    description: 'List scan execution histories for a company (status, integration, durations, vulnerability counts). Optional: asset_ids, page, limit, filters (ScansHistoriesFiltersInput).',
    inputSchema: z.object({
      company_id: z.number(),
      asset_ids: z.array(z.number()).optional(),
      page: z.number().optional(),
      limit: z.number().optional(),
      filters: z.record(z.string(), z.any()).optional(),
    }),
    annotations: { title: 'List Scan Histories', ...READ },
  },
  async ({ company_id, asset_ids, page, limit, filters }) => {
    try {
      return ok(await gateway.get_scan_histories(company_id, { assetIds: asset_ids, page, limit, filters }));
    } catch (err) {
      return fail(err, 'Failed to list scan histories');
    }
  }
);

server.registerTool(
  'get_asset_scans_count',
  {
    description: 'Get scan coverage counts for a company (assets with scans, without scans, and which scans are considered).',
    inputSchema: z.object({ company_id: z.number() }),
    annotations: { title: 'Asset Scans Count', ...READ },
  },
  async ({ company_id }) => {
    try {
      return ok(await gateway.get_asset_scans_count(company_id));
    } catch (err) {
      return fail(err, 'Failed to get asset scans count');
    }
  }
);

server.registerTool(
  'get_sbom_components',
  {
    description: 'List Software Bill of Materials (SBOM) / supply-chain components for a company (name, version, technology, package manager, license, issues by severity). Optional: search (SbomComponentSearchInput).',
    inputSchema: z.object({
      company_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.record(z.string(), z.any()).optional(),
    }),
    annotations: { title: 'List SBOM Components', ...READ },
  },
  async ({ company_id, page, limit, search }) => {
    try {
      return ok(await gateway.get_sbom_components(company_id, { page, limit, search }));
    } catch (err) {
      return fail(err, 'Failed to list SBOM components');
    }
  }
);

server.registerTool(
  'get_pentest_artifacts',
  {
    description: 'List AI-Pentest artifacts for a company (label, type, scheduling, latest execution). Optional: search, assignee_email, pentest_type, application_id.',
    inputSchema: z.object({
      company_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      assignee_email: z.string().optional(),
      pentest_type: z.string().optional(),
      application_id: z.number().optional(),
    }),
    annotations: { title: 'List Pentest Artifacts', ...READ },
  },
  async ({ company_id, page, limit, search, assignee_email, pentest_type, application_id }) => {
    try {
      return ok(await gateway.get_pentest_artifacts(company_id, {
        page, limit, search, assigneeEmail: assignee_email, pentestType: pentest_type, applicationId: application_id,
      }));
    } catch (err) {
      return fail(err, 'Failed to list pentest artifacts');
    }
  }
);

server.registerTool(
  'get_pentest_artifact',
  {
    description: 'Get a single AI-Pentest artifact by id, including scope and its executions.',
    inputSchema: z.object({ artifact_id: z.number() }),
    annotations: { title: 'Pentest Artifact Details', ...READ },
  },
  async ({ artifact_id }) => {
    try {
      return ok(await gateway.get_pentest_artifact(artifact_id));
    } catch (err) {
      return fail(err, 'Failed to get pentest artifact');
    }
  }
);

server.registerTool(
  'get_pentest_execution',
  {
    description: 'Get the result/status of a single AI-Pentest execution by id (status, vulnerability count, severity breakdown, retest progress).',
    inputSchema: z.object({ execution_id: z.number() }),
    annotations: { title: 'Pentest Execution Result', ...READ },
  },
  async ({ execution_id }) => {
    try {
      return ok(await gateway.get_pentest_execution(execution_id));
    } catch (err) {
      return fail(err, 'Failed to get pentest execution');
    }
  }
);

server.registerTool(
  'get_threat_model_artifacts',
  {
    description: 'List Threat Modeling artifacts for a company (label, scope, latest version). Optional: search, assignee_email, has_version.',
    inputSchema: z.object({
      company_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      assignee_email: z.string().optional(),
      has_version: z.boolean().optional(),
    }),
    annotations: { title: 'List Threat Model Artifacts', ...READ },
  },
  async ({ company_id, page, limit, search, assignee_email, has_version }) => {
    try {
      return ok(await gateway.get_threat_model_artifacts(company_id, {
        page, limit, search, assigneeEmail: assignee_email, hasVersion: has_version,
      }));
    } catch (err) {
      return fail(err, 'Failed to list threat model artifacts');
    }
  }
);

server.registerTool(
  'get_threat_model_artifact',
  {
    description: 'Get a single Threat Modeling artifact by id, including its versions (diagrams, notes, scope).',
    inputSchema: z.object({ artifact_id: z.number() }),
    annotations: { title: 'Threat Model Artifact Details', ...READ },
  },
  async ({ artifact_id }) => {
    try {
      return ok(await gateway.get_threat_model_artifact(artifact_id));
    } catch (err) {
      return fail(err, 'Failed to get threat model artifact');
    }
  }
);

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
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  httpServer.listen(PORT, () => {
    console.error(`Conviso MCP Server running on HTTP port ${PORT}`);
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Conviso MCP Server running on stdio');
}