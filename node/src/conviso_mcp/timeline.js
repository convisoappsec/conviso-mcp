/**
 * Change history ("timeline") of Conviso objects, normalized to one event shape.
 *
 * The platform has no generic timeline query: each object exposes its own field, with its
 * own shape and pagination (validated against platform-backend):
 *   project               project.timeline (status, allocations, reports, attachments; not
 *                         paginated) + the history of every requirement activity of the
 *                         project + activity attachment records from project.activitiesTimeline.
 *                         activitiesTimeline is not used for activity changes: the backend
 *                         skips activities that have no `check` (custom activities), so their
 *                         whole history would be missing.
 *   activity              activities(params:{projectId, activityId}).history (paginated)
 *   issue                 issue.timeline (paginated; not enabled for every company, and
 *                         then it returns an empty page) -> falls back to the legacy
 *                         issue.history (status + assignee changes)
 *   asset                 no history field: creation, last update, archive, risk score and
 *                         scanHistories are assembled into events
 *   ticket                ticket.history (not paginated)
 *   threat_model_artifact threatModelArtifact.versions (snapshots, not paginated)
 *   pentest_artifact      pentestArtifact.executions (not paginated)
 *
 * Every event: { at, type, source, actor{name,email}, target, field, from, to, reason,
 * subject, details }, newest first. Sources the platform does not paginate are paginated
 * here ("client" mode). No query selects File.url / File.presignedUrl, so reading a
 * timeline never records an attachment download.
 */

export const TIMELINE_OBJECT_TYPES = [
  'project', 'activity', 'issue', 'asset', 'ticket', 'threat_model_artifact', 'pentest_artifact',
];
export const DEFAULT_TIMELINE_LIMIT = 50;
export const MAX_TIMELINE_LIMIT = 100;
const SOURCE_PAGE_SIZE = 100; // platform max_limit for paginated collections
const MAX_SOURCE_PAGES = 10;
const ACTIVITIES_PAGE_SIZE = 200;
const MAX_ACTIVITY_PAGES = 5;
const ACTIVITY_HISTORY_PER_ACTIVITY = 100;
const MAX_USER_PAGES = 5;
const MAX_SCAN_PAGES = 5;

function publicError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.publicMessage = message;
  return e;
}

/** Drop null/undefined/'' values and empty objects/arrays so events stay compact. */
export function compactEvent(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const inner = compactEvent(v);
      if (Object.keys(inner).length === 0) continue;
      out[k] = inner;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** email (lowercased) -> name, from any lists of { name, email } users. */
export function buildNameIndex(...lists) {
  const names = new Map();
  for (const list of lists) {
    for (const user of list || []) {
      if (user?.email && user?.name && !names.has(user.email.toLowerCase())) {
        names.set(user.email.toLowerCase(), user.name);
      }
    }
  }
  return names;
}

export function personOf(user, names = new Map()) {
  if (!user) return null;
  const email = user.email || null;
  const name = user.name || (email ? names.get(email.toLowerCase()) : null) || null;
  return compactEvent({ name, email });
}

/**
 * Several platform fields carry only "who" as a string: the user's email, or a service
 * account's name. Resolve the name from the index when it is an email.
 */
export function actorFromString(value, names = new Map()) {
  if (!value) return null;
  if (value.includes('@')) return compactEvent({ name: names.get(value.toLowerCase()), email: value });
  return { name: value };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateBound(value, name, endOfDay = false) {
  if (value === undefined || value === null || value === '') return null;
  if (!DATE_RE.test(value)) throw publicError(400, `${name} must be a date in YYYY-MM-DD format`);
  const ms = Date.parse(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (Number.isNaN(ms)) throw publicError(400, `${name} is not a valid date`);
  return ms;
}

export function filterByDate(events, sinceMs, untilMs) {
  if (sinceMs === null && untilMs === null) return events;
  return events.filter((e) => {
    const t = Date.parse(e.at);
    if (Number.isNaN(t)) return false;
    return (sinceMs === null || t >= sinceMs) && (untilMs === null || t <= untilMs);
  });
}

export function sortNewestFirst(events) {
  return events
    .map((e, i) => ({ e, i, t: Date.parse(e.at) }))
    .sort((a, b) => {
      const ta = Number.isNaN(a.t) ? -Infinity : a.t;
      const tb = Number.isNaN(b.t) ? -Infinity : b.t;
      return tb - ta || a.i - b.i;
    })
    .map(({ e }) => e);
}

export function paginateEvents(events, page, limit) {
  const total = events.length;
  return {
    events: events.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)), mode: 'client' },
  };
}

