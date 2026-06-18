"""Pure helpers for building GraphQL filter/sort variables. No network."""

SEVERITIES = ["NOTIFICATION", "LOW", "MEDIUM", "HIGH", "CRITICAL"]
ISSUE_STATUSES = [
    "CREATED", "DRAFT", "IDENTIFIED", "IN_PROGRESS", "AWAITING_VALIDATION",
    "FIX_ACCEPTED", "RISK_ACCEPTED", "FALSE_POSITIVE", "SUPPRESSED",
]
SLA_STATES = ["ON_TRACK", "APPROACHING", "BREACHED", "RESOLVED", "NOT_TRACKED", "NOT_PARAMETERIZED"]
BUSINESS_IMPACT = ["LOW", "MEDIUM", "HIGH", "NOT_DEFINED"]
EXPLOITABILITY = ["INTERNET_FACING", "INTERNAL", "NOT_DEFINED"]
REACHABILITY = ["STATIC_ANALYSIS", "DYNAMIC_ANALYSIS"]
ISSUE_SORT_BY = ["RISK_SCORE", "SEVERITY", "ID", "CREATED_AT", "UPDATED_AT", "SLA_DUE_AT"]
ASSET_SORT_BY = ["updated_at", "name", "business_impact", "risk_score"]
ORDER = ["ASC", "DESC"]


def normalize_enum(value, allowed, upper=True):
    if value is None:
        return None
    s = str(value).strip()
    s = s.upper() if upper else s.lower()
    return s if s in allowed else None


def normalize_enum_list(values, allowed, upper=True):
    if not values:
        return []
    out = []
    for v in values:
        s = normalize_enum(v, allowed, upper=upper)
        if s is not None:
            out.append(s)
    return out


def build_date_range(after, before):
    rng = {}
    if after:
        rng["startDate"] = after
    if before:
        rng["endDate"] = before
    return rng or None


def build_issue_sort_options(sort_by, order):
    sb = normalize_enum(sort_by, ISSUE_SORT_BY)
    if sb is None:
        return []
    ordv = normalize_enum(order, ORDER) or "DESC"
    return [{"sortBy": sb, "order": ordv}]


def prune(d):
    return {k: v for k, v in d.items() if v not in (None, "", [], {})}
