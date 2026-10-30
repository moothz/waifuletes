.PHONY: help dump import dump-media import-media sync-remote

help:
	@echo "Waifuletes — Utilitários de Catálogo e Mídias"
	@echo "  make dump          - Exporta apenas a tabela 'characters' em backups/characters-dump.sql.gz (~13 MB)"
	@echo "  make import        - Restaura backups/characters-dump.sql.gz no banco PostgreSQL local"
	@echo "  make dump-media    - Empacota mídias de media/characters em backups/characters-media.tar.gz (~34 GB)"
	@echo "  make import-media  - Extrai backups/characters-media.tar.gz na pasta media/"
	@echo "  make sync-remote   - Sincroniza metadados crus diretamente via HTTP do Hub (UPSTREAM_API_URL)"

dump:
	@mkdir -p backups
	@echo "📦 Exportando tabela 'characters' (sem dados de usuários ou casamentos)..."
	docker exec waifuletes-db pg_dump -U $${POSTGRES_USER:-waifuletes} -d $${POSTGRES_DB:-waifuletes} \
		--data-only \
		--table=characters \
		| gzip > backups/characters-dump.sql.gz
	@echo "✅ Dump concluído com sucesso em backups/characters-dump.sql.gz ($$(du -h backups/characters-dump.sql.gz | cut -f1))"

import:
	@if [ ! -f backups/characters-dump.sql.gz ]; then \
		echo "❌ Arquivo backups/characters-dump.sql.gz não encontrado!"; exit 1; \
	fi
	@echo "📥 Importando tabela 'characters' no PostgreSQL local..."
	gunzip -c backups/characters-dump.sql.gz | docker exec -i waifuletes-db psql -U $${POSTGRES_USER:-waifuletes} -d $${POSTGRES_DB:-waifuletes} -v ON_ERROR_STOP=1
	@echo "✅ Importação concluída com sucesso!"

dump-media:
	@mkdir -p backups
	@echo "🖼️ Empacotando pasta de mídias (isso pode levar alguns minutos)..."
	tar -czf backups/characters-media.tar.gz -C media characters
	@echo "✅ Mídias empacotadas em backups/characters-media.tar.gz ($$(du -h backups/characters-media.tar.gz | cut -f1))"

import-media:
	@if [ ! -f backups/characters-media.tar.gz ]; then \
		echo "❌ Arquivo backups/characters-media.tar.gz não encontrado!"; exit 1; \
	fi
	@echo "📥 Extraindo mídias para media/..."
	tar -xzf backups/characters-media.tar.gz -C media/
	@echo "✅ Mídias extraídas com sucesso!"

sync-remote:
	@echo "🌐 Sincronizando catálogo de personagens do Hub remoto..."
	node scripts/syncRemoteCatalog.js
