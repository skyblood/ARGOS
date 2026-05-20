import { buildHmacAuthHeader, getCredentials, VERACODE_API_HOST, type VeracodeCredentials } from '../auth/hmac.js'
import {
  AuthConfigError, AuthError, NotImplementedError, RateLimitError, VeracodeError,
} from './errors.js'
import type {
  AppSecScanner, CVE, Dependency, DepParams, Finding, FindingDetail, FindingParams,
  FixSuggestion, IaCParams, Misconfiguration, ScanStatus,
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

  // Phase 2+ stubs
  listDependencies(_params: DepParams): Promise<Dependency[]> { throw new NotImplementedError('v2') }
  getScanStatus(_scanId: string): Promise<ScanStatus> { throw new NotImplementedError('v2') }
  listImageVulnerabilities(_image: string): Promise<CVE[]> { throw new NotImplementedError('v2') }
  listMisconfigurations(_params: IaCParams): Promise<Misconfiguration[]> { throw new NotImplementedError('v2') }
  getFixSuggestions(_findingId: string): Promise<FixSuggestion[]> { throw new NotImplementedError('v2') }
}
