import axios from 'axios';
import * as F from './filters.js';
import { buildMutationQuery } from './mutations.js';

/** Drop only undefined/null keys, keeping false/0/'' so intentional values survive. */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

// --- Curated mutation input builders (pure; exported for tests) ---------------
// Each maps snake_case tool arguments to the GraphQL <Name>Input shape and supports
// an optional `extra` object spread in for any input field not in the curated signature.

export function buildChangeIssueStatusInput(a = {}) {
  return { input: compact({ id: a.issue_id, status: a.status, reason: a.reason, ...(a.extra || {}) }) };
}

export function buildSourceCodeVulnerabilityInput(a = {}) {
  return {
    input: compact({
      title: a.title,
      description: a.description,
      solution: a.solution,
      category: a.category,
      patterns: a.patterns,
      reference: a.reference,
      impactLevel: a.impact_level ?? 'MEDIUM',
      probabilityLevel: a.probability_level ?? 'MEDIUM',
      severity: a.severity,
      summary: a.summary ?? '',
      impactDescription: a.impact_description ?? '',
      stepsToReproduce: a.steps_to_reproduce ?? '',
      compromisedEnvironment: a.compromised_environment,
      status: a.status ?? 'DRAFT',
      assetId: a.asset_id,
      projectId: a.project_id,
      codeSnippet: a.code_snippet,
      fileName: a.file_name,
      firstLine: a.first_line,
      vulnerableLine: a.vulnerable_line,
      source: a.source,
      sink: a.sink,
      ...(a.extra || {}),
    }),
  };
}

export function buildCreateProjectInput(a = {}) {
  return {
    input: compact({
      companyId: a.company_id,
      typeId: a.type_id,
      label: a.label,
      goal: a.goal,
      scope: a.scope,
      startDate: a.start_date,
      endDate: a.end_date,
      ...(a.extra || {}),
    }),
  };
}

export function buildCreateAssetInput(a = {}) {
  return {
    input: compact({
      companyId: a.company_id,
      name: a.name,
      assetType: a.asset_type,
      url: a.url,
      description: a.description,
      businessImpact: a.business_impact,
      exploitability: a.exploitability,
      assetsTagList: a.tags,
      ...(a.extra || {}),
    }),
  };
}

export function buildCreateTicketInput(a = {}) {
  return {
    input: compact({
      companyId: a.company_id,
      type: a.type,
      title: a.title,
      description: a.description,
      priority: a.priority,
      impact: a.impact,
      ...(a.extra || {}),
    }),
  };
}

export function buildCreatePentestArtifactInput(a = {}) {
  return {
    input: compact({
      companyId: a.company_id,
      applicationId: a.application_id,
      label: a.label,
      pentestType: a.pentest_type,
      description: a.description,
      scopeText: a.scope_text,
      assigneeEmail: a.assignee_email,
      domains: a.domains,
      inScope: a.in_scope,
      outScope: a.out_scope,
      ...(a.extra || {}),
    }),
  };
}


const GraphQLFieldTemplates = {
  complete_issue: `
        id
        title
        description
        status
        severity
        createdAt
        updatedAt
        category
        patterns
        reference
        permittedStatus
        statusHistory {
            status
            createdAt
        }
        asset {
            id
            name
        }
        project {
            id
            label

            company {
                id
            }
        }
        author {
            id
            name
            email
        }
`,

  complete_issue_with_snippet: null,

  project: `
        id
        label
        status
        createdAt
        startDate
        endDate
        allocatedAnalyst {
            portalUser {
                name
            }
        }
        projectType {
            label
        }

        company {
            id
        }
`
};

