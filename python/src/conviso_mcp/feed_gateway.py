from graphql_client import GraphQLClient
import dotenv, os

dotenv.load_dotenv()

class FeedGateway:
    def __init__(self, base_url, graphql_api_key: str = ""):
        self.base_url = base_url

        graphql_api_key = os.environ.get("CONVISO_API_KEY")

        self.graphql = GraphQLClient(f"{self.base_url}/graphql", graphql_api_key)
        pass

    @staticmethod
    def get_base_url() -> str:
        return "https://app.convisoappsec.com"

    def get_companies(self, page: int = 1, limit: int = 10, search=""):
        companies = self.graphql.get_companies(page=page, limit=limit, search=search)
        return companies
    
    def get_company_by_id(self, company_id: int):
        return self.graphql.get_company_by_id(company_id)

    def get_issue_by_id(self, issue_id: str, return_snippets: bool = False):
        """Get details of a issue in Conviso Platform"""
        issue = self.graphql.get_issue_by_id(issue_id, return_snippets=return_snippets)
        return issue

    def get_issues(self, company_id, search=None, page=1, limit=10, project_id=None,
                   severities=None, statuses=None, sla_states=None, created_after=None,
                   created_before=None, assignee_emails=None, sort_by=None, order=None,
                   extra_filters=None):
        return self.graphql.get_issues(
            company_id, search=search, page=page, limit=limit, project_id=project_id,
            severities=severities, statuses=statuses, sla_states=sla_states,
            created_after=created_after, created_before=created_before,
            assignee_emails=assignee_emails, sort_by=sort_by, order=order,
            extra_filters=extra_filters,
        )

    def get_issue_with_company_id(self, company_id: str, issue_id: int):
        issues = self.graphql.get_issues(company_id, search="", page=1, limit=5, issue_ids=[issue_id])
        return issues
    
    def get_issues_by_asset_ids(self, company_id, page=1, limit=10, asset_ids=None, search=None, **kw):
        return self.graphql.get_issues(company_id, search=search, page=page, limit=limit,
                                        asset_ids=asset_ids or [], **kw)

    def get_projects(self, company_id: int, page: int = 1, limit: int = 1000, search=None,
                     statuses=None, project_types=None, created_after=None, created_before=None,
                     tags=None, analyst_emails=None, sort_by="createdAt", descending=True):
        return self.graphql.get_projects(
            company_id, page=page, limit=limit, search=search, statuses=statuses,
            project_types=project_types, created_after=created_after, created_before=created_before,
            tags=tags, analyst_emails=analyst_emails, sort_by=sort_by, descending=descending,
        )
    
    def get_project_by_id(self, project_id: int):
        projects = self.graphql.get_project_by_id(project_id)
        return projects
    
    def get_assets(self, company_id: int, page: int = 1, limit: int = 1000, name=None,
                   search=None, tags=None, technology=None, business_impact=None,
                   exploitability=None, asset_type=None, environment_compromised=None,
                   covered_by_scan=None, sort_by=None, order=None, extra_filters=None):
        return self.graphql.get_assets_by_company(
            company_id=company_id, page=page, limit=limit, name=name, search=search,
            tags=tags, technology=technology, business_impact=business_impact,
            exploitability=exploitability, asset_type=asset_type,
            environment_compromised=environment_compromised, covered_by_scan=covered_by_scan,
            sort_by=sort_by, order=order, extra_filters=extra_filters,
        )
    
    def get_asset_by_id(self, asset_id: int):
        return self.graphql.get_asset_by_id(asset_id=asset_id)
    
    def get_top_vulnerabilities(self, company_id: int, severities=None, statuses=None,
                                asset_ids=None, asset_tags=None, created_after=None,
                                created_before=None):
        return self.graphql.get_top_vulnerabilities(
            company_id, severities=severities, statuses=statuses, asset_ids=asset_ids,
            asset_tags=asset_tags, created_after=created_after, created_before=created_before,
        )
    
    def generate_project_report(
        self,
        project_id: int,
        language: str = "en",
        vulnerability_criticity: list = None,
        vulnerability_statuses: list = None,
        requirements: bool = True,
        evidences: bool = True
    ):
        return self.graphql.generate_project_report(project_id, language, vulnerability_criticity, vulnerability_statuses, requirements, evidences)

    def generate_project_report_progress(self, project_id: int, report_id: int):
        return self.graphql.generate_project_report_progress(project_id, report_id)

    def create_project_url(self, company_id: int, project_id: int):
        return f"{self.base_url}/spa/company/{company_id}/projects/{project_id}"

    def create_issue_url(self, company_id: int, issue_id: int):
        return f"{self.base_url}/spa/company/{company_id}/vulnerabilities?title=&search={issue_id}"
    
    def get_mttr_over_time(self, company_id: int, start_date: str, end_date: str, severities: list = None, statuses: list = None, asset_ids: list = None, asset_tags: list = None):
        return self.graphql.get_mttr_over_time(company_id, start_date, end_date, severities, statuses, asset_ids, asset_tags)
    
    def get_overall_risk_score_history(self, company_id: int):
        return self.graphql.get_overall_risk_score_history(company_id)
    

if __name__ == "__main__":
    print(FeedGateway("https://staging.convisoappsec.com").get_issue_with_company_id(248,135606)["issues"]["collection"][0]["id"])