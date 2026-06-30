<img src="assets/conviso_banner.png" width="128">

# Conviso MCP Server

This repository contains both a Python and a Node.js MCP server. This `node/` folder is the Node.js bundle and is packaged into the `.mcpb` bundle for MCP clients that run Node runtimes.

## 🛠 Available Tools (Capabilities)

The server exposes the following tools to the LLM (see `node/manifest.json` for the authoritative definitions):

| Category | Tool | Description |
| --- | --- | --- |
| **General** | `get_companies` | List companies and associated IDs. |
| **General** | `get_company_info` | Plan details, integrations, and company branding info. |
| **Vulnerabilities** | `get_issues` | List vulnerabilities by company or project. |
| **Vulnerabilities** | `get_issue` | Technical details, including **code snippets** and raw requests/responses. |
| **Vulnerabilities** | `get_top_vulnerabilities` | Risk overview (vulnerability count by severity). |
| **Vulnerabilities** | `get_issues_by_asset_id` | List vulnerabilities for a company filtered by a single asset ID. |
| **Vulnerabilities** | `get_issues_by_project_id` | List vulnerabilities for a company filtered by a project ID. |
| **Management** | `get_projects` | List active security projects. |
| **Management** | `get_project` | Get specific project in Conviso Platform by project ID. |
| **Assets** | `get_assets` | List assets mapped within the platform. |
| **Assets** | `get_asset` | Get asset in Conviso Platform by asset ID. |
| **Utilities** | `create_issue_url` | Generates a direct link to the specific issue on the Conviso Platform. |
| **Utilities** | `create_project_url` | Generates a direct link to the specific project on the Conviso Platform. |
| **Utilities** | `get_today_date` | Return current day/month/year (utility). |
| **Metrics** | `get_mttr_over_time` | Get Mean Time To Resolution (MTTR) metrics over time for a company. Returns resolution times by severity level. |
| **Metrics** | `get_overall_risk_score_history` | Get overall risk score history for a company, including current score and difference from last period. |
| **Tickets** | `get_tickets` / `get_ticket` | List or fetch support/bug tickets. |
| **Requirements** | `get_requirements` / `get_requirement` / `get_project_requirements` | Browse security requirements/checklists. |
| **Applications** | `get_applications` / `get_application` | List or fetch applications and their assets. |
| **Scans** | `get_scan_histories` / `get_asset_scans_count` | Scan execution history and coverage counts. |
| **Supply chain** | `get_sbom_components` | SBOM / dependency components per company. |
| **AI-Pentest** | `get_pentest_artifacts` / `get_pentest_artifact` / `get_pentest_execution` | Pentest artifacts, scope and execution results. |
| **Threat Modeling** | `get_threat_model_artifacts` / `get_threat_model_artifact` | Threat model artifacts and versions. |
| **Writes — engine** | `list_mutations` / `describe_mutation` / `execute_mutation` | Discover, describe and run the permitted write operations below. |
| **Writes — Issues** | `execute_mutation` | Create, update, delete and change status of vulnerabilities/issues. |
| **Writes — Assets** | `execute_mutation` | Create and update assets; run a DAST scan. |
| **Writes — Tickets** | `execute_mutation` | Create tickets. |
| **Writes — Projects** | `execute_mutation` | Create, update, change status and remove projects. |
| **Writes — Requirements** | `execute_mutation` | Create and update requirements. |
| **Writes — AI-Pentest** | `execute_mutation` | Create artifacts, schedule, trigger executions and retests. |
| **Writes — Applications** | `execute_mutation` | Create and update applications. |
| **Writes — Threat Modeling** | `execute_mutation` | Create and update threat-model artifacts and versions. |

> Write tools are **Node-only** and limited to the supported client-facing capabilities; see
> the root `README.md` for the write workflow.

## 🚀 Installation and Configuration (Node.js bundle)

### Prerequisites

* Node.js 20.10 or later.
* A Conviso Platform API Key (obtained from your profile settings).
* An MCP-compatible client (e.g., Claude Desktop, Cursor, etc.).

### Setup

```bash
git clone https://github.com/convisoappsec/conviso-mcp.git
cd conviso-mcp/node
npm install
```

### Run

```bash
export CONVISO_API_KEY=your_api_key_here
npm start
```

## Staging (optional)

Set the `STAGING` environment variable to `true` to make the server use
`https://staging.convisoappsec.com` instead of the production API.

Example:

```bash
# staging (testing only)
export STAGING=true
npm start
```


## Client configuration examples

Below are quick examples showing how to configure Claude Desktop to run the Node bundle locally or via Docker. Paste the appropriate JSON into your Claude Desktop configuration file (see Claude docs for exact path on your OS).

### A. Node.js (Local)

```json
{
	"mcpServers": {
		"conviso-mcp": {
			"command": "node",
			"args": [
				"/ABSOLUTE/PATH/TO/REPO/node/src/conviso_mcp/server.js"
			],
			"env": {
				"CONVISO_API_KEY": "your_api_key_here"
			}
		}
	}
}
```

Notes:
- Replace `/ABSOLUTE/PATH/TO/REPO` with the absolute path to your cloned repository.
- Ensure `node` is available in the PATH used by Claude Desktop.

### B. Docker (Node bundle)

```json
{
	"mcpServers": {
		"conviso-mcp": {
			"command": "docker",
			"args": [
				"run",
				"-i",
				"--rm",
				"--init",
				"-e",
				"CONVISO_API_KEY=your_api_key_here",
				"conviso-mcp-node-image"
			]
		}
	}
}
```

Notes:
- Build the Docker image first (example):

```bash
cd node
docker build -t conviso-mcp-node-image .
```

---

## Privacy Policy

This connector communicates only with the Conviso Platform API (`https://app.convisoappsec.com`)
using the API key you provide. It does not collect, store, or share your data with any third
party — requests and responses stay between your MCP client and the Conviso Platform. Error
logs go to `stderr` only.

Full privacy policy: https://www.iubenda.com/privacy-policy/55589285
