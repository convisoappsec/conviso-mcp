"""Manual live smoke check against a running Conviso GraphQL endpoint.

Not part of the default pytest run (no `test_` prefix). Requires a live
endpoint and CONVISO_API_KEY in the environment:

    cd python && CONVISO_API_KEY=... python tests/smoke_live.py
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "conviso_mcp"))
from graphql_client import GraphQLClient

key = os.environ["CONVISO_API_KEY"]
gc = GraphQLClient("http://localhost:3000/graphql", key)

cid = gc.get_companies(limit=1)["companies"]["collection"][0]["id"]
print("company:", cid)

issues = gc.get_issues(cid, severities=["CRITICAL", "HIGH"], statuses=["IDENTIFIED"],
                       sort_by="SEVERITY", order="DESC", limit=3)["issues"]
print("issues totalCount:", issues["metadata"]["totalCount"])
assert "metadata" in issues

assets = gc.get_assets_by_company(cid, limit=3, sort_by="risk_score", order="DESC")["assets"]
print("assets totalCount:", assets["metadata"]["totalCount"])

print("projects:", len(gc.get_projects(cid, limit=3)["projects"]["collection"]))
print("topVulns:", len(gc.get_top_vulnerabilities(cid, severities=["CRITICAL"])["topVulnerabilities"]))

# Sort-default check: no sort requested should still be accepted.
issues_no_sort = gc.get_issues(cid, limit=3)["issues"]
print("issues (no sort) totalCount:", issues_no_sort["metadata"]["totalCount"])

print("OK")
