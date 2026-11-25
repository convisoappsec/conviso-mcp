import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_TIMELINE_QUERY,
  ISSUE_TIMELINE_QUERY,
  PROJECT_TIMELINE_QUERY,
  actorFromString,
  buildAssetEvents,
  filterByDate,
  getObjectTimeline,
  normalizeActivitiesTimelineEntry,
  normalizeActivityHistoryEntry,
  normalizeIssueHistoryEntry,
  normalizeIssueTimelineEvent,
  normalizeProjectTimelineEntry,
  normalizeTicketHistoryEntry,
  paginateEvents,
  parseDateBound,
} from '../src/conviso_mcp/timeline.js';
import { GraphQLClient } from '../src/conviso_mcp/graphql_client.js';

/** Fake execute(): picks the response by the GraphQL operation name. */
function fakeExecute(responses) {
  const calls = [];
  const execute = async (query, variables) => {
    const op = /query\s+(\w+)/.exec(query)[1];
    calls.push({ op, query, variables });
    const r = responses[op];
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r(variables) : r;
  };
  return { execute, calls };
}

const NAMES = new Map([['ana@example.com', 'Ana Analyst']]);

test('timeline queries never select file URLs (reading history must not log downloads)', () => {
  for (const q of [PROJECT_TIMELINE_QUERY, ACTIVITY_TIMELINE_QUERY, ISSUE_TIMELINE_QUERY]) {
    assert.doesNotMatch(q, /presignedUrl|\burl\b/);
  }
});

test('project timeline entries map to explicit event types with the analyst name resolved', () => {
  assert.deepEqual(
    normalizeProjectTimelineEntry({ type: 'project_history', status: 'in_progress', changedBy: 'ana@example.com', changeTime: '2026-11-02T10:00:00Z', observation: 'kick-off' }, NAMES),
    {
      at: '2026-11-02T10:00:00Z', source: 'project.timeline', actor: { name: 'Ana Analyst', email: 'ana@example.com' },
      type: 'PROJECT_STATUS_CHANGED', field: 'status', to: 'in_progress', reason: 'kick-off',
    },
  );
  assert.equal(normalizeProjectTimelineEntry({ type: 'project_history', status: 'created', changeTime: 't' }).type, 'PROJECT_CREATED');
  const assigned = normalizeProjectTimelineEntry({ type: 'assigned_users', action: 'create', changedBy: 'boss@example.com', changeTime: 't', assignedUser: { name: 'Bob', email: 'bob@example.com' } }, NAMES);
  assert.equal(assigned.type, 'ANALYST_ASSIGNED');
  assert.deepEqual(assigned.target, { name: 'Bob', email: 'bob@example.com' });
  assert.deepEqual(assigned.actor, { email: 'boss@example.com' });
  assert.equal(normalizeProjectTimelineEntry({ type: 'assigned_teams', action: 'destroy', changeTime: 't', assignedTeam: { id: '3', label: 'Red' } }).type, 'TEAM_UNASSIGNED');
  assert.equal(normalizeProjectTimelineEntry({ type: 'download', changeTime: 't', reportFileName: 'scope.pdf' }).type, 'ATTACHMENT_DOWNLOADED');
  assert.deepEqual(normalizeProjectTimelineEntry({ type: 'report', changeTime: 't', reportTitle: 'Final', reportFileName: 'final.pdf' }).subject, { report_title: 'Final', file: 'final.pdf' });
});

test('service accounts recorded by name stay as a name, not an email', () => {
  assert.deepEqual(actorFromString('CI Integration', NAMES), { name: 'CI Integration' });
  assert.equal(actorFromString('', NAMES), null);
});

test('activity entries of the project timeline carry the activity title as subject', () => {
  const e = normalizeActivitiesTimelineEntry({ type: 'status_change', title: 'Validate MFA', status: 'done', changedBy: 'ana@example.com', changeTime: 't', observation: 'ok', reportFileName: 'mfa.png' }, NAMES);
  assert.equal(e.type, 'ACTIVITY_STATUS_CHANGED');
  assert.deepEqual(e.subject, { activity: 'Validate MFA' });
  assert.equal(e.to, 'done');
  assert.equal(e.details.file, 'mfa.png');
  assert.equal(normalizeActivitiesTimelineEntry({ type: 'assignment_removed', changeTime: 't', assignedUser: { name: 'Bob', email: 'b@x' } }).type, 'ACTIVITY_ASSIGNEE_REMOVED');
});

