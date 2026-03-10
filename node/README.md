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
| **Management** | `get_projects` | List active security projects. |
| **Management** | `get_project` | Get specific project in Conviso Platform by project ID. |
| **Assets** | `get_assets` | List assets mapped within the platform. |
| **Assets** | `get_asset` | Get asset in Conviso Platform by asset ID. |
| **Utilities** | `create_issue_url` | Generates a direct link to the specific issue on the Conviso Platform. |
| **Utilities** | `create_project_url` | Generates a direct link to the specific project on the Conviso Platform. |
| **Utilities** | `get_today_date` | Return current day/month/year (utility). |
| **Metrics** | `get_mttr_over_time` | Get Mean Time To Resolution (MTTR) metrics over time for a company. Returns resolution times by severity level. |
| **Metrics** | `get_overall_risk_score_history` | Get overall risk score history for a company, including current score and difference from last period. |

## 🚀 Installation and Configuration (Node.js bundle)

### Prerequisites

* Node.js 18 or later.
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

## Privacy

This bundle references the project's privacy policy. See `node/manifest.json` privacy_policies for details.