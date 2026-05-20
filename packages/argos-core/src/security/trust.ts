const TRUST_TIERS = {
  new:      { sessions: 0,  allowed_tools: ['list_findings', 'get_scan_summary'] as string[] | 'all' },
  basic:    { sessions: 3,  allowed_tools: ['list_findings', 'get_scan_summary', 'get_finding_detail'] as string[] | 'all' },
  standard: { sessions: 10, allowed_tools: 'all' as string[] | 'all' },
  flagged:  { sessions: -1, allowed_tools: [] as string[] | 'all' },
} as const

export type TrustTier = keyof typeof TRUST_TIERS

export function getTrustTier(user: { session_count: number; violations: number }): TrustTier {
  if (user.violations > 2) return 'flagged'
  if (user.session_count >= 10) return 'standard'
  if (user.session_count >= 3) return 'basic'
  return 'new'
}

export function isToolAllowed(tier: TrustTier, toolName: string): boolean {
  const allowed = TRUST_TIERS[tier].allowed_tools
  if (allowed === 'all') return true
  return (allowed as string[]).includes(toolName)
}
