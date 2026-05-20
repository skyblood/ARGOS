import { loadTenantAllowlist } from '../tenant/manager.js'

export interface ScanResult {
  safe: boolean
  threats: ('cross_tenant' | 'prompt_injection' | 'jailbreak' | 'pii')[]
  blocked_reason?: string
}

const INJECTION_PATTERNS = [
  /ignora (las )?instrucciones/i,
  /ignore (previous |all )?instructions/i,
  /olvida (lo que|tu)/i,
  /system prompt/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
  /\]\]\s*>/i,
]

const PII_PATTERNS = [
  /\b\d{8,10}\b/,
  /\b4\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  /\b192\.168\.\d+\.\d+\b/,
]

export function scanQuery(query: string, sessionTenantId: string): ScanResult {
  const threats: ScanResult['threats'] = []

  const knownTenants = loadTenantAllowlist()
  for (const tenant of knownTenants) {
    if (tenant !== sessionTenantId && query.toLowerCase().includes(tenant.toLowerCase())) {
      threats.push('cross_tenant')
    }
  }

  if (INJECTION_PATTERNS.some(p => p.test(query))) {
    threats.push('prompt_injection')
  }

  if (PII_PATTERNS.some(p => p.test(query))) {
    threats.push('pii')
  }

  return {
    safe: threats.length === 0,
    threats,
    blocked_reason: threats.length > 0
      ? `Query bloqueada: ${threats.join(', ')} detectado`
      : undefined,
  }
}
