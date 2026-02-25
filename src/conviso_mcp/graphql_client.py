import requests
from typing import Optional, Dict, Any

class GraphQLFieldTemplates:
    complete_issue = """
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
"""

    complete_issue_with_snippet = """
        %s
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
""" % (complete_issue)

    project = """
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
"""

class GraphQLClient:
    def __init__(self, endpoint: str, api_key: Optional[str] = None):
        self.endpoint = endpoint
        self.headers = {
            "Content-Type": "application/json",
        }
        if api_key:
            self.headers["X-Api-Key"] = f"{api_key}"

    def execute(self, query: str, variables: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = {"query": query, "variables": variables or {}}
        response = requests.post(self.endpoint, json=payload, headers=self.headers)

        if not response.ok:
            raise Exception(f"GraphQL query failed: {response.status_code} - {response.text}")

        result = response.json()
        if "errors" in result:
            raise Exception(f"GraphQL errors: {result['errors']}")

        return result["data"]

    def get_issues(self, company_id: str, search: str, page: int = 1, limit: int = 1, project_id: int = None, issue_ids: list = [], asset_ids = []) -> Dict[str, Any]:
        query = """
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
        """
        variables = {
            "companyId": company_id,
            "filters": {
                "title" : search 
            },
            "pagination" : {
                "page" : page,
                "perPage" : limit
            }
        }

        if project_id is not None and project_id != 0:
            variables["filters"]["projectIds"] = [
                project_id
            ]

        if len(issue_ids) > 0:
            variables["filters"]["ids"] = issue_ids

        if len(asset_ids) > 0:
            variables["filters"]["assetIds"] = asset_ids

        return self.execute(query, variables)

    def get_issue_by_id(self, issue_id: str, return_snippets: bool = False) -> Dict[str, Any]:
        query = """
        query GetIssue($id: ID!) {
            issue(id: $id) {
                %s
            }
        }
        """

        if return_snippets:
            query = query % GraphQLFieldTemplates.complete_issue_with_snippet
        else:
            query = query % GraphQLFieldTemplates.complete_issue

        variables = {"id": issue_id}
        return self.execute(query, variables)

    def get_companies(self, page: int = 1, limit: int = 10, search="") -> Dict[str, Any]:
        query = """
        query companies($page: Int, $limit: Int, $params: CompanySearch, $order: OrderScopesParams, $orderType: OrderParams){
            companies(page: $page, limit: $limit, params: $params, order: $order, orderType : $orderType) {
                collection {
                    id
                    label
                }
            }
        }
        """
        variables = {
            "page": page,
            "limit": limit,
            "params":{
                "labelCont": search
            }
        }
        return self.execute(query, variables)

    def get_projects(self, company_id: int, page: int = 1, limit: int = 1000, search: str = "") -> Dict[str, Any]:
        query = """
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
        """
        variables = {
            "page": page,
            "limit": limit,
            "params": {
                "scopeIdEq" : company_id,
                "labelCont" : search
                #"projectStatusLabelEq": "Fixing"
            },
            "sortBy": "createdAt",
            "descending": True
        }
        return self.execute(query, variables)
    
    def get_project_by_id(self, project_id: str) -> Dict[str, Any]:
        query = """
        query GetProject($id: ID!) {
            project(id: $id) {
                %s
            }
        }
        """ % GraphQLFieldTemplates.project
        variables = {"id": project_id}
        return self.execute(query, variables)

    def get_project_vulns(self, project_id: str) -> Dict[str, Any]:
        query = """
        query project($id: ID!){
            project(id: $id) {
                vulnerabilities {
                    id
                    title
                    vulnerabilityStatus
                }
            }
        }
        """
        variables = {"id": project_id}
        return self.execute(query, variables)

    def get_vulnerabilities(self, page: int = 1, project_id: Optional[int] = None) -> Dict[str, Any]:
        query = """
        query vulnerabilities($page: Int, $limit: Int, $params: VulnerabilitySearch, $order: OrderOccurrencesParams, $orderType: OrderParams){
            vulnerabilities(page: $page, limit: $limit, params: $params, order: $order, orderType : $orderType) {
                collection {
                    id
                    title
                    vulnerabilityStatus
                    impact
                    failureType
                    createdAt
                    history {
                        id
                        createdAt
                        status
                        updatedAt
                    }
                    company {
                        id
                        label
                    }
                }
            }
        }
        """
        variables = {
            "page": page,
            "params": {},
            "order": "vulnerability_status",
            "orderType": "DESC"
        }
        if project_id:
            variables["params"]["projectScopeIdEq"] = project_id
        return self.execute(query, variables)
    
    def get_asset_by_id(self, asset_id: str) -> Dict[str, Any]:
        query = """
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
        """
        variables = {"id": asset_id}
        return self.execute(query, variables)

    def get_assets_by_company(self, company_id: str, page: int = 1, limit: int = 10) -> Dict[str, Any]:
        query = """
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
        """
        variables = {
            "companyId": company_id,
            "page": page,
            "limit": limit
        }
        return self.execute(query, variables)
    

    def list_allocated_analyses(self, page: int = 1, limit: int = 10) -> Dict[str, Any]:
        query = """
        query ListAllocatedAnalyses($page: Int, $limit: Int) {
            allocatedAnalyses(page: $page, limit: $limit) {
                collection {
                    id
                    label
                    status
                    createdAt
                    updatedAt
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
        """
        variables = {
            "page": page,
            "limit": limit
        }
        return self.execute(query, variables)

    def get_top_vulnerabilities(
        self,
        company_id: int
    ) -> Dict[str, Any]:
        query = """
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
        """
        variables = {
            "companyId": company_id
        }
        return self.execute(query, variables)

    def get_issues_stats(
        self,
        company_id: int,
        start_date: str = None,
        end_date: str = None,
        severities: list = None,
        statuses: list = None,
        asset_ids: list = None,
        asset_tags: list = None,
        sort_by: str = None,
        order: str = "DESC"
    ) -> Dict[str, Any]:
        query = """
        query IssuesStats(
            $filters: IssuesStatsFiltersInput!,
            $companyId: ID!,
            $sortBy: IssueSortByEnum,
            $order: OrderEnum
        ) {
            issuesStats(companyId: $companyId, filters: $filters, sortBy: $sortBy, order: $order) {
                severities {
                    count
                    value
                }
            }
        }
        """

        filters = {
            "severities": severities or [],
            "statuses": statuses or [],
            "assetIds": asset_ids or [],
            "assetTags": asset_tags or []
        }

        if start_date and end_date:
            filters["createdAtRange"] = {
                "startDate": start_date,
                "endDate": end_date
            }

        variables = {
            "companyId": company_id,
            "filters": filters,
            "sortBy": sort_by,
            "order": order
        }

        return self.execute(query, variables)

    def get_company_by_id(self, company_id: int) -> Dict[str, Any]:
        query = """
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
        """
        variables = {"id": company_id}
        return self.execute(query, variables)
    
    def generate_project_report(
        self,
        project_id: int,
        language: str = "en",
        vulnerability_criticity: list = None,
        vulnerability_statuses: list = None,
        requirements: bool = True,
        evidences: bool = True
    ) -> Dict[str, Any]:
        query = """
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
        """

        variables = {
            "projectId": project_id,
            "language": language,
            "vulnerabilityCriticity": vulnerability_criticity or ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NOTIFICATION"],
            "vulnerabilityStatuses": vulnerability_statuses or [
                "IDENTIFIED", "IN_PROGRESS", "AWAITING_VALIDATION", "FIX_ACCEPTED", "RISK_ACCEPTED", "FALSE_POSITIVE"
            ],
            "requirements": requirements,
            "evidences": evidences
        }

        return self.execute(query, variables)
    

    def generate_project_report_progress(self, project_id: int, report_id: int) -> Dict[str, Any]:
        query = """
        query GenerateProjectReport($projectId: ID!, $reportId: ID!) {
            projectReport(projectId: $projectId, reportId: $reportId) {
                id
                progress
                reportUrl
                status
            }
        }
        """
        variables = {
            "projectId": project_id,
            "reportId": report_id
        }
        return self.execute(query, variables)
    
    def create_source_code_vulnerability(
        self,
        title: str,
        description: str,
        solution: str,
        severity: str,
        project_id: int,
        asset_id: int,
        code_snippet: str,
        file_name: str,
        first_line: int,
        vulnerable_line: int,
        impact_level: str = "MEDIUM",
        probability_level: str = "MEDIUM",
        compromised_environment: bool = False,
        status: str = "DRAFT",
        category: str = "",
        patterns: Optional[list] = None,
        reference: str = "",
        summary: str = "",
        impact_description: str = "",
        steps_to_reproduce: str = "",
        source: str = "",
        sink: str = ""
    ) -> Dict[str, Any]:
        query = """
        mutation CreateSourceCodeVulnerability($input: CreateSourceCodeVulnerabilityInput!) {
            createSourceCodeVulnerability(input: $input) {
                issue {
                    id
                }
            }
        }
        """
        variables = {
            "input": {
                "title": title,
                "description": description,
                "solution": solution,
                "category": category,
                "patterns": patterns or [],
                "reference": reference,
                "impactLevel": impact_level,
                "probabilityLevel": probability_level,
                "compromisedEnvironment": compromised_environment,
                "status": status,
                "summary": summary,
                "impactDescription": impact_description,
                "stepsToReproduce": steps_to_reproduce,
                "assetId": asset_id,
                "projectId": project_id,
                "severity": severity,
                "codeSnippet": code_snippet,
                "fileName": file_name,
                "firstLine": first_line,
                "vulnerableLine": vulnerable_line,
                "source": source,
                "sink": sink
            }
        }
        return self.execute(query, variables)
    
    def mutate_change_issue_status(self, issue_id: str, status: str, reason: str = "") -> Dict[str, Any]:
        query = """
        mutation ChangeIssueStatus($input: ChangeIssueStatusInput!) {
            changeIssueStatus(input: $input) {
                issue {
                    id
                    status
                    permittedStatus
                }
            }
        }
        """
        variables = {
            "input": {
                "id": issue_id,
                "status": status,
                "reason" : reason
            }
        }
        return self.execute(query, variables)

    def get_mttr_over_time(self, company_id: int, start_date: str, end_date: str, severities: list = None, statuses: list = None, asset_ids: list = None, asset_tags: list = None) -> Dict[str, Any]:
        query = """
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
        """
        variables = {
            "companyId": company_id,
            "params": {
                "startDate": start_date,
                "endDate": end_date,
                "severities": severities or ["NOTIFICATION", "LOW", "MEDIUM", "HIGH", "CRITICAL"],
                "statuses": statuses or ["CREATED", "DRAFT", "IDENTIFIED", "IN_PROGRESS", "AWAITING_VALIDATION", "FIX_ACCEPTED", "RISK_ACCEPTED", "FALSE_POSITIVE", "SUPPRESSED"],
                "assetIds": asset_ids or [],
                "assetTags": asset_tags or []
            }
        }
        return self.execute(query, variables)

    def get_overall_risk_score_history(self, company_id: int) -> Dict[str, Any]:
        query = """
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
        """
        variables = {"companyId": company_id}
        return self.execute(query, variables)