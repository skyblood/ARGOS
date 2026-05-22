IMAGE   := argos:dev
TENANT  ?= TEST

.PHONY: build run scan-sast scan-sca scan-iac apps triage report test shell help

## Build the Docker image
build:
	docker build -t $(IMAGE) .

## Run argos CLI with arbitrary ARGS (make run ARGS="apps --tenant ACME")
run: build
	docker run --rm \
	  --read-only \
	  --tmpfs /tmp \
	  -v $(PWD)/output:/output \
	  -e $(TENANT)_API_ID=$(VERACODE_API_ID) \
	  -e $(TENANT)_API_KEY=$(VERACODE_API_KEY) \
	  $(IMAGE) $(ARGS)

## List applications: make apps TENANT=ACME
apps: build
	docker run --rm \
	  --read-only --tmpfs /tmp \
	  -e $(TENANT)_API_ID=$(VERACODE_API_ID) \
	  -e $(TENANT)_API_KEY=$(VERACODE_API_KEY) \
	  $(IMAGE) apps --tenant $(TENANT)

## SAST scan: make scan-sast TENANT=ACME APP_GUID=abc123 THRESHOLD=HIGH
scan-sast: build
	docker run --rm \
	  --read-only --tmpfs /tmp \
	  -v $(PWD)/output:/output \
	  -e $(TENANT)_API_ID=$(VERACODE_API_ID) \
	  -e $(TENANT)_API_KEY=$(VERACODE_API_KEY) \
	  $(IMAGE) scan \
	    --scan-type sast \
	    --tenant $(TENANT) \
	    --app-guid $(APP_GUID) \
	    --threshold $(or $(THRESHOLD),HIGH) \
	    --output /output/sast-results.json

## SCA scan: make scan-sca TENANT=ACME WORKSPACE_ID=ws1 PROJECT_ID=p1
scan-sca: build
	docker run --rm \
	  --read-only --tmpfs /tmp \
	  -v $(PWD)/output:/output \
	  -e $(TENANT)_API_ID=$(VERACODE_API_ID) \
	  -e $(TENANT)_API_KEY=$(VERACODE_API_KEY) \
	  $(IMAGE) scan \
	    --scan-type sca \
	    --tenant $(TENANT) \
	    --workspace-id $(WORKSPACE_ID) \
	    --project-id $(PROJECT_ID) \
	    --output /output/sca-results.json

## IaC scan: make scan-iac TENANT=ACME WORKSPACE_ID=ws1 PROJECT_ID=p1
scan-iac: build
	docker run --rm \
	  --read-only --tmpfs /tmp \
	  -v $(PWD)/output:/output \
	  -e $(TENANT)_API_ID=$(VERACODE_API_ID) \
	  -e $(TENANT)_API_KEY=$(VERACODE_API_KEY) \
	  $(IMAGE) scan \
	    --scan-type iac \
	    --tenant $(TENANT) \
	    --workspace-id $(WORKSPACE_ID) \
	    --project-id $(PROJECT_ID) \
	    --output /output/iac-results.json

## Triage: make triage TENANT=ACME APP_GUID=abc123
triage: build
	docker run --rm \
	  --read-only --tmpfs /tmp \
	  -e $(TENANT)_API_ID=$(VERACODE_API_ID) \
	  -e $(TENANT)_API_KEY=$(VERACODE_API_KEY) \
	  $(IMAGE) triage \
	    --tenant $(TENANT) \
	    --app-guid $(APP_GUID) \
	    --min-severity MEDIUM

## CISO report: make report TENANT=ACME APP_GUID=abc123 FORMAT=ciso
report: build
	docker run --rm \
	  --read-only --tmpfs /tmp \
	  -v $(PWD)/output:/output \
	  -e $(TENANT)_API_ID=$(VERACODE_API_ID) \
	  -e $(TENANT)_API_KEY=$(VERACODE_API_KEY) \
	  $(IMAGE) report \
	    --tenant $(TENANT) \
	    --app-guid $(APP_GUID) \
	    --format $(or $(FORMAT),dev) \
	    --output /output/report.json

## Trigger smoke test (typecheck + tests + artifact build, no Veracode)
ci-smoke:
	gh workflow run smoke-test.yml --ref main
	@echo "Smoke test running — monitor with: make ci-watch WORKFLOW=smoke-test.yml"

## Stream live CI run status (WORKFLOW defaults to smoke-test.yml)
ci-watch:
	gh run watch $$(gh run list --workflow=$(or $(WORKFLOW),smoke-test.yml) --limit 1 --json databaseId -q '.[0].databaseId')

## Check configured secrets (names only, values are never shown)
ci-secrets:
	gh secret list

## Run unit tests (local, no Docker)
test:
	npm run test -w packages/argos-core

## Debug shell inside the image
shell: build
	docker run --rm -it \
	  --entrypoint sh \
	  $(IMAGE)

help:
	@grep -E '^## ' Makefile | sed 's/## //'

.DEFAULT_GOAL := help
