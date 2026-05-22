#!/usr/bin/env node
import { writeFileSync } from 'fs'
import { Command } from 'commander'
import { VeracodeScanner } from '@argos/core'
import { AuthConfigError, AuthError, RateLimitError, VeracodeError } from '@argos/core'
import type { Finding } from '@argos/core'

// ── Severity helpers ──────────────────────────────────────────────────────────

const THRESHOLD_MAP: Record<string, number> = {
  CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 0,
}

function thresholdNum(label: string): number {
  const n = THRESHOLD_MAP[label.toUpperCase()]
  if (n === undefined) die(`Unknown threshold: ${label}. Use CRITICAL, HIGH, MEDIUM, LOW, INFO.`, 3)
  return n!
}

const SEV_LABEL = ['Informational', 'Very Low', 'Low', 'Medium', 'High', 'Very High'] as const

// ── Output helpers ────────────────────────────────────────────────────────────

function log(msg: string) { process.stderr.write(`[argos] ${msg}\n`) }

function die(msg: string, code = 2): never {
  process.stderr.write(`[argos] ERROR: ${msg}\n`)
  process.exit(code)
}

function writeOutput(path: string | undefined, data: unknown) {
  const json = JSON.stringify(data, null, 2)
  if (path && path !== '-') {
    writeFileSync(path, json, 'utf8')
    log(`Results written to ${path}`)
  } else {
    process.stdout.write(json + '\n')
  }
}

function getScanner(tenant: string | undefined): VeracodeScanner {
  const t = tenant ?? process.env['ARGOS_TENANT']
  if (!t) die('Tenant required: pass --tenant or set ARGOS_TENANT env var.', 3)
  try {
    return new VeracodeScanner(t!)
  } catch (e) {
    if (e instanceof AuthConfigError) die(e.message, 3)
    throw e
  }
}

