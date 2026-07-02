<img src="https://blog.convisoappsec.com/wp-content/uploads/2022/02/Logo.png" width="128">

# Conviso MCP Server

This is a **Model Context Protocol (MCP)** server that enables Claude Desktop (or any MCP client) to interact directly with the **Conviso Platform**. With this connector, the AI gains full context regarding your software assets, vulnerabilities, security projects, and risk metrics.

## 🛠 Available Tools (Capabilities)

The server exposes the following tools to the LLM:

| Category | Tool | Description |
| --- | --- | --- |
| **General** | `get_companies` | List companies and associated IDs. |
| **General** | `get_company_info` | Plan details, integrations, and company branding info. |
| **Vulnerabilities** | `get_issues` | List vulnerabilities for a company, filterable by project, asset, severity, status, dates and more. |
| **Vulnerabilities** | `get_issue` | Technical details, including **code snippets** and raw requests/responses. |
| **Vulnerabilities** | `get_top_vulnerabilities` | Risk overview (vulnerability count by severity). |
| **Management** | `get_projects` | List active security projects. |
| **Management** | `get_project` | Get specific project in Conviso Platform by project ID. |
| **Assets** | `get_assets` | List assets mapped within the platform. |
| **Assets** | `get_asset` | Get asset in Conviso Platform by asset ID. |
| **Utilities** | `create_issue_url` | Generates a direct link to the specific issue on the Conviso Platform. |
| **Utilities** | `create_project_url` | Generates a direct link to the specific project on the Conviso Platform. |
| **Metrics** | `get_mttr_over_time` | Get Mean Time To Resolution (MTTR) metrics over time for a company. Returns resolution times by severity level. |
| **Metrics** | `get_overall_risk_score_history` | Get overall risk score history for a company, including current score and difference from last period. |
| **Tickets**  | `get_tickets` / `get_ticket` | List or fetch support/bug tickets. |
| **Requirements**  | `get_requirements` / `get_requirement` / `get_project_requirements` | Browse security requirements/checklists. |
| **Applications** | `get_applications` / `get_application` | List or fetch applications and their assets. |
| **Scans**  | `get_scan_histories` / `get_asset_scans_count` | Scan execution history and coverage counts. |
| **Supply chain**  | `get_sbom_components` | SBOM / dependency components per company. |
| **AI-Pentest**  | `get_pentest_artifacts` / `get_pentest_artifact` / `get_pentest_execution` | Pentest artifacts, scope and execution results. |
| **Threat Modeling**  | `get_threat_model_artifacts` / `get_threat_model_artifact` | Threat model artifacts and versions. |
| **Writes — engine**  | `list_mutations` / `describe_mutation` / `execute_mutation` | Discover, describe and run the permitted write operations below. |
| **Writes — Issues**  | `execute_mutation` | Create, update, delete and change status of vulnerabilities/issues. |
| **Writes — Assets**  | `execute_mutation` | Create and update assets; run a DAST scan. |
| **Writes — Tickets**  | `execute_mutation` | Create tickets. |
| **Writes — Projects** | `execute_mutation` | Create, update, change status and remove projects. |
| **Writes — Requirements**  | `execute_mutation` | Create and update requirements. |
| **Writes — AI-Pentest**  | `execute_mutation` | Create artifacts, schedule, trigger executions and retests. |
| **Writes — Applications**  | `execute_mutation` | Create and update applications. |
| **Writes — Threat Modeling**  | `execute_mutation` | Create and update threat-model artifacts and versions. |

## ✍️ Write Operations (Mutations)

Write operations are limited to the client-facing capabilities below — everything else the
platform supports is intentionally not exposed.

Available domains: **Issues/Vulnerabilities** (create/update/delete/change status),
**Assets** (create/update + run DAST), **Tickets** (create), **Projects**
(create/update/status/remove), **Requirements** (create/update), **AI-Pentest**
(artifact/schedule/trigger/retest), **Applications** (create/update), **Threat Modeling**
(create/update/version). Supply chain and Scans are read-only.

Use the discover → describe → execute workflow:

1. `list_mutations({ search: "issue" })` — find the operation you need.
2. `describe_mutation({ name: "changeIssueStatus" })` — get its input fields (required,
   allowed enum values) and the fields returned by default.
3. `execute_mutation({ name: "changeIssueStatus", variables: { input: { id: "123", status: "FALSE_POSITIVE", reason: "duplicate" } } })`
   — run it. Optionally pass `return_fields` to override the returned selection set.

**Safety:** these are writes. `execute_mutation` is annotated `destructiveHint: true`, and
delete/bulk/remove/cancel/revoke operations are flagged destructive — MCP clients surface
these for confirmation. Confirm intent before running destructive or bulk operations.

## 🚀 Installation and Configuration

### Prerequisites

* Node.js 20.10 or later.
* A Conviso Platform API Key (obtained from your profile settings).
* An MCP-compatible client (e.g., [Claude Desktop](https://claude.ai/download), [Cursor](https://cursor.com/), etc).

### 1. Quick Start (npm — recommended)

The server is published as [`@convisoappsec/mcp`](https://www.npmjs.com/package/@convisoappsec/mcp). No clone needed:

```json
{
  "mcpServers": {
    "conviso": {
      "command": "npx",
      "args": ["-y", "@convisoappsec/mcp"],
      "env": { "CONVISO_API_KEY": "your_api_key_here" }
    }
  }
}
```

Claude Desktop config file location:

* **Linux:** `~/.config/Claude/claude_desktop_config.json`
* **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

The same JSON works for Cursor (`.cursor/mcp.json`) and other MCP clients.

> **Note:** if your Node is managed by nvm (or `npx` is not on the client's PATH), use absolute
> paths instead: `"command": "/absolute/path/to/node"`, `"args": ["/absolute/path/to/node_modules/@convisoappsec/mcp/src/conviso_mcp/server.js"]`
> after `npm install -g @convisoappsec/mcp`.

### 2. Claude Desktop one-click bundle

Download `conviso-mcp-<version>.mcpb` from the [latest GitHub Release](https://github.com/convisoappsec/conviso-mcp/releases),
open it with Claude Desktop, and paste your API key when prompted.

### 3. From source / Docker

```bash
git clone https://github.com/convisoappsec/conviso-mcp.git
cd conviso-mcp/node
npm install
CONVISO_API_KEY=your_api_key_here npm start
```

```bash
docker build -t conviso-mcp-node-image -f node/Dockerfile node/
```

```json
{
  "mcpServers": {
    "conviso": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--init", "-e", "CONVISO_API_KEY=your_api_key_here", "conviso-mcp-node-image"]
    }
  }
}
```

### 4. Verification

After configuring your chosen client:

1. Restart the application.
2. Look for the MCP connection status (in Claude, this is the **plug icon**).
3. Ensure the `conviso-mcp` status is active/green.

## 🛡 Security and Privacy

This connector handles sensitive security data (vulnerabilities).

* **Scope:** The server operates using the permissions assigned to the provided API Key.
* **Code Snippets:** The `get_issue` tool may return vulnerable code snippets if explicitly requested for AI analysis.
* **Logs:** Error logs are directed to `stderr` to prevent interference with the MCP communication protocol.

## Privacy Policy

This connector communicates only with the Conviso Platform API (`https://app.convisoappsec.com`)
using the API key you provide. It does not collect, store, or share your data with any third
party — requests and responses stay between your MCP client and the Conviso Platform.

Full privacy policy: https://docs.convisoappsec.com