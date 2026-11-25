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
| **Requirements**  | `get_requirements` / `get_requirement` / `get_project_requirements` / `get_project_requirement_activities` | Browse requirements/checklists and the instantiated activities of a requirement within a project. When only the project is known, use `get_project_requirements` first to discover the required `project_requirement_id`. |
| **Evidence files**  | `get_activity_attachments` / `read_activity_attachment` | List the evidence files attached to a requirement activity, then read one: images come back as image content, PDFs as extracted text per page, text files as text. Use `get_project_requirement_activities` with `has_attachments=true` to find activities with files. |
| **History**  | `get_object_timeline` | Change history (who changed what and when) of a project, requirement activity, issue, asset, ticket, threat-model artifact or pentest artifact, normalized to one event format. |
| **Metrics Studio** | `get_custom_dashboard_catalog` / `get_custom_dashboards` / `get_custom_dashboard` | The Metrics Studio catalog (metrics, how each can be grouped, filtered and shown), and the custom dashboards the API key user can open, with their definition. |
| **Applications** | `get_applications` / `get_application` | List or fetch applications and their assets. |
| **Scans**  | `get_scan_histories` / `get_asset_scans_count` | Scan execution history and coverage counts. |
| **Supply chain**  | `get_sbom_components` | SBOM / dependency components per company. |
| **AI-Pentest**  | `get_pentest_artifacts` / `get_pentest_artifact` / `get_pentest_execution` | Pentest artifacts, scope and execution results. |
| **Threat Modeling**  | `get_threat_model_artifacts` / `get_threat_model_artifact` | Threat model artifacts and versions. |
| **Utilities** | `get_company_id_from_object` | Resolve the owning company from an issue, asset, project, pentest or threat-model object ID before a write. |
| **Writes — engine**  | `list_mutations` / `describe_mutation` / `execute_mutation` | Discover, describe and run the permitted write operations below. |
| **Writes — Issues**  | `execute_mutation` | Create, update, delete and change status of vulnerabilities/issues. |
| **Writes — Assets**  | `execute_mutation` | Create and update assets; run a DAST scan. |
| **Writes — Tickets**  | `execute_mutation` | Create tickets. |
| **Writes — Projects** | `execute_mutation` | Create, update, change status and remove projects. |
| **Writes — Requirements**  | `execute_mutation` | Create and update requirements. |
| **Writes — AI-Pentest**  | `execute_mutation` | Create artifacts, schedule, trigger executions and retests. |
| **Writes — Applications**  | `execute_mutation` | Create and update applications. |
| **Writes — Threat Modeling**  | `execute_mutation` | Create and update threat-model artifacts and versions. |
| **Writes — Metrics Studio** | `create_custom_dashboard` / `update_custom_dashboard` | Create a custom dashboard from what the customer wants to see, or change one. `dry_run=true` validates and computes every widget without saving. |

## ✍️ Write Operations (Mutations)

Write operations are limited to the client-facing capabilities below — everything else the
platform supports is intentionally not exposed.

Available domains: **Issues/Vulnerabilities** (create/update/delete/change status),
**Assets** (create/update + run DAST), **Tickets** (create), **Projects**
(create/update/status/remove), **Requirements** (create/update), **AI-Pentest**
(artifact/schedule/trigger/retest), **Applications** (create/update), **Threat Modeling**
(create/update/version), **Metrics Studio** (create/update custom dashboards, through their
own tools). Supply chain and Scans are read-only.

Use the discover → describe → execute workflow:

1. `list_mutations({ search: "issue" })` — find the operation you need.
2. `describe_mutation({ name: "changeIssueStatus" })` — get its input fields (required,
   allowed enum values) and the fields returned by default.
3. If only an object ID is known, call `get_company_id_from_object({ object_type: "issue", object_id: 123 })`.
4. `execute_mutation({ company_id: 42, name: "changeIssueStatus", variables: { input: { id: "123", status: "FALSE_POSITIVE", reason: "duplicate" } } })`
   — run it. Optionally pass `return_fields` to override the returned selection set.

