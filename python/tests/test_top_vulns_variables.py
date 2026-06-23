import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "conviso_mcp"))
from graphql_client import GraphQLClient


def test_no_filters_omits_filters_key():
    v = GraphQLClient.build_top_vulns_variables(248)
    assert v == {"companyId": 248}


def test_filters_built_and_normalized():
    v = GraphQLClient.build_top_vulns_variables(
        248, severities=["critical"], statuses=["identified"],
        asset_ids=[7], asset_tags=["pci"], created_after="2026-01-01")
    fl = v["filters"]
    assert fl["severities"] == ["CRITICAL"]
    assert fl["statuses"] == ["IDENTIFIED"]
    assert fl["assetIds"] == [7]
    assert fl["assetTags"] == ["pci"]
    assert fl["createdAtRange"] == {"startDate": "2026-01-01"}
