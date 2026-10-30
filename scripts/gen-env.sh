#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# 🔐 Gerador de Arquivo .env Seguro para o Waifuletes
# ==============================================================================
# Uso:
#   ./scripts/gen-env.sh [opções] [arquivo_destino]
#
# Opções:
#   --external                    Modo interativo para solicitar URL e chave do Hub remoto
#   --upstream-url <URL>          Define a URL do Hub remoto (não interativo / para agents)
#   --upstream-key <CHAVE>        Define a chave de acesso do Hub remoto (para agents)
#   -f, --force                   Sobrescreve o arquivo de destino se já existir
#   -h, --help                    Exibe esta mensagem de ajuda
#
# Exemplos:
#   ./scripts/gen-env.sh
#   ./scripts/gen-env.sh --external
#   ./scripts/gen-env.sh --upstream-url https://waifuletes.exemplo.com --upstream-key segredo123
#   ./scripts/gen-env.sh -f .env.test
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TARGET_ENV="$REPO_ROOT/.env"
EXAMPLE_ENV="$REPO_ROOT/.env.example"
FORCE=false
ASK_EXTERNAL=false
UPSTREAM_URL=""
UPSTREAM_KEY=""

# Processamento de argumentos de linha de comando
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      grep -E "^# (Uso:|  \-\-|  \-f|  \-h|Exemplos:)" "$0" | sed 's/^# //'
      exit 0
      ;;
    -f|--force)
      FORCE=true
      shift
      ;;
    --external)
      ASK_EXTERNAL=true
      shift
      ;;
    --upstream-url)
      UPSTREAM_URL="${2:-}"
      shift 2
      ;;
    --upstream-key)
      UPSTREAM_KEY="${2:-}"
      shift 2
      ;;
    -*)
      echo "❌ Opção desconhecida: $1"
      echo "Use $0 --help para ver as opções disponíveis."
      exit 1
      ;;
    *)
      TARGET_ENV="$1"
      shift
      ;;
  esac
done

if [ -f "$TARGET_ENV" ] && [ "$FORCE" = false ]; then
  echo "⚠️  O arquivo $TARGET_ENV já existe. Nenhuma alteração foi realizada."
  echo "Para regerar sobrescrevendo, use: $0 --force"
  exit 0
fi

if [ ! -f "$EXAMPLE_ENV" ]; then
  echo "❌ Arquivo $EXAMPLE_ENV não encontrado no diretório atual!"
  exit 1
fi

# Se foi solicitado --external de forma interativa e não via args
if [ "$ASK_EXTERNAL" = true ] && [ -z "$UPSTREAM_URL" ]; then
  echo ""
  echo "🌐 --- Configuração Opcional de Hub / Satélite Remoto ---"
  echo "Permite rodar o Waifuletes em modo 'Zero-Import' (sem baixar 34GB de fotos"
  echo "e sem precisar importar os 215k personagens manualmente)."
  echo ""
  read -r -p "Deseja conectar a um Hub Waifuletes remoto? [s/N]: " RESP
  if [[ "$RESP" =~ ^[sSyY]$ ]]; then
    read -r -p "URL do Hub (ex: https://waifuletes.exemplo.com): " UPSTREAM_URL
    read -r -p "Chave de Acesso Externa (fornecida pelo dono do Hub): " UPSTREAM_KEY
  fi
  echo ""
fi

echo "🔐 Gerando credenciais criptográficas seguras..."

GEN_KEY=$(openssl rand -hex 32)
GEN_ADMIN_PASS=$(openssl rand -hex 16)
GEN_DB_PASS=$(openssl rand -hex 24)
GEN_REDIS_PASS=$(openssl rand -hex 24)

# Criação base a partir do .env.example
sed \
  -e "s/API_KEYS=.*/API_KEYS=$GEN_KEY/" \
  -e "s/API_KEY=.*/API_KEY=$GEN_KEY/" \
  -e "s/ADMIN_PASSWORD=.*/ADMIN_PASSWORD=$GEN_ADMIN_PASS/" \
  -e "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$GEN_DB_PASS/" \
  -e "s/REDIS_PASSWORD=.*/REDIS_PASSWORD=$GEN_REDIS_PASS/" \
  -e "s/postgresql:\/\/waifu_user:[^@]*@/postgresql:\/\/waifu_user:$GEN_DB_PASS@/" \
  -e "s/redis:\/\/:[^@]*@/redis:\/\/:$GEN_REDIS_PASS@/" \
  "$EXAMPLE_ENV" > "$TARGET_ENV"

# Se URL e Chave foram informadas, configura o modo Satélite no arquivo gerado
if [ -n "$UPSTREAM_URL" ] && [ -n "$UPSTREAM_KEY" ]; then
  UPSTREAM_URL_CLEAN="${UPSTREAM_URL%/}"
  sed -i \
    -e "s|# UPSTREAM_API_URL=.*|UPSTREAM_API_URL=$UPSTREAM_URL_CLEAN|" \
    -e "s|# UPSTREAM_API_KEY=.*|UPSTREAM_API_KEY=$UPSTREAM_KEY|" \
    -e "s|# REMOTE_MEDIA_BASE_URL=.*|REMOTE_MEDIA_BASE_URL=$UPSTREAM_URL_CLEAN/api/v1/external/media|" \
    "$TARGET_ENV"
fi

chmod 600 "$TARGET_ENV"

echo "✅ Arquivo $TARGET_ENV gerado com sucesso!"
echo "---------------------------------------------------------"
echo "🔑 Chave de API Local do Bot (API_KEYS): $GEN_KEY"
echo "🛡️  Senha Administrativa Web (ADMIN_PASSWORD): $GEN_ADMIN_PASS"
if [ -n "$UPSTREAM_URL" ] && [ -n "$UPSTREAM_KEY" ]; then
  echo "🌐 Conectado ao Hub Remoto: $UPSTREAM_URL"
  echo "🚀 Modo Zero-Import & Zero-Disk Media ATIVADO!"
else
  echo "📦 Modo Standalone Local configurado (Hub remoto desativado)."
fi
echo "---------------------------------------------------------"
