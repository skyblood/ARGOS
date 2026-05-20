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

describe('VeracodeScanner', () => {
  it('throws AuthConfigError when env vars missing', () => {
    delete process.env.TEST_API_KEY
    expect(() => new VeracodeScanner('TEST')).toThrow(AuthConfigError)
  })

  it('listApplications returns apps from _embedded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ _embedded: { applications: [{ guid: 'abc', profile: { name: 'MyApp' } }] } })
    ))
    const scanner = new VeracodeScanner('TEST')
    const apps = await scanner.listApplications()
    expect(apps).toHaveLength(1)
    expect(apps[0].guid).toBe('abc')
  })

  it('listApplications returns empty array when no _embedded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({})))
    const scanner = new VeracodeScanner('TEST')
    expect(await scanner.listApplications()).toEqual([])
  })

  it('throws AuthError on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({}, 401)))
    const scanner = new VeracodeScanner('TEST')
    await expect(scanner.listApplications()).rejects.toThrow(AuthError)
  })

  it('throws RateLimitError after 3 retries on 429', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({}, 429))
    vi.stubGlobal('fetch', fetchMock)
    const scanner = new VeracodeScanner('TEST')
    // Attach rejection handler BEFORE running timers to avoid unhandled rejection
    const assertion = expect(scanner.listApplications()).rejects.toThrow(RateLimitError)
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
    const scanner = new VeracodeScanner('TEST')
    const findings: unknown[] = []
    for await (const f of scanner.listFindings({ appGuid: 'guid' })) findings.push(f)
    expect(findings).toHaveLength(2)
  })

  it('phase 2+ stubs throw NotImplementedError', () => {
    const scanner = new VeracodeScanner('TEST')
    expect(() => scanner.listDependencies({ appGuid: 'x' })).toThrow(NotImplementedError)
    expect(() => scanner.getScanStatus('x')).toThrow(NotImplementedError)
    expect(() => scanner.listImageVulnerabilities('x')).toThrow(NotImplementedError)
    expect(() => scanner.listMisconfigurations({ appGuid: 'x' })).toThrow(NotImplementedError)
    expect(() => scanner.getFixSuggestions('x')).toThrow(NotImplementedError)
  })
})
