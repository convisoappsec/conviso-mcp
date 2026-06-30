<img src="https://blog.convisoappsec.com/wp-content/uploads/2022/02/Logo.png" width="128">

# Conviso MCP Server

This is a **Model Context Protocol (MCP)** server that enables Claude Desktop (or any MCP client) to interact directly with the **Conviso Platform**. With this connector, the AI gains full context regarding your software assets, vulnerabilities, security projects, and risk metrics.

## 🛠 Available Tools (Capabilities)

The server exposes the following tools to the LLM:

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
| **Metrics** | `get_mttr_over_time` | Get Mean Time To Resolution (MTTR) metrics over time for a company. Returns resolution times by severity level. |
| **Metrics** | `get_overall_risk_score_history` | Get overall risk score history for a company, including current score and difference from last period. |
| **Tickets** ⁽ᴺᵒᵈᵉ⁾ | `get_tickets` / `get_ticket` | List or fetch support/bug tickets. |
| **Requirements** ⁽ᴺᵒᵈᵉ⁾ | `get_requirements` / `get_requirement` / `get_project_requirements` | Browse security requirements/checklists. |
| **Applications** ⁽ᴺᵒᵈᵉ⁾ | `get_applications` / `get_application` | List or fetch applications and their assets. |
| **Scans** ⁽ᴺᵒᵈᵉ⁾ | `get_scan_histories` / `get_asset_scans_count` | Scan execution history and coverage counts. |
| **Supply chain** ⁽ᴺᵒᵈᵉ⁾ | `get_sbom_components` | SBOM / dependency components per company. |
| **AI-Pentest** ⁽ᴺᵒᵈᵉ⁾ | `get_pentest_artifacts` / `get_pentest_artifact` / `get_pentest_execution` | Pentest artifacts, scope and execution results. |
| **Threat Modeling** ⁽ᴺᵒᵈᵉ⁾ | `get_threat_model_artifacts` / `get_threat_model_artifact` | Threat model artifacts and versions. |
| **Write engine** ⁽ᴺᵒᵈᵉ⁾ | `list_mutations` / `describe_mutation` / `execute_mutation` | Discover, describe and run any of the 37 allowlisted mutations. |
| **Write (curated)** ⁽ᴺᵒᵈᵉ⁾ | `change_issue_status` | Change an issue/vulnerability status. |
| **Write (curated)** ⁽ᴺᵒᵈᵉ⁾ | `create_source_code_vulnerability` | Create a manual source-code vulnerability. |
| **Write (curated)** ⁽ᴺᵒᵈᵉ⁾ | `create_project` | Create a project. |
| **Write (curated)** ⁽ᴺᵒᵈᵉ⁾ | `create_asset` | Create an asset. |
| **Write (curated)** ⁽ᴺᵒᵈᵉ⁾ | `create_ticket` | Open a ticket. |
| **Write (curated)** ⁽ᴺᵒᵈᵉ⁾ | `run_dast` | Start a Conviso DAST scan on an asset. |
| **Write (curated)** ⁽ᴺᵒᵈᵉ⁾ | `trigger_pentest` | Trigger an AI-Pentest execution from an artifact. |
| **Write (curated)** ⁽ᴺᵒᵈᵉ⁾ | `create_pentest_artifact` | Create an AI-Pentest artifact (scope/config). |

## ✍️ Write Operations (Mutations)

> Available in the **Node** server. The Python server remains read-only for now.

The Conviso GraphQL schema defines hundreds of mutations, but the MCP intentionally exposes
only an **allowlisted subset** (see `node/src/conviso_mcp/operation_allowlist.js`) covering
the client-facing capabilities below. Every other mutation is excluded from the catalog and
cannot be reached by any tool.

Allowlisted domains: **Issues/Vulnerabilities** (create/update/delete/change status),
**Assets** (create/update + run DAST), **Tickets** (create), **Projects**
(create/update/status/remove), **Requirements** (create/update), **AI-Pentest**
(artifact/schedule/trigger/retest), **Applications** (create/update), **Threat Modeling**
(create/update/version). Supply chain and Scans are read-only.

**Generic engine** — discover → describe → execute, covering the whole allowlist:

1. `list_mutations({ search: "issue" })` — find the mutation you need.
2. `describe_mutation({ name: "changeIssueStatus" })` — get its input fields, which are
   required, allowed enum values, and the fields returned by default.
