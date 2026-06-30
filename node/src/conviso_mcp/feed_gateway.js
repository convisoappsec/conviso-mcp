import 'dotenv/config';
import { GraphQLClient } from './graphql_client.js';
import { listMutations, describeMutation } from './mutations.js';

class FeedGateway {
  constructor(graphql_api_key = '') {
    this.base_url = 'https://app.convisoappsec.com';
    const apiKey = process.env.CONVISO_API_KEY || graphql_api_key || '';
    this.graphql = new GraphQLClient(`${this.base_url}/graphql`, apiKey);
  }

  // search = name contains; label_eq = exact name match.
  async get_companies(page = 1, limit = 10, search = '', label_eq = null) {
    return this.graphql.get_companies(page, limit, search, label_eq);
  }

  async get_company_by_id(company_id) {
    return this.graphql.get_company_by_id(company_id);
  }

  async get_issue_by_id(issue_id, return_snippets = false) {
    return this.graphql.get_issue_by_id(issue_id, return_snippets);
  }

  // Single rich issues passthrough (parity with Python gateway.get_issues kwargs).
  async getIssues(company_id, opts = {}) {
    return this.graphql.getIssues(company_id, opts);
  }

  async get_issue_with_company_id(company_id, issue_id) {
    return this.graphql.get_issues(company_id, '', 1, 5, null, [issue_id]);
  }

  async get_issues_by_asset_ids(company_id, page = 1, limit = 10, asset_ids = [], search = '', opts = {}) {
    return this.graphql.getIssues(company_id, {
      ...opts,
      page,
      limit,
      search,
      assetIds: asset_ids,
    });
  }

  async get_projects(company_id, page = 1, limit = 1000, search = '', opts = {}) {
    return this.graphql.get_projects(company_id, page, limit, search, opts);
  }

  async get_project_by_id(project_id) {
    return this.graphql.get_project_by_id(project_id);
  }

  async get_assets(company_id, page = 1, limit = 1000, opts = {}) {
    return this.graphql.get_assets_by_company(company_id, page, limit, opts);
  }

  async get_asset_by_id(asset_id) {
    return this.graphql.get_asset_by_id(asset_id);
  }

  async get_top_vulnerabilities(company_id, opts = {}) {
    return this.graphql.get_top_vulnerabilities(company_id, opts);
  }

  async generate_project_report(project_id, language = 'en', vulnerability_criticity = null, vulnerability_statuses = null, requirements = true, evidences = true) {
    return this.graphql.generate_project_report(project_id, language, vulnerability_criticity, vulnerability_statuses, requirements, evidences);
  }

  async generate_project_report_progress(project_id, report_id) {
    return this.graphql.generate_project_report_progress(project_id, report_id);
  }

  create_project_url(company_id, project_id) {
    return `${this.base_url}/spa/company/${company_id}/projects/${project_id}`;
  }

  create_issue_url(company_id, issue_id) {
    return `${this.base_url}/spa/company/${company_id}/vulnerabilities?title=&search=${issue_id}`;
  }

  async get_mttr_over_time(company_id, start_date, end_date, severities = null, statuses = null, asset_ids = null, asset_tags = null) {
    return this.graphql.get_mttr_over_time(company_id, start_date, end_date, severities, statuses, asset_ids, asset_tags);
  }

  async get_overall_risk_score_history(company_id) {
    return this.graphql.get_overall_risk_score_history(company_id);
  }

  // --- Mutations -------------------------------------------------------------

  // Discovery/introspection are pure (no network) — answered straight from the catalog.
  list_mutations(opts = {}) {
    return listMutations(opts);
  }

  describe_mutation(name) {
    return describeMutation(name);
  }

  async execute_mutation(name, variables = {}, returnFields = null) {
    return this.graphql.executeMutation(name, variables, returnFields);
  }

  async change_issue_status(a = {}) {
    return this.graphql.change_issue_status(a);
  }

  async create_source_code_vulnerability(a = {}) {
    return this.graphql.create_source_code_vulnerability(a);
  }

  async create_project(a = {}) {
    return this.graphql.create_project(a);
  }

  async create_asset(a = {}) {
    return this.graphql.create_asset(a);
  }

  async create_ticket(a = {}) {
    return this.graphql.create_ticket(a);
  }

  async run_dast(a = {}) {
    return this.graphql.run_dast(a);
  }

  async trigger_pentest(a = {}) {
    return this.graphql.trigger_pentest(a);
  }

  async create_pentest_artifact(a = {}) {
    return this.graphql.create_pentest_artifact(a);
  }

  // --- Reads (curated query tools) -------------------------------------------

  async get_tickets(company_id, opts = {}) {
    return this.graphql.get_tickets(company_id, opts);
  }

  async get_ticket(company_id, ticket_id) {
    return this.graphql.get_ticket(company_id, ticket_id);
  }

  async get_requirements(scope_id, opts = {}) {
    return this.graphql.get_requirements(scope_id, opts);
  }

  async get_requirement(company_id, requirement_id) {
    return this.graphql.get_requirement(company_id, requirement_id);
  }

  async get_project_requirements(project_id) {
    return this.graphql.get_project_requirements(project_id);
  }

  async get_applications(company_id, search = null) {
    return this.graphql.get_applications(company_id, search);
  }

  async get_application(company_id, application_id) {
    return this.graphql.get_application(company_id, application_id);
  }

  async get_scan_histories(company_id, opts = {}) {
    return this.graphql.get_scan_histories(company_id, opts);
  }

  async get_asset_scans_count(company_id) {
    return this.graphql.get_asset_scans_count(company_id);
  }

  async get_sbom_components(company_id, opts = {}) {
    return this.graphql.get_sbom_components(company_id, opts);
  }

  async get_pentest_artifacts(company_id, opts = {}) {
    return this.graphql.get_pentest_artifacts(company_id, opts);
  }

  async get_pentest_artifact(artifact_id) {
    return this.graphql.get_pentest_artifact(artifact_id);
  }

  async get_pentest_execution(execution_id) {
    return this.graphql.get_pentest_execution(execution_id);
  }

  async get_threat_model_artifacts(company_id, opts = {}) {
    return this.graphql.get_threat_model_artifacts(company_id, opts);
  }

  async get_threat_model_artifact(artifact_id) {
    return this.graphql.get_threat_model_artifact(artifact_id);
  }
}

export { FeedGateway };