function clampInt(value, fallback, min, max) {
  const n = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback;
  return Math.min(max, Math.max(min, n));
}

function upper(value) {
  return String(value || '').toUpperCase();
}

function fileOf(file) {
  return compactEvent({ id: file.id, filename: file.filename, content_type: file.contentType, size: file.size });
}

// --- Normalizers (pure) ------------------------------------------------------

const PROJECT_FILE_TYPES = { create: 'ATTACHMENT_UPLOADED', download: 'ATTACHMENT_DOWNLOADED', delete: 'ATTACHMENT_DELETED' };

/** project.timeline entry (ProjectTimelineType). */
export function normalizeProjectTimelineEntry(entry, names = new Map()) {
  const base = { at: entry.changeTime, source: 'project.timeline', actor: actorFromString(entry.changedBy, names) };
  switch (entry.type) {
    case 'project_history':
      if (entry.status === 'created') return compactEvent({ ...base, type: 'PROJECT_CREATED' });
      return compactEvent({ ...base, type: 'PROJECT_STATUS_CHANGED', field: 'status', to: entry.status, reason: entry.observation });
    case 'report':
      return compactEvent({ ...base, type: 'REPORT_CREATED', subject: { report_title: entry.reportTitle, file: entry.reportFileName } });
    case 'assigned_users':
      return compactEvent({
        ...base,
        type: entry.action === 'destroy' ? 'ANALYST_UNASSIGNED' : 'ANALYST_ASSIGNED',
        target: personOf(entry.assignedUser, names),
      });
    case 'assigned_teams':
      return compactEvent({
        ...base,
        type: entry.action === 'destroy' ? 'TEAM_UNASSIGNED' : 'TEAM_ASSIGNED',
        target: { team: entry.assignedTeam?.label, team_id: entry.assignedTeam?.id },
      });
    default:
      if (PROJECT_FILE_TYPES[entry.type]) {
        return compactEvent({ ...base, type: PROJECT_FILE_TYPES[entry.type], subject: { file: entry.reportFileName } });
      }
      return compactEvent({
        ...base,
        type: upper(entry.type) || 'PROJECT_EVENT',
        to: entry.status,
        reason: entry.observation,
        details: { action: entry.action, title: entry.title, file: entry.reportFileName },
      });
  }
}

const ACTIVITY_TIMELINE_TYPES = {
  status_change: 'ACTIVITY_STATUS_CHANGED',
  assignment_added: 'ACTIVITY_ASSIGNEE_ADDED',
  assignment_removed: 'ACTIVITY_ASSIGNEE_REMOVED',
  create: 'ACTIVITY_ATTACHMENT_UPLOADED',
  download: 'ACTIVITY_ATTACHMENT_DOWNLOADED',
  delete: 'ACTIVITY_ATTACHMENT_DELETED',
  project_history: 'ACTIVITY_UPDATED',
};

/** project.activitiesTimeline entry (same ProjectTimelineType, activity flavour). */
export function normalizeActivitiesTimelineEntry(entry, names = new Map()) {
  const type = ACTIVITY_TIMELINE_TYPES[entry.type] || `ACTIVITY_${upper(entry.type)}`;
  const isAssignment = type === 'ACTIVITY_ASSIGNEE_ADDED' || type === 'ACTIVITY_ASSIGNEE_REMOVED';
  const isStatus = type === 'ACTIVITY_STATUS_CHANGED';
  return compactEvent({
    at: entry.changeTime,
    type,
    source: 'project.activitiesTimeline',
    actor: actorFromString(entry.changedBy, names),
    target: isAssignment ? personOf(entry.assignedUser, names) : null,
    field: isStatus ? 'status' : null,
    to: isStatus ? entry.status : null,
    reason: entry.observation,
    subject: { activity: entry.title },
    details: { file: entry.reportFileName },
  });
}

const ACTIVITY_HISTORY_TYPES = {
  STATUS_CHANGE: 'STATUS_CHANGED',
  ASSIGNMENT_ADDED: 'ASSIGNEE_ADDED',
  ASSIGNMENT_REMOVED: 'ASSIGNEE_REMOVED',
};

/** activities(...).history entry (ActivityHistory). */
export function normalizeActivityHistoryEntry(entry) {
  const type = ACTIVITY_HISTORY_TYPES[entry.actionType] || upper(entry.actionType) || 'ACTIVITY_EVENT';
  const isAssignment = type === 'ASSIGNEE_ADDED' || type === 'ASSIGNEE_REMOVED';
  return compactEvent({
    at: entry.createdAt,
    type,
    source: 'activity.history',
    actor: personOf(entry.portalUser),
    target: isAssignment ? personOf(entry.assignedUser) : null,
    field: type === 'STATUS_CHANGED' ? 'status' : null,
    to: type === 'STATUS_CHANGED' ? entry.status : null,
    reason: entry.reason,
    details: {
      history_id: entry.id,
      evidence_text: entry.evidenceText,
      attachments: (entry.evidences || []).map(fileOf),
    },
  });
}

