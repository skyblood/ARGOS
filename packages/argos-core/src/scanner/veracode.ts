import { buildHmacAuthHeader, getCredentials, VERACODE_API_HOST, type VeracodeCredentials } from '../auth/hmac.js'
import {
  AuthConfigError, AuthError, NotImplementedError, RateLimitError, VeracodeError,
} from './errors.js'
import type {
  AppSecScanner, CVE, Dependency, DepParams, Finding, FindingDetail, FindingParams,
  FixSuggestion, IaCParams, ImageParams, Misconfiguration, Project, ScanStatus,
  ScanSubmitParams, Workspace,
} from './interface.js'

const BASE_URL = `https://${VERACODE_API_HOST}`
const MAX_RETRIES = 3

export class VeracodeScanner implements AppSecScanner {
  private readonly credentials: VeracodeCredentials

  constructor(tenantEnvPrefix: string) {
    const apiKey = process.env[`${tenantEnvPrefix}_API_KEY`]
    if (!apiKey) throw new AuthConfigError(tenantEnvPrefix)
    this.credentials = getCredentials(tenantEnvPrefix)
  }

  private async get(urlPath: string): Promise<unknown> {
    let attempt = 0
    while (true) {
      const authHeader = buildHmacAuthHeader(this.credentials, 'GET', urlPath)
      const res = await fetch(`${BASE_URL}${urlPath}`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      })

      if (res.status === 401) throw new AuthError()
      if (res.status === 429) {
        if (++attempt >= MAX_RETRIES) throw new RateLimitError()
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
        continue
      }
      if (!res.ok) throw new VeracodeError(res.status, await res.text())

      return res.json()
    }
  }

  async listApplications(): Promise<{ guid: string; profile: { name: string } }[]> {
    const data = await this.get('/appsec/v2/applications') as {
      _embedded?: { applications: { guid: string; profile: { name: string } }[] }
    }
    return data._embedded?.applications ?? []
  }

  async *listFindings(params: FindingParams): AsyncGenerator<Finding> {
    const { appGuid, severity, status } = params
    const qs = new URLSearchParams({ size: '500', page: '0' })
    if (severity !== undefined) qs.set('severity', String(severity))
    if (status) qs.set('violates_policy', status === 'OPEN' ? 'true' : 'false')

    let urlPath: string | null = `/appsec/v2/applications/${appGuid}/findings?${qs}`
    while (urlPath) {
      const data = await this.get(urlPath) as {
        _embedded?: { findings: Finding[] }
        _links?: { next?: { href: string } }
      }
      for (const f of data._embedded?.findings ?? []) yield f
      const next = data._links?.next?.href ?? null
      urlPath = next ? new URL(next).pathname + new URL(next).search : null
    }
  }

  async getFindingDetail(appGuid: string, findingId: number): Promise<FindingDetail> {
    return this.get(`/appsec/v2/applications/${appGuid}/findings/${findingId}`) as Promise<FindingDetail>
  }

  // Phase 2 — SCA helpers (not in AppSecScanner interface)
  async listWorkspaces(): Promise<Workspace[]> {
    let urlPath: string | null = '/srcclr/v3/workspaces?size=50&page=0'
    const result: Workspace[] = []
    while (urlPath) {
      const data = await this.get(urlPath) as {
        _embedded?: { workspaces: Workspace[] }
        _links?: { next?: { href: string } }
      }
      result.push(...(data._embedded?.workspaces ?? []))
      const next = data._links?.next?.href ?? null
      urlPath = next ? new URL(next).pathname + new URL(next).search : null
    }
    return result
  }

  async listProjects(workspaceId: string): Promise<Project[]> {
    let urlPath: string | null = `/srcclr/v3/workspaces/${workspaceId}/projects?size=50&page=0`
    const result: Project[] = []
    while (urlPath) {
      const data = await this.get(urlPath) as {
        _embedded?: { projects: Project[] }
        _links?: { next?: { href: string } }
      }
      result.push(...(data._embedded?.projects ?? []))
      const next = data._links?.next?.href ?? null
      urlPath = next ? new URL(next).pathname + new URL(next).search : null
    }
    return result
  }

  // Phase 2 — SCA (implemented)
  async listDependencies(params: DepParams): Promise<Dependency[]> {
    const { workspaceId, projectId } = params
    let urlPath: string | null =
      `/srcclr/v3/workspaces/${workspaceId}/projects/${projectId}/libraries?size=500&page=0`
    const result: Dependency[] = []
    while (urlPath) {
      const data = await this.get(urlPath) as {
        _embedded?: { libraries: RawLibrary[] }
        _links?: { next?: { href: string } }
      }
      for (const lib of data._embedded?.libraries ?? []) {
        result.push({
          component_id: lib.id ?? '',
          name: lib.name ?? '',
          version: lib.version ?? '',
          vulnerability_count: lib.vulnerability_count ?? 0,
          licenses: lib.licenses?.map((l: { name: string }) => l.name) ?? [],
        })
      }
      const next = data._links?.next?.href ?? null
      urlPath = next ? new URL(next).pathname + new URL(next).search : null
    }
    return result
  }

  // Phase 3 — Pipeline Scan submit + poll
  async submitPipelineScan(params: ScanSubmitParams): Promise<string> {
    const body = JSON.stringify({ url: params.url, filename: params.filename })
    const urlPath = '/pipeline_scan/v1/scans'
    const authHeader = buildHmacAuthHeader(this.credentials, 'POST', urlPath)
    const res = await fetch(`${BASE_URL}${urlPath}`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    })
    if (res.status === 401) throw new AuthError()
    if (!res.ok) throw new VeracodeError(res.status, await res.text())
    const data = await res.json() as { scan_id: string }
    return data.scan_id
  }

  async getScanStatus(scanId: string): Promise<ScanStatus> {
    return this.get(`/pipeline_scan/v1/scans/${scanId}`) as Promise<ScanStatus>
  }

  // Polls until SUCCESS/FAILURE/CANCELLED or timeout (default 30 min)
  async waitForScan(scanId: string, intervalMs = 10_000, timeoutMs = 30 * 60 * 1000): Promise<ScanStatus> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const status = await this.getScanStatus(scanId)
      if (status.status !== 'PENDING' && status.status !== 'RUNNING') return status
      await new Promise(r => setTimeout(r, intervalMs))
    }
    throw new VeracodeError(408, `Scan ${scanId} timed out after ${timeoutMs / 1000}s`)
  }

  // Phase 4 — Container scanning (SCA issues filtered by scan_type=CONTAINER)
  async listImageVulnerabilities(params: ImageParams): Promise<CVE[]> {
    const { workspaceId, projectId, image } = params
    const qs = new URLSearchParams({ size: '500', page: '0', scan_type: 'CONTAINER' })
    if (image) qs.set('image', image)
    let urlPath: string | null =
      `/srcclr/v3/workspaces/${workspaceId}/projects/${projectId}/issues?${qs}`
    const result: CVE[] = []
    while (urlPath) {
      const data = await this.get(urlPath) as {
        _embedded?: { issues: RawIssue[] }
        _links?: { next?: { href: string } }
      }
      for (const issue of data._embedded?.issues ?? []) {
        result.push({
          id: issue.cve?.name ?? issue.id ?? '',
          severity: issue.severity ?? 'UNKNOWN',
          cvss_score: issue.cve?.cvss_score ?? 0,
          description: issue.cve?.summary ?? '',
          affected_component: issue.library?.name ?? '',
          fixed_version: issue.library?.version_to_update_to,
        })
      }
      const next = data._links?.next?.href ?? null
      urlPath = next ? new URL(next).pathname + new URL(next).search : null
    }
    return result
  }

  // Phase 4 — IaC misconfigurations (SCA issues filtered by scan_type=IAC)
  async listMisconfigurations(params: IaCParams): Promise<Misconfiguration[]> {
    const { workspaceId, projectId } = params
    let urlPath: string | null =
      `/srcclr/v3/workspaces/${workspaceId}/projects/${projectId}/issues?size=500&page=0&scan_type=IAC`
    const result: Misconfiguration[] = []
    while (urlPath) {
      const data = await this.get(urlPath) as {
        _embedded?: { issues: RawIssue[] }
        _links?: { next?: { href: string } }
      }
      for (const issue of data._embedded?.issues ?? []) {
        result.push({
          rule_id: issue.rule_id ?? issue.id ?? '',
          severity: issue.severity ?? 'UNKNOWN',
          resource: issue.resource ?? '',
          file: issue.file,
          line: issue.line,
          remediation: issue.remediation,
        })
      }
      const next = data._links?.next?.href ?? null
      urlPath = next ? new URL(next).pathname + new URL(next).search : null
    }
    return result
  }

  // Phase 5+ stub
  getFixSuggestions(_findingId: string): Promise<FixSuggestion[]> { throw new NotImplementedError('v5') }
}

interface RawLibrary {
  id?: string
  name?: string
  version?: string
  vulnerability_count?: number
  licenses?: { name: string }[]
}

interface RawIssue {
  id?: string
  severity?: string
  rule_id?: string
  resource?: string
  file?: string
  line?: number
  remediation?: string
  cve?: { name?: string; cvss_score?: number; summary?: string }
  library?: { name?: string; version_to_update_to?: string }
}
