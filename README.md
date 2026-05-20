# ARGOS — Veracode Agent Orchestration Platform

> *El ojo que nunca cierra.*

ARGOS es una plataforma de orquestación de agentes IA para Veracode. Permite a ingenieros de seguridad y consultores operar SAST, SCA, DAST, Container e IaC scans en lenguaje natural.

## Arquitectura

```
argos/
  packages/
    argos-core/     — Lógica pura: Veracode API, security utilities, SARIF mapper
    argos-claude/   — Plugin Claude Code: MCP server, agentes, slash commands
    argos-cli/      — CLI headless para CI/CD pipelines (Docker)
```

## Setup rápido

```bash
git clone https://github.com/skyblood/ARGOS.git
cd ARGOS
npm install
npm run build
```

## Uso local (Docker)

```bash
# Build
make build

# Scan
VERACODE_API_KEY=... ARGOS_TENANT=mi-cliente make run ARGS="scan --scan-type sast --threshold HIGH"
```

## CI/CD

Agrega a tu pipeline:

```yaml
- name: ARGOS Security Scan
  run: |
    docker run --rm \
      -e VERACODE_API_KEY=${{ secrets.VERACODE_API_KEY }} \
      -e ARGOS_TENANT=${{ secrets.ARGOS_TENANT }} \
      -v ${{ github.workspace }}/output:/output \
      ghcr.io/skyblood/argos:latest \
      scan --scan-type sast --threshold HIGH --output /output/results.sarif
```

## Secrets requeridos en GitHub

| Secret | Descripción |
|---|---|
| `ANTHROPIC_API_KEY` | Para el job de claude-security-review en PRs |
| `VERACODE_API_KEY` | Para dogfood scan en publish.yml |
| `ARGOS_TENANT` | ID del tenant para dogfood scan |

Ir a Settings → Actions → General → **Read and write permissions** ✓

## Releases

```bash
git tag v0.1.0
git push origin v0.1.0
# → GitHub Actions construye Docker + publica @argos/core automáticamente
```

## Verificar imagen firmada (cosign)

```bash
REPO=skyblood/ARGOS
cosign verify ghcr.io/skyblood/argos:v0.1.0 \
  --certificate-identity "https://github.com/${REPO}/.github/workflows/publish.yml" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

---

INCODACORP — Medellín + Delaware · [incodacorp.com](https://incodacorp.com)
