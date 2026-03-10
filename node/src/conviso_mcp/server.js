#!/usr/bin/env node

require('dotenv').config();
const { FeedGateway } = require('./feed_gateway');
const { FastMCP } = require('fastmcp');
const { z } = require('zod');

const base_url = FeedGateway.get_base_url();
const gateway = new FeedGateway(base_url);

console.error('[+] Starting Conviso MCP Server (FastMCP)');
console.error('[+] Using base API URL: %s', base_url);

const _pkg = require('../../package.json');
const server = new FastMCP({ name: _pkg.name || 'conviso-mcp', version: _pkg.version || '0.2.1' });

function sanitizeError(err, message = 'Request failed') {
  const error_id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;

  const status =
    err?.response?.status ??
    err?.response?.statusCode ??
    err?.status ??
    err?.statusCode ??
    (err?.code === 'ECONNREFUSED' ? 503 : undefined) ??
    (err?.code === 'ETIMEDOUT' ? 504 : undefined) ??
    500;

  const safeLog = {
    error_id,
    name: err?.name,
    code: err?.code,
    message: err?.message?.slice(0, 200),
    status
  };

  console.error('[tool_error]', safeLog);

  return {
    error: message,
    status,
    error_id
  };
}

server.addTool({
	name: 'get_companies',
	description: 'Return a paginated list of companies accessible with the provided API key. Use `search` to filter by company name.',
	annotations: { title: 'List Companies', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	structured_output: false,
	parameters: z.object({
		page: z.number().optional(),
		limit: z.number().optional(),
		search: z.string().optional(),
	}),
	execute: async (args) => {
		try {
			const page = args?.page ?? 1;
			const limit = args?.limit ?? 10;
			const search = args?.search ?? '';
			const res = await gateway.get_companies(page, limit, search);
			return typeof res === 'string' ? res : JSON.stringify(res);
		} catch (err) {
			return JSON.stringify(sanitizeError(err, 'Failed to list companies'));
		}
	},
});

server.addTool({
	name: 'get_company_info',
	description: 'Retrieve detailed information about a specific company, including plan, integrations, and branding metadata.',
	annotations: { title: 'Company Details', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	structured_output: false,
	parameters: z.object({ company_id: z.number() }),
	execute: async (args) => {
		try {
			const res = await gateway.get_company_by_id(args.company_id);
			return typeof res === 'string' ? res : JSON.stringify(res);
		} catch (err) {
			return JSON.stringify(sanitizeError(err, 'Failed to get company info'));
		}
	},
});

server.addTool({
	name: 'get_issue',
	description: 'Fetch detailed technical data for a specific vulnerability/issue. Optionally include raw request/response and vulnerable code snippets when `return_vulnerable_data` is true.',
	annotations: { title: 'Issue Details', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	structured_output: false,
	parameters: z.object({ id: z.number(), return_vulnerable_data: z.boolean().optional() }),
	execute: async (args) => {
		try {
			const res = await gateway.get_issue_by_id(args.id, args.return_vulnerable_data);
			return typeof res === 'string' ? res : JSON.stringify(res);
		} catch (err) {
			return JSON.stringify(sanitizeError(err, 'Failed to get issue details'));
		}
	},
});

server.addTool({
	name: 'get_issues',
	description: 'List vulnerabilities for a company or project. Supports pagination and filtering by project.',
	annotations: { title: 'List Issues', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	structured_output: false,
	parameters: z.object({ company_id: z.number(), page: z.number().optional(), limit: z.number().optional(), project_id: z.number().optional() }),
	execute: async (args) => {
		try {
			const res = await gateway.get_issues(args.company_id, '', args.page ?? 1, args.limit ?? 10, args.project_id);
			return typeof res === 'string' ? res : JSON.stringify(res);
		} catch (err) {
			return JSON.stringify(sanitizeError(err, 'Failed to list issues'));
		}
	},
});

server.addTool({
	name: 'get_top_vulnerabilities',
	description: 'Return a summary of vulnerability counts grouped by severity for a given company (risk overview).',
	annotations: { title: 'Top Vulnerabilities', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	structured_output: false,
	parameters: z.object({ company_id: z.number() }),
	execute: async (args) => {
		try {
			const res = await gateway.get_top_vulnerabilities(args.company_id);
			return typeof res === 'string' ? res : JSON.stringify(res);
		} catch (err) {
			return JSON.stringify(sanitizeError(err, 'Failed to get top vulnerabilities'));
		}
	},
});

server.addTool({
	name: 'get_projects',
	description: 'Return a paginated list of active security projects for a company. Defaults to 25 results per page to conserve tokens.',
	annotations: { title: 'List Projects', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	structured_output: false,
	parameters: z.object({ company_id: z.number(), page: z.number().optional(), limit: z.number().optional(), search: z.string().optional() }),
	execute: async (args) => {
		try {
			const res = await gateway.get_projects(args.company_id, args.page ?? 1, args.limit ?? 25, args.search ?? '');
			return typeof res === 'string' ? res : JSON.stringify(res);
		} catch (err) {
			return JSON.stringify(sanitizeError(err, 'Failed to list projects'));
		}
	},
});

server.addTool({
	name: 'get_project',
	description: 'Retrieve detailed metadata for a specific project by its ID.',
	annotations: { title: 'Project Details', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	structured_output: false,
	parameters: z.object({ project_id: z.number() }),
	execute: async (args) => {
		try {
			const res = await gateway.get_project_by_id(args.project_id);
			return typeof res === 'string' ? res : JSON.stringify(res);
		} catch (err) {
			return JSON.stringify(sanitizeError(err, 'Failed to get project'));
		}
	},
});

server.addTool({
	name: 'get_asset',
	description: 'Fetch information about a specific asset by its ID.',
	annotations: { title: 'Asset Details', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	structured_output: false,
	parameters: z.object({ asset_id: z.number() }),
	execute: async (args) => {
		try {
			const res = await gateway.get_asset_by_id(args.asset_id);
			return typeof res === 'string' ? res : JSON.stringify(res);
		} catch (err) {
			return JSON.stringify(sanitizeError(err, 'Failed to get asset'));
		}
	},
});

server.addTool({
	name: 'get_assets',
	description: 'Return a paginated list of assets for a company. Defaults to 25 results per page to reduce token usage.',
	annotations: { title: 'List Assets', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	structured_output: false,
	parameters: z.object({ company_id: z.number(), page: z.number().optional(), limit: z.number().optional() }),
	execute: async (args) => {
		try {
			const res = await gateway.get_assets(args.company_id, args.page ?? 1, args.limit ?? 25);
			return typeof res === 'string' ? res : JSON.stringify(res);
		} catch (err) {
			return JSON.stringify(sanitizeError(err, 'Failed to list assets'));
		}
	},
});

server.addTool({
	name: 'create_project_url',
	description: 'Return a direct URL to open a project in the Conviso Platform for quick navigation.',
	annotations: { title: 'Project URL Generator', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	structured_output: false,
	parameters: z.object({ company_id: z.number(), project_id: z.number() }),
	execute: async (args) => {
		try {
			const res = await gateway.create_project_url(args.company_id, args.project_id);
			return typeof res === 'string' ? res : JSON.stringify(res);
		} catch (err) {
			return JSON.stringify(sanitizeError(err, 'Failed to create project URL'));
		}
	},
});

server.addTool({
	name: 'create_issue_url',
	description: 'Return a direct URL to open a specific issue in the Conviso Platform for triage or review.',
	annotations: { title: 'Issue URL Generator', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	structured_output: false,
	parameters: z.object({ company_id: z.number(), issue_id: z.number() }),
	execute: async (args) => {
		try {
			const res = await gateway.create_issue_url(args.company_id, args.issue_id);
			return typeof res === 'string' ? res : JSON.stringify(res);
		} catch (err) {
			return JSON.stringify(sanitizeError(err, 'Failed to create issue URL'));
		}
	},
});

server.addTool({
	name: 'get_mttr_over_time',
	description: 'Get Mean Time To Resolution (MTTR) aggregated over a date range. Supports filtering by severities, statuses, and assets.',
	annotations: { title: 'MTTR Over Time', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	structured_output: false,
	parameters: z.object({
		company_id: z.number(),
		start_date: z.string(),
		end_date: z.string(),
		severities: z.array(z.string()).optional(),
		statuses: z.array(z.string()).optional(),
		asset_ids: z.array(z.number()).optional(),
		asset_tags: z.array(z.string()).optional(),
	}),
	execute: async (args) => {
		try {
			const res = await gateway.get_mttr_over_time(args.company_id, args.start_date, args.end_date, args.severities, args.statuses, args.asset_ids, args.asset_tags);
			return typeof res === 'string' ? res : JSON.stringify(res);
		} catch (err) {
			return JSON.stringify(sanitizeError(err, 'Failed to get MTTR metrics'));
		}
	},
});

server.addTool({
	name: 'get_overall_risk_score_history',
	description: 'Retrieve historical overall risk scores for a company, useful for trend analysis and reporting.',
	annotations: { title: 'Risk Score History', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	structured_output: false,
	parameters: z.object({ company_id: z.number() }),
	execute: async (args) => {
		try {
			const res = await gateway.get_overall_risk_score_history(args.company_id);
			return typeof res === 'string' ? res : JSON.stringify(res);
		} catch (err) {
			return JSON.stringify(sanitizeError(err, 'Failed to get risk score history'));
		}
	},
});

server.addTool({
	name: 'get_today_date',
	description: 'Utility tool returning the current day, month and year. Useful for tests or date-based queries.',
	annotations: { title: 'Get Today Date', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	structured_output: false,
	parameters: z.object({}),
	execute: async () => {
		try {
			const d = new Date();
			const res = { day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() };
			return JSON.stringify(res);
		} catch (err) {
			return JSON.stringify(sanitizeError(err, 'Failed to get current date'));
		}
	},
});

module.exports = { server, gateway };

if (require.main === module) {
	(async () => {
		await server.start({ transportType: 'stdio' });
	})().catch((err) => {
		console.error('Failed to start FastMCP server:', err);
		process.exit(1);
	});
}