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

// ── Phase 3+ stubs ────────────────────────────────────────────────────────────

describe('VeracodeScanner — Phase 3+ stubs', () => {
  it('all throw NotImplementedError synchronously', () => {
    const s = new VeracodeScanner('TEST')
    expect(() => s.getScanStatus('x')).toThrow(NotImplementedError)
    expect(() => s.listImageVulnerabilities('x')).toThrow(NotImplementedError)
    expect(() => s.listMisconfigurations({ appGuid: 'x' })).toThrow(NotImplementedError)
    expect(() => s.getFixSuggestions('x')).toThrow(NotImplementedError)
  })
})
