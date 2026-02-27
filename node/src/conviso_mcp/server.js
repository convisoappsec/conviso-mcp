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
const server = new FastMCP({ name: _pkg.name || 'conviso-mcp', version: _pkg.version || '0.2.0' });

server.addTool({
	name: 'get_companies',
	description: 'Get company list in Conviso Platform and IDs.',
	structured_output: false,
	parameters: z.object({
		page: z.number().optional(),
		limit: z.number().optional(),
		search: z.string().optional(),
	}),
	execute: async (args) => {
		const page = args?.page ?? 1;
		const limit = args?.limit ?? 10;
		const search = args?.search ?? '';
		const res = await gateway.get_companies(page, limit, search);
		return typeof res === 'string' ? res : JSON.stringify(res);
	},
});

server.addTool({
	name: 'get_company_info',
	description: 'Get company details by ID.',
	structured_output: false,
	parameters: z.object({ company_id: z.number() }),
	execute: async (args) => {
		const res = await gateway.get_company_by_id(args.company_id);
		return typeof res === 'string' ? res : JSON.stringify(res);
	},
});

server.addTool({
	name: 'get_issue',
	description: 'Get issue details by ID.',
	structured_output: false,
	parameters: z.object({ id: z.number(), return_vulnerable_data: z.boolean().optional() }),
	execute: async (args) => {
		const res = await gateway.get_issue_by_id(args.id, args.return_vulnerable_data);
		return typeof res === 'string' ? res : JSON.stringify(res);
	},
});

server.addTool({
	name: 'get_issues',
	description: 'Get issues list by company ID.',
	structured_output: false,
	parameters: z.object({ company_id: z.number(), page: z.number().optional(), limit: z.number().optional(), project_id: z.number().optional() }),
	execute: async (args) => {
		const res = await gateway.get_issues(args.company_id, '', args.page ?? 1, args.limit ?? 10, args.project_id);
		return typeof res === 'string' ? res : JSON.stringify(res);
	},
});

server.addTool({
	name: 'get_top_vulnerabilities',
	description: 'Get top vulnerabilities by company ID.',
	structured_output: false,
	parameters: z.object({ company_id: z.number() }),
	execute: async (args) => {
		const res = await gateway.get_top_vulnerabilities(args.company_id);
		return typeof res === 'string' ? res : JSON.stringify(res);
	},
});

server.addTool({
	name: 'get_projects',
	description: 'Get project list by company ID.',
	structured_output: false,
	parameters: z.object({ company_id: z.number(), page: z.number().optional(), limit: z.number().optional(), search: z.string().optional() }),
	execute: async (args) => {
		const res = await gateway.get_projects(args.company_id, args.page ?? 1, args.limit ?? 1000, args.search ?? '');
		return typeof res === 'string' ? res : JSON.stringify(res);
	},
});

server.addTool({
	name: 'get_project',
	description: 'Get specific project by ID.',
	structured_output: false,
	parameters: z.object({ project_id: z.number() }),
	execute: async (args) => {
		const res = await gateway.get_project_by_id(args.project_id);
		return typeof res === 'string' ? res : JSON.stringify(res);
	},
});

server.addTool({
	name: 'get_asset',
	description: 'Get asset by ID.',
	structured_output: false,
	parameters: z.object({ asset_id: z.number() }),
	execute: async (args) => {
		const res = await gateway.get_asset_by_id(args.asset_id);
		return typeof res === 'string' ? res : JSON.stringify(res);
	},
});

server.addTool({
	name: 'get_assets',
	description: 'Get assets list by company ID.',
	structured_output: false,
	parameters: z.object({ company_id: z.number(), page: z.number().optional(), limit: z.number().optional() }),
	execute: async (args) => {
		const res = await gateway.get_assets(args.company_id, args.page ?? 1, args.limit ?? 1000);
		return typeof res === 'string' ? res : JSON.stringify(res);
	},
});

server.addTool({
	name: 'create_project_url',
	description: 'Get the project URL by company ID and project ID.',
	structured_output: false,
	parameters: z.object({ company_id: z.number(), project_id: z.number() }),
	execute: async (args) => {
		const res = await gateway.create_project_url(args.company_id, args.project_id);
		return typeof res === 'string' ? res : JSON.stringify(res);
	},
});

server.addTool({
	name: 'create_issue_url',
	description: 'Get the issue URL by company ID and issue ID.',
	structured_output: false,
	parameters: z.object({ company_id: z.number(), issue_id: z.number() }),
	execute: async (args) => {
		const res = await gateway.create_issue_url(args.company_id, args.issue_id);
		return typeof res === 'string' ? res : JSON.stringify(res);
	},
});

server.addTool({
	name: 'get_mttr_over_time',
	description: 'Get MTTR metrics over time for a company.',
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
		const res = await gateway.get_mttr_over_time(args.company_id, args.start_date, args.end_date, args.severities, args.statuses, args.asset_ids, args.asset_tags);
		return typeof res === 'string' ? res : JSON.stringify(res);
	},
});

server.addTool({
	name: 'get_overall_risk_score_history',
	description: 'Get overall risk score history for a company.',
	structured_output: false,
	parameters: z.object({ company_id: z.number() }),
	execute: async (args) => {
		const res = await gateway.get_overall_risk_score_history(args.company_id);
		return typeof res === 'string' ? res : JSON.stringify(res);
	},
});

server.addTool({
	name: 'get_today_date',
	description: 'Get today date.',
	structured_output: false,
	parameters: z.object({}),
	execute: async () => {
		const d = new Date();
		const res = { day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() };
		return JSON.stringify(res);
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