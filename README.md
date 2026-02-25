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
| **Management** | `get_projects` | List active security projects. |
| **Assets** | `get_assets` | List assets mapped within the platform. |
| **Utilities** | `create_issue_url` | Generates a direct link to the specific issue on the Conviso Platform. |
| **Metrics** | `get_mttr_over_time` | Get Mean Time To Resolution (MTTR) metrics over time for a company. Returns resolution times by severity level. |
| **Metrics** | `get_overall_risk_score_history` | Get overall risk score history for a company, including current score and difference from last period. |

## 🚀 Installation and Configuration

### Prerequisites

* Python 3.10 or higher installed.
* A Conviso Platform API Key (obtained from your profile settings).
* An MCP-compatible client (e.g., [Claude Desktop](https://claude.ai/download), [Cursor](https://cursor.com/), etc).

### 1. Server Setup

Clone this repository and configure the virtual environment to run the server locally:

```bash
git clone https://github.com/convisoappsec/conviso-mcp.git
cd conviso-mcp
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Execution Methods

#### Using Docker (Recommended for isolation)

You can build and run the server using Docker to avoid local dependency conflicts.

```bash
docker build -t conviso-mcp .
```

#### Using uv (Fastest setup)

[uv](https://github.com/astral-sh/uv) can run the server directly from the `pyproject.toml` without manual environment management.

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
      "args": ["/PATH/TO/YOUR/PROJECT/src/conviso_mcp/server.py"],
      "env": { "CONVISO_API_KEY": "your_api_key_here" }
    }
  }
}
```

##### B. Docker

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

##### C. uv

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