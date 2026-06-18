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
def get_issues(company_id: int, page: int = 1, limit: int = 10, project_id: int = None,
               search: str = "", severities: list = None, statuses: list = None,
               sla_states: list = None, created_after: str = None, created_before: str = None,
               assignee_emails: list = None, sort_by: str = None, order: str = "DESC",
               extra_filters: dict = None):
    """Get issues (vulnerabilities) for a company, with rich filtering and sorting.

    Filters (all optional):
    - search: substring match on issue title.
    - severities: any of NOTIFICATION, LOW, MEDIUM, HIGH, CRITICAL.
    - statuses: any of CREATED, DRAFT, IDENTIFIED, IN_PROGRESS, AWAITING_VALIDATION,
      FIX_ACCEPTED, RISK_ACCEPTED, FALSE_POSITIVE, SUPPRESSED.
    - sla_states: any of ON_TRACK, APPROACHING, BREACHED, RESOLVED, NOT_TRACKED, NOT_PARAMETERIZED.
    - created_after / created_before: ISO8601 dates (YYYY-MM-DD). For relative ranges
      ("last 30 days") call get_today_date first and compute the bounds.
    - assignee_emails: list of assignee emails.
    - project_id: restrict to one project. asset filtering: use get_issues_by_asset_id.
    - sort_by: one of RISK_SCORE, SEVERITY, ID, CREATED_AT, UPDATED_AT, SLA_DUE_AT. order: ASC or DESC.
    - extra_filters: dict mapping directly to IssuesFiltersInput for advanced keys, e.g.
      {"cves": [...], "categories": [...], "reachableBy": ["STATIC_ANALYSIS"],
       "businessImpact": ["HIGH"], "exploitability": "INTERNET_FACING",
       "compromisedEnvironment": true, "aiFpAnalyzed": true, "assetTags": [...]}.

    Returns issue collection (id, title, severity, status, dates, sla, assignedUsers,
    asset, project) plus metadata (totalCount, totalPages, currentPage) for pagination.
    """
    return gateway.get_issues(company_id, search=search, page=page, limit=limit,
                              project_id=project_id, severities=severities, statuses=statuses,
                              sla_states=sla_states, created_after=created_after,
                              created_before=created_before, assignee_emails=assignee_emails,
                              sort_by=sort_by, order=order, extra_filters=extra_filters)

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
def get_issues_by_asset_id(company_id: int, asset_id: int, page: int = 1, limit: int = 10, search: str = ""):
    """Get issues list filtered by a single asset ID. Supports pagination and optional title search."""
    return gateway.get_issues_by_asset_ids(company_id=company_id, page=page, limit=limit, asset_ids=[asset_id], search=search)

@mcp.tool()
def get_issues_by_project_id(company_id: int, project_id: int, page: int = 1, limit: int = 10, search: str = ""):
    """Get issues list filtered by project ID. Supports pagination and optional title search."""
    return gateway.get_issues(company_id, search=search, page=page, limit=limit, project_id=project_id)

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