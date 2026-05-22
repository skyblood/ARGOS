import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { VeracodeScanner } from '@argos/core'
import { AuthConfigError } from '@argos/core'

const server = new Server(
  { name: 'argos-veracode', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

// ── Tool registry ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'veracode_list_applications',
    description: 'List all Veracode SAST applications for a tenant.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant: { type: 'string', description: 'Tenant env prefix (e.g. ACME → reads ACME_API_ID / ACME_API_KEY)' },
      },
      required: ['tenant'],
    },
  },
  {
    name: 'veracode_list_findings',
    description: 'List SAST findings for an application (paginated, yields all pages).',
    inputSchema: {
      type: 'object',
      properties: {
        tenant:   { type: 'string' },
        appGuid:  { type: 'string', description: 'Application GUID from veracode_list_applications' },
        severity: { type: 'number', description: 'Filter by severity (0–5). Omit for all.' },
        status:   { type: 'string', enum: ['OPEN', 'CLOSED'], description: 'Filter by policy status' },
      },
      required: ['tenant', 'appGuid'],
    },
  },
  {
    name: 'veracode_list_workspaces',
    description: 'List all SCA workspaces for a tenant.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant: { type: 'string' },
      },
      required: ['tenant'],
    },
  },
  {
    name: 'veracode_list_projects',
    description: 'List projects inside a SCA workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant:      { type: 'string' },
        workspaceId: { type: 'string' },
      },
      required: ['tenant', 'workspaceId'],
    },
  },
  {
    name: 'veracode_list_dependencies',
    description: 'List open-source dependencies for a SCA project.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant:      { type: 'string' },
        workspaceId: { type: 'string' },
        projectId:   { type: 'string' },
      },
      required: ['tenant', 'workspaceId', 'projectId'],
    },
  },
  {
    name: 'veracode_submit_pipeline_scan',
    description: 'Submit a Pipeline Scan for a pre-built artifact URL. Returns scan_id.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant:   { type: 'string' },
        url:      { type: 'string', description: 'Pre-signed or public URL to the artifact zip/war/jar' },
        filename: { type: 'string', description: 'Original filename (e.g. argos-core.zip)' },
      },
      required: ['tenant', 'url', 'filename'],
    },
  },
  {
    name: 'veracode_get_scan_status',
    description: 'Get the current status of a Pipeline Scan.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant: { type: 'string' },
        scanId: { type: 'string' },
      },
      required: ['tenant', 'scanId'],
    },
  },
  {
    name: 'veracode_wait_for_scan',
    description: 'Poll a Pipeline Scan until SUCCESS/FAILURE/CANCELLED (default timeout 30 min).',
    inputSchema: {
      type: 'object',
      properties: {
        tenant:     { type: 'string' },
        scanId:     { type: 'string' },
        intervalMs: { type: 'number', description: 'Poll interval in ms (default 10000)' },
        timeoutMs:  { type: 'number', description: 'Max wait in ms (default 1800000)' },
      },
      required: ['tenant', 'scanId'],
    },
  },
  {
    name: 'veracode_list_image_vulnerabilities',
    description: 'List container image CVEs for a SCA project.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant:      { type: 'string' },
        workspaceId: { type: 'string' },
        projectId:   { type: 'string' },
        image:       { type: 'string', description: 'Optional image name/tag filter' },
      },
      required: ['tenant', 'workspaceId', 'projectId'],
    },
  },
  {
    name: 'veracode_list_misconfigurations',
    description: 'List IaC misconfigurations for a SCA project.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant:      { type: 'string' },
        workspaceId: { type: 'string' },
        projectId:   { type: 'string' },
      },
      required: ['tenant', 'workspaceId', 'projectId'],
    },
  },
] as const

// ── Handlers ──────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const a = (args ?? {}) as Record<string, unknown>

  const tenant = String(a['tenant'] ?? '')
  if (!tenant) return err('tenant parameter is required')

  let scanner: VeracodeScanner
  try {
    scanner = new VeracodeScanner(tenant)
  } catch (e) {
    if (e instanceof AuthConfigError) return err(e.message)
    throw e
  }

  try {
    switch (name) {
      case 'veracode_list_applications': {
        const apps = await scanner.listApplications()
        return ok(apps)
      }

      case 'veracode_list_findings': {
        const findings: unknown[] = []
        for await (const f of scanner.listFindings({
          appGuid:  String(a['appGuid'] ?? ''),
          severity: a['severity'] !== undefined ? Number(a['severity']) : undefined,
          status:   a['status'] as 'OPEN' | 'CLOSED' | undefined,
        })) findings.push(f)
        return ok(findings)
      }

      case 'veracode_list_workspaces':
        return ok(await scanner.listWorkspaces())

      case 'veracode_list_projects':
        return ok(await scanner.listProjects(String(a['workspaceId'] ?? '')))

      case 'veracode_list_dependencies':
        return ok(await scanner.listDependencies({
          workspaceId: String(a['workspaceId'] ?? ''),
          projectId:   String(a['projectId'] ?? ''),
        }))

      case 'veracode_submit_pipeline_scan': {
        const scanId = await scanner.submitPipelineScan({
          url:      String(a['url'] ?? ''),
          filename: String(a['filename'] ?? ''),
        })
        return ok({ scan_id: scanId })
      }

      case 'veracode_get_scan_status':
        return ok(await scanner.getScanStatus(String(a['scanId'] ?? '')))

      case 'veracode_wait_for_scan':
        return ok(await scanner.waitForScan(
          String(a['scanId'] ?? ''),
          a['intervalMs'] !== undefined ? Number(a['intervalMs']) : undefined,
          a['timeoutMs']  !== undefined ? Number(a['timeoutMs'])  : undefined,
        ))

      case 'veracode_list_image_vulnerabilities':
        return ok(await scanner.listImageVulnerabilities({
          workspaceId: String(a['workspaceId'] ?? ''),
          projectId:   String(a['projectId'] ?? ''),
          image:       a['image'] !== undefined ? String(a['image']) : undefined,
        }))

      case 'veracode_list_misconfigurations':
        return ok(await scanner.listMisconfigurations({
          workspaceId: String(a['workspaceId'] ?? ''),
          projectId:   String(a['projectId'] ?? ''),
        }))

      default:
        return err(`Unknown tool: ${name}`)
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function err(message: string) {
  return { content: [{ type: 'text' as const, text: `ERROR: ${message}` }], isError: true }
}

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