test('activity history keeps reason, evidence text and evidence files', () => {
  const e = normalizeActivityHistoryEntry({
    id: '501', createdAt: 't', actionType: 'STATUS_CHANGE', status: 'DONE', reason: 'validated', evidenceText: 'see screenshot',
    portalUser: { name: 'Ana Analyst', email: 'ana@example.com' }, assignedUser: null,
    evidences: [{ id: '9001', filename: 'mfa.png', contentType: 'image/png', size: 10 }],
  });
  assert.equal(e.type, 'STATUS_CHANGED');
  assert.equal(e.reason, 'validated');
  assert.deepEqual(e.actor, { name: 'Ana Analyst', email: 'ana@example.com' });
  assert.equal(e.target, undefined);
  assert.deepEqual(e.details.attachments, [{ id: '9001', filename: 'mfa.png', content_type: 'image/png', size: 10 }]);
  assert.equal(normalizeActivityHistoryEntry({ createdAt: 't', actionType: 'ASSIGNMENT_ADDED', assignedUser: { name: 'Bob' } }).target.name, 'Bob');
});

test('issue timeline events keep field, old/new values and the actor', () => {
  const e = normalizeIssueTimelineEvent({
    id: '1', eventType: 'RISK_SEVERITY_CHANGED', occurredAt: 't', actor: { kind: 'PORTAL_USER', label: 'ana', name: 'Ana Analyst', email: 'ana@example.com' },
    field: 'severity', oldValue: 'LOW', newValue: 'HIGH', reason: 'exploit published', payload: null, evidences: [],
  });
  assert.equal(e.type, 'RISK_SEVERITY_CHANGED');
  assert.equal(e.from, 'LOW');
  assert.equal(e.to, 'HIGH');
  assert.deepEqual(e.actor, { name: 'Ana Analyst', email: 'ana@example.com', kind: 'PORTAL_USER' });
});

test('legacy issue history maps to the same event names as the timeline', () => {
  assert.equal(normalizeIssueHistoryEntry({ kind: 'status', at: 't', status: 'FIX_ACCEPTED', previousStatus: 'IDENTIFIED', authorEmail: 'ana@example.com' }, NAMES).type, 'ISSUE_STATUS_CHANGED');
  const a = normalizeIssueHistoryEntry({ kind: 'assignee', action: 'removed', at: 't', assigneeEmail: 'bob@example.com', authorEmail: 'ana@example.com' }, NAMES);
  assert.equal(a.type, 'OWNERSHIP_ASSIGNEE_REMOVED');
  assert.deepEqual(a.actor, { name: 'Ana Analyst', email: 'ana@example.com' });
  assert.deepEqual(a.target, { email: 'bob@example.com' });
});

test('ticket history keeps previous/new values', () => {
  assert.deepEqual(
    normalizeTicketHistoryEntry({ id: '5', kind: 'STATUS', previousValue: 'OPEN', newValue: 'CLOSED', authorEmail: 'ana@example.com', createdAt: 't' }, NAMES),
    { at: 't', type: 'TICKET_STATUS', source: 'ticket.history', actor: { name: 'Ana Analyst', email: 'ana@example.com' }, field: 'status', from: 'OPEN', to: 'CLOSED', details: { history_id: '5' } },
  );
});

