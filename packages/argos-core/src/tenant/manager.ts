export interface TenantConfig {
  id: string
  name: string
  envPrefix: string
}

let _allowlist: TenantConfig[] | null = null

export function loadTenantConfig(): TenantConfig[] {
  if (_allowlist) return _allowlist

  const raw = process.env['ARGOS_TENANTS']
  if (!raw) return []

  try {
    _allowlist = JSON.parse(raw) as TenantConfig[]
    return _allowlist
  } catch {
    throw new Error('ARGOS_TENANTS must be a valid JSON array of TenantConfig objects')
  }
}

export function loadTenantAllowlist(): string[] {
  return loadTenantConfig().map(t => t.id)
}

export function getTenant(tenantId: string): TenantConfig {
  const tenants = loadTenantConfig()
  const tenant = tenants.find(t => t.id === tenantId)
  if (!tenant) {
    throw new Error(`Tenant '${tenantId}' not found in allowlist`)
  }
  return tenant
}
