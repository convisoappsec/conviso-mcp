import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "conviso_mcp"))
from graphql_client import GraphQLClient


def test_assets_search_built_and_normalized():
    v = GraphQLClient.build_assets_variables(
        248, 1, 20, name="api", business_impact=["high", "bogus"],
        exploitability=["internet_facing"], sort_by="RISK_SCORE", order="asc",
        environment_compromised=True)
    s = v["search"]
    assert v["companyId"] == 248 and v["page"] == 1 and v["limit"] == 20
    assert s["name"] == "api"
    assert s["businessImpact"] == ["HIGH"]
    assert s["exploitability"] == ["INTERNET_FACING"]
    assert s["sortBy"] == "risk_score" and s["order"] == "ASC"
    assert s["environmentCompromised"] is True


def test_assets_search_empty_is_omitted():
    v = GraphQLClient.build_assets_variables(248, 1, 20)
    assert v["search"] == {}