GraphQLFieldTemplates.complete_issue_with_snippet = `
    ${GraphQLFieldTemplates.complete_issue}
    ... on FindingInterface {
      severity
      solution
      scanSource
      originalIssueIdFromTool
    }
    ... on VulnerabilityInterface {
      severity
      impactDescription
      solution
      summary
      stepsToReproduce
      impactLevel
      probabilityLevel
      compromisedEnvironment
    }
    ... on DastFinding {
      detail {
        url
        port
        scheme
        method
        request
        response
      }
    }
    ... on WebVulnerability {
      detail {
        url
        port
        scheme
        method
        request
        response
        parameters
      }
    }
    ... on SourceCodeVulnerability {
      detail {
        codeSnippet
        fileName
        vulnerableLine
        firstLine
        source
        sink
      }
    }
    ... on NetworkVulnerability {
      detail {
        address
        port
        protocol
        attackVector
      }
    }
    ... on ScaFinding {
      detail {
        affectedVersion
        package
        patchedVersion
        cve
        cvssScore
        cvssMetric
        fileName
      }
    }
    ... on SastFinding {
      detail {
        codeSnippet
        fileName
        vulnerableLine
        firstLine
      }
    }
    ... on IacFinding {
      detail {
        codeSnippet
        fileName
        vulnerableLine
        firstLine
      }
    }
    ... on SecretFinding {
      detail {
        codeSnippet
        fileName
        vulnerableLine
        firstLine
      }
    }
    ... on ContainerFinding {
      detail {
        affectedVersion
        package
        patchedVersion
        cve
      }
    }
`;

export const ISSUES_QUERY = `
  query GetIssues($companyId: ID!, $pagination: PaginationInput!, $filters: IssuesFiltersInput, $sortOptions: [IssueSortOptionInput!]) {
    issues(companyId: $companyId, pagination: $pagination, filters: $filters, sortOptions: $sortOptions) {
      collection {
        id
        title
        severity
        status
        createdAt
        updatedAt
        sla { state dueAt daysRemaining }
        assignedUsers { name email }
        asset { id name }
        project { id label company { id } }
      }
      metadata { totalCount totalPages currentPage limitValue }
    }
  }
`;

export function buildIssuesVariables(companyId, page = 1, limit = 10, opts = {}) {
  const {
    severities, statuses, slaStates, createdAfter, createdBefore, assigneeEmails,
    search, projectId, assetIds, issueIds, sortBy, order, extraFilters,
  } = opts;
  let built = F.prune({
    severities: F.normalizeEnumList(severities, F.SEVERITIES),
    statuses: F.normalizeEnumList(statuses, F.ISSUE_STATUSES),
    slaStates: F.normalizeEnumList(slaStates, F.SLA_STATES),
    createdAtRange: F.buildDateRange(createdAfter, createdBefore),
    assigneeEmails: assigneeEmails || [],
    partialTitle: search,
    projectIds: (projectId !== undefined && projectId !== null && projectId !== 0) ? [projectId] : [],
    assetIds: assetIds || [],
    ids: issueIds || [],
  });
  if (extraFilters) {
    for (const [k, val] of Object.entries(extraFilters)) {
      if (val !== null && val !== undefined) built[k] = val;
    }
  }
  return {
    companyId,
    pagination: { page, perPage: limit },
    filters: built,
    sortOptions: F.buildIssueSortOptions(sortBy, order),
  };
}

export const ASSETS_QUERY = `
  query ListAssets($companyId: ID!, $page: Int, $limit: Int, $search: AssetsSearch) {
    assets(companyId: $companyId, page: $page, limit: $limit, search: $search) {
      collection {
        id
        name
        assetType
        environment
        audience
        createdAt
        updatedAt
        riskScore { current { value } }
      }
      metadata { totalCount totalPages currentPage limitValue }
    }
  }
`;

