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
  version: pkg.version || '0.3.2',
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

  return { error: message, status, error_id };
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

server.registerTool(
  'get_companies',
  {
    description: 'Return a paginated list of companies accessible with the provided API key. Use `search` to filter by company name.',
    inputSchema: z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    }),
    annotations: {
      title: 'List Companies',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ page = 1, limit = 10, search = '' }) => {
    try {
      return ok(await gateway.get_companies(page, limit, search));
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
    description: 'List vulnerabilities for a company or project.',
    inputSchema: z.object({
      company_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      project_id: z.number().optional(),
    }),
    annotations: {
      title: 'List Issues',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ company_id, page = 1, limit = 10, project_id }) => {
    try {
      return ok(await gateway.get_issues(company_id, '', page, limit, project_id));
    } catch (err) {
      return fail(err, 'Failed to list issues');
    }
  }
);

server.registerTool(
  'get_issues_by_asset_ids',
  {
    description: 'List vulnerabilities for a company filtered by asset IDs. Supports pagination.',
    inputSchema: z.object({
      company_id: z.number(),
      asset_ids: z.array(z.number()),
      page: z.number().optional(),
      limit: z.number().optional(),
    }),
    annotations: {
      title: 'List Issues by Asset IDs',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ company_id, asset_ids = [], page = 1, limit = 10 }) => {
    try {
      return ok(await gateway.get_issues_by_asset_ids(company_id, page, limit, asset_ids));
    } catch (err) {
      return fail(err, 'Failed to list issues by asset ids');
    }
  }
);

server.registerTool(
  'get_top_vulnerabilities',
  {
    description: 'Return a summary of vulnerability counts grouped by severity for a given company (risk overview).',
    inputSchema: z.object({ company_id: z.number() }),
    annotations: {
      title: 'Top Vulnerabilities',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ company_id }) => {
    try {
      return ok(await gateway.get_top_vulnerabilities(company_id));
    } catch (err) {
      return fail(err, 'Failed to get top vulnerabilities');
    }
  }
);

server.registerTool(
  'get_projects',
  {
    description: 'Return a paginated list of active security projects for a company. Defaults to 25 results per page to conserve tokens.',
    inputSchema: z.object({
      company_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    }),
    annotations: {
      title: 'List Projects',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ company_id, page = 1, limit = 25, search = '' }) => {
    try {
      return ok(await gateway.get_projects(company_id, page, limit, search));
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
    description: 'Return a paginated list of assets for a company. Defaults to 25 results per page to reduce token usage.',
    inputSchema: z.object({
      company_id: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
    }),
    annotations: {
      title: 'List Assets',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ company_id, page = 1, limit = 25 }) => {
    try {
      return ok(await gateway.get_assets(company_id, page, limit));
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