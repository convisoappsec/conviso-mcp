/**
 * Allowlist of the only platform mutations this MCP is permitted to expose.
 *
 * Everything else in the Conviso GraphQL schema is intentionally excluded. The catalog
 * generator (scripts/generate_mutation_catalog.mjs) filters mutations_catalog.json down to
 * exactly this set, so list_mutations / describe_mutation / execute_mutation — and the
 * curated tools — can never reach a mutation outside it.
 *
 * Scope (client-facing capabilities):
 *   1. Issues/Vulnerabilities  create / update / delete / change status (manual only)
 *   2. Assets                  create / update / run DAST
 *   3. Tickets                 create        (read via get_tickets/get_ticket)
 *   4. Projects                create / update / change status / remove (read via get_projects)
 *   5. Requirements            create / update (read via get_requirements/get_requirement)
 *   6. AI-Pentest              artifact / schedule / trigger / retest (read via get_pentest_*)
 *   7. Supply chain            read only  -> get_sbom_components (no mutation)
 *   8. Applications            create / update (read via get_applications/get_application)
 *   9. Scans                   read only  -> get_scan_histories (no mutation)
 *  10. Threat Modeling         create / update / version (read via get_threat_model_*)
 */
export const ALLOWED_MUTATIONS = [
  // 1. Issues / Vulnerabilities (manual management only — scanner-ingestion mutations excluded)
  'changeIssueStatus',
  'bulkChangeIssueStatus',
  'bulkDeleteIssues',
  'createSourceCodeVulnerability',
  'createWebVulnerability',
  'createNetworkVulnerability',
  'updateSourceCodeVulnerability',
  'updateWebVulnerability',
  'updateNetworkVulnerability',
  'updateIssueAssignee',
  'markIssueAsAnalyzed',

  // 2. Assets (+ run DAST)
  'createAsset',
  'updateAsset',
  'startConvisoDast',

  // 3. Tickets
  'createTicket',

  // 4. Projects
  'createProject',
  'updateProject',
  'updateProjectStatus',
  'bulkUpdateProjectStatus',
  'bulkDeleteProjects',

  // 5. Requirements
  'createOrUpdateRequirement',
  'createProjectRequirement',
  'updateProjectRequirement',

  // 6. AI-Pentest
  'createPentestArtifact',
  'updatePentestArtifact',
  'createPentestExecution',
  'cancelPentestExecution',
  'createPentestRetest',
  'submitPentestRetestResult',

  // 8. Applications
  'createApplication',
  'updateApplication',
  'addApplicationAssets',
  'removeApplicationAssets',

  // 10. Threat Modeling
  'createThreatModelArtifact',
  'createThreatModelArtifactVersion',
  'updateThreatModelArtifact',
  'createThreatModelingRequirements',
];
