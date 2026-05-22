import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VeracodeScanner } from './veracode.js'
import { AuthError, AuthConfigError, RateLimitError, NotImplementedError } from './errors.js'

beforeEach(() => {
  process.env.TEST_API_ID = 'test-id'
  process.env.TEST_API_KEY = 'deadbeef'
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

function jsonRes(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

// ── Phase 1 — SAST ────────────────────────────────────────────────────────────

describe('VeracodeScanner — SAST', () => {
  it('throws AuthConfigError when env vars missing', () => {
    delete process.env.TEST_API_KEY
    expect(() => new VeracodeScanner('TEST')).toThrow(AuthConfigError)
  })

  it('listApplications returns apps from _embedded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ _embedded: { applications: [{ guid: 'abc', profile: { name: 'MyApp' } }] } })
    ))
    const apps = await new VeracodeScanner('TEST').listApplications()
    expect(apps).toHaveLength(1)
    expect(apps[0].guid).toBe('abc')
  })

  it('listApplications returns empty array when no _embedded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({})))
    expect(await new VeracodeScanner('TEST').listApplications()).toEqual([])
  })

  it('throws AuthError on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({}, 401)))
    await expect(new VeracodeScanner('TEST').listApplications()).rejects.toThrow(AuthError)
  })

  it('throws RateLimitError after 3 retries on 429', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({}, 429))
    vi.stubGlobal('fetch', fetchMock)
    const assertion = expect(new VeracodeScanner('TEST').listApplications()).rejects.toThrow(RateLimitError)
    await vi.runAllTimersAsync()
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('listFindings paginates via _links.next', async () => {
    const page1 = {
      _embedded: { findings: [{ issue_id: 1 }] },
      _links: { next: { href: 'https://api.veracode.com/appsec/v2/applications/guid/findings?page=1' } },
    }
    const page2 = { _embedded: { findings: [{ issue_id: 2 }] }, _links: {} }
    let call = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonRes(call++ === 0 ? page1 : page2))))
    const findings: unknown[] = []
    for await (const f of new VeracodeScanner('TEST').listFindings({ appGuid: 'guid' })) findings.push(f)
    expect(findings).toHaveLength(2)
  })
})

// ── Phase 2 — SCA ─────────────────────────────────────────────────────────────

describe('VeracodeScanner — SCA', () => {
  it('listWorkspaces returns workspaces from _embedded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ _embedded: { workspaces: [{ id: 'ws1', name: 'Prod', slug: 'prod' }] } })
    ))
    const ws = await new VeracodeScanner('TEST').listWorkspaces()
    expect(ws).toHaveLength(1)
    expect(ws[0].id).toBe('ws1')
  })

  it('listWorkspaces paginates', async () => {
    const page1 = {
      _embedded: { workspaces: [{ id: 'ws1', name: 'A', slug: 'a' }] },
      _links: { next: { href: 'https://api.veracode.com/srcclr/v3/workspaces?page=1' } },
    }
    const page2 = { _embedded: { workspaces: [{ id: 'ws2', name: 'B', slug: 'b' }] }, _links: {} }
    let call = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonRes(call++ === 0 ? page1 : page2))))
    const ws = await new VeracodeScanner('TEST').listWorkspaces()
    expect(ws).toHaveLength(2)
  })

  it('listProjects returns projects for a workspace', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ _embedded: { projects: [{ id: 'p1', name: 'argos-core', last_scan_date: '2026-05-20' }] } })
    ))
    const projects = await new VeracodeScanner('TEST').listProjects('ws1')
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('argos-core')
  })

  it('listDependencies maps library fields to Dependency', async () => {
    const libs = [{
      id: 'lib1',
      name: 'lodash',
      version: '4.17.20',
      vulnerability_count: 2,
      licenses: [{ name: 'MIT' }],
    }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ _embedded: { libraries: libs } })
    ))
    const deps = await new VeracodeScanner('TEST').listDependencies({ workspaceId: 'ws1', projectId: 'p1' })
    expect(deps).toHaveLength(1)
    expect(deps[0]).toEqual({
      component_id: 'lib1',
      name: 'lodash',
      version: '4.17.20',
      vulnerability_count: 2,
      licenses: ['MIT'],
    })
  })

  it('listDependencies returns empty array when no libraries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({})))
    const deps = await new VeracodeScanner('TEST').listDependencies({ workspaceId: 'ws1', projectId: 'p1' })
    expect(deps).toEqual([])
  })

  it('listDependencies handles missing optional fields gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ _embedded: { libraries: [{ name: 'express' }] } })
    ))
    const deps = await new VeracodeScanner('TEST').listDependencies({ workspaceId: 'ws1', projectId: 'p1' })
    expect(deps[0]).toEqual({ component_id: '', name: 'express', version: '', vulnerability_count: 0, licenses: [] })
  })
})