/** One activity's history entry, seen from the project timeline (activity named in subject). */
export function normalizeProjectActivityHistoryEntry(entry, activity) {
  const e = normalizeActivityHistoryEntry(entry);
  return compactEvent({
    ...e,
    type: `ACTIVITY_${e.type}`,
    source: 'project.activities.history',
    subject: { activity: activity.title, activity_id: activity.id },
  });
}

/** issue.timeline event (IssueTimelineEvent). */
export function normalizeIssueTimelineEvent(ev) {
  return compactEvent({
    at: ev.occurredAt,
    type: ev.eventType,
    source: 'issue.timeline',
    actor: { name: ev.actor?.name || ev.actor?.label, email: ev.actor?.email, kind: ev.actor?.kind },
    field: ev.field,
    from: ev.oldValue,
    to: ev.newValue,
    reason: ev.reason,
    details: {
      event_id: ev.id,
      payload: ev.payload,
      subject_type: ev.subjectType,
      subject_id: ev.subjectId,
      correlation_id: ev.correlationId,
      evidences: (ev.evidences || []).map(fileOf),
    },
  });
}

/** Legacy issue.history entry (IssueHistory: status and assignee changes). */
export function normalizeIssueHistoryEntry(h, names = new Map()) {
  const actor = actorFromString(h.authorEmail, names);
  const details = { event_id: h.eventId, author_type: h.authorType };
  if (h.kind === 'assignee') {
    return compactEvent({
      at: h.at,
      type: h.action === 'removed' ? 'OWNERSHIP_ASSIGNEE_REMOVED' : 'OWNERSHIP_ASSIGNEE_ADDED',
      source: 'issue.history',
      actor,
      target: actorFromString(h.assigneeEmail, names),
      reason: h.reason,
      details,
    });
  }
  return compactEvent({
    at: h.at,
    type: h.kind === 'status' ? 'ISSUE_STATUS_CHANGED' : `ISSUE_${upper(h.kind)}`,
    source: 'issue.history',
    actor,
    field: h.kind === 'status' ? 'status' : null,
    from: h.previousStatus,
    to: h.status,
    reason: h.reason,
    details,
  });
}

/** ticket.history entry (TicketHistory). */
export function normalizeTicketHistoryEntry(h, names = new Map()) {
  return compactEvent({
    at: h.createdAt,
    type: `TICKET_${upper(h.kind)}`,
    source: 'ticket.history',
    actor: actorFromString(h.authorEmail, names),
    field: String(h.kind || '').toLowerCase(),
    from: h.previousValue,
    to: h.newValue,
    details: { history_id: h.id },
  });
}

/** threatModelArtifact.versions entry (snapshot). */
export function normalizeThreatModelVersion(v) {
  return compactEvent({
    at: v.createdAt,
    type: 'VERSION_CREATED',
    source: 'threatModelArtifact.versions',
    actor: personOf(v.createdBy),
    subject: { version: v.version, version_id: v.id },
    details: {
      notes: v.notes,
      scope_text: v.scopeText,
      diagram_type: v.diagramType,
      assignee: { name: v.assigneeName, email: v.assigneeEmail },
      source_project_id: v.sourceProjectId,
      requirement_ids: v.requirementIds,
    },
  });
}

/** pentestArtifact.executions entry. */
export function normalizePentestExecution(x) {
  return compactEvent({
    at: x.createdAt,
    type: 'EXECUTION_TRIGGERED',
    source: 'pentestArtifact.executions',
    actor: personOf(x.triggeredBy),
    subject: { execution_id: x.id, run_number: x.runNumber },
    to: x.status,
    details: {
      kind: x.kind,
      trigger_kind: x.triggerKind,
      started_at: x.startedAt,
      finished_at: x.finishedAt,
      duration_seconds: x.durationSeconds,
      vulnerabilities_count: x.vulnerabilitiesCount,
      severity_breakdown: x.severityBreakdown,
      retest_fixed_count: x.retestFixedCount,
      retest_total_count: x.retestTotalCount,
    },
  });
}

