import axios from 'axios';
import * as F from './filters.js';

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
      const e = new Error('GraphQL error');
      e.status = 400;
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

  async get_companies(page = 1, limit = 10, search = '') {
    const query = `
        query companies($page: Int, $limit: Int, $params: CompanySearch, $order: OrderScopesParams, $orderType: OrderParams){
            companies(page: $page, limit: $limit, params: $params, order: $order, orderType : $orderType) {
                collection {
                    id
                    label
                }
            }
        }
        `;
    const variables = { page, limit, params: { labelCont: search } };
    return this.execute(query, variables);
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
}

export { GraphQLClient };
