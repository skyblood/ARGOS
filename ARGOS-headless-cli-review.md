1# ARGOS Headless CLI — Senior Engineering Review

## 1. Arquitectura Headless (Bloqueador: Alto)

**Problema:** El plan actual acopla toda la lógica en el plugin de Claude Code. No hay entry point independiente.

**Spec mínima para v1:**

```
packages/
  argos-core/       ← lógica pura: llamadas Veracode, triage, mapeo SARIF
  argos-cli/        ← bin/argos.js, argparse, exit codes, sin dependencia de Claude
  argos-mcp/        ← MCP server (wraps argos-core)
  argos-plugin/     ← Claude Code plugin (wraps argos-mcp)
```

`argos-core` no puede importar nada de Claude Code ni del MCP SDK. Es la capa que ejecuta el CLI headless y el MCP server por igual. Este es el cambio estructural mínimo. Sin él, v2 (GH Actions, Azure Task) requiere reescritura completa.

**Comando objetivo:**
```
npx argos scan --tenant client-a --type sast --output sarif --fail-on high
```

---

## 2. SARIF 2.1.0 (Bloqueador: Alto para GH Code Scanning)

**Requerido para SARIF válido:**

| Campo SARIF | Fuente Veracode | Edge case |
|---|---|---|
| `ruleId` | `cwe_id` → `CWE-{n}` | Null si Veracode no mapea CWE → usar `VERACODE-{flaw_id}` |
| `level` | severity 5=error, 3-4=warning, 1-2=note | severity=0 existe → mapear a `none` |
| `locations[].physicalLocation.artifactLocation.uri` | `source_file` relativo al repo root | Rutas absolutas del sandbox rompen GitHub UI; normalizarlas |
| `locations[].physicalLocation.region.startLine` | `line` | Puede ser 0 o null → omitir `region` si ausente |
| `partialFingerprints.primaryLocationLineHash` | hash(file+line+cwe) | Sin esto, GH crea duplicados en cada run |

**Campos obligatorios que Veracode no da directamente:**
- `$schema`: `https://json.schemastore.org/sarif-2.1.0.json`
- `runs[].tool.driver.name`: `"ARGOS/Veracode"`
- `runs[].tool.driver.rules[]`: array de reglas únicas — construir desde el conjunto de `cwe_id` presentes
- `runs[].results[].message.text`: usar `description` de Veracode; si vacío, fallback a `"CWE-{n}: {category}"`

**Edge case crítico:** Pipeline Scan y Policy Scan usan schemas de respuesta diferentes. El mapper SARIF debe abstraer ambos.

---

## 3. Exit Codes

```
0 → scan completado, 0 findings sobre el umbral
1 → findings sobre el umbral (--fail-on high|medium|low|policy)
2 → error de ejecución (API auth fail, timeout, red)
3 → configuración inválida (tenant no encontrado, parámetros faltantes)
```

**Spec:**
- `--fail-on policy` usa el resultado de Veracode Policy (pass/fail), no umbrales locales
- `--fail-on high` cuenta severity ≥ 4 (escala Veracode 1-5)
- Sin `--fail-on`: siempre exit 0 si el scan completa (modo observación)
- Stderr para errores, stdout para SARIF/JSON. Nunca mezclar.

---

## 4. Azure DevOps Extension (v2, pero diseñar ahora)

**Estructura requerida:**
```
azure-devops-extension/
  vss-extension.json     ← manifest del publisher
  task/
    task.json            ← define inputs, outputs, execution
    index.js             ← entry point (Node 20)
    node_modules/        ← bundled completo (sin npm install en pipeline)
```

**Bloqueador de diseño:** Azure requiere `node_modules` bundleado. Si `argos-core` tiene dependencias nativas (binarios, sqlite), el bundle falla en Linux agents. Mantener `argos-core` con dependencias puras JS/Node.

**`task.json` mínimo:** inputs `tenant`, `failOn`, `outputPath`; `execution.Node20.target: "index.js"`. El `index.js` llama `argos-core` directamente, no `npx`.

---

## 5. GitHub Actions (v2, pero diseñar ahora)

**Opción correcta: JavaScript Action** (no Docker, no composite).

- Docker Action: startup ~30s, imagen ~500MB, bloqueada en runners self-hosted sin Docker
- Composite Action: solo orquesta steps, no puede manejar lógica async compleja
- JavaScript Action: cold start <1s, funciona en todos los runners, usa `@actions/core` y `@actions/artifact`

**`action.yml` mínimo:**
```yaml
runs:
  using: node20
  main: dist/index.js   # esbuild bundle de argos-core + @actions/core
```

**Integración Code Scanning:**
```yaml
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: argos-results.sarif
```
ARGOS no sube el SARIF directamente; genera el archivo y deja que `upload-sarif` lo haga. Simplifica permisos.

---

## 6. Seguridad: Credenciales en CI/CD Shared Runners

**Riesgos concretos más allá de env vars:**

| Riesgo | Severidad | Fix |
|---|---|---|
| `--tenant client-a` en los logs del pipeline expone el nombre del cliente | Media | Flag `--mask-tenant`; loggear solo hash del tenant |
| SARIF output file en artefactos del pipeline contiene rutas de código fuente | Media | Documentar que SARIF es artefacto sensible; no publicar públicamente |
| `printenv` en steps de debug vuelca todas las vars incluyendo API keys | Alta | Documentar que runners deben tener `ACTIONS_STEP_DEBUG=false` en producción |
| Shared runners (GitHub-hosted) pueden tener procesos concurrentes que lean `/proc` | Baja en GH, Alta en self-hosted | Recomendar self-hosted runners dedicados para scans de producción |
| `argos.config.json` commiteado por error con env var names que revelan convención de nombres | Baja | `.gitignore` por defecto + pre-commit hook validando no hay patterns `ARGOS_*=` en el diff |

**El plan ya tiene correcto:** env var names en config (nunca raw keys), HMAC-SHA256 para el MCP server. No cambiar.

---

## Resumen de Decisiones para el Plan

1. **Crear `argos-core` como paquete independiente** antes de escribir una línea del CLI. Todo lo demás depende de esto.
2. **SARIF mapper requiere 2 modos:** Pipeline Scan schema y Policy Scan schema. Testear con `sarif-multitool validate` antes de v1.
3. **Exit code 3** (config inválida) es necesario para CI/CD; falta en planes típicos.
4. **JavaScript Action sobre Docker** para GitHub Actions. Decisión tomada en v1 para no bloquearse en v2.
5. **Azure bundle constraint**: mantener `argos-core` sin deps nativas. Verificar ahora, no en v2.
