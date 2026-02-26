require('dotenv').config();
const { GraphQLClient } = require('./graphql_client');

class FeedGateway {
  constructor(base_url, graphql_api_key = '') {
    this.base_url = base_url;
    const apiKey = process.env.CONVISO_API_KEY || graphql_api_key || '';
    this.graphql = new GraphQLClient(`${this.base_url}/graphql`, apiKey);
  }

  static get_base_url() {
    require('dotenv').config();
    const ENV = process.env.STAGING || false;
    if (!ENV) {
      return 'https://app.convisoappsec.com';
    }
    return 'https://staging.convisoappsec.com';
  }

  async get_companies(page = 1, limit = 10, search = '') {
    return this.graphql.get_companies(page, limit, search);
  }

  async get_company_by_id(company_id) {
    return this.graphql.get_company_by_id ? this.graphql.get_company_by_id(company_id) : this.graphql.get_company_by_id(company_id);
  }

  async get_issue_by_id(issue_id, return_snippets = false) {
    return this.graphql.get_issue_by_id(issue_id, return_snippets);
  }

  async get_issues(company_id, search = '', page = 1, limit = 1, project_id = null) {
    return this.graphql.get_issues(company_id, search, page, limit, project_id);
  }

  async get_issue_with_company_id(company_id, issue_id) {
    return this.graphql.get_issues(company_id, '', 1, 5, null, [issue_id]);
  }

  async get_issues_by_asset_ids(company_id, page = 1, limit = 1, asset_ids = []) {
    return this.graphql.get_issues(company_id, '', page, limit, null, [], asset_ids);
  }

  async get_projects(company_id, page = 1, limit = 1000, search = '') {
    return this.graphql.get_projects(company_id, page, limit, search);
  }

  async get_project_by_id(project_id) {
    return this.graphql.get_project_by_id(project_id);
  }

  async get_assets(company_id, page = 1, limit = 1000) {
    return this.graphql.get_assets_by_company(company_id, page, limit);
  }

  async get_asset_by_id(asset_id) {
    return this.graphql.get_asset_by_id(asset_id);
  }

  async get_top_vulnerabilities(company_id) {
    return this.graphql.get_top_vulnerabilities(company_id);
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
}

module.exports = { FeedGateway };
