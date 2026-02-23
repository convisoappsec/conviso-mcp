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

## 🚀 Installation and Configuration

### Prerequisites

* Python 3.10 or higher installed.
* A Conviso Platform API Key (obtained from your profile settings).
* [Claude Desktop](https://claude.ai/download) installed.

### 1. Environment Setup

Clone this repository and configure the virtual environment:

```bash
git clone https://github.com/convisoappsec/conviso-mcp.git
cd conviso-mcp
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

```

### 2. Claude Desktop Configuration

Claude Desktop reads connector settings from a JSON configuration file. Follow the steps below to set it up:

1. Open the configuration file in your preferred editor:
* **Linux:** `~/.config/Claude/claude_desktop_config.json`
* **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`


2. Add the following entry (ensure you use absolute paths for your specific machine):

```json
{
  "mcpServers": {
    "conviso-mcp": {
      "command": "/PATH/TO/YOUR/PROJECT/venv/bin/python",
      "args": [
        "/PATH/TO/YOUR/PROJECT/src/conviso_mcp/server.py"
      ],
      "env": {
        "CONVISO_API_KEY": "your_api_key_here"
      }
    }
  }
}

```

> **Warning:** Always use absolute paths. On Linux/macOS, avoid using `~/`; use the full path like `/home/user/`.

### 3. Restart Claude

Fully exit Claude Desktop and reopen it. Look for the **plug icon** at the bottom-right of the chat interface. If it is visible and `conviso-mcp` is listed with a green status light, the connection is active!

## 🛡 Security and Privacy

This connector handles sensitive security data (vulnerabilities).

* **Scope:** The server operates using the permissions assigned to the provided API Key.
* **Code Snippets:** The `get_issue` tool may return vulnerable code snippets if explicitly requested for AI analysis.
* **Logs:** Error logs are directed to `stderr` to prevent interference with the MCP communication protocol.