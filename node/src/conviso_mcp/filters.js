// node/src/conviso_mcp/filters.js
// Pure helpers for building GraphQL filter/sort variables. No network.

export const SEVERITIES = ['NOTIFICATION', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const ISSUE_STATUSES = ['CREATED', 'DRAFT', 'IDENTIFIED', 'IN_PROGRESS', 'AWAITING_VALIDATION', 'FIX_ACCEPTED', 'RISK_ACCEPTED', 'FALSE_POSITIVE', 'SUPPRESSED'];
export const SLA_STATES = ['ON_TRACK', 'APPROACHING', 'BREACHED', 'RESOLVED', 'NOT_TRACKED', 'NOT_PARAMETERIZED'];
export const BUSINESS_IMPACT = ['LOW', 'MEDIUM', 'HIGH', 'NOT_DEFINED'];
export const EXPLOITABILITY = ['INTERNET_FACING', 'INTERNAL', 'NOT_DEFINED'];
export const REACHABILITY = ['STATIC_ANALYSIS', 'DYNAMIC_ANALYSIS'];
export const ISSUE_SORT_BY = ['RISK_SCORE', 'SEVERITY', 'ID', 'CREATED_AT', 'UPDATED_AT', 'SLA_DUE_AT'];
export const ASSET_SORT_BY = ['updated_at', 'name', 'business_impact', 'risk_score'];
export const ORDER = ['ASC', 'DESC'];

export function normalizeEnum(value, allowed, upper = true) {
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  s = upper ? s.toUpperCase() : s.toLowerCase();
  return allowed.includes(s) ? s : null;
}

export function normalizeEnumList(values, allowed, upper = true) {
  if (!values || values.length === 0) return [];
  const out = [];
  for (const v of values) {
    const s = normalizeEnum(v, allowed, upper);
    if (s !== null) out.push(s);
  }
  return out;
}

export function buildDateRange(after, before) {
  const rng = {};
  if (after) rng.startDate = after;
  if (before) rng.endDate = before;
  return Object.keys(rng).length ? rng : null;
}

export function buildIssueSortOptions(sortBy, order) {
  const sb = normalizeEnum(sortBy, ISSUE_SORT_BY);
  if (sb === null) return [];
  const ord = normalizeEnum(order, ORDER) || 'DESC';
  return [{ sortBy: sb, order: ord }];
}

export function prune(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}