/** Asset lifecycle events assembled from the asset's own fields. */
export function buildAssetEvents(asset, riskScore = null) {
  const events = [];
  if (asset.createdAt) events.push({ at: asset.createdAt, type: 'ASSET_CREATED', source: 'asset' });
  if (asset.updatedAt && asset.updatedAt !== asset.createdAt) {
    events.push({ at: asset.updatedAt, type: 'ASSET_UPDATED', source: 'asset', details: { note: 'last update; who changed it and which fields is not exposed by the platform API' } });
  }
  if (asset.archivedAt) {
    events.push(compactEvent({ at: asset.archivedAt, type: 'ASSET_ARCHIVED', source: 'asset', actor: personOf(asset.archivedBy) }));
  }
  const current = riskScore?.current;
  const diff = riskScore?.differenceFromLast;
  if (current?.date) {
    events.push(compactEvent({
      at: current.date,
      type: 'RISK_SCORE_CHANGED',
      source: 'asset.riskScore',
      field: 'risk_score',
      to: current.value,
      details: {
        difference_from_last: diff?.value,
        previous_recorded_at: diff?.date,
        data_classification_changes: diff?.dataClassificationChanges,
        threat_changes: diff?.threatChanges,
        exploitability_changes: diff?.exploitabilityChanges,
        business_impact_changes: diff?.businessImpactChanges,
      },
    }));
  }
  return events;
}

/** scanHistories entry for an asset. */
export function normalizeScanHistory(s) {
  return compactEvent({
    at: s.createdAt,
    type: 'SCAN_EXECUTED',
    source: 'scanHistories',
    to: s.status,
    subject: { scan_id: s.id, integration: s.integration },
    details: {
      duration_in_seconds: s.durationInSeconds,
      created_vulnerability_count: s.createdVulnerabilityCount,
      closed_vulnerability_count: s.closedVulnerabilityCount,
      imported_vulnerability_count: s.importedVulnerabilityCount,
      failure_reason: s.failureReason,
    },
  });
}

// --- Queries -----------------------------------------------------------------

const PROJECT_TIMELINE_FIELDS = 'type status changedBy changeTime observation reportTitle reportFileName action title';

export const PROJECT_TIMELINE_QUERY = `
  query ProjectTimeline($id: ID!, $activitiesPagination: PaginationInput!) {
    project(id: $id) {
      id label createdAt updatedAt
      company { id }
      timeline { ${PROJECT_TIMELINE_FIELDS} assignedUser { name email } assignedTeam { id label } }
      activitiesTimeline(pagination: $activitiesPagination) {
        collection { ${PROJECT_TIMELINE_FIELDS} assignedUser { name email } }
        metadata { totalCount totalPages }
      }
    }
  }
`;

export const PROJECT_ACTIVITIES_TIMELINE_QUERY = `
  query ProjectActivitiesTimeline($id: ID!, $pagination: PaginationInput!) {
    project(id: $id) {
      activitiesTimeline(pagination: $pagination) {
        collection { ${PROJECT_TIMELINE_FIELDS} assignedUser { name email } }
        metadata { totalCount totalPages }
      }
    }
  }
`;

export const PROJECT_ACTIVITIES_HISTORY_QUERY = `
  query ProjectActivitiesHistory($projectId: ID!, $page: Int, $limit: Int) {
    activities(page: $page, limit: $limit, params: { projectId: $projectId }) {
      collection {
        id title
        history(pagination: { page: 1, perPage: ${ACTIVITY_HISTORY_PER_ACTIVITY} }) {
          collection {
            id createdAt actionType status reason evidenceText
            portalUser { name email }
            assignedUser { name email }
            evidences { id filename contentType size }
          }
          metadata { totalCount }
        }
      }
      metadata { totalCount totalPages }
    }
  }
`;

export const PROJECT_USERS_QUERY = `
  query ProjectAccessibleUsers($id: ID!, $pagination: PaginationInput!) {
    project(id: $id) {
      projectAccessibleUsers(pagination: $pagination) {
        collection { name email }
        metadata { totalPages }
      }
    }
  }
`;

export const ACTIVITY_TIMELINE_QUERY = `
  query ActivityTimeline($projectId: ID!, $activityId: ID!, $pagination: PaginationInput!) {
    activities(page: 1, limit: 1, params: { projectId: $projectId, activityId: $activityId }) {
      collection {
        id title status createdAt updatedAt
        projectRequirement { id label }
        history(pagination: $pagination) {
          collection {
            id createdAt actionType status reason evidenceText
            portalUser { name email }
            assignedUser { name email }
            evidences { id filename contentType size }
          }
          metadata { totalCount totalPages currentPage }
        }
      }
    }
  }
`;