3. `execute_mutation({ name: "changeIssueStatus", variables: { input: { id: "123", status: "FALSE_POSITIVE", reason: "duplicate" } } })`
   — run it. Optionally pass `return_fields` to override the returned selection set.

**Curated shortcuts** wrap the highest-frequency writes with typed arguments
(`change_issue_status`, `create_source_code_vulnerability`, `create_project`, `create_asset`,
`create_ticket`, `run_dast`, `trigger_pentest`, `create_pentest_artifact`). Each also accepts
an `extra` object merged into the GraphQL input for any advanced field not in the typed
signature.

**Safety:** mutations are writes. `execute_mutation` is annotated `destructiveHint: true`,
and the catalog flags `delete`/`bulk`/`remove`/`cancel`/`revoke` operations as destructive —
MCP clients surface these for confirmation. Confirm intent before running destructive or
bulk operations.

**Schema source:** the engine is driven by `node/src/conviso_mcp/mutations_catalog.json`,
generated from `sdl.gql` (filtered by the allowlist) via `npm run gen:mutations`. Regenerate
it whenever the allowlist or the Conviso GraphQL schema changes (`graphql` is a dev-only
dependency used solely by the generator).

## 🚀 Installation and Configuration

### Prerequisites

* Python 3.10 or higher installed.
* A Conviso Platform API Key (obtained from your profile settings).
* An MCP-compatible client (e.g., [Claude Desktop](https://claude.ai/download), [Cursor](https://cursor.com/), etc).

### 1. Server Setup

Clone this repository and configure the virtual environment to run the server locally:

Python:
```bash
git clone https://github.com/convisoappsec/conviso-mcp.git
cd conviso-mcp
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r python/requirements.txt
```

Node.js:
```bash
git clone https://github.com/convisoappsec/conviso-mcp.git
cd conviso-mcp/node
npm install
```

### 2. Execution Methods

#### Using Docker (Recommended for isolation)

You can build and run the server using Docker to avoid local dependency conflicts.

```bash
docker build -t conviso-mcp -f python/Dockerfile python/ # For Python version
docker build -t conviso-mcp-node-image -f node/Dockerfile node/ # For Node.js version
```

#### Using uv (Python)

[uv](https://github.com/astral-sh/uv) can run the server directly from the `pyproject.toml` without manual environment management.

#### Using npm (Node.js)

[npm](https://www.npmjs.com/) can run the server directly from the package.json without requiring virtual environments or manual dependency management.

---

### 3. Client Configuration Examples

The Conviso MCP Server can be integrated into any MCP-compatible host. Below are examples for common clients.

#### Example: Claude Desktop

Claude Desktop reads settings from a JSON file. Location:

* **Linux:** `~/.config/Claude/claude_desktop_config.json`
* **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add one of the following entries based on your preferred execution method:

##### A. Standard Python (Local Venv)

```json
{
  "mcpServers": {
    "conviso-mcp": {
      "command": "/PATH/TO/YOUR/PROJECT/venv/bin/python",
      "args": ["/PATH/TO/YOUR/PROJECT/python/src/conviso_mcp/server.py"],
      "env": { "CONVISO_API_KEY": "your_api_key_here" }
    }
  }
}
```

##### B. Node.js (Local)

```json
{
  "mcpServers": {
    "conviso-mcp": {
      "command": "node",
      "args": [
        "/PATH/TO/YOUR/PROJECT/node/src/conviso_mcp/server.js"
      ],
      "env": {
        "CONVISO_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

##### C. Docker

```json
{
  "mcpServers": {
    "conviso-mcp-docker": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "CONVISO_API_KEY=your_api_key_here", "conviso-mcp"]
    }
  }
}
```

Node.js:
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

##### D. uv

```json
{
  "mcpServers": {
    "conviso-mcp-uv": {
      "command": "uv",
      "args": ["--directory", "/PATH/TO/YOUR/PROJECT", "run", "conviso-mcp"],
      "env": { "CONVISO_API_KEY": "your_api_key_here" }
    }
  }
}
```

#### Example: Cursor

Add the following JSON file, `mcp.json` or equivalent configuration, to the `.cursor` folder:

```json
{
  "mcpServers": {
    "conviso-mcp": {
      "command": "uv",
      "args": [
        "--directory",
        "/ABSOLUTE/PATH/TO/src/conviso_mcp",
        "run",
        "conviso-mcp"
      ],
      "env": {
        "CONVISO_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

> **Warning:** Always use absolute paths for commands and arguments.

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