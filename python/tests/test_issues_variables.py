import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "conviso_mcp"))
from graphql_client import GraphQLClient


def vars_for(**kw):
    return GraphQLClient.build_issues_variables(248, 1, 10, **kw)


def test_minimal_variables():
    v = vars_for()
    assert v["companyId"] == 248
    assert v["pagination"] == {"page": 1, "perPage": 10}
    assert v["filters"] == {}
    assert v["sortOptions"] == []


def test_enum_filters_normalized_and_pruned():
    v = vars_for(severities=["critical", "bogus"], statuses=["identified"], sla_states=["breached"])
    assert v["filters"]["severities"] == ["CRITICAL"]
    assert v["filters"]["statuses"] == ["IDENTIFIED"]
    assert v["filters"]["slaStates"] == ["BREACHED"]


def test_date_range_and_search_and_sort():
    v = vars_for(created_after="2026-01-01", created_before="2026-02-01", search="sql", sort_by="severity", order="asc")
    assert v["filters"]["createdAtRange"] == {"startDate": "2026-01-01", "endDate": "2026-02-01"}
    assert v["filters"]["partialTitle"] == "sql"
    assert v["sortOptions"] == [{"sortBy": "SEVERITY", "order": "ASC"}]


def test_ids_and_extra_filters_merge():
    v = vars_for(project_id=5, asset_ids=[7, 8], issue_ids=[1], extra_filters={"cves": ["CVE-2021-1"], "compromisedEnvironment": True})
    assert v["filters"]["projectIds"] == [5]
    assert v["filters"]["assetIds"] == [7, 8]
    assert v["filters"]["ids"] == [1]
    assert v["filters"]["cves"] == ["CVE-2021-1"]
    assert v["filters"]["compromisedEnvironment"] is True