export const ISSUE_TIMELINE_QUERY = `
  query IssueTimeline($id: ID!, $pagination: BasePaginationInput, $filters: IssueTimelineFiltersInput, $hasFilters: Boolean!) {
    issue(id: $id) {
      id title status createdAt updatedAt
      author { name email }
      asset { id name }
      timeline(pagination: $pagination, filters: $filters) {
        collection {
          id eventType occurredAt
          actor { kind label name email }
          field oldValue newValue reason payload subjectType subjectId correlationId
          evidences { id filename contentType size }
        }
        metadata { totalCount totalPages currentPage }
      }
      # With filters, an empty page does not mean the timeline is off: count it unfiltered too.
      unfiltered: timeline(pagination: { page: 1, perPage: 1 }) @include(if: $hasFilters) {
        metadata { totalCount }
      }
    }
  }
`;

export const ISSUE_HISTORY_QUERY = `
  query IssueHistory($id: ID!) {
    issue(id: $id) {
      history { kind eventId at status previousStatus reason action assigneeId assigneeEmail authorType authorId authorEmail }
      statusHistory { createdAt source { name email } }
      assignedUsers { name email }
    }
  }
`;

export const ASSET_TIMELINE_QUERY = `
  query AssetTimeline($id: ID!) {
    asset(id: $id) {
      id name createdAt updatedAt archived archivedAt
      archivedBy { name email }
      company { id }
    }
  }
`;

export const ASSET_RISK_SCORE_QUERY = `
  query AssetRiskScoreTimeline($id: ID!) {
    asset(id: $id) {
      riskScore {
        current { value date }
        differenceFromLast { value date dataClassificationChanges threatChanges exploitabilityChanges businessImpactChanges }
      }
    }
  }
`;

export const ASSET_SCANS_QUERY = `
  query AssetScansTimeline($companyId: ID!, $assetIds: [ID!], $pagination: PaginationInput!, $sortOptions: [ScansHistoriesSortOptionInput!]) {
    scanHistories(companyId: $companyId, assetIds: $assetIds, pagination: $pagination, sortOptions: $sortOptions) {
      collection { id status integration createdAt durationInSeconds createdVulnerabilityCount closedVulnerabilityCount importedVulnerabilityCount failureReason }
      metadata { totalCount totalPages }
    }
  }
`;

export const TICKET_TIMELINE_QUERY = `
  query TicketTimeline($companyId: ID!, $id: ID!) {
    ticket(companyId: $companyId, id: $id) {
      id title status createdAt updatedAt
      createdBy { name email }
      assignee { name email }
      watchers { name email }
      history { id kind previousValue newValue authorEmail createdAt }
    }
  }
`;

export const THREAT_MODEL_TIMELINE_QUERY = `
  query ThreatModelTimeline($id: ID!) {
    threatModelArtifact(id: $id) {
      id label createdAt updatedAt
      assignee { name email }
      versions {
        id version createdAt notes scopeText diagramType assigneeName assigneeEmail sourceProjectId requirementIds
        createdBy { name email }
      }
    }
  }
`;

export const PENTEST_TIMELINE_QUERY = `
  query PentestArtifactTimeline($id: ID!) {
    pentestArtifact(id: $id) {
      id label createdAt updatedAt
      assignee { name email }
      application { id name }
      executions {
        id runNumber status kind triggerKind startedAt finishedAt durationSeconds createdAt
        vulnerabilitiesCount severityBreakdown retestFixedCount retestTotalCount
        triggeredBy { name email }
      }
    }
  }
`;

// --- Handlers ----------------------------------------------------------------

function notFound(type, id) {
  return publicError(404, `${type} ${id} not found or not accessible with this API key`);
}

function finalizeClient(object, events, ctx, notes) {
  const filtered = filterByDate(sortNewestFirst(events), ctx.sinceMs, ctx.untilMs);
  const { events: pageEvents, pagination } = paginateEvents(filtered, ctx.page, ctx.limit);
  return { object, events: pageEvents, pagination, notes };
}

async function fetchProjectUsers(execute, id, notes) {
  const users = [];
  try {
    let totalPages = 1;
    for (let page = 1; page <= Math.min(totalPages, MAX_USER_PAGES); page += 1) {
      const data = await execute(PROJECT_USERS_QUERY, { id, pagination: { page, perPage: SOURCE_PAGE_SIZE } });
      const conn = data?.project?.projectAccessibleUsers;
      users.push(...(conn?.collection || []));
      totalPages = Number(conn?.metadata?.totalPages) || 1;
    }
  } catch {
    notes.push('Could not load the project users to resolve analyst names; actors show the email recorded by the platform.');
  }
  return users;
}

