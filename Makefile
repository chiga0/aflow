.PHONY: test e2e screenshots up deploy

test:
	bash scripts/test.sh

e2e:
	cd web && npm run test:e2e

screenshots:
	python3 scripts/ui_matrix.py

up:
	python3 -m runtime --host 127.0.0.1 --port 8765

deploy:
	@test -n "$(TARGET)" || (echo "Usage: make deploy TARGET=user@host" && exit 1)
	bash deploy/deploy_baremetal.sh "$(TARGET)"
