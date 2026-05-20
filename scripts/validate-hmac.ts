// Run with: npx tsx scripts/validate-hmac.ts
// Expected: Status: 200 — if 401, HMAC bug persists; if 403, API key lacks /applications permission
import { buildHmacAuthHeader, getCredentials, VERACODE_API_HOST } from '../packages/argos-core/src/auth/hmac.js'

const prefix = process.env.ARGOS_TENANT_PREFIX ?? 'INCODACORP_INTERNAL'
const creds = getCredentials(prefix)
const urlPath = '/appsec/v2/applications'
const authHeader = buildHmacAuthHeader(creds, 'GET', urlPath)

const res = await fetch(`https://${VERACODE_API_HOST}${urlPath}`, {
  headers: { Authorization: authHeader },
})

console.log('Status:', res.status)
if (res.ok) {
  const data = await res.json() as { _embedded?: { applications: unknown[] } }
  console.log('Apps encontradas:', data._embedded?.applications?.length ?? 0)
} else {
  console.error('Error body:', await res.text())
}