async function fetchProjectActivityEvents(execute, projectId, notes) {
  const events = [];
  const people = [];
  let totalPages = 1;
  let cut = false;
  for (let page = 1; page <= Math.min(totalPages, MAX_ACTIVITY_PAGES); page += 1) {
    const data = await execute(PROJECT_ACTIVITIES_HISTORY_QUERY, { projectId, page, limit: ACTIVITIES_PAGE_SIZE });
    const conn = data?.activities;
    for (const activity of conn?.collection || []) {
      const entries = activity.history?.collection || [];
      if (Number(activity.history?.metadata?.totalCount) > entries.length) cut = true;
      for (const entry of entries) {
        people.push(entry.portalUser, entry.assignedUser);
        events.push(normalizeProjectActivityHistoryEntry(entry, activity));
      }
    }
    totalPages = Number(conn?.metadata?.totalPages) || 1;
  }
  if (totalPages > MAX_ACTIVITY_PAGES) {
    notes.push(`Only the first ${MAX_ACTIVITY_PAGES * ACTIVITIES_PAGE_SIZE} requirement activities were read.`);
  }
  if (cut) {
    notes.push(`Activities with more than ${ACTIVITY_HISTORY_PER_ACTIVITY} history entries show only the newest ${ACTIVITY_HISTORY_PER_ACTIVITY}; use object_type "activity" for one activity's full history.`);
  }
  return { events, people };
}

const ACTIVITY_FILE_EVENT_TYPES = new Set(['create', 'download', 'delete']);

async function projectTimeline(execute, ctx) {
  const notes = [];
  const data = await execute(PROJECT_TIMELINE_QUERY, {
    id: ctx.object_id,
    activitiesPagination: { page: 1, perPage: SOURCE_PAGE_SIZE },
  });
  const project = data?.project;
  if (!project) throw notFound('project', ctx.object_id);

  // activitiesTimeline is read only for its activity attachment records (upload, download,
  // delete), which exist nowhere else. Activity changes come from each activity's history.
  const fileEntries = (project.activitiesTimeline?.collection || []).filter((e) => ACTIVITY_FILE_EVENT_TYPES.has(e.type));
  const totalPages = Number(project.activitiesTimeline?.metadata?.totalPages) || 1;
  for (let page = 2; page <= Math.min(totalPages, MAX_SOURCE_PAGES); page += 1) {
    const next = await execute(PROJECT_ACTIVITIES_TIMELINE_QUERY, {
      id: ctx.object_id,
      pagination: { page, perPage: SOURCE_PAGE_SIZE },
    });
    fileEntries.push(...(next?.project?.activitiesTimeline?.collection || []).filter((e) => ACTIVITY_FILE_EVENT_TYPES.has(e.type)));
  }
  if (totalPages > MAX_SOURCE_PAGES) {
    notes.push(`Activity attachment records were read from the newest ${MAX_SOURCE_PAGES * SOURCE_PAGE_SIZE} activity-timeline entries only.`);
  }

  const activity = await fetchProjectActivityEvents(execute, ctx.object_id, notes);
  const timeline = project.timeline || [];
  const users = await fetchProjectUsers(execute, ctx.object_id, notes);
  const names = buildNameIndex(users, timeline.map((e) => e.assignedUser), activity.people);
  const events = [
    ...timeline.map((e) => normalizeProjectTimelineEntry(e, names)),
    ...activity.events,
    ...fileEntries.map((e) => normalizeActivitiesTimelineEntry(e, names)),
  ];
  notes.push(
    'Covers status changes, analyst/team allocations, reports, project attachments and the history of every requirement activity. Edits to project fields (label, dates, scope) are not exposed by the platform API.',
    'Reports created by other users appear only when the API key user is a company admin.',
  );
  return finalizeClient({
    type: 'project',
    id: project.id,
    name: project.label,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
    company_id: project.company?.id,
  }, events, ctx, notes);
}

async function activityTimeline(execute, ctx) {
  if (!ctx.project_id) throw publicError(400, 'object_type "activity" requires project_id');
  const notes = [];
  const data = await execute(ACTIVITY_TIMELINE_QUERY, {
    projectId: ctx.project_id,
    activityId: ctx.object_id,
    pagination: { page: ctx.page, perPage: ctx.limit },
  });
  const activity = data?.activities?.collection?.[0];
  if (!activity) throw notFound('activity', ctx.object_id);

  let events = (activity.history?.collection || []).map(normalizeActivityHistoryEntry);
  if (ctx.sinceMs !== null || ctx.untilMs !== null) {
    events = filterByDate(events, ctx.sinceMs, ctx.untilMs);
    notes.push('since/until were applied to this page only: the platform paginates activity history itself.');
  }
  if (events.some((e) => e.details?.attachments)) {
    notes.push('Entries with details.attachments carry evidence files: read them with read_activity_attachment.');
  }
  const meta = activity.history?.metadata || {};
  return {
    object: {
      type: 'activity',
      id: activity.id,
      name: activity.title,
      status: activity.status,
      created_at: activity.createdAt,
      updated_at: activity.updatedAt,
      project_id: ctx.project_id,
      project_requirement: activity.projectRequirement,
    },
    events,
    pagination: { page: ctx.page, limit: ctx.limit, total: meta.totalCount ?? null, total_pages: meta.totalPages ?? null, mode: 'server' },
    notes,
  };
}