export function buildAssetsVariables(companyId, page = 1, limit = 10, opts = {}) {
  const {
    name, search, tags, technology, businessImpact, exploitability, assetType,
    environmentCompromised, coveredByScan, sortBy, order, extraFilters,
  } = opts;
  const s = F.prune({
    name,
    search,
    tags: tags || [],
    technology: technology || [],
    businessImpact: F.normalizeEnumList(businessImpact, F.BUSINESS_IMPACT),
    exploitability: F.normalizeEnumList(exploitability, F.EXPLOITABILITY),
    assetType,
    sortBy: F.normalizeEnum(sortBy, F.ASSET_SORT_BY, false),
    order: F.normalizeEnum(order, F.ORDER),
  });
  if (environmentCompromised !== null && environmentCompromised !== undefined) {
    s.environmentCompromised = environmentCompromised;
  }
  if (coveredByScan !== null && coveredByScan !== undefined) {
    s.coveredByScan = coveredByScan;
  }
  if (extraFilters) {
    for (const [k, val] of Object.entries(extraFilters)) {
      if (val !== null && val !== undefined) s[k] = val;
    }
  }
  return { companyId, page, limit, search: s };
}

export function buildTopVulnsVariables(companyId, opts = {}) {
  const {
    severities, statuses, assetIds, assetTags, createdAfter, createdBefore,
  } = opts;
  const fl = F.prune({
    severities: F.normalizeEnumList(severities, F.SEVERITIES),
    statuses: F.normalizeEnumList(statuses, F.ISSUE_STATUSES),
    assetIds: assetIds || [],
    assetTags: assetTags || [],
    createdAtRange: F.buildDateRange(createdAfter, createdBefore),
  });
  const variables = { companyId };
  if (Object.keys(fl).length) variables.filters = fl;
  return variables;
}

export const COMPANIES_QUERY = `
    query companies($page: Int, $limit: Int, $params: CompanySearch, $order: OrderScopesParams, $orderType: OrderParams){
        companies(page: $page, limit: $limit, params: $params, order: $order, orderType : $orderType) {
            collection {
                id
                label
            }
        }
    }
`;

const PROJECTS_QUERY = `
    query projects($page: Int, $limit: Int, $params: ProjectSearch, $sortBy: String, $descending: Boolean){
        projects(page: $page, limit: $limit, params: $params, sortBy: $sortBy, descending : $descending) {
            collection {
                id
                label
                status
                createdAt
                startDate
                endDate
                allocatedAnalyst {
                    portalUser {
                        name
                    }
                }
                projectType {
                    label
                }

                company {
                    id
                }
            }
            metadata {
                totalCount
                totalPages
                currentPage
                limitValue
            }
        }
    }
`;

export function buildProjectsVariables(companyId, page = 1, limit = 1000, opts = {}) {
  const {
    search, statuses, projectTypes, createdAfter, createdBefore, tags, analystEmails,
    sortBy = 'createdAt', descending = true,
  } = opts;
  const params = F.prune({
    scopeIdEq: companyId,
    labelCont: search,
    projectStatusLabelIn: statuses || [],
    projectTypeLabelIn: projectTypes || [],
    createdAtGteq: createdAfter,
    createdAtLteq: createdBefore,
    tags: tags || [],
    analystsEmailIn: analystEmails || [],
  });
  return { page, limit, params, sortBy, descending };
}

class GraphQLClient {
  constructor(endpoint, apiKey) {
    this.endpoint = endpoint;
    this.headers = {
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      this.headers['X-Api-Key'] = `${apiKey}`;
    }
  }

  async execute(query, variables = {}) {
    const payload = { query, variables };

    let response;

    try {
      response = await axios.post(this.endpoint, payload, { headers: this.headers });
    } catch (err) {
      if (err.response) {
        const e = new Error('GraphQL request failed');
        e.status = err.response.status;
        throw e;
      }

      if (err.code === 'ECONNREFUSED') {
        const e = new Error('Upstream service unavailable');
        e.status = 503;
        throw e;
      }

      if (err.code === 'ETIMEDOUT') {
        const e = new Error('Upstream request timeout');
        e.status = 504;
        throw e;
      }

      throw err;
    }

    if (response.data?.errors) {
      const messages = response.data.errors.map((x) => x?.message).filter(Boolean);
      const e = new Error('GraphQL error');
      e.status = 400;
      // Validation/field errors about the caller's own request — safe and useful to surface
      // so the model can correct the input (e.g. a missing required mutation field).
      e.graphqlErrors = messages;
      throw e;
    }

    return response.data.data;
  }

