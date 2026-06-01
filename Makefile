.PHONY: help sso-dev sso-prod whoami bootstrap-dev bootstrap-prod build-layer init-dev init-prod plan-dev plan-prod deploy-dev deploy-prod

INFRA_DIR    = infra
PROFILE_DEV  = jajc-dev
PROFILE_PROD = jajc-prod
LAYER_SRC    = lambdas/layers/src
LAYER_BUILD  = lambdas/layers/common/python
LAYER_REQS   = lambdas/layers/requirements.txt

help:
	@echo ''
	@echo 'RockDrop — Comandos disponibles'
	@echo '================================'
	@echo ''
	@echo '  Auth AWS SSO'
	@echo '  ------------'
	@echo '  make sso-dev          Renovar sesion SSO para jajc_dev'
	@echo '  make sso-prod         Renovar sesion SSO para jajc prod'
	@echo '  make whoami           Ver identidad activa en ambas cuentas'
	@echo ''
	@echo '  Infraestructura'
	@echo '  ---------------'
	@echo '  make plan-dev         Ver cambios pendientes en dev'
	@echo '  make plan-prod        Ver cambios pendientes en prod'
	@echo '  make deploy-dev       Build layer + aplicar cambios en dev'
	@echo '  make deploy-prod      Build layer + aplicar cambios en prod (pide confirmacion)'
	@echo '  make bootstrap-dev    Crear S3 + DynamoDB para estado dev  (solo 1 vez)'
	@echo '  make bootstrap-prod   Crear tabla DynamoDB para estado prod (solo 1 vez)'
	@echo ''
	@echo '  Lambda layer'
	@echo '  ------------'
	@echo '  make build-layer      Instalar dependencias y empaquetar el layer comun'
	@echo ''

# ── Auth SSO ─────────────────────────────────────────────────────────────────

sso-dev:
	@echo 'Iniciando sesion SSO -> jajc_dev (116921840630)'
	aws sso login --profile $(PROFILE_DEV)

sso-prod:
	@echo 'Iniciando sesion SSO -> jajc prod (582428574572)'
	aws sso login --profile $(PROFILE_PROD)

whoami:
	@echo '-- Dev (jajc_dev) --'
	@AWS_PROFILE=$(PROFILE_DEV) aws sts get-caller-identity 2>/dev/null || echo 'Sesion expirada: make sso-dev'
	@echo '-- Prod (jajc) --'
	@AWS_PROFILE=$(PROFILE_PROD) aws sts get-caller-identity 2>/dev/null || echo 'Sesion expirada: make sso-prod'

# ── Lambda layer ─────────────────────────────────────────────────────────────

build-layer:
	@echo 'Construyendo layer comun...'
	rm -rf $(LAYER_BUILD)
	mkdir -p $(LAYER_BUILD)
	pip3 install -r $(LAYER_REQS) -t $(LAYER_BUILD) --quiet
	cp $(LAYER_SRC)/*.py $(LAYER_BUILD)/
	@echo 'Layer OK -> $(LAYER_BUILD)'

# ── Infraestructura ──────────────────────────────────────────────────────────

bootstrap-dev:
	@echo 'Creando recursos de estado Terraform para dev...'
	@AWS_PROFILE=$(PROFILE_DEV) aws s3api head-bucket --bucket rockdrop-tfstate-dev --region us-east-1 2>/dev/null && \
		echo 'Bucket rockdrop-tfstate-dev ya existe, omitiendo.' || \
		( \
			AWS_PROFILE=$(PROFILE_DEV) aws s3api create-bucket \
				--bucket rockdrop-tfstate-dev \
				--region us-east-1 && \
			AWS_PROFILE=$(PROFILE_DEV) aws s3api put-bucket-versioning \
				--bucket rockdrop-tfstate-dev \
				--versioning-configuration Status=Enabled && \
			AWS_PROFILE=$(PROFILE_DEV) aws s3api put-bucket-encryption \
				--bucket rockdrop-tfstate-dev \
				--server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' && \
			echo 'Bucket rockdrop-tfstate-dev creado.' \
		)
	@AWS_PROFILE=$(PROFILE_DEV) aws dynamodb describe-table --table-name rockdrop-tfstate-locks-dev --region us-east-1 2>/dev/null && \
		echo 'Tabla rockdrop-tfstate-locks-dev ya existe, omitiendo.' || \
		( \
			AWS_PROFILE=$(PROFILE_DEV) aws dynamodb create-table \
				--table-name rockdrop-tfstate-locks-dev \
				--attribute-definitions AttributeName=LockID,AttributeType=S \
				--key-schema AttributeName=LockID,KeyType=HASH \
				--billing-mode PAY_PER_REQUEST \
				--region us-east-1 && \
			echo 'Tabla rockdrop-tfstate-locks-dev creada.' \
		)

bootstrap-prod:
	@echo 'Creando tabla DynamoDB para bloqueo de estado prod...'
	@AWS_PROFILE=$(PROFILE_PROD) aws dynamodb describe-table --table-name rockdrop-tfstate-locks-prod --region us-east-1 2>/dev/null && \
		echo 'Tabla rockdrop-tfstate-locks-prod ya existe, omitiendo.' || \
		( \
			AWS_PROFILE=$(PROFILE_PROD) aws dynamodb create-table \
				--table-name rockdrop-tfstate-locks-prod \
				--attribute-definitions AttributeName=LockID,AttributeType=S \
				--key-schema AttributeName=LockID,KeyType=HASH \
				--billing-mode PAY_PER_REQUEST \
				--region us-east-1 && \
			echo 'Tabla rockdrop-tfstate-locks-prod creada.' \
		)

init-dev:
	@echo 'Init Terraform -> jajc_dev (116921840630)'
	AWS_PROFILE=$(PROFILE_DEV) terraform -chdir=$(INFRA_DIR) init -backend-config=backends/dev.hcl -reconfigure

init-prod:
	@echo 'Init Terraform -> jajc prod (582428574572)'
	AWS_PROFILE=$(PROFILE_PROD) terraform -chdir=$(INFRA_DIR) init -backend-config=backends/prod.hcl -reconfigure

plan-dev: init-dev
	AWS_PROFILE=$(PROFILE_DEV) terraform -chdir=$(INFRA_DIR) plan -var-file=envs/dev.tfvars

plan-prod: init-prod
	@echo '--- PRODUCCION ---'
	AWS_PROFILE=$(PROFILE_PROD) terraform -chdir=$(INFRA_DIR) plan -var-file=envs/prod.tfvars

deploy-dev: build-layer init-dev
	AWS_PROFILE=$(PROFILE_DEV) terraform -chdir=$(INFRA_DIR) apply -var-file=envs/dev.tfvars -auto-approve

deploy-prod: build-layer init-prod
	@echo ''
	@echo 'PRODUCCION -- jajc (582428574572) -- usuarios reales'
	@echo ''
	@read -p 'Escribe "prod" para confirmar: ' confirm; \
	if [ "$$confirm" != "prod" ]; then echo 'Cancelado.'; exit 1; fi
	AWS_PROFILE=$(PROFILE_PROD) terraform -chdir=$(INFRA_DIR) apply -var-file=envs/prod.tfvars