function issueFilters(ctx) {
  const filters = {};
  if (ctx.event_types?.length) filters.eventTypes = ctx.event_types.map(upper);
  if (ctx.since) filters.occurredAfter = `${ctx.since}T00:00:00Z`;
  if (ctx.until) filters.occurredBefore = `${ctx.until}T23:59:59Z`;
  return Object.keys(filters).length ? filters : undefined;
}

async function issueTimeline(execute, ctx) {
  const notes = [];
  const filters = issueFilters(ctx);
  const data = await execute(ISSUE_TIMELINE_QUERY, {
    id: ctx.object_id,
    pagination: { page: ctx.page, perPage: ctx.limit },
    filters,
    hasFilters: Boolean(filters),
  });
  const issue = data?.issue;
  if (!issue) throw notFound('issue', ctx.object_id);
  const object = {
    type: 'issue',
    id: issue.id,
    name: issue.title,
    status: issue.status,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    created_by: personOf(issue.author),
    asset: issue.asset,
  };

  const meta = issue.timeline?.metadata || {};
  const timelineEvents = (issue.timeline?.collection || []).map(normalizeIssueTimelineEvent);
  const timelineEnabled = timelineEvents.length > 0
    || Number(meta.totalCount) > 0
    || Number(issue.unfiltered?.metadata?.totalCount) > 0;
  if (timelineEnabled) {
    if (timelineEvents.some((e) => e.type === 'ISSUE_FIELD_CHANGED')) {
      notes.push('ISSUE_FIELD_CHANGED events record only which field changed; the platform does not store the old/new values.');
    }
    return {
      object,
      events: timelineEvents,
      pagination: { page: ctx.page, limit: ctx.limit, total: meta.totalCount ?? null, total_pages: meta.totalPages ?? null, mode: 'server' },
      notes,
    };
  }

  // No timeline events at all, even unfiltered: the timeline is likely not enabled
  // for this company (the field then returns an empty page, not an error). Fall back to the
  // legacy status/assignee history.
  const legacy = await execute(ISSUE_HISTORY_QUERY, { id: ctx.object_id });
  const names = buildNameIndex(
    [issue.author],
    legacy?.issue?.assignedUsers,
    (legacy?.issue?.statusHistory || []).map((s) => s.source),
  );
  let events = (legacy?.issue?.history || []).map((h) => normalizeIssueHistoryEntry(h, names));
  if (ctx.event_types?.length) {
    const wanted = new Set(ctx.event_types.map(upper));
    events = events.filter((e) => wanted.has(e.type));
  }
  notes.push('The issue timeline returned no events (it may not be enabled for this company), so this is the legacy history: status and assignee changes only.');
  return finalizeClient(object, events, ctx, notes);
}

async function assetTimeline(execute, ctx) {
  const notes = [];
  const data = await execute(ASSET_TIMELINE_QUERY, { id: ctx.object_id });
  const asset = data?.asset;
  if (!asset) throw notFound('asset', ctx.object_id);

  let riskScore = null;
  try {
    riskScore = (await execute(ASSET_RISK_SCORE_QUERY, { id: ctx.object_id }))?.asset?.riskScore || null;
  } catch {
    notes.push('Could not load the asset risk score history.');
  }

  const scans = [];
  if (asset.company?.id) {
    try {
      let totalPages = 1;
      for (let page = 1; page <= Math.min(totalPages, MAX_SCAN_PAGES); page += 1) {
        const res = await execute(ASSET_SCANS_QUERY, {
          companyId: asset.company.id,
          assetIds: [String(asset.id)],
          pagination: { page, perPage: SOURCE_PAGE_SIZE },
          sortOptions: [{ sortBy: 'CREATED_AT', order: 'DESC' }],
        });
        scans.push(...(res?.scanHistories?.collection || []));
        totalPages = Number(res?.scanHistories?.metadata?.totalPages) || 1;
      }
      if (totalPages > MAX_SCAN_PAGES) {
        notes.push(`Scan executions were capped at the newest ${MAX_SCAN_PAGES * SOURCE_PAGE_SIZE}; use get_scan_histories for older ones.`);
      }
    } catch {
      notes.push('Could not load the asset scan history.');
    }
  }

  const events = [...buildAssetEvents(asset, riskScore), ...scans.map(normalizeScanHistory)];
  notes.push('The platform API exposes no change log for assets: field edits and assignee changes are recorded by the platform but not readable through the API. This timeline shows creation, last update, archive, risk score and scan executions.');
  return finalizeClient({
    type: 'asset',
    id: asset.id,
    name: asset.name,
    created_at: asset.createdAt,
    updated_at: asset.updatedAt,
    archived: asset.archived,
    company_id: asset.company?.id,
    risk_score: riskScore?.current?.value ?? null,
  }, events, ctx, notes);
}