  async getIssues(companyId, opts = {}) {
    const variables = buildIssuesVariables(companyId, opts.page || 1, opts.limit || 10, opts);
    return this.execute(ISSUES_QUERY, variables);
  }

  // Backward-compatible positional-argument wrapper used by existing FeedGateway callers.
  async get_issues(company_id, search, page = 1, limit = 1, project_id = null, issue_ids = [], asset_ids = []) {
    return this.getIssues(company_id, {
      page,
      limit,
      search,
      projectId: project_id,
      issueIds: issue_ids,
      assetIds: asset_ids,
    });
  }

  async get_issue_by_id(issue_id, return_snippets = false) {
    let query = `
        query GetIssue($id: ID!) {
            issue(id: $id) {
                %s
            }
        }
        `;
    query = query.replace('%s', return_snippets ? GraphQLFieldTemplates.complete_issue_with_snippet : GraphQLFieldTemplates.complete_issue);
    const variables = { id: issue_id };
    return this.execute(query, variables);
  }

  async get_companies(page = 1, limit = 10, search = '', label_eq = null) {
    const params = F.prune({ labelCont: search, labelEq: label_eq });
    const variables = { page, limit, params };
    return this.execute(COMPANIES_QUERY, variables);
  }

  async get_projects(company_id, page = 1, limit = 1000, search = '', opts = {}) {
    const variables = buildProjectsVariables(company_id, page, limit, { search, ...opts });
    return this.execute(PROJECTS_QUERY, variables);
  }

  async get_project_by_id(project_id) {
    const query = `
        query GetProject($id: ID!) {
            project(id: $id) {
                ${GraphQLFieldTemplates.project}
            }
        }
        `;
    const variables = { id: project_id };
    return this.execute(query, variables);
  }

  async get_company_by_id(company_id) {
    const query = `
        query Company($id: ID!) {
        company(id: $id) {
            id
            label
            sid
            brandUrl
            brandId
            brandFilename
            brandSize
            customFeatures
            integrations
            createdAt
            updatedAt
            configured
            companyPlan {
            name
            id
            }
        }
        }
        `;
    const variables = { id: company_id };
    return this.execute(query, variables);
  }

  async get_assets_by_company(company_id, page = 1, limit = 10, opts = {}) {
    const variables = buildAssetsVariables(company_id, page, limit, opts);
    return this.execute(ASSETS_QUERY, variables);
  }

  async get_asset_by_id(asset_id) {
    const query = `
        query asset($id: ID!) {
            asset(id: $id) {
                id
                name
                assetType
                businessImpact
                architectureType
                technologies
                environment
                audience
                description
                createdAt
                updatedAt
                company {
                    id
                }
                riskScore{
                    current{
                        value
                    }
                }
            }
        }
        `;
    const variables = { id: asset_id };
    return this.execute(query, variables);
  }

  async get_top_vulnerabilities(company_id, opts = {}) {
    const query = `
        query TopVulnerabilities($companyId: ID!, $filters: TopVulnerabilitiesFiltersInput) {
            topVulnerabilities(companyId: $companyId, filters: $filters) {
                affectedAssetsCount
                criticalCount
                highCount
                lowCount
                mediumCount
                title
                totalCount
            }
        }
        `;
    const variables = buildTopVulnsVariables(company_id, opts);
    return this.execute(query, variables);
  }

  async get_mttr_over_time(company_id, start_date, end_date, severities = null, statuses = null, asset_ids = null, asset_tags = null) {
    const query = `
        query MttrOverTime($companyId: ID!, $params: FilterParams!) {
            mttrOverTime(companyId: $companyId, params: $params) {
                all
                critical
                dates
                high
                low
                medium
                notification
            }
        }
        `;
    const variables = {
      companyId: company_id,
      params: {
        startDate: start_date,
        endDate: end_date,
        severities: severities || ["NOTIFICATION", "LOW", "MEDIUM", "HIGH", "CRITICAL"],
        statuses: statuses || ["CREATED", "DRAFT", "IDENTIFIED", "IN_PROGRESS", "AWAITING_VALIDATION", "FIX_ACCEPTED", "RISK_ACCEPTED", "FALSE_POSITIVE", "SUPPRESSED"],
        assetIds: asset_ids || [],
        assetTags: asset_tags || []
      }
    };
    return this.execute(query, variables);
  }

