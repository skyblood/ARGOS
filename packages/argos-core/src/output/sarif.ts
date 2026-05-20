export interface SarifResult {
  ruleId: string
  level: 'error' | 'warning' | 'note' | 'none'
  message: { text: string }
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string }
      region: { startLine: number }
    }
  }>
  partialFingerprints: {
    primaryLocationLineHash: string
  }
  properties?: {
    cwe?: string
    severity?: string
  }
}

export interface SarifLog {
  version: '2.1.0'
  $schema: string
  runs: Array<{
    tool: { driver: { name: string; version: string; rules: SarifRule[] } }
    results: SarifResult[]
  }>
}

interface SarifRule {
  id: string
  name: string
  helpUri: string
  properties: { tags: string[] }
}

type VeracodeSeverity = 'Very High' | 'High' | 'Medium' | 'Low' | 'Informational'

function severityToLevel(severity: VeracodeSeverity): SarifResult['level'] {
  if (severity === 'Very High' || severity === 'High') return 'error'
  if (severity === 'Medium') return 'warning'
  return 'note'
}

export interface VeracodeFlaw {
  issueid: number
  cweid: string
  categoryname: string
  severity: number
  severityText: VeracodeSeverity
  sourcefile: string
  sourcefilepath: string
  line: number
  description: string
}

export function veracodeToSarif(flaws: VeracodeFlaw[], toolVersion = '0.1.0'): SarifLog {
  const rulesMap = new Map<string, SarifRule>()

  const results: SarifResult[] = flaws.map(flaw => {
    const ruleId = `CWE-${flaw.cweid}`

    if (!rulesMap.has(ruleId)) {
      rulesMap.set(ruleId, {
        id: ruleId,
        name: flaw.categoryname,
        helpUri: `https://cwe.mitre.org/data/definitions/${flaw.cweid}.html`,
        properties: { tags: ['security', `severity/${flaw.severityText}`] },
      })
    }

    // Relative path only — never expose absolute project paths
    const relativePath = flaw.sourcefilepath
      .replace(/^\/.*?\/(?=src|lib|app|pkg)/, '')
      .replace(/\\/g, '/')

    const fingerprint = `${flaw.cweid}-${relativePath}-${flaw.line}`

    return {
      ruleId,
      level: severityToLevel(flaw.severityText),
      message: { text: flaw.description },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: relativePath },
          region: { startLine: flaw.line },
        },
      }],
      partialFingerprints: { primaryLocationLineHash: fingerprint },
      properties: { cwe: ruleId, severity: flaw.severityText },
    }
  })

  return {
    version: '2.1.0',
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    runs: [{
      tool: {
        driver: {
          name: 'ARGOS',
          version: toolVersion,
          rules: Array.from(rulesMap.values()),
        },
      },
      results,
    }],
  }
}
