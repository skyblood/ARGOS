import { createHmac } from 'crypto'

export interface AuditEntry {
  user_id: string
  tenant_id: string
  query_hash: string
  tools_called: string[]
  timestamp: string
  blocked: boolean
  threats?: string[]
}

export interface ProofEnvelope extends AuditEntry {
  prev_hash: string
  signature: string
}

function hmac(data: string): string {
  const key = process.env['ARGOS_PROOF_KEY']
  if (!key) throw new Error('ARGOS_PROOF_KEY env var is required for audit chain')
  return createHmac('sha256', key).update(data).digest('hex')
}

export function sealAuditEntry(
  entry: AuditEntry,
  previousEnvelope: ProofEnvelope | null
): ProofEnvelope {
  const prev_hash = previousEnvelope
    ? hmac(JSON.stringify(previousEnvelope))
    : '0000000000000000000000000000000000000000000000000000000000000000'

  const payload = JSON.stringify({ ...entry, prev_hash })
  const signature = hmac(payload)

  return { ...entry, prev_hash, signature }
}

export function verifyChain(envelopes: ProofEnvelope[]): boolean {
  for (let i = 1; i < envelopes.length; i++) {
    const expectedPrevHash = hmac(JSON.stringify(envelopes[i - 1]))
    if (envelopes[i].prev_hash !== expectedPrevHash) return false

    const { signature, ...rest } = envelopes[i]
    const payload = JSON.stringify(rest)
    if (signature !== hmac(payload)) return false
  }
  return true
}
