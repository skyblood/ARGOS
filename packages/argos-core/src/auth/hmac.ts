import { createHmac } from 'crypto'

export const VERACODE_API_HOST = 'api.veracode.com'

export interface VeracodeCredentials {
  apiId: string
  apiKey: string
}

export function getCredentials(tenantEnvPrefix: string): VeracodeCredentials {
  const apiId = process.env[`${tenantEnvPrefix}_API_ID`]
  const apiKey = process.env[`${tenantEnvPrefix}_API_KEY`]

  if (!apiId || !apiKey) {
    throw new Error(
      `Veracode credentials not found for tenant prefix '${tenantEnvPrefix}'. ` +
      `Set ${tenantEnvPrefix}_API_ID and ${tenantEnvPrefix}_API_KEY env vars.`
    )
  }

  return { apiId, apiKey }
}

export function buildHmacAuthHeader(
  credentials: VeracodeCredentials,
  method: string,
  urlPath: string
): string {
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const timestamp = Date.now().toString()
  const requestData = `id=${credentials.apiId}&host=${VERACODE_API_HOST}&url=${urlPath}&method=${method.toUpperCase()}`
  const signingData = `${requestData}\n${nonce}\n${timestamp}\nvcode_request_version_1`

  const signature = createHmac('sha256', Buffer.from(credentials.apiKey, 'hex'))
    .update(signingData)
    .digest('hex')

  return `VERACODE-HMAC-SHA-256 id=${credentials.apiId},ts=${timestamp},nonce=${nonce},sig=${signature}`
}