function handleApiError(e: unknown): never {
  if (e instanceof AuthError) die('Authentication failed — verify HMAC credentials.', 3)
  if (e instanceof RateLimitError) die('Veracode rate limit reached — retry in 60 s.', 2)
  if (e instanceof VeracodeError) die(`Veracode API error ${e.status}: ${e.message}`, 2)
  throw e
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const program = new Command()

program
  .name('argos')
  .description('ARGOS — Veracode Agent Orchestration CLI')
  .version('0.1.0')

// ── scan ─────────────────────────────────────────────────────────────────────

program
  .command('scan')
  .description('Run a Veracode security scan and exit 1 if findings exceed threshold.')
  .requiredOption('--scan-type <type>', 'sast | sca | pipeline | container | iac')
  .option('--tenant <id>', 'Tenant env prefix (overrides ARGOS_TENANT)')
  .option('--threshold <level>', 'Fail if findings at/above: CRITICAL, HIGH, MEDIUM, LOW, INFO', 'HIGH')
  .option('--app-guid <guid>', 'Application GUID (required for --scan-type sast)')
  .option('--workspace-id <id>', 'SCA workspace ID (required for sca, container, iac)')
  .option('--project-id <id>', 'SCA project ID (required for sca, container, iac)')
  .option('--artifact-url <url>', 'Artifact URL for pipeline scan')
  .option('--filename <name>', 'Artifact filename for pipeline scan')
  .option('--image <name>', 'Container image filter (optional, for container scan)')
  .option('--output <path>', 'Write JSON results to file (- for stdout)', '-')
  .action(async (opts) => {
    const scanner = getScanner(opts.tenant)
    const minSev = thresholdNum(opts.threshold)

    try {
      switch (opts.scanType as string) {

        case 'sast': {
          if (!opts.appGuid) die('--app-guid required for --scan-type sast', 3)
          log(`SAST scan — app=${opts.appGuid} threshold=${opts.threshold}`)
          const findings: Finding[] = []
          for await (const f of scanner.listFindings({ appGuid: opts.appGuid })) findings.push(f)
          const failing = findings.filter(f => f.severity >= minSev)
          log(`Found ${findings.length} total findings, ${failing.length} at/above ${opts.threshold}`)
          writeOutput(opts.output, { scan_type: 'sast', total: findings.length, findings })
          if (failing.length > 0) {
            log(`FAIL — ${failing.length} finding(s) exceed threshold ${opts.threshold}`)
            process.exit(1)
          }
          break
        }

        case 'sca': {
          if (!opts.workspaceId || !opts.projectId) die('--workspace-id and --project-id required for --scan-type sca', 3)
          log(`SCA scan — workspace=${opts.workspaceId} project=${opts.projectId}`)
          const deps = await scanner.listDependencies({ workspaceId: opts.workspaceId, projectId: opts.projectId })
          const vulnerable = deps.filter(d => d.vulnerability_count > 0)
          log(`Found ${deps.length} dependencies, ${vulnerable.length} with vulnerabilities`)
          writeOutput(opts.output, { scan_type: 'sca', total: deps.length, vulnerable_count: vulnerable.length, dependencies: deps })
          if (vulnerable.length > 0 && minSev <= 4) {
            log(`FAIL — ${vulnerable.length} vulnerable dependency/ies`)
            process.exit(1)
          }
          break
        }

        case 'pipeline': {
          if (!opts.artifactUrl || !opts.filename) die('--artifact-url and --filename required for --scan-type pipeline', 3)
          log(`Pipeline scan — artifact=${opts.filename}`)
          const scanId = await scanner.submitPipelineScan({ url: opts.artifactUrl, filename: opts.filename })
          log(`Scan submitted — scan_id=${scanId}`)
          log('Polling until complete…')
          const status = await scanner.waitForScan(scanId)
          log(`Scan ${status.status} — findings=${status.findings_count ?? 0}`)
          writeOutput(opts.output, { scan_type: 'pipeline', ...status })
          if (status.status === 'FAILURE' || (status.findings_count ?? 0) > 0) {
            process.exit(1)
          }
          break
        }

        case 'container': {
          if (!opts.workspaceId || !opts.projectId) die('--workspace-id and --project-id required for --scan-type container', 3)
          log(`Container scan — workspace=${opts.workspaceId} project=${opts.projectId}`)
          const cves = await scanner.listImageVulnerabilities({
            workspaceId: opts.workspaceId,
            projectId: opts.projectId,
            image: opts.image,
          })
          const sevOrder: Record<string, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFORMATIONAL: 0 }
          const failing = cves.filter(c => (sevOrder[c.severity.toUpperCase()] ?? 3) >= minSev)
          log(`Found ${cves.length} CVEs, ${failing.length} at/above ${opts.threshold}`)
          writeOutput(opts.output, { scan_type: 'container', total: cves.length, cves })
          if (failing.length > 0) process.exit(1)
          break
        }

        case 'iac': {
          if (!opts.workspaceId || !opts.projectId) die('--workspace-id and --project-id required for --scan-type iac', 3)
          log(`IaC scan — workspace=${opts.workspaceId} project=${opts.projectId}`)
          const misconfigs = await scanner.listMisconfigurations({ workspaceId: opts.workspaceId, projectId: opts.projectId })
          const sevOrder: Record<string, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFORMATIONAL: 0 }
          const failing = misconfigs.filter(m => (sevOrder[m.severity.toUpperCase()] ?? 3) >= minSev)
          log(`Found ${misconfigs.length} misconfigurations, ${failing.length} at/above ${opts.threshold}`)
          writeOutput(opts.output, { scan_type: 'iac', total: misconfigs.length, misconfigurations: misconfigs })
          if (failing.length > 0) process.exit(1)
          break
        }

        default:
          die(`Unknown scan type: ${opts.scanType}. Use sast, sca, pipeline, container, iac.`, 3)
      }
    } catch (e) {
      handleApiError(e)
    }
  })

// ── triage ───────────────────────────────────────────────────────────────────