async function ticketTimeline(execute, ctx) {
  if (!ctx.company_id) throw publicError(400, 'object_type "ticket" requires company_id');
  const data = await execute(TICKET_TIMELINE_QUERY, { companyId: ctx.company_id, id: ctx.object_id });
  const ticket = data?.ticket;
  if (!ticket) throw notFound('ticket', ctx.object_id);
  const names = buildNameIndex([ticket.createdBy, ticket.assignee], ticket.watchers);
  const events = [
    compactEvent({ at: ticket.createdAt, type: 'TICKET_CREATED', source: 'ticket', actor: personOf(ticket.createdBy) }),
    ...(ticket.history || []).map((h) => normalizeTicketHistoryEntry(h, names)),
  ];
  return finalizeClient({
    type: 'ticket',
    id: ticket.id,
    name: ticket.title,
    status: ticket.status,
    created_at: ticket.createdAt,
    updated_at: ticket.updatedAt,
    assignee: personOf(ticket.assignee),
  }, events, ctx, []);
}

async function threatModelTimeline(execute, ctx) {
  const data = await execute(THREAT_MODEL_TIMELINE_QUERY, { id: ctx.object_id });
  const artifact = data?.threatModelArtifact;
  if (!artifact) throw notFound('threat_model_artifact', ctx.object_id);
  const events = [
    { at: artifact.createdAt, type: 'ARTIFACT_CREATED', source: 'threatModelArtifact' },
    ...(artifact.versions || []).map(normalizeThreatModelVersion),
  ];
  return finalizeClient({
    type: 'threat_model_artifact',
    id: artifact.id,
    name: artifact.label,
    created_at: artifact.createdAt,
    updated_at: artifact.updatedAt,
    assignee: personOf(artifact.assignee),
  }, events, ctx, ['Each version is a full snapshot; use get_threat_model_artifact for diagrams and architecture items.']);
}

async function pentestTimeline(execute, ctx) {
  const data = await execute(PENTEST_TIMELINE_QUERY, { id: ctx.object_id });
  const artifact = data?.pentestArtifact;
  if (!artifact) throw notFound('pentest_artifact', ctx.object_id);
  const events = [
    { at: artifact.createdAt, type: 'ARTIFACT_CREATED', source: 'pentestArtifact' },
    ...(artifact.executions || []).map(normalizePentestExecution),
  ];
  return finalizeClient({
    type: 'pentest_artifact',
    id: artifact.id,
    name: artifact.label,
    created_at: artifact.createdAt,
    updated_at: artifact.updatedAt,
    assignee: personOf(artifact.assignee),
    application: artifact.application,
  }, events, ctx, ['Use get_pentest_execution for one execution\'s full result.']);
}

const HANDLERS = {
  project: projectTimeline,
  activity: activityTimeline,
  issue: issueTimeline,
  asset: assetTimeline,
  ticket: ticketTimeline,
  threat_model_artifact: threatModelTimeline,
  pentest_artifact: pentestTimeline,
};

export async function getObjectTimeline(execute, args = {}) {
  const handler = HANDLERS[args.object_type];
  if (!handler) {
    throw publicError(400, `Unsupported object_type '${args.object_type}'. Supported: ${TIMELINE_OBJECT_TYPES.join(', ')}`);
  }
  const ctx = {
    ...args,
    page: clampInt(args.page, 1, 1, 100_000),
    limit: clampInt(args.limit, DEFAULT_TIMELINE_LIMIT, 1, MAX_TIMELINE_LIMIT),
    sinceMs: parseDateBound(args.since, 'since'),
    untilMs: parseDateBound(args.until, 'until', true),
  };
  if (ctx.sinceMs !== null && ctx.untilMs !== null && ctx.sinceMs > ctx.untilMs) {
    throw publicError(400, 'since must not be after until');
  }
  const result = await handler(execute, ctx);
  const out = { object_type: args.object_type, ...result };
  if (!out.notes?.length) delete out.notes;
  return out;
}
