import { createHmac, randomBytes } from 'crypto'

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
  const nonce = randomBytes(16).toString('hex')
  const timestamp = Date.now().toString()
  const requestData = `id=${credentials.apiId}&host=${VERACODE_API_HOST}&url=${urlPath}&method=${method.toUpperCase()}`
  const signingData = `${requestData}\n${nonce}\n${timestamp}\nvcode_request_version_1`

  // Veracode HMAC-SHA256 v1 key derivation chain
  const keyBytes = Buffer.from(credentials.apiKey, 'hex')
  const nonceBytes = Buffer.from(nonce, 'hex')
  const hmacNonce = createHmac('sha256', keyBytes).update(nonceBytes).digest()
  const hmacTs    = createHmac('sha256', hmacNonce).update(timestamp).digest()
  const hmacVer   = createHmac('sha256', hmacTs).update('vcode_request_version_1').digest()
  const signature = createHmac('sha256', hmacVer).update(signingData).digest('hex')

  return `VERACODE-HMAC-SHA-256 id=${credentials.apiId},ts=${timestamp},nonce=${nonce},sig=${signature}`
}
