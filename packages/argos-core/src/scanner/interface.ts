// Phase 1 — SAST types
export interface FindingParams {
  appGuid: string
  severity?: number
  status?: 'OPEN' | 'CLOSED'
}

export interface Finding {
  issue_id: number
  severity: 0 | 1 | 2 | 3 | 4 | 5
  cwe_id: number
  display_text: string
  finding_status: { status: 'OPEN' | 'CLOSED' | 'MITIGATED' }
  finding_details: {
    file_name: string
    file_line_number: number
    cwe: { id: number; name: string }
  }
}

export interface FindingDetail extends Finding {
  description: string
  remediation_guidance: string
}

// Phase 2+ — stub types (not implemented in v1)
export interface DepParams { appGuid: string }
export interface Dependency { component_id: string; name: string; vulnerability_count: number }
export interface ScanStatus { scan_id: string; status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED' }
export interface CVE { id: string; severity: string; description: string }
export interface IaCParams { appGuid: string }
export interface Misconfiguration { rule_id: string; severity: string; resource: string }
export interface FixSuggestion { suggestion: string; confidence: number }

export interface AppSecScanner {
  // Phase 1 — implemented
  listApplications(): Promise<{ guid: string; profile: { name: string } }[]>
  listFindings(params: FindingParams): AsyncGenerator<Finding>
  getFindingDetail(appGuid: string, findingId: number): Promise<FindingDetail>

  // Phase 2+ — NotImplementedError
  listDependencies(params: DepParams): Promise<Dependency[]>
  getScanStatus(scanId: string): Promise<ScanStatus>
  listImageVulnerabilities(image: string): Promise<CVE[]>
  listMisconfigurations(params: IaCParams): Promise<Misconfiguration[]>
  // TODO: validate /appsec/v2/flaws/{id}/fix_suggestions exists as REST endpoint before implementing
  getFixSuggestions(findingId: string): Promise<FixSuggestion[]>
}
