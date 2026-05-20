export class TenantViolationError extends Error {
  constructor(
    message: string,
    public readonly context: { tool: string; session_tenant: string; attempted_tenant?: string }
  ) {
    super(message)
    this.name = 'TenantViolationError'
  }
}

const securityLog = {
  critical: (event: string, data: Record<string, unknown>) => {
    process.stderr.write(JSON.stringify({ level: 'CRITICAL', event, ...data }) + '\n')
  },
}

export function createTenantGate(sessionTenantId: string) {
  return function enforce(toolName: string, args: Record<string, unknown>): void {
    const argsTenantId = args['tenant_id'] as string | undefined

    if (!argsTenantId) {
      throw new TenantViolationError(
        `Tool ${toolName} llamado sin tenant_id — bloqueado`,
        { tool: toolName, session_tenant: sessionTenantId }
      )
    }

    if (argsTenantId !== sessionTenantId) {
      securityLog.critical('CROSS_TENANT_ATTEMPT', {
        tool: toolName,
        session_tenant: sessionTenantId,
        attempted_tenant: argsTenantId,
        timestamp: new Date().toISOString(),
      })
      throw new TenantViolationError(
        `Acceso denegado: sesión es de '${sessionTenantId}', tool pidió '${argsTenantId}'`,
        { tool: toolName, session_tenant: sessionTenantId, attempted_tenant: argsTenantId }
      )
    }
  }
}
