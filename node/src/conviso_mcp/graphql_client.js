const axios = require('axios');

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
        throw new Error(`GraphQL query failed: ${err.response.status} - ${JSON.stringify(err.response.data)}`);
      }
      throw err;
    }

    if (response.data && response.data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
    }

    return response.data.data;
  }

  async get_issues(company_id, search, page = 1, limit = 1, project_id = null, issue_ids = [], asset_ids = []) {
    const query = `
        query GetIssues($companyId: ID!, $pagination: PaginationInput!, $filters: IssuesFiltersInput) {
            issues(companyId: $companyId,  pagination: $pagination, filters: $filters) {
                collection {
                    id
                    title
                    severity
                    project {
                        company {
                            id
                        }
                    }

                    asset {
                        id
                    }
                }
            }
        }
        `;

    const variables = {
      companyId: company_id,
      filters: { title: search },
      pagination: { page: page, perPage: limit }
    };

    if (project_id !== null && project_id !== 0) {
      variables.filters.projectIds = [project_id];
    }
    if (Array.isArray(issue_ids) && issue_ids.length > 0) {
      variables.filters.ids = issue_ids;
    }
    if (Array.isArray(asset_ids) && asset_ids.length > 0) {
      variables.filters.assetIds = asset_ids;
    }

    return this.execute(query, variables);
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

  async get_projects(company_id, page = 1, limit = 1000, search = '') {
    const query = `
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
    const variables = {
      page,
      limit,
      params: { scopeIdEq: company_id, labelCont: search },
      sortBy: 'createdAt',
      descending: true
    };
    return this.execute(query, variables);
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

  async get_assets_by_company(company_id, page = 1, limit = 10) {
    const query = `
        query ListAssets($companyId: ID!, $page: Int, $limit: Int) {
            assets(companyId: $companyId, page: $page, limit: $limit) {
                collection {
                    id
                    name
                    assetType
                    environment
                    audience
                    createdAt
                    updatedAt
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
    const variables = { companyId: company_id, page, limit };
    return this.execute(query, variables);
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

  async get_top_vulnerabilities(company_id) {
    const query = `
        query TopVulnerabilities($companyId: ID!) {
            topVulnerabilities(companyId: $companyId) {
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
    const variables = { companyId: company_id };
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

module.exports = { GraphQLClient };
