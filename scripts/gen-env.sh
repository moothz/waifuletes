#!/usr/bin/env bash
set -euo pipefail

# Gera credenciais seguras e cria o arquivo .env a partir de .env.example se não existir
TARGET_ENV="${1:-.env}"
EXAMPLE_ENV=".env.example"

if [ -f "$TARGET_ENV" ]; then
  echo "⚠️  O arquivo $TARGET_ENV já existe. Nenhuma alteração foi realizada."
  echo "Para regerar, remova ou renomeie o arquivo existente primeiro."
  exit 0
fi

if [ ! -f "$EXAMPLE_ENV" ]; then
  echo "❌ Arquivo $EXAMPLE_ENV não encontrado!"
  exit 1
fi

echo "🔐 Gerando credenciais seguras para o ambiente..."

GEN_KEY=$(openssl rand -hex 32)
GEN_DB_PASS=$(openssl rand -hex 24)
GEN_REDIS_PASS=$(openssl rand -hex 24)

sed \
  -e "s/API_KEYS=.*/API_KEYS=$GEN_KEY/" \
  -e "s/API_KEY=.*/API_KEY=$GEN_KEY/" \
  -e "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$GEN_DB_PASS/" \
  -e "s/REDIS_PASSWORD=.*/REDIS_PASSWORD=$GEN_REDIS_PASS/" \
  -e "s/postgresql:\/\/waifu_user:[^@]*@/postgresql:\/\/waifu_user:$GEN_DB_PASS@/" \
  -e "s/redis:\/\/:[^@]*@/redis:\/\/:$GEN_REDIS_PASS@/" \
  "$EXAMPLE_ENV" > "$TARGET_ENV"

chmod 600 "$TARGET_ENV"

echo "✅ Arquivo $TARGET_ENV gerado com sucesso!"
echo "🔑 Chave de API gerada: $GEN_KEY"