program
  .command('triage')
  .description('List and prioritize SAST findings grouped by severity.')
  .requiredOption('--app-guid <guid>', 'Application GUID')
  .option('--tenant <id>', 'Tenant env prefix')
  .option('--min-severity <level>', 'Minimum severity to show: CRITICAL, HIGH, MEDIUM, LOW, INFO', 'MEDIUM')
  .option('--output <path>', 'Write JSON to file (- for stdout)', '-')
  .action(async (opts) => {
    const scanner = getScanner(opts.tenant)
    const minSev = thresholdNum(opts.minSeverity)
    log(`Triaging findings for app=${opts.appGuid} min-severity=${opts.minSeverity}`)

    try {
      const all: Finding[] = []
      for await (const f of scanner.listFindings({ appGuid: opts.appGuid })) all.push(f)

      const filtered = all.filter(f => f.severity >= minSev)
      const byGroup = filtered.reduce<Record<string, Finding[]>>((acc, f) => {
        const label = SEV_LABEL[f.severity] ?? 'Unknown'
        ;(acc[label] ??= []).push(f)
        return acc
      }, {})

      log(`Total: ${all.length} findings, ${filtered.length} at/above ${opts.minSeverity}`)
      for (const [sev, items] of Object.entries(byGroup).sort((a, b) => {
        return (THRESHOLD_MAP[b[0].toUpperCase()] ?? 0) - (THRESHOLD_MAP[a[0].toUpperCase()] ?? 0)
      })) {
        log(`  ${sev}: ${items.length}`)
      }

      writeOutput(opts.output, {
        app_guid: opts.appGuid,
        total: all.length,
        filtered: filtered.length,
        min_severity: opts.minSeverity,
        by_severity: byGroup,
      })
    } catch (e) {
      handleApiError(e)
    }
  })

// ── report ───────────────────────────────────────────────────────────────────

program
  .command('report')
  .description('Generate a CISO summary or developer findings report.')
  .requiredOption('--app-guid <guid>', 'Application GUID')
  .option('--tenant <id>', 'Tenant env prefix')
  .option('--format <type>', 'ciso | dev', 'dev')
  .option('--output <path>', 'Write report JSON to file (- for stdout)', '-')
  .action(async (opts) => {
    const scanner = getScanner(opts.tenant)
    log(`Generating ${opts.format} report for app=${opts.appGuid}`)

    try {
      const all: Finding[] = []
      for await (const f of scanner.listFindings({ appGuid: opts.appGuid })) all.push(f)

      const counts = SEV_LABEL.reduce<Record<string, number>>((acc, label, i) => {
        acc[label] = all.filter(f => f.severity === i).length
        return acc
      }, {})

      if (opts.format === 'ciso') {
        writeOutput(opts.output, {
          report_type: 'ciso',
          app_guid: opts.appGuid,
          generated_at: new Date().toISOString(),
          summary: counts,
          total_findings: all.length,
          critical_high: (counts['High'] ?? 0) + (counts['Very High'] ?? 0),
          open_findings: all.filter(f => f.finding_status?.status === 'OPEN').length,
        })
      } else {
        const sorted = [...all].sort((a, b) => b.severity - a.severity)
        writeOutput(opts.output, {
          report_type: 'dev',
          app_guid: opts.appGuid,
          generated_at: new Date().toISOString(),
          summary: counts,
          findings: sorted.map(f => ({
            issue_id: f.issue_id,
            severity: SEV_LABEL[f.severity],
            cwe_id: f.cwe_id,
            file: f.finding_details?.file_name,
            line: f.finding_details?.file_line_number,
            status: f.finding_status?.status,
            display_text: f.display_text,
          })),
        })
      }
    } catch (e) {
      handleApiError(e)
    }
  })

// ── apps ─────────────────────────────────────────────────────────────────────

program
  .command('apps')
  .description('List all Veracode applications for a tenant.')
  .option('--tenant <id>', 'Tenant env prefix')
  .option('--output <path>', 'Write JSON to file (- for stdout)', '-')
  .action(async (opts) => {
    const scanner = getScanner(opts.tenant)
    try {
      const apps = await scanner.listApplications()
      log(`Found ${apps.length} application(s)`)
      writeOutput(opts.output, apps)
    } catch (e) {
      handleApiError(e)
    }
  })

program.parse()
