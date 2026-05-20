IMAGE := argos:dev

.PHONY: build run test help

build:
	docker build -t $(IMAGE) .

run:
	docker run --rm \
	  -e VERACODE_API_KEY=$(VERACODE_API_KEY) \
	  -e ARGOS_TENANT=$(ARGOS_TENANT) \
	  -v $(PWD)/output:/output \
	  $(IMAGE) $(ARGS)

test:
	npm run test

help:
	docker run --rm $(IMAGE) --help

.DEFAULT_GOAL := help
