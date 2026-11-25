/**
 * Metrics Studio (custom dashboards): build, preview, create and update dashboards.
 *
 * The platform stores a dashboard as one declarative JSON document (DefinitionV1, validated by
 * platform-backend app/services/custom_dashboards/definitions/validator.rb against
 * config/custom_dashboards/schemas/definition_v1.json). The model describes widgets in the
 * definition's own vocabulary (the one customDashboardMetricCatalog returns) and this module
 * fills what is mechanical: definition version, each metric's time basis and latest version,
 * widget keys and the grid layout. Every combination rule stays on the server: its validation
 * errors are located by JSON pointer and returned per widget, so nothing here duplicates (and
 * drifts from) the catalog.
 *
 * Dashboards are private to the API key's user. The server gate is the dashboard_manage_own
 * permission; the Metrics Studio page itself is also behind the frontend flag
 * "custom-dashboard".
 */

export const DEFAULT_TIMEZONE = 'UTC';
export const DEFAULT_PERIOD_DAYS = 30; // the editor's default for a new dashboard
export const DEFAULT_WIDGET_LIMIT = 12; // Limits::WIDGETS_PER_DASHBOARD when the catalog omits it
export const GRID_COLUMNS = 12;
const MAX_HEIGHT = 12;
const MAX_Y = 1000;
const KEY_MAX_LENGTH = 64;
const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CATALOG_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PREVIEW_CONCURRENCY = 3; // limits.clientConcurrency
const SAMPLE_ROWS = 5;

export const VISUALIZATION_KINDS = ['NUMBER', 'TABLE', 'BAR', 'HORIZONTAL_BAR', 'STACKED_BAR', 'LINE', 'RECORD_LIST'];
export const OWNERSHIP_FILTERS = ['OWNED', 'SHARED_WITH_ME', 'ALL'];

// Size presets of the platform editor (platform-frontend src/pages/customDashboards/gridLayout.ts).
export const WIDGET_SIZES = {
  SMALL: { width: 3, height: 2 },
  MEDIUM: { width: 4, height: 3 },
  HALF: { width: 6, height: 4 },
  WIDE: { width: 8, height: 4 },
  FULL: { width: 12, height: 4 },
};
const DEFAULT_SIZE_BY_KIND = { NUMBER: 'SMALL', RECORD_LIST: 'FULL' };

// The only record-list columns the validator approves; they are not part of the catalog.
export const RECORD_LIST_COLUMNS = {
  'issues.count': ['issueId', 'title', 'severity', 'status', 'slaState', 'assetName', 'dueAt', 'recordedAt'],
  'coverage.missing_successful_scan': ['assetId', 'assetName', 'configured', 'lastSucceededAt'],
};

// Query fields a widget may also carry at its top level (merged into widget.query).
const QUERY_FIELDS = ['filterMode', 'filters', 'groupBy', 'orderBy', 'limit', 'parameters', 'recordList', 'timeRange'];

// snake_case spellings models tend to use for the definition's camelCase keys.
const FILTER_ALIASES = {
  asset_ids: 'assetIds', asset_tags: 'assetTags', sla_states: 'slaStates',
  issue_types: 'issueTypes', branch_scope: 'branchScope',
};
const PARAMETER_ALIASES = { window_days: 'windowDays' };
const QUERY_ALIASES = {
  filter_mode: 'filterMode', group_by: 'groupBy', order_by: 'orderBy',
  record_list: 'recordList', time_range: 'timeRange',
};

const NOTES = {
  private: 'The dashboard is private to the user that owns the API key. Other people only see it after it is shared from the Metrics Studio page of the platform.',
  flag: 'If the link does not open Metrics Studio, the feature is not enabled for this company yet.',
};