test('asset events are assembled from lifecycle fields and the risk score', () => {
  const events = buildAssetEvents(
    { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z', archivedAt: '2026-06-01T00:00:00Z', archivedBy: { name: 'Ana Analyst', email: 'ana@example.com' } },
    { current: { value: 7.5, date: '2026-05-02T00:00:00Z' }, differenceFromLast: { value: 1.5, date: '2026-04-01T00:00:00Z', threatChanges: 'HIGH' } },
  );
  assert.deepEqual(events.map((e) => e.type), ['ASSET_CREATED', 'ASSET_UPDATED', 'ASSET_ARCHIVED', 'RISK_SCORE_CHANGED']);
  assert.deepEqual(events[2].actor, { name: 'Ana Analyst', email: 'ana@example.com' });
  assert.equal(events[3].to, 7.5);
  assert.equal(events[3].details.difference_from_last, 1.5);
});

test('date bounds are validated and inclusive', () => {
  assert.throws(() => parseDateBound('11/02/2026', 'since'), (err) => err.status === 400);
  const since = parseDateBound('2026-11-01', 'since');
  const until = parseDateBound('2026-11-01', 'until', true);
  const events = [{ at: '2026-10-31T23:59:59Z' }, { at: '2026-11-01T00:00:00Z' }, { at: '2026-11-01T23:59:59Z' }, { at: '2026-11-02T00:00:00Z' }];
  assert.deepEqual(filterByDate(events, since, until).map((e) => e.at), ['2026-11-01T00:00:00Z', '2026-11-01T23:59:59Z']);
});

test('client pagination reports totals', () => {
  const events = Array.from({ length: 5 }, (_, i) => ({ at: `t${i}` }));
  const { events: page2, pagination } = paginateEvents(events, 2, 2);
  assert.deepEqual(page2.map((e) => e.at), ['t2', 't3']);
  assert.deepEqual(pagination, { page: 2, limit: 2, total: 5, total_pages: 3, mode: 'client' });
});

test('project: merges project timeline, every activity history and activity file records, newest first', async () => {
  const { execute, calls } = fakeExecute({
    ProjectTimeline: {
      project: {
        id: '10', label: 'Pentest Q4', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z', company: { id: '7' },
        timeline: [
          { type: 'project_history', status: 'created', changedBy: 'ana@example.com', changeTime: '2026-10-01T00:00:00Z' },
          { type: 'project_history', status: 'in_progress', changedBy: 'ana@example.com', changeTime: '2026-11-03T00:00:00Z' },
        ],
        activitiesTimeline: {
          collection: [{ type: 'status_change', title: 'Validate MFA', status: 'done', changedBy: 'bob@example.com', changeTime: '2026-11-02T00:00:00Z' }],
          metadata: { totalCount: 101, totalPages: 2 },
        },
      },
    },
    ProjectActivitiesTimeline: {
      project: { activitiesTimeline: { collection: [{ type: 'create', title: 'Validate MFA', changedBy: 'bob@example.com', changeTime: '2026-10-15T00:00:00Z', reportFileName: 'mfa.png' }], metadata: { totalPages: 2 } } },
    },
    // Includes a custom activity (no check) — the backend's activitiesTimeline omits those.
    ProjectActivitiesHistory: {
      activities: {
        collection: [
          { id: '77', title: 'Validate MFA', history: { collection: [{ id: '1', createdAt: '2026-11-02T00:00:00Z', actionType: 'STATUS_CHANGE', status: 'DONE', reason: 'ok', portalUser: { name: 'Bob Builder', email: 'bob@example.com' }, evidences: [] }], metadata: { totalCount: 1 } } },
          { id: '78', title: 'Custom evidence request', history: { collection: [{ id: '2', createdAt: '2026-10-20T00:00:00Z', actionType: 'ASSIGNMENT_ADDED', portalUser: { name: 'Ana Analyst', email: 'ana@example.com' }, assignedUser: { name: 'Bob Builder', email: 'bob@example.com' } }], metadata: { totalCount: 1 } } },
        ],
        metadata: { totalCount: 2, totalPages: 1 },
      },
    },
    ProjectAccessibleUsers: {
      project: { projectAccessibleUsers: { collection: [{ name: 'Ana Analyst', email: 'ana@example.com' }, { name: 'Bob Builder', email: 'bob@example.com' }], metadata: { totalPages: 1 } } },
    },
  });

  const out = await getObjectTimeline(execute, { object_type: 'project', object_id: 10 });

  assert.equal(calls.find((c) => c.op === 'ProjectActivitiesTimeline').variables.pagination.page, 2);
  assert.deepEqual(calls.find((c) => c.op === 'ProjectActivitiesHistory').variables, { projectId: 10, page: 1, limit: 200 });
  assert.deepEqual(out.object, { type: 'project', id: '10', name: 'Pentest Q4', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-11-03T00:00:00Z', company_id: '7' });
  // The activitiesTimeline status_change entry is not repeated: activity changes come from history.
  assert.deepEqual(out.events.map((e) => e.type), ['PROJECT_STATUS_CHANGED', 'ACTIVITY_STATUS_CHANGED', 'ACTIVITY_ASSIGNEE_ADDED', 'ACTIVITY_ATTACHMENT_UPLOADED', 'PROJECT_CREATED']);
  assert.deepEqual(out.events[1].actor, { name: 'Bob Builder', email: 'bob@example.com' });
  assert.equal(out.events[1].source, 'project.activities.history');
  assert.deepEqual(out.events[1].subject, { activity: 'Validate MFA', activity_id: '77' });
  assert.deepEqual(out.events[2].subject, { activity: 'Custom evidence request', activity_id: '78' });
  assert.deepEqual(out.events[2].target, { name: 'Bob Builder', email: 'bob@example.com' });
  assert.deepEqual(out.events[3].actor, { name: 'Bob Builder', email: 'bob@example.com' });
  assert.equal(out.pagination.total, 5);
  assert.equal(out.pagination.mode, 'client');
  assert.ok(out.notes.some((n) => /not exposed by the platform API/.test(n)));
});

test('project: warns when an activity has more history than was read', async () => {
  const { execute } = fakeExecute({
    ProjectTimeline: { project: { id: '10', label: 'P', timeline: [], activitiesTimeline: { collection: [], metadata: { totalPages: 1 } } } },
    ProjectActivitiesHistory: { activities: { collection: [{ id: '1', title: 'Busy', history: { collection: [{ id: 'h', createdAt: 't', actionType: 'STATUS_CHANGE' }], metadata: { totalCount: 150 } } }], metadata: { totalPages: 1 } } },
    ProjectAccessibleUsers: { project: { projectAccessibleUsers: { collection: [], metadata: { totalPages: 1 } } } },
  });
  const out = await getObjectTimeline(execute, { object_type: 'project', object_id: 10 });
  assert.ok(out.notes.some((n) => /more than 100 history entries/.test(n)));
});

test('project: names stay as emails when project users cannot be listed', async () => {
  const { execute } = fakeExecute({
    ProjectTimeline: { project: { id: '10', label: 'P', timeline: [{ type: 'project_history', status: 'done', changedBy: 'ana@example.com', changeTime: 't' }], activitiesTimeline: { collection: [], metadata: { totalPages: 1 } } } },
    ProjectAccessibleUsers: new Error('forbidden'),
  });
  const out = await getObjectTimeline(execute, { object_type: 'project', object_id: 10 });
  assert.deepEqual(out.events[0].actor, { email: 'ana@example.com' });
  assert.ok(out.notes.some((n) => /resolve analyst names/.test(n)));
});

test('activity: requires project_id and paginates on the server', async () => {
  await assert.rejects(getObjectTimeline(async () => ({}), { object_type: 'activity', object_id: 77 }), (err) => err.status === 400 && /requires project_id/.test(err.publicMessage));

  const { execute, calls } = fakeExecute({
    ActivityTimeline: {
      activities: { collection: [{ id: '77', title: 'Validate MFA', status: 'DONE', history: { collection: [{ id: '1', createdAt: 't', actionType: 'STATUS_CHANGE', status: 'DONE', evidences: [{ id: '9', filename: 'a.png' }] }], metadata: { totalCount: 31, totalPages: 4, currentPage: 2 } } }] },
    },
  });
  const out = await getObjectTimeline(execute, { object_type: 'activity', object_id: 77, project_id: 10, page: 2, limit: 10 });
  assert.deepEqual(calls[0].variables, { projectId: 10, activityId: 77, pagination: { page: 2, perPage: 10 } });
  assert.deepEqual(out.pagination, { page: 2, limit: 10, total: 31, total_pages: 4, mode: 'server' });
  assert.ok(out.notes.some((n) => /read_activity_attachment/.test(n)));
});

test('activity date filters paginate all matches and stop once history predates since', async () => {
  const pages = [
    ['2026-12-01'],
    ['2026-11-30T23:59:59.999Z', '2026-11-01T00:00:00Z', '2026-10-31'],
  ];
  const { execute, calls } = fakeExecute({
    ActivityTimeline: ({ pagination }) => ({
      activities: { collection: [{ id: '77', history: {
        collection: pages[pagination.page - 1].map((createdAt) => ({ createdAt, actionType: 'STATUS_CHANGE' })),
        metadata: { totalCount: 5, totalPages: 3 },
      } }] },
    }),
  });
  const args = { object_type: 'activity', object_id: 77, project_id: 10, since: '2026-11-01', until: '2026-11-30', limit: 1 };
  for (const page of [1, 2, 3]) {
    const out = await getObjectTimeline(execute, { ...args, page });
    assert.deepEqual(out.events.map((event) => event.at), pages[1].slice(0, 2).slice(page - 1, page));
    assert.deepEqual(out.pagination, { page, limit: 1, total: 2, total_pages: 2, mode: 'client' });
  }
  assert.deepEqual(calls.map((call) => call.variables.pagination.page), [1, 2, 1, 2, 1, 2]);
});

test('issue: server-side timeline with filters translated to the platform input', async () => {
  const { execute, calls } = fakeExecute({
    IssueTimeline: {
      issue: {
        id: '5', title: 'SQLi', status: 'IDENTIFIED', createdAt: 'c', updatedAt: 'u', author: { name: 'Ana Analyst', email: 'ana@example.com' },
        timeline: { collection: [{ id: '1', eventType: 'ISSUE_FIELD_CHANGED', occurredAt: 't', actor: { kind: 'PORTAL_USER', name: 'Ana Analyst' }, field: 'description' }], metadata: { totalCount: 1, totalPages: 1 } },
      },
    },
  });
  const out = await getObjectTimeline(execute, { object_type: 'issue', object_id: 5, since: '2026-11-01', until: '2026-11-30', event_types: ['issue_field_changed'] });
  assert.deepEqual(calls[0].variables.filters, { eventTypes: ['ISSUE_FIELD_CHANGED'], occurredAfter: '2026-11-01T00:00:00Z', occurredBefore: '2026-11-30T23:59:59Z' });
  assert.equal(calls[0].variables.hasFilters, true);
  assert.equal(out.pagination.mode, 'server');
  assert.deepEqual(out.object.created_by, { name: 'Ana Analyst', email: 'ana@example.com' });
  assert.ok(out.notes.some((n) => /does not store the old\/new values/.test(n)));
  assert.equal(calls.length, 1);
});

test('issue: a filter that matches nothing is an empty result, not a fallback', async () => {
  const { execute, calls } = fakeExecute({
    IssueTimeline: { issue: { id: '5', title: 'SQLi', timeline: { collection: [], metadata: { totalCount: 0, totalPages: 0 } }, unfiltered: { metadata: { totalCount: 4 } } } },
  });
  const out = await getObjectTimeline(execute, { object_type: 'issue', object_id: 5, event_types: ['RISK_SEVERITY_CHANGED'] });
  assert.deepEqual(calls.map((c) => c.op), ['IssueTimeline']);
  assert.deepEqual(out.events, []);
  assert.equal(out.pagination.mode, 'server');
  assert.equal(out.notes, undefined);
});

test('issue: an empty timeline falls back to the legacy status/assignee history', async () => {
  const { execute, calls } = fakeExecute({
    IssueTimeline: { issue: { id: '5', title: 'SQLi', author: null, timeline: { collection: [], metadata: { totalCount: 0, totalPages: 0 } } } },
    IssueHistory: {
      issue: {
        history: [
          { kind: 'status', at: '2026-11-01T00:00:00Z', status: 'IDENTIFIED', previousStatus: 'CREATED', authorEmail: 'ana@example.com' },
          { kind: 'assignee', action: 'added', at: '2026-11-02T00:00:00Z', assigneeEmail: 'bob@example.com', authorEmail: 'ana@example.com' },
        ],
        statusHistory: [{ createdAt: 't', source: { name: 'Ana Analyst', email: 'ana@example.com' } }],
        assignedUsers: [{ name: 'Bob Builder', email: 'bob@example.com' }],
      },
    },
  });
  const out = await getObjectTimeline(execute, { object_type: 'issue', object_id: 5 });
  assert.equal(calls[0].variables.hasFilters, false);
  assert.deepEqual(calls.map((c) => c.op), ['IssueTimeline', 'IssueHistory']);
  assert.deepEqual(out.events.map((e) => e.type), ['OWNERSHIP_ASSIGNEE_ADDED', 'ISSUE_STATUS_CHANGED']);
  assert.deepEqual(out.events[0].target, { name: 'Bob Builder', email: 'bob@example.com' });
  assert.deepEqual(out.events[1].actor, { name: 'Ana Analyst', email: 'ana@example.com' });
  assert.ok(out.notes.some((n) => /legacy history/.test(n)));
});

test('asset: lifecycle, risk score and scans merge; failures of optional parts become notes', async () => {
  const { execute, calls } = fakeExecute({
    AssetTimeline: { asset: { id: '3', name: 'api', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archived: false, company: { id: '7' } } },
    AssetRiskScoreTimeline: new Error('boom'),
    AssetScansTimeline: { scanHistories: { collection: [{ id: 's1', status: 'SUCCESS', integration: 'CONVISO_SAST', createdAt: '2026-02-01T00:00:00Z' }], metadata: { totalPages: 1 } } },
  });
  const out = await getObjectTimeline(execute, { object_type: 'asset', object_id: 3 });
  const scanCall = calls.find((c) => c.op === 'AssetScansTimeline');
  assert.deepEqual(scanCall.variables, { companyId: '7', assetIds: ['3'], pagination: { page: 1, perPage: 100 }, sortOptions: [{ sortBy: 'CREATED_AT', order: 'DESC' }] });
  assert.deepEqual(out.events.map((e) => e.type), ['SCAN_EXECUTED', 'ASSET_CREATED']);
  assert.ok(out.notes.some((n) => /risk score/.test(n)));
  assert.ok(out.notes.some((n) => /exposes no change log for assets/.test(n)));
});

test('ticket: requires company_id and includes the creation event', async () => {
  await assert.rejects(getObjectTimeline(async () => ({}), { object_type: 'ticket', object_id: 1 }), (err) => err.status === 400);
  const { execute } = fakeExecute({
    TicketTimeline: {
      ticket: {
        id: '1', title: 'Bug', status: 'CLOSED', createdAt: '2026-01-01T00:00:00Z', createdBy: { name: 'Ana Analyst', email: 'ana@example.com' }, watchers: [],
        history: [{ id: '2', kind: 'STATUS', previousValue: 'OPEN', newValue: 'CLOSED', authorEmail: 'ana@example.com', createdAt: '2026-01-02T00:00:00Z' }],
      },
    },
  });
  const out = await getObjectTimeline(execute, { object_type: 'ticket', object_id: 1, company_id: 7 });
  assert.deepEqual(out.events.map((e) => e.type), ['TICKET_STATUS', 'TICKET_CREATED']);
  assert.equal(out.events[0].actor.name, 'Ana Analyst');
});

test('threat model versions and pentest executions become events', async () => {
  const { execute } = fakeExecute({
    ThreatModelTimeline: { threatModelArtifact: { id: '1', label: 'TM', createdAt: '2026-01-01T00:00:00Z', versions: [{ id: 'v2', version: 2, createdAt: '2026-02-01T00:00:00Z', notes: 'added auth flow', createdBy: { name: 'Ana Analyst', email: 'ana@example.com' } }] } },
    PentestArtifactTimeline: { pentestArtifact: { id: '2', label: 'Web', createdAt: '2026-01-01T00:00:00Z', executions: [{ id: 'e1', runNumber: 1, status: 'FINISHED', kind: 'pentest', createdAt: '2026-03-01T00:00:00Z', triggeredBy: { name: 'Bob', email: 'bob@example.com' } }] } },
  });
  const tm = await getObjectTimeline(execute, { object_type: 'threat_model_artifact', object_id: 1 });
  assert.deepEqual(tm.events.map((e) => e.type), ['VERSION_CREATED', 'ARTIFACT_CREATED']);
  assert.equal(tm.events[0].details.notes, 'added auth flow');
  const pt = await getObjectTimeline(execute, { object_type: 'pentest_artifact', object_id: 2 });
  assert.equal(pt.events[0].type, 'EXECUTION_TRIGGERED');
  assert.deepEqual(pt.events[0].actor, { name: 'Bob', email: 'bob@example.com' });
});

test('invalid object_type, limits and date ranges are rejected or clamped', async () => {
  await assert.rejects(getObjectTimeline(async () => ({}), { object_type: 'company', object_id: 1 }), (err) => err.status === 400);
  await assert.rejects(getObjectTimeline(async () => ({}), { object_type: 'ticket', object_id: 1, company_id: 1, since: '2026-12-01', until: '2026-11-01' }), (err) => err.status === 400);
  const { execute, calls } = fakeExecute({ ActivityTimeline: { activities: { collection: [{ id: '1', history: { collection: [], metadata: {} } }] } } });
  await getObjectTimeline(execute, { object_type: 'activity', object_id: 1, project_id: 1, limit: 5000 });
  assert.equal(calls[0].variables.pagination.perPage, 100);
});

test('unknown objects are a 404 with a safe message', async () => {
  await assert.rejects(getObjectTimeline(async () => ({ project: null }), { object_type: 'project', object_id: 99 }), (err) => err.status === 404 && /project 99 not found/.test(err.publicMessage));
});

test('GraphQLClient.get_object_timeline routes through execute()', async () => {
  const client = new GraphQLClient('https://example.invalid/graphql', 'test');
  client.execute = async () => ({ threatModelArtifact: { id: '1', label: 'TM', createdAt: 't', versions: [] } });
  const out = await client.get_object_timeline({ object_type: 'threat_model_artifact', object_id: 1 });
  assert.equal(out.object_type, 'threat_model_artifact');
  assert.equal(out.events.length, 1);
});
