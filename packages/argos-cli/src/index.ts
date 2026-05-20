#!/usr/bin/env node
import { Command } from 'commander'

const program = new Command()

program
  .name('argos')
  .description('ARGOS — Veracode Agent Orchestration CLI')
  .version('0.1.0')

program
  .command('scan')
  .description('Run a Veracode security scan')
  .requiredOption('--scan-type <type>', 'Scan type: sast, sca, dast, container, iac')
  .requiredOption('--threshold <level>', 'Fail threshold: CRITICAL, HIGH, MEDIUM, LOW')
  .option('--output <path>', 'SARIF output file path', '/output/results.sarif')
  .option('--tenant <id>', 'Tenant ID (overrides ARGOS_TENANT env var)')
  .action(async (opts) => {
    const tenantId = opts.tenant ?? process.env['ARGOS_TENANT']
    if (!tenantId) {
      process.stderr.write('Error: tenant ID required (--tenant or ARGOS_TENANT env var)\n')
      process.exit(3)
    }

    // Phase 1: wire up real Veracode API calls via argos-core
    process.stderr.write(
      `[argos] scan type=${opts.scanType} threshold=${opts.threshold} tenant=${tenantId}\n`
    )
    process.stderr.write('[argos] Veracode API integration — Phase 1 implementation pending\n')
    process.exit(0)
  })

program
  .command('triage')
  .description('Triage and prioritize Veracode findings')
  .requiredOption('--tenant <id>', 'Tenant ID')
  .action(async (opts) => {
    process.stderr.write(`[argos] triage tenant=${opts.tenant} — Phase 2 implementation pending\n`)
    process.exit(0)
  })

program
  .command('report')
  .description('Generate CISO or developer report from scan results')
  .requiredOption('--tenant <id>', 'Tenant ID')
  .option('--format <type>', 'Report format: ciso, dev', 'dev')
  .action(async (opts) => {
    process.stderr.write(`[argos] report format=${opts.format} tenant=${opts.tenant} — Phase 3 implementation pending\n`)
    process.exit(0)
  })

program.parse()
