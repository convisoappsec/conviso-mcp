import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "conviso_mcp"))

import filters as f


def test_normalize_enum_list_uppercases_and_filters_unknown():
    assert f.normalize_enum_list(["critical", "High", "bogus"], f.SEVERITIES) == ["CRITICAL", "HIGH"]


def test_normalize_enum_list_empty_and_none():
    assert f.normalize_enum_list(None, f.SEVERITIES) == []
    assert f.normalize_enum_list([], f.SEVERITIES) == []


def test_normalize_enum_list_lowercase_allowed_for_asset_sort():
    assert f.normalize_enum_list(["RISK_SCORE", "Name"], f.ASSET_SORT_BY, upper=False) == ["risk_score", "name"]


def test_normalize_enum_single():
    assert f.normalize_enum("internal", f.EXPLOITABILITY) == "INTERNAL"
    assert f.normalize_enum("nope", f.EXPLOITABILITY) is None
    assert f.normalize_enum(None, f.EXPLOITABILITY) is None


def test_build_date_range():
    assert f.build_date_range("2026-01-01", "2026-02-01") == {"startDate": "2026-01-01", "endDate": "2026-02-01"}
    assert f.build_date_range("2026-01-01", None) == {"startDate": "2026-01-01"}
    assert f.build_date_range(None, None) is None


def test_build_issue_sort_options():
    assert f.build_issue_sort_options("severity", "asc") == [{"sortBy": "SEVERITY", "order": "ASC"}]
    assert f.build_issue_sort_options("bogus", "desc") == []
    assert f.build_issue_sort_options(None, None) == []


def test_prune_drops_empty():
    assert f.prune({"a": 1, "b": None, "c": [], "d": "", "e": {}, "f": [1]}) == {"a": 1, "f": [1]}
