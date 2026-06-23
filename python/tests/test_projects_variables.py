import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "conviso_mcp"))
from graphql_client import GraphQLClient


def test_projects_params_built():
    v = GraphQLClient.build_projects_variables(
        248, 1, 50, search="api", statuses=["Fixing"], project_types=["Pentest"],
        created_after="2026-01-01", created_before="2026-02-01",
        tags=["pci"], analyst_emails=["a@x.com"])
    p = v["params"]
    assert p["scopeIdEq"] == 248
    assert p["labelCont"] == "api"
    assert p["projectStatusLabelIn"] == ["Fixing"]
    assert p["projectTypeLabelIn"] == ["Pentest"]
    assert p["createdAtGteq"] == "2026-01-01"
    assert p["createdAtLteq"] == "2026-02-01"
    assert p["tags"] == ["pci"]
    assert p["analystsEmailIn"] == ["a@x.com"]
    assert v["sortBy"] == "createdAt" and v["descending"] is True


def test_projects_params_minimal_omits_empty():
    v = GraphQLClient.build_projects_variables(248, 1, 50)
    assert v["params"] == {"scopeIdEq": 248}