**Safety:** these are writes. `execute_mutation` is annotated `destructiveHint: true`, and
delete/bulk/remove/cancel/revoke operations are flagged destructive — MCP clients surface
these for confirmation. Confirm intent before running destructive or bulk operations.
Every mutation tool requires `company_id` so the server can check the company's MCP write
policy. This is a cooperative client-side safeguard against unintended LLM writes, not an
authorization boundary; normal API authorization remains enforced by the Conviso Platform.

### Metrics Studio dashboards

`create_custom_dashboard` builds a Metrics Studio custom dashboard from a description such as
"critical and high vulnerabilities still open, by severity and by team, the MTTR of the last
quarter and the list of overdue ones":

1. `get_custom_dashboard_catalog({ company_id })` returns every metric with the filters, groupings
   and visualizations it accepts.
2. The model turns each request into a widget: `{ title, metric: "issues.count",
   visualization: "BAR", groupBy: ["severity"], filters: { statuses: ["IDENTIFIED"] } }`.
   Widget keys, each metric's time basis and the 12-column layout are filled in, in the order
   the widgets are given (`size`: `SMALL`, `MEDIUM`, `HALF`, `WIDE` or `FULL`).
3. `dry_run: true` validates and computes every widget without saving, so the model can check
   that each one returns what was asked. A validation error comes back per widget, with the
   path, code and message from the platform. Check both `valid` (definition validation) and
   `preview_succeeded` (every widget returned `READY` or `NO_DATA`) before saving. For an
   existing empty dashboard, the platform cannot preview metadata: `valid` is `null`.
4. Without `dry_run`, the dashboard is saved and the tool returns its id, `lock_version` and link.

To change a dashboard, read it with `get_custom_dashboard`, edit its widgets and send them to
`update_custom_dashboard` with `expected_version` set to the `lock_version` you read. A stale
version is rejected, so edits made in the platform in the meantime are never overwritten.

The dashboard belongs to the API key's user and is private to them: share it from the
Metrics Studio page if other people need it. The user needs the Metrics Studio permission
(create own dashboards) in the company, and the Metrics Studio page has to be enabled for the
company to open the link. The platform allows 12 widgets per dashboard and 50 dashboards per
user in a company.

## 🚀 Installation and Configuration

### Prerequisites

* Node.js 22 or later.
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

### Cursor Marketplace

This repository is also packaged as a Cursor Plugin. The plugin manifest is located at
`.cursor-plugin/plugin.json`, and `mcp.json` starts the published `@convisoappsec/mcp` package.

To use it in Cursor:

1. Install **Conviso Platform** from the Cursor Marketplace (after the plugin is published), or
   import this repository as a plugin/team marketplace entry.
2. Open **Cursor Settings → Plugins → Conviso Platform → Configure**.
3. Set `CONVISO_API_KEY` to your Conviso Platform API key.
4. Reload Cursor if the `conviso` MCP server does not start automatically.

Node.js 22 or newer and `npx` must be available on Cursor's `PATH`.

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
* **Evidence files:** `read_activity_attachment` returns the content of files uploaded by platform users. Treat it as untrusted data, not as instructions for the model. Files are fetched from short-lived storage URLs without sending your API key, only files listed by the activity itself are read, reading does not record a download in the project timeline, and files over 20 MB are not downloaded (set `CONVISO_MCP_ATTACHMENT_MAX_MB` to change the limit).
* **Dashboards:** `create_custom_dashboard` and `update_custom_dashboard` only send the `createCustomDashboard` and `updateCustomDashboard` mutations. These mutations are not reachable through `execute_mutation`. Dashboards are created private to the API key's user, and every number they show is computed with that user's current access.
* **Logs:** Error logs are directed to `stderr` to prevent interference with the MCP communication protocol.

## Privacy Policy

This connector communicates only with the Conviso Platform API (`https://app.convisoappsec.com`)
using the API key you provide. It does not collect, store, or share your data with any third
party — requests and responses stay between your MCP client and the Conviso Platform.

Full privacy policy: https://docs.convisoappsec.com