  async get_overall_risk_score_history(company_id) {
    const query = `
        query OverallRiskScoreHistory($companyId: ID!) {
            overallRiskScoreHistory(companyId: $companyId) {
                company {
                    id
                    label
                }
                current {
                    date
                    value
                }
                differenceFromLast {
                    date
                    value
                }
            }
        }
        `;
    const variables = { companyId: company_id };
    return this.execute(query, variables);
  }

  async generate_project_report(project_id, language = 'en', vulnerability_criticity = null, vulnerability_statuses = null, requirements = true, evidences = true) {
    const query = `
        query GenerateProjectReport(
            $projectId: ID!,
            $language: String!,
            $vulnerabilityCriticity: [SeverityCategory!],
            $vulnerabilityStatuses: [IssueStatusLabel!],
            $requirements: Boolean!,
            $evidences: Boolean!
        ) {
            generateProjectReport(
                projectId: $projectId,
                language: $language,
                vulnerabilityCriticity: $vulnerabilityCriticity,
                vulnerabilityStatuses: $vulnerabilityStatuses,
                requirements: $requirements,
                evidences: $evidences
            ) {
                id
                reportUrl
                status
            }
        }
        `;
    const variables = {
      projectId: project_id,
      language,
      vulnerabilityCriticity: vulnerability_criticity || ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NOTIFICATION"],
      vulnerabilityStatuses: vulnerability_statuses || ["IDENTIFIED", "IN_PROGRESS", "AWAITING_VALIDATION", "FIX_ACCEPTED", "RISK_ACCEPTED", "FALSE_POSITIVE"],
      requirements,
      evidences
    };
    return this.execute(query, variables);
  }

  async generate_project_report_progress(project_id, report_id) {
    const query = `
        query GenerateProjectReport($projectId: ID!, $reportId: ID!) {
            projectReport(projectId: $projectId, reportId: $reportId) {
                id
                progress
                reportUrl
                status
            }
        }
        `;
    const variables = { projectId: project_id, reportId: report_id };
    return this.execute(query, variables);
  }

  // --- Mutations -------------------------------------------------------------

  // Generic engine: run any catalogued mutation. Builds the GraphQL document from the
  // SDL-derived catalog (whitelist) and executes it. `variables` is typically { input }.
  async executeMutation(name, variables = {}, returnFields = null) {
    const built = buildMutationQuery(name, variables, returnFields);
    return this.execute(built.query, built.variables);
  }

  // Curated shortcuts for the most common writes (thin wrappers over executeMutation).
  async change_issue_status(a = {}) {
    return this.executeMutation('changeIssueStatus', buildChangeIssueStatusInput(a));
  }

  async create_source_code_vulnerability(a = {}) {
    return this.executeMutation('createSourceCodeVulnerability', buildSourceCodeVulnerabilityInput(a));
  }

  async create_project(a = {}) {
    return this.executeMutation('createProject', buildCreateProjectInput(a));
  }

  async create_asset(a = {}) {
    return this.executeMutation('createAsset', buildCreateAssetInput(a));
  }

  async create_ticket(a = {}) {
    return this.executeMutation('createTicket', buildCreateTicketInput(a));
  }

  // --- Curated DAST / AI-Pentest shortcuts ----------------------------------
  async run_dast(a = {}) {
    return this.executeMutation('startConvisoDast', { input: compact({ assetId: a.asset_id, ...(a.extra || {}) }) });
  }

  async trigger_pentest(a = {}) {
    return this.executeMutation('createPentestExecution', { input: compact({ artifactId: a.artifact_id, ...(a.extra || {}) }) });
  }

