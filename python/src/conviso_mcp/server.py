#!/usr/bin/env python3

from mcp.server.fastmcp import FastMCP
import os, sys
from datetime import datetime
from dotenv import load_dotenv

print("[+] Starting Conviso MCP Server", file=sys.stderr)

script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)

from feed_gateway import FeedGateway

load_dotenv()

base_url = FeedGateway.get_base_url()
app = None
mcp = FastMCP("conviso-mcp")

gateway = FeedGateway(base_url)

print(f"[+] Using base API URL: {base_url}", file=sys.stderr)

@mcp.tool()
def get_companies(page: int, limit: int, search: str):
    """Get company list in Conviso Platform and IDs."""
    return gateway.get_companies(page=page, limit=limit, search=search)

@mcp.tool()
def get_company_info(company_id: int):
    """Get company details by ID as As label, sid, brandUrl, brandId, brandFilename, brandSize, customFeatures, integrations, createdAt, updatedAt and companyPlan."""
    return gateway.get_company_by_id(company_id=company_id)

@mcp.tool()
def get_issue(id: int, return_vulnerable_data: bool = False):
    """Get details of a issue in Conviso Platform. Return vulnerable data (e.g.: code, request, response, etc.) if needed or requested."""
    return gateway.get_issue_by_id(id, return_snippets=return_vulnerable_data)

@mcp.tool()
def get_issues(company_id: int, page: int, limit: int, project_id: int):
    """Get issues list in Conviso Platform by company ID. Project ID is optional."""
    return gateway.get_issues(company_id, search="", page=page, limit=limit, project_id=project_id)

@mcp.tool()
def get_top_vulnerabilities(company_id: int):
    """Get top vulnerabilities by company ID. This is a general overview of the company's top vulnerabilities. It returns data such as: affectedAssetsCount, criticalCount, highCount, lowCount, mediumCount, title, totalCount."""
    return gateway.get_top_vulnerabilities(company_id)

@mcp.tool()
def get_projects(company_id: int, page: int, limit: int, search: str):
    """Get project list in Conviso Platform by company ID."""
    return gateway.get_projects(company_id, page=page, limit=limit, search=search)

@mcp.tool()
def get_project(project_id: int):
    """Get specific project in Conviso Platform by project ID."""
    return gateway.get_project_by_id(project_id=project_id)

@mcp.tool()
def get_asset(asset_id: int):
    """Get asset in Conviso Platform by asset ID."""
    return gateway.get_asset_by_id(asset_id)

@mcp.tool()
def get_assets(company_id: int, page: int, limit: int):
    """Get assets list in Conviso Platform by company ID."""
    projects = gateway.get_assets(company_id, page=page, limit=limit)
    return projects

@mcp.tool()
def create_project_url(company_id: int, project_id: int):
    """Get the project URL by company ID and project ID."""
    return gateway.create_project_url(company_id=company_id, project_id=project_id)

@mcp.tool()
def create_issue_url(company_id: int, issue_id: int):
    """Get the issue URL by company ID and issue ID."""
    return gateway.create_issue_url(company_id=company_id, issue_id=issue_id)

@mcp.tool()
def get_mttr_over_time(company_id: int, start_date: str, end_date: str, severities: list = None, statuses: list = None, asset_ids: list = None, asset_tags: list = None):
    """Get Mean Time To Resolution (MTTR) metrics over time for a company. Returns resolution times by severity level."""
    return gateway.get_mttr_over_time(company_id, start_date, end_date, severities, statuses, asset_ids, asset_tags)

@mcp.tool()
def get_overall_risk_score_history(company_id: int):
    """Get overall risk score history for a company, including current score and difference from last period."""
    return gateway.get_overall_risk_score_history(company_id)

@mcp.tool()
def get_today_date():
    """Get today date."""
    date = datetime.today()

    return {
        "day" : date.day,
        "month" : date.month,
        "year" : date.year
    }

def main():
    mcp.run(transport='stdio')

if __name__ == "__main__":
    main()