function publicError(status, message, data) {
  const e = new Error(message);
  e.status = status;
  e.publicMessage = message;
  if (data) e.publicData = data;
  return e;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

function renameKeys(obj, aliases) {
  if (!isObject(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[aliases[k] || k] = v;
  return out;
}

// --- GraphQL documents ------------------------------------------------------

export const CATALOG_QUERY = `
  query CustomDashboardCatalog($companyId: ID!) {
    customDashboardMetricCatalog(companyId: $companyId) {
      definitionVersion
      metrics {
        key version label description semantics dataset entityGrain timeBasis filters groupings
        visualizations { groupDepth kinds }
        parameters { key kind values minimum maximum default required }
        measureLabel unit aggregation maxLimit
      }
      dimensions { key label datasets valueKind additive listSelectable values ungroupedIn }
      vocabularies { statuses severities issueTypes assetTypes }
      limits { widgetsPerDashboard dashboardsPerOwner defaultTopN maxTopN lineSeries clientConcurrency }
    }
  }
`;

const DASHBOARD_FIELDS = `
  id name description timezone lockVersion definitionVersion widgetCount origin
  createdAt updatedAt accessRole ownerActive
  owner { name email }
  capabilities { canEdit canDelete canShare }
`;

export const LIST_QUERY = `
  query CustomDashboards($companyId: ID!, $search: String, $ownership: CustomDashboardOwnershipFilter, $page: Int, $limit: Int) {
    customDashboards(companyId: $companyId, search: $search, ownership: $ownership, page: $page, limit: $limit) {
      collection { ${DASHBOARD_FIELDS} }
      metadata { currentPage totalPages totalCount limitValue }
    }
  }
`;

export const GET_QUERY = `
  query CustomDashboard($companyId: ID!, $id: ID!) {
    customDashboard(companyId: $companyId, id: $id) {
      ${DASHBOARD_FIELDS}
      definition
    }
  }
`;

export const PREVIEW_QUERY = `
  query PreviewCustomDashboardWidget($companyId: ID!, $definition: JSON!) {
    previewCustomDashboardWidget(companyId: $companyId, definition: $definition) {
      widgetKey state reasonCode
      errors { path code message }
      measure { label unit aggregation }
      secondaryMeasure { label unit }
      buckets { index start end }
      rows {
        groups { dimension key label ungrouped unavailable }
        bucketIndex value secondaryValue sampleSize
      }
      total totalSampleSize truncated notes
      unavailableReferences { path value }
    }
  }
`;

// The only two mutations this module sends (operation_allowlist.js DEDICATED_MUTATIONS).
export const CREATE_MUTATION = `
  mutation CreateCustomDashboard($input: CreateCustomDashboardInput!) {
    createCustomDashboard(input: $input) {
      customDashboard { ${DASHBOARD_FIELDS} definition }
    }
  }
`;

export const UPDATE_MUTATION = `
  mutation UpdateCustomDashboard($input: UpdateCustomDashboardInput!) {
    updateCustomDashboard(input: $input) {
      customDashboard { ${DASHBOARD_FIELDS} definition }
    }
  }
`;

// --- Errors -------------------------------------------------------------------

/** "/widgets/3/query/groupBy" -> 3 (null for a dashboard-level path). */
function widgetIndexOf(path) {
  const m = /^\/widgets\/(\d+)(?:\/|$)/.exec(path || '');
  return m ? Number(m[1]) : null;
}

/** Path errors with the widget each one belongs to, so the model knows what to fix. */
export function locateValidationErrors(details, definition) {
  return (details || []).filter(isObject).map((d) => {
    const index = widgetIndexOf(d.path);
    const widget = index === null ? null : definition?.widgets?.[index];
    return compact({
      path: d.path,
      code: d.code,
      message: d.message,
      widget: index === null ? undefined : compact({ index, key: widget?.key, title: widget?.title }),
    });
  });
}

/**
 * Translate a custom-dashboard GraphQL error (read by extensions.code, never by message) into
 * an error the tool may show. Unknown errors pass through unchanged (sanitizeError hides them).
 * The backend builds these messages and details from fixed texts (SEC-22), so they are safe.
 */
export function mapDashboardError(err, { definition = null, companyId = null } = {}) {
  const ext = (err?.graphqlExtensions || []).find((x) => isObject(x) && typeof x.code === 'string');
  if (!ext) return err;
  switch (ext.code) {
    case 'INVALID_DEFINITION':
      return publicError(400, 'The dashboard definition is invalid. Fix the fields listed in validation_errors and try again.', {
        validation_errors: locateValidationErrors(ext.details, definition),
      });
    case 'NOT_AUTHORIZED': {
      const e = publicError(403, 'Not authorized to use Metrics Studio in this company.');
      e.authHint = `The API key's user needs the Metrics Studio permission (create own dashboards) in the access profile of company ${companyId ?? ''}`.trim();
      return e;
    }
    case 'LIMIT_EXCEEDED':
      return publicError(400, err.graphqlErrors?.[0] || 'A Metrics Studio limit was exceeded.');
    case 'CUSTOM_DASHBOARD_CONFLICT':
      return publicError(409, ext.reason === 'STALE_REVISION'
        ? 'The dashboard changed since expected_version. Call get_custom_dashboard, apply the change to the current definition and retry with its lock_version.'
        : 'The dashboard request conflicts with an earlier one.');
    case 'RECORD_NOT_FOUND':
      return publicError(404, 'Dashboard not found, or not visible to the API key user.');
    case 'INVALID_PARAMETERS':
      return publicError(400, err.graphqlErrors?.[0] || 'Invalid parameters.');
    default:
      return err;
  }
}

async function run(execute, query, variables, context) {
  try {
    return await execute(query, variables);
  } catch (err) {
    throw mapDashboardError(err, context);
  }
}

// --- Catalog --------------------------------------------------------------------

const catalogCache = new Map();

export function clearCatalogCache() {
  catalogCache.clear();
}

export async function fetchCatalog(execute, companyId, { now = Date.now() } = {}) {
  const cacheKey = String(companyId);
  const hit = catalogCache.get(cacheKey);
  if (hit && now - hit.at < CATALOG_TTL_MS) return hit.catalog;
  const data = await run(execute, CATALOG_QUERY, { companyId }, { companyId });
  const catalog = data?.customDashboardMetricCatalog;
  if (!catalog) throw publicError(502, 'The platform did not return the Metrics Studio catalog.');
  catalogCache.set(cacheKey, { at: now, catalog });
  return catalog;
}

/** The catalog in the shape the model composes widgets from. */
export function summarizeCatalog(catalog) {
  return {
    definition_version: catalog.definitionVersion,
    metrics: (catalog.metrics || []).map((m) => compact({
      metric: `${m.key}@${m.version}`,
      label: m.label,
      description: m.description,
      semantics: m.semantics,
      dataset: m.dataset,
      entity_grain: m.entityGrain,
      time_basis: m.timeBasis,
      unit: m.unit,
      aggregation: m.aggregation,
      filters: m.filters,
      groupings: m.groupings,
      visualizations: Object.fromEntries((m.visualizations || []).map((v) => [String(v.groupDepth), v.kinds])),
      parameters: (m.parameters || []).length ? m.parameters.map((p) => compact({
        key: p.key,
        kind: p.kind,
        values: p.values?.length ? p.values : undefined,
        minimum: p.minimum,
        maximum: p.maximum,
        default: p.default === '' ? undefined : p.default,
        required: p.required || undefined,
      })) : undefined,
      max_limit: m.maxLimit,
      record_list_columns: RECORD_LIST_COLUMNS[m.key],
    })),
    dimensions: (catalog.dimensions || []).map((d) => compact({
      key: d.key,
      label: d.label,
      datasets: d.datasets,
      value_kind: d.valueKind,
      values: d.values,
      list_selectable: d.listSelectable,
      additive: d.additive,
      ungrouped_in: d.ungroupedIn?.length ? d.ungroupedIn : undefined,
    })),
    vocabularies: catalog.vocabularies,
    limits: catalog.limits,
    widget_sizes: WIDGET_SIZES,
    how_to_read: [
      'groupings lists every allowed groupBy, in order: [] means no grouping, ["asset_tag","severity"] means two levels.',
      'visualizations maps the number of groupBy dimensions to the allowed visualization kinds.',
      'filters lists the widget filter keys the metric accepts (camelCase, e.g. slaStates). Values come from vocabularies or from the dimension values.',
      'time_basis CURRENT measures the state now and ignores the period; EVENT_IN_PERIOD and BUCKET_END_SNAPSHOT use the dashboard period or the widget timeRange.',
      'RECORD_LIST is only allowed where record_list_columns is present.',
    ],
  };
}

function findMetric(catalog, ref, index, title) {
  const metrics = catalog.metrics || [];
  const sameKey = metrics.filter((m) => m.key === ref.key);
  if (!sameKey.length) {
    throw publicError(400, `Widget ${index} ("${title}"): unknown metric '${ref.key}'. Call get_custom_dashboard_catalog for the available metrics.`, {
      available_metrics: metrics.map((m) => `${m.key}@${m.version}`),
    });
  }
  if (ref.version === undefined) return sameKey.reduce((a, b) => (b.version > a.version ? b : a));
  const exact = sameKey.find((m) => m.version === ref.version);
  if (!exact) {
    throw publicError(400, `Widget ${index} ("${title}"): metric '${ref.key}' has no version ${ref.version}.`, {
      available_versions: sameKey.map((m) => m.version),
    });
  }
  return exact;
}

// --- Definition building --------------------------------------------------------

/** "issues.count", "issues.count@1" or { key, version } -> { key, version? } */
export function parseMetricRef(metric) {
  if (isObject(metric)) {
    const version = metric.version === undefined || metric.version === null ? undefined : Number(metric.version);
    return { key: String(metric.key || '').trim(), version };
  }
  const text = String(metric || '').trim();
  const at = text.lastIndexOf('@');
  if (at > 0 && /^\d+$/.test(text.slice(at + 1))) {
    return { key: text.slice(0, at), version: Number(text.slice(at + 1)) };
  }
  return { key: text, version: undefined };
}

/** A key matching the definition's localKey pattern, unique among `used`. */
export function widgetKey(title, used = new Set(), preferred = null) {
  if (typeof preferred === 'string' && KEY_PATTERN.test(preferred) && !used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  const base = String(title || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, KEY_MAX_LENGTH)
    .replace(/-+$/g, '') || 'widget';
  let key = base;
  for (let n = 2; used.has(key); n += 1) {
    const suffix = `-${n}`;
    key = `${base.slice(0, KEY_MAX_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`;
  }
  used.add(key);
  return key;
}

function normalizeGroupBy(groupBy) {
  if (groupBy === undefined || groupBy === null) return undefined;
  return (Array.isArray(groupBy) ? groupBy : [groupBy]).map((item) => {
    if (typeof item === 'string') return { dimension: item };
    if (!isObject(item)) return item;
    const out = renameKeys(item, { include_ungrouped: 'includeUngrouped' });
    if (out.values !== undefined && out.selection === undefined) {
      out.selection = { mode: 'LIST', values: out.values };
    }
    delete out.values;
    if (isObject(out.selection) && Array.isArray(out.selection.values)) {
      out.selection = { ...out.selection, values: out.selection.values.map(String) };
    }
    return out;
  });
}

function normalizeFilters(filters) {
  if (!isObject(filters)) return filters;
  const out = renameKeys(filters, FILTER_ALIASES);
  // assetIds are strings in the definition; ids often arrive as numbers.
  if (Array.isArray(out.assetIds)) out.assetIds = out.assetIds.map(String);
  return out;
}

function normalizeRecordList(list) {
  if (!isObject(list)) return list;
  const out = renameKeys(list, { page_size: 'pageSize' });
  if (out.sort === undefined && Array.isArray(out.columns) && out.columns.length) {
    out.sort = { column: out.columns[0], direction: 'DESC' };
  }
  if (out.pageSize === undefined) out.pageSize = 10;
  return out;
}

function sizeOf(widget, kind, index, title) {
  if (widget.size !== undefined) {
    const preset = WIDGET_SIZES[String(widget.size).toUpperCase()];
    if (!preset) {
      throw publicError(400, `Widget ${index} ("${title}"): size must be one of ${Object.keys(WIDGET_SIZES).join(', ')}.`);
    }
    return { ...preset };
  }
  if (isObject(widget.layout) && Number.isInteger(widget.layout.width) && Number.isInteger(widget.layout.height)) {
    return { width: widget.layout.width, height: widget.layout.height };
  }
  return { ...WIDGET_SIZES[DEFAULT_SIZE_BY_KIND[kind] || 'HALF'] };
}

function normalizeWidget(raw, index, catalog, key, savedLayout) {
  if (!isObject(raw)) throw publicError(400, `Widget ${index} must be an object.`);
  const widget = renameKeys(raw, QUERY_ALIASES);
  const title = String(widget.title ?? '').trim();
  if (!title) throw publicError(400, `Widget ${index} needs a title.`);

  const metric = findMetric(catalog, parseMetricRef(widget.metric), index, title);

  const query = isObject(widget.query) ? renameKeys(widget.query, QUERY_ALIASES) : {};
  for (const field of QUERY_FIELDS) {
    if (widget[field] !== undefined) query[field] = widget[field];
  }
  query.timeBasis = metric.timeBasis;
  if (query.groupBy !== undefined) query.groupBy = normalizeGroupBy(query.groupBy);
  if (query.filters !== undefined) query.filters = normalizeFilters(query.filters);
  if (query.parameters !== undefined) query.parameters = renameKeys(query.parameters, PARAMETER_ALIASES);
  if (query.recordList !== undefined) query.recordList = normalizeRecordList(query.recordList);
  if (typeof query.orderBy === 'string') query.orderBy = { measure: 'value', direction: query.orderBy.toUpperCase() };
  if (typeof query.filterMode === 'string') query.filterMode = query.filterMode.toUpperCase();

  const kindRaw = isObject(widget.visualization) ? widget.visualization.kind : widget.visualization;
  const kind = String(kindRaw || '').trim().toUpperCase();
  if (!kind) {
    throw publicError(400, `Widget ${index} ("${title}") needs a visualization: ${VISUALIZATION_KINDS.join(', ')}.`);
  }

  return {
    key,
    title,
    metric: { key: metric.key, version: metric.version },
    query,
    visualization: { kind },
    layout: { x: 0, y: 0, ...sizeOf({ ...widget, layout: widget.layout ?? savedLayout }, kind, index, title), order: index },
    enabled: widget.enabled !== false,
  };
}

/**
 * Port of the editor's packLayout: widgets flow left to right in reading order and wrap to a
 * new row when they do not fit, so x/y/order describe exactly what the grid renders.
 */
export function packLayout(widgets) {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  return widgets
    .map((widget, index) => ({ widget, index }))
    .sort((a, b) => (a.widget.layout.order - b.widget.layout.order) || (a.index - b.index))
    .map(({ widget }, order) => {
      const width = Math.min(Math.max(widget.layout.width, 1), GRID_COLUMNS);
      const height = Math.min(Math.max(widget.layout.height, 1), MAX_HEIGHT);
      if (x + width > GRID_COLUMNS) {
        y += rowHeight;
        x = 0;
        rowHeight = 0;
      }
      const layout = { x, y: Math.min(y, MAX_Y), width, height, order };
      x += width;
      rowHeight = Math.max(rowHeight, height);
      return { ...widget, layout };
    });
}

/**
 * Tool arguments (+ the current canonical definition, on update) -> a complete DefinitionV1.
 * Fields left out keep the current value; widgets, when given, replace the whole list.
 */
export function buildDefinition(spec = {}, catalog, base = null) {
  const name = String(spec.name ?? base?.name ?? '').trim();
  if (!name) throw publicError(400, 'name is required.');

  let defaultTimeRange = base?.defaultTimeRange ?? { mode: 'LAST_COMPLETE_DAYS', days: DEFAULT_PERIOD_DAYS };
  if (spec.period_days !== undefined) defaultTimeRange = { mode: 'LAST_COMPLETE_DAYS', days: spec.period_days };
  if (spec.default_time_range !== undefined) defaultTimeRange = spec.default_time_range;

  const definition = compact({
    definitionVersion: catalog.definitionVersion ?? base?.definitionVersion ?? 1,
    name,
    description: spec.description ?? base?.description,
    timezone: spec.timezone ?? base?.timezone ?? DEFAULT_TIMEZONE,
    defaultTimeRange,
    defaultFilters: spec.default_filters !== undefined
      ? normalizeFilters(spec.default_filters)
      : (base?.defaultFilters ?? { archived: 'ACTIVE' }),
  });

  if (spec.widgets === undefined) {
    if (!base) throw publicError(400, 'widgets is required.');
    // Untouched widgets keep the layout the people editing the dashboard arranged.
    definition.widgets = base.widgets || [];
    return definition;
  }

  const limit = catalog.limits?.widgetsPerDashboard ?? DEFAULT_WIDGET_LIMIT;
  if (!Array.isArray(spec.widgets) || spec.widgets.length === 0) {
    throw publicError(400, 'widgets must list at least one widget.');
  }
  if (spec.widgets.length > limit) {
    throw publicError(400, `A dashboard holds at most ${limit} widgets; got ${spec.widgets.length}. Split it into more than one dashboard.`);
  }
  // Assign explicit keys first so an earlier title cannot claim a later widget's identity.
  const usedKeys = new Set();
  const keys = spec.widgets.map((w) => {
    if (typeof w?.key !== 'string' || !KEY_PATTERN.test(w.key) || usedKeys.has(w.key)) return null;
    usedKeys.add(w.key);
    return w.key;
  });
  const savedWidgets = base?.widgets ?? [];
  const savedByKey = new Map(savedWidgets.map((w) => [w.key, w]));
  const widgets = spec.widgets.map((w, i) => {
    const key = keys[i] ?? widgetKey(w?.title, usedKeys);
    return normalizeWidget(w, i, catalog, key, savedByKey.get(key)?.layout);
  });
  const sameGrid = widgets.length === savedWidgets.length && widgets.every((w, i) => {
    const saved = savedWidgets[i];
    return w.key === saved.key && w.layout.width === saved.layout.width && w.layout.height === saved.layout.height;
  });
  if (sameGrid) {
    definition.widgets = widgets.map((w, i) => {
      const saved = savedWidgets[i].layout;
      const requested = spec.widgets[i].layout;
      return { ...w, layout: {
        ...w.layout, x: requested?.x ?? saved.x, y: requested?.y ?? saved.y, order: requested?.order ?? saved.order,
      } };
    });
  } else {
    definition.widgets = packLayout(widgets);
  }
  return definition;
}

// --- Output shapes ----------------------------------------------------------------

export function dashboardUrl(appUrl, companyId, dashboardId, { edit = false } = {}) {
  return `${appUrl}/spa/company/${companyId}/dashboards/custom/${dashboardId}${edit ? '/edit' : ''}`;
}

export function summarizeDashboard(d, companyId, appUrl) {
  return compact({
    id: d.id === undefined ? undefined : String(d.id),
    name: d.name,
    description: d.description || undefined,
    timezone: d.timezone,
    lock_version: d.lockVersion,
    widget_count: d.widgetCount,
    origin: d.origin,
    access_role: d.accessRole,
    can_edit: d.capabilities?.canEdit,
    can_delete: d.capabilities?.canDelete,
    owner: d.owner ? compact({ name: d.owner.name, email: d.owner.email }) : undefined,
    owner_active: d.ownerActive,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
    url: d.id === undefined ? undefined : dashboardUrl(appUrl, companyId, d.id),
    edit_url: d.id === undefined ? undefined : dashboardUrl(appUrl, companyId, d.id, { edit: true }),
  });
}

export function summarizeWidgets(definition) {
  return (definition?.widgets || []).map((w) => compact({
    key: w.key,
    title: w.title,
    metric: w.metric ? `${w.metric.key}@${w.metric.version}` : undefined,
    visualization: w.visualization?.kind,
    group_by: (w.query?.groupBy || []).map((g) => g.dimension),
    layout: w.layout,
    enabled: w.enabled === false ? false : undefined,
  }));
}

function groupLabel(g) {
  if (g.ungrouped) return '(ungrouped)';
  if (g.unavailable) return '(unavailable)';
  return g.label ?? g.key;
}

export function summarizePreview(result, widget) {
  const buckets = new Map((result.buckets || []).map((b) => [b.index, b.start]));
  const rows = result.rows || [];
  return compact({
    key: widget.key,
    title: widget.title,
    state: result.state,
    reason_code: result.reasonCode,
    errors: result.errors?.length ? result.errors : undefined,
    measure: result.measure ? compact({ label: result.measure.label, unit: result.measure.unit }) : undefined,
    total: result.total,
    total_sample_size: result.totalSampleSize,
    row_count: rows.length,
    truncated: result.truncated || undefined,
    notes: result.notes?.length ? result.notes : undefined,
    unavailable_references: result.unavailableReferences?.length ? result.unavailableReferences : undefined,
    sample_rows: rows.slice(0, SAMPLE_ROWS).map((r) => compact({
      groups: r.groups?.length ? r.groups.map(groupLabel) : undefined,
      bucket_start: r.bucketIndex === null || r.bucketIndex === undefined ? undefined : buckets.get(r.bucketIndex),
      value: r.value,
      secondary_value: r.secondaryValue,
    })),
  });
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/**
 * Validate and compute every widget without saving: the server previews exactly one widget
 * per call, so each runs inside a copy of the dashboard holding only that widget.
 */
export async function previewDefinition(execute, companyId, definition, { concurrency = DEFAULT_PREVIEW_CONCURRENCY } = {}) {
  if (!definition.widgets.length) {
    return {
      dry_run: true, saved: false, valid: null, preview_succeeded: false, widgets: [],
      note: 'The platform preview requires one widget. It could not validate the metadata of this empty dashboard.',
    };
  }
  const dashboardErrors = new Map();
  const widgets = await mapWithConcurrency(definition.widgets, Math.max(1, concurrency), async (widget, index) => {
    const single = { ...definition, widgets: [widget] };
    try {
      const data = await execute(PREVIEW_QUERY, { companyId, definition: single });
      return { ...summarizeWidgets({ widgets: [widget] })[0], preview: summarizePreview(data.previewCustomDashboardWidget, widget) };
    } catch (err) {
      const mapped = mapDashboardError(err, { definition: single, companyId });
      const summary = summarizeWidgets({ widgets: [widget] })[0];
      const located = mapped.publicData?.validation_errors;
      if (!located) {
        // Authorization and unexpected failures stop the dry run; a widget-level failure
        // (e.g. the statement timeout) is reported on that widget only.
        if (mapped.status === 403 || !mapped.publicMessage) throw mapped;
        return { ...summary, preview: { state: 'ERROR', message: mapped.publicMessage } };
      }
      const own = [];
      for (const e of located) {
        if (e.widget) {
          own.push({ ...e, path: e.path.replace(/^\/widgets\/0/, `/widgets/${index}`), widget: { ...e.widget, index } });
        } else {
          dashboardErrors.set(`${e.path}|${e.code}`, e);
        }
      }
      return {
        ...summary,
        preview: own.length
          ? { state: 'INVALID_CONFIGURATION', validation_errors: own }
          : { state: 'NOT_COMPUTED', message: 'Not computed: fix dashboard_errors first.' },
      };
    }
  });
  const states = widgets.map((w) => w.preview.state);
  return compact({
    dry_run: true,
    saved: false,
    valid: dashboardErrors.size === 0 && !states.includes('INVALID_CONFIGURATION') && !states.includes('NOT_COMPUTED'),
    preview_succeeded: states.every((state) => state === 'READY' || state === 'NO_DATA'),
    dashboard_errors: dashboardErrors.size ? [...dashboardErrors.values()] : undefined,
    widgets,
    note: 'Nothing was saved. READY means the widget computed (a zero count is READY); NO_DATA means a mean or rate had nothing to measure; FORBIDDEN means the API key user cannot read that data. Fix invalid widgets, then call again without dry_run.',
  });
}

// --- Tool entry points --------------------------------------------------------------

export async function getCustomDashboardCatalog(execute, { company_id }) {
  return summarizeCatalog(await fetchCatalog(execute, company_id));
}

export async function listCustomDashboards(execute, { company_id, search, ownership, page = 1, limit = 25 } = {}, { appUrl } = {}) {
  const data = await run(execute, LIST_QUERY, compact({
    companyId: company_id, search, ownership, page, limit,
  }), { companyId: company_id });
  const list = data?.customDashboards || {};
  return {
    dashboards: (list.collection || []).map((d) => summarizeDashboard(d, company_id, appUrl)),
    metadata: list.metadata,
  };
}

async function loadDashboard(execute, companyId, dashboardId) {
  const data = await run(execute, GET_QUERY, { companyId, id: String(dashboardId) }, { companyId });
  const dashboard = data?.customDashboard;
  if (!dashboard) throw publicError(404, 'Dashboard not found, or not visible to the API key user.');
  return dashboard;
}

export async function getCustomDashboard(execute, { company_id, dashboard_id }, { appUrl } = {}) {
  const d = await loadDashboard(execute, company_id, dashboard_id);
  return { dashboard: summarizeDashboard(d, company_id, appUrl), definition: d.definition };
}

function specOf(args) {
  return {
    name: args.name,
    description: args.description,
    timezone: args.timezone,
    period_days: args.period_days,
    default_time_range: args.default_time_range,
    default_filters: args.default_filters,
    widgets: args.widgets,
  };
}

export async function createCustomDashboard(execute, args = {}, { appUrl } = {}) {
  const companyId = args.company_id;
  const catalog = await fetchCatalog(execute, companyId);
  const definition = buildDefinition(specOf(args), catalog);
  if (args.dry_run) {
    return previewDefinition(execute, companyId, definition, { concurrency: catalog.limits?.clientConcurrency });
  }
  const data = await run(execute, CREATE_MUTATION, { input: { companyId, definition } }, { definition, companyId });
  const d = data?.createCustomDashboard?.customDashboard;
  if (!d) throw publicError(502, 'The platform did not return the created dashboard.');
  return {
    created: true,
    dashboard: summarizeDashboard(d, companyId, appUrl),
    widgets: summarizeWidgets(d.definition),
    notes: [NOTES.private, NOTES.flag],
  };
}

export async function updateCustomDashboard(execute, args = {}, { appUrl } = {}) {
  const companyId = args.company_id;
  if (!Number.isInteger(args.expected_version)) {
    throw publicError(400, 'expected_version is required: pass the lock_version returned by get_custom_dashboard.');
  }
  const current = await loadDashboard(execute, companyId, args.dashboard_id);
  if (current.capabilities && current.capabilities.canEdit === false) {
    throw publicError(403, 'The API key user can open this dashboard but cannot edit it.');
  }
  if (current.lockVersion !== args.expected_version) {
    throw publicError(409, `The dashboard is at lock_version ${current.lockVersion}, not ${args.expected_version}: it changed since it was read. Call get_custom_dashboard, apply the change to the current definition and retry.`);
  }
  const catalog = await fetchCatalog(execute, companyId);
  const definition = buildDefinition(specOf(args), catalog, current.definition);
  if (args.dry_run) {
    return previewDefinition(execute, companyId, definition, { concurrency: catalog.limits?.clientConcurrency });
  }
  const data = await run(execute, UPDATE_MUTATION, {
    input: { companyId, id: String(args.dashboard_id), expectedVersion: args.expected_version, definition },
  }, { definition, companyId });
  const d = data?.updateCustomDashboard?.customDashboard;
  if (!d) throw publicError(502, 'The platform did not return the updated dashboard.');
  return {
    updated: true,
    dashboard: summarizeDashboard(d, companyId, appUrl),
    widgets: summarizeWidgets(d.definition),
  };
}