  async create_pentest_artifact(a = {}) {
    return this.executeMutation('createPentestArtifact', buildCreatePentestArtifactInput(a));
  }

  // --- Read queries (curated) ------------------------------------------------
  async get_tickets(company_id, { page = 1, limit = 25, search, sort_by, descending, params } = {}) {
    const query = `
      query GetTickets($companyId: ID!, $page: Int, $limit: Int, $sortBy: String, $descending: Boolean, $params: TicketSearch) {
        tickets(companyId: $companyId, page: $page, limit: $limit, sortBy: $sortBy, descending: $descending, params: $params) {
          collection { id title type status priority impact createdAt updatedAt createdBy { name email } assignee { name email } }
          metadata { totalCount totalPages currentPage limitValue }
        }
      }`;
    const p = compact({ search, ...(params || {}) });
    return this.execute(query, { companyId: company_id, page, limit, sortBy: sort_by, descending, params: Object.keys(p).length ? p : undefined });
  }

  async get_ticket(company_id, ticket_id) {
    const query = `
      query GetTicket($companyId: ID!, $id: ID!) {
        ticket(companyId: $companyId, id: $id) {
          id title description type status priority impact createdAt updatedAt
          createdBy { name email } assignee { name email }
        }
      }`;
    return this.execute(query, { companyId: company_id, id: ticket_id });
  }

  async get_requirements(scope_id, { page = 1, limit = 25, filters } = {}) {
    const query = `
      query GetRequirements($scopeId: Int!, $pagination: BasePaginationInput!, $filters: RequirementsFilterInput) {
        requirements(scopeId: $scopeId, pagination: $pagination, filters: $filters) {
          collection { id label description global createdAt updatedAt }
          metadata { totalCount totalPages currentPage limitValue }
        }
      }`;
    return this.execute(query, { scopeId: scope_id, pagination: { page, perPage: limit }, filters });
  }

  async get_requirement(company_id, requirement_id) {
    const query = `
      query GetRequirement($companyId: ID!, $id: ID!) {
        requirement(companyId: $companyId, id: $id) {
          id label description global createdAt updatedAt
        }
      }`;
    return this.execute(query, { companyId: company_id, id: requirement_id });
  }

  async get_project_requirements(project_id) {
    const query = `
      query GetProjectRequirements($projectId: ID!) {
        projectRequirements(projectId: $projectId) {
          id label description createdAt updatedAt
        }
      }`;
    return this.execute(query, { projectId: project_id });
  }

  async get_applications(company_id, search = null) {
    const query = `
      query GetApplications($companyId: ID!, $search: String) {
        applications(companyId: $companyId, search: $search) {
          id name description url riskScore assetsCount createdAt updatedAt
        }
      }`;
    return this.execute(query, { companyId: company_id, search });
  }

  async get_application(company_id, application_id) {
    const query = `
      query GetApplication($companyId: ID!, $id: ID!) {
        application(id: $id, companyId: $companyId) {
          id name description url riskScore assetsCount createdAt updatedAt
          assets { id name }
        }
      }`;
    return this.execute(query, { companyId: company_id, id: application_id });
  }

  async get_scan_histories(company_id, { assetIds, page = 1, limit = 25, filters, sortOptions } = {}) {
    const query = `
      query GetScanHistories($companyId: ID!, $assetIds: [ID!], $pagination: PaginationInput!, $filters: ScansHistoriesFiltersInput, $sortOptions: [ScansHistoriesSortOptionInput!]) {
        scanHistories(companyId: $companyId, assetIds: $assetIds, pagination: $pagination, filters: $filters, sortOptions: $sortOptions) {
          collection { id status integration createdAt durationInSeconds createdVulnerabilityCount closedVulnerabilityCount importedVulnerabilityCount failureReason asset { id name } }
          metadata { totalCount totalPages currentPage limitValue }
        }
      }`;
    return this.execute(query, { companyId: company_id, assetIds, pagination: { page, perPage: limit }, filters, sortOptions });
  }

