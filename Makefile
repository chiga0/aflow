.PHONY: test test-runtime test-web lint backup restore verify-backup local-init local-doctor local-up local-status local-smoke local-demo local-load local-logs local-down

test: test-runtime test-web

test-runtime:
	python3 scripts/check_runtime_coverage.py

test-web:
	cd web && npm run test

lint:
	python3 scripts/check_style.py
	cd web && npm run lint
	cd web && npm run format

backup:
	bash scripts/backup_runtime.sh backup

restore:
	@test -n "$(BACKUP_FILE)" || (echo "Usage: make restore BACKUP_FILE=<path>" && exit 1)
	bash scripts/backup_runtime.sh restore "$(BACKUP_FILE)"

verify-backup:
	@test -n "$(BACKUP_FILE)" || (echo "Usage: make verify-backup BACKUP_FILE=<path>" && exit 1)
	python3 scripts/verify_backup.py "$(BACKUP_FILE)"

local-init:
	python3 scripts/local_stack.py init

local-doctor:
	python3 scripts/local_stack.py doctor

local-up:
	python3 scripts/local_stack.py up

local-status:
	python3 scripts/local_stack.py status

local-smoke:
	python3 scripts/local_stack.py smoke

local-demo:
	python3 scripts/local_stack.py demo

local-load:
	python3 scripts/validate_ha_load.py --token "$${RUN_MANAGER_TOKEN:?set RUN_MANAGER_TOKEN}"

local-logs:
	python3 scripts/local_stack.py logs

local-down:
	python3 scripts/local_stack.py down