// ── Phase 3 — Pipeline Scan ───────────────────────────────────────────────────

describe('VeracodeScanner — Pipeline Scan', () => {
  it('submitPipelineScan returns scan_id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ scan_id: 'scan-123' }, 201)))
    const scanId = await new VeracodeScanner('TEST').submitPipelineScan({
      url: 'https://example.com/artifact.zip',
      filename: 'artifact.zip',
    })
    expect(scanId).toBe('scan-123')
  })

  it('submitPipelineScan throws AuthError on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({}, 401)))
    await expect(
      new VeracodeScanner('TEST').submitPipelineScan({ url: 'https://x.com/a.zip', filename: 'a.zip' })
    ).rejects.toThrow(AuthError)
  })

  it('getScanStatus returns status object', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ scan_id: 'scan-123', status: 'RUNNING', findings_count: 0 })
    ))
    const status = await new VeracodeScanner('TEST').getScanStatus('scan-123')
    expect(status.status).toBe('RUNNING')
    expect(status.scan_id).toBe('scan-123')
  })

  it('waitForScan returns when status is SUCCESS', async () => {
    vi.useFakeTimers()
    let call = 0
    const responses = [
      { scan_id: 's1', status: 'PENDING' },
      { scan_id: 's1', status: 'RUNNING' },
      { scan_id: 's1', status: 'SUCCESS', findings_count: 3 },
    ]
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(jsonRes(responses[Math.min(call++, responses.length - 1)]))
    ))
    const promise = new VeracodeScanner('TEST').waitForScan('s1', 1000)
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.status).toBe('SUCCESS')
    expect(result.findings_count).toBe(3)
  })
})

// ── Phase 4 — Container + IaC ─────────────────────────────────────────────────

describe('VeracodeScanner — Container scanning', () => {
  it('listImageVulnerabilities maps CVE fields', async () => {
    const issues = [{
      id: 'i1',
      severity: 'HIGH',
      cve: { name: 'CVE-2021-44228', cvss_score: 10.0, summary: 'Log4Shell RCE' },
      library: { name: 'log4j-core', version_to_update_to: '2.17.1' },
    }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ _embedded: { issues } })))
    const cves = await new VeracodeScanner('TEST').listImageVulnerabilities({
      workspaceId: 'ws1', projectId: 'p1',
    })
    expect(cves).toHaveLength(1)
    expect(cves[0]).toMatchObject({
      id: 'CVE-2021-44228',
      severity: 'HIGH',
      cvss_score: 10.0,
      description: 'Log4Shell RCE',
      affected_component: 'log4j-core',
      fixed_version: '2.17.1',
    })
  })

  it('listImageVulnerabilities returns empty on no issues', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({})))
    expect(await new VeracodeScanner('TEST').listImageVulnerabilities({ workspaceId: 'ws1', projectId: 'p1' }))
      .toEqual([])
  })
})

describe('VeracodeScanner — IaC misconfigurations', () => {
  it('listMisconfigurations maps issue fields', async () => {
    const issues = [{
      id: 'm1',
      rule_id: 'CKV_AWS_18',
      severity: 'MEDIUM',
      resource: 'aws_s3_bucket.logs',
      file: 'infra/main.tf',
      line: 42,
      remediation: 'Enable S3 bucket access logging',
    }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ _embedded: { issues } })))
    const misconfigs = await new VeracodeScanner('TEST').listMisconfigurations({ workspaceId: 'ws1', projectId: 'p1' })
    expect(misconfigs).toHaveLength(1)
    expect(misconfigs[0]).toMatchObject({
      rule_id: 'CKV_AWS_18',
      severity: 'MEDIUM',
      resource: 'aws_s3_bucket.logs',
      file: 'infra/main.tf',
      line: 42,
    })
  })

  it('listMisconfigurations returns empty on no issues', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({})))
    expect(await new VeracodeScanner('TEST').listMisconfigurations({ workspaceId: 'ws1', projectId: 'p1' }))
      .toEqual([])
  })
})

// ── Phase 5+ stub ─────────────────────────────────────────────────────────────

describe('VeracodeScanner — Phase 5+ stubs', () => {
  it('getFixSuggestions throws NotImplementedError', () => {
    expect(() => new VeracodeScanner('TEST').getFixSuggestions('x')).toThrow(NotImplementedError)
  })
})