  async get_asset_scans_count(company_id) {
    const query = `
      query GetAssetScansCount($companyId: ID!) {
        assetScansCount(companyId: $companyId) { assetsWithScans assetsWithoutScans consideredScans }
      }`;
    return this.execute(query, { companyId: company_id });
  }

  async get_sbom_components(company_id, { page = 1, limit = 25, search } = {}) {
    const query = `
      query GetSbomComponents($companyId: ID!, $page: Int, $limit: Int, $search: SbomComponentSearchInput) {
        sbomComponents(companyId: $companyId, page: $page, limit: $limit, search: $search) {
          collection { id name version technology packageManager license issuesBySeverity asset { id name } createdAt updatedAt }
          metadata { totalCount totalPages currentPage limitValue }
        }
      }`;
    return this.execute(query, { companyId: company_id, page, limit, search });
  }

  async get_pentest_artifacts(company_id, { page = 1, limit = 25, search, assigneeEmail, pentestType, applicationId } = {}) {
    const query = `
      query GetPentestArtifacts($companyId: ID!, $pagination: BasePaginationInput!, $search: String, $assigneeEmail: String, $pentestType: String, $applicationId: ID) {
        pentestArtifacts(companyId: $companyId, pagination: $pagination, search: $search, assigneeEmail: $assigneeEmail, pentestType: $pentestType, applicationId: $applicationId) {
          collection { id label description pentestType createdAt updatedAt useScheduling scheduledAt executionsCount assignee { name email } application { id name } latestExecution { id status runNumber vulnerabilitiesCount createdAt } }
          metadata { totalCount totalPages currentPage limitValue }
        }
      }`;
    return this.execute(query, { companyId: company_id, pagination: { page, perPage: limit }, search, assigneeEmail, pentestType, applicationId });
  }

  async get_pentest_artifact(artifact_id) {
    const query = `
      query GetPentestArtifact($id: ID!) {
        pentestArtifact(id: $id) {
          id label description pentestType scopeText inScope outScope domains createdAt updatedAt useScheduling scheduledAt
          assignee { name email } application { id name }
          executions { id status runNumber vulnerabilitiesCount createdAt }
        }
      }`;
    return this.execute(query, { id: artifact_id });
  }

  async get_pentest_execution(execution_id) {
    const query = `
      query GetPentestExecution($id: ID!) {
        pentestExecution(id: $id) {
          id status kind triggerKind runNumber startedAt finishedAt durationSeconds
          vulnerabilitiesCount severityBreakdown nodeCount retestFixedCount retestTotalCount
          project { id label } pentestArtifact { id label } triggeredBy { name email }
        }
      }`;
    return this.execute(query, { id: execution_id });
  }

  async get_threat_model_artifacts(company_id, { page = 1, limit = 25, search, assigneeEmail, hasVersion } = {}) {
    const query = `
      query GetThreatModelArtifacts($companyId: ID!, $pagination: BasePaginationInput!, $search: String, $assigneeEmail: String, $hasVersion: Boolean) {
        threatModelArtifacts(companyId: $companyId, pagination: $pagination, search: $search, assigneeEmail: $assigneeEmail, hasVersion: $hasVersion) {
          collection { id label description scopeText createdAt updatedAt assignee { name email } latestVersion { id version createdAt } }
          metadata { totalCount totalPages currentPage limitValue }
        }
      }`;
    return this.execute(query, { companyId: company_id, pagination: { page, perPage: limit }, search, assigneeEmail, hasVersion });
  }

  async get_threat_model_artifact(artifact_id) {
    const query = `
      query GetThreatModelArtifact($id: ID!) {
        threatModelArtifact(id: $id) {
          id label description scopeText createdAt updatedAt
          assignee { name email }
          versions { id version createdAt diagramType scopeText notes }
        }
      }`;
    return this.execute(query, { id: artifact_id });
  }
}

export { GraphQLClient };
