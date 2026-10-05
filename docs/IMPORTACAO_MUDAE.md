# 📥 Guia de Importação de Personagens e Download de Imagens

> Este documento detalha como importar personagens oficiais e seus rankings a partir do Mudae e baixar as imagens locais para o Waifuletes.

---

## 📌 Visão Geral do Catálogo

O cadastro de personagens no Waifuletes é **idempotente**, **consolidado por slug** (ex.: `rem-rezero`, `zero-two`, `mikasa-ackerman`) e sincronizado com o banco de dados PostgreSQL.

As ferramentas públicas mantidas no repositório são:
1. **`scripts/importFromMudae.js`**: Importador oficial que conecta-se ao diretório de personagens do Mudae, capturando ranking canônico, fotos de alta qualidade, séries oficiais e apelidos (aliases).
2. **`scripts/downloadCharacterImages.js`**: Baixador paralelo de imagens locais para o disco (`media/characters/<slug>/default.*`), com suporte a múltiplos workers e auto-resume.

---

## ⭐ 1. Importação Oficial do Mudae (`importFromMudae.js`)

O script busca dados diretamente do Mudae, integrando o ranking canônico, fotos originais e apelidos para a base do Waifuletes.

### Regras de Funcionamento:
- **Normalização Inteligente:** Normaliza o nome do personagem e da série para evitar duplicações.
- **Raridade Canônica:** Atribui as categorias de raridade (`LEGENDARY`, `EPIC`, `RARE`, `UNCOMMON`, `COMMON`) de acordo com o ranking global de popularidade.
- **Sincronização Direta no PostgreSQL (`--sync-db`):** Atualiza imediatamente os registros existentes ou insere novos no banco de dados.

### Exemplos de Execução:

```bash
# 1. Configurar variáveis de ambiente necessárias
export DATABASE_URL="postgresql://waifu_user:sua_senha@localhost:5433/waifuletes_db?schema=public"

# 2. Importar o Top 500 personagens femininos (Waifus) apenas gerando manifest JSON
node scripts/importFromMudae.js 500 true all

# 3. Importar Top 2.000 Waifus sincronizando direto com o PostgreSQL
node scripts/importFromMudae.js 2000 true all --sync-db

# 4. Importar especificamente Top Personagens de Jogos e Gachas
node scripts/importFromMudae.js 1000 true games --sync-db

# 5. Importar todos os gêneros (Waifus e Husbandos)
node scripts/importFromMudae.js 3000 false all --sync-db
```

---

## 🖼️ 2. Download Local de Imagens (`downloadCharacterImages.js`)

O script lê o arquivo manifest (`media/manifests/characters.json`) e realiza o download das imagens remotas diretamente para o diretório local `media/characters/<slug>/default.<ext>`.

### Recursos Principais:
- **Detecção de Imagens Existentes:** Pula automaticamente imagens que já foram baixadas e possuem tamanho válido no disco.
- **Concorrência Otimizada:** Baixa múltiplas imagens simultaneamente utilizando um pool configurável de conexões.
- **Persistência de Progresso:** Salva o progresso no disco periodicamente e em caso de interrupção com `Ctrl+C`.
- **Sincronização com o Banco (`--sync-db`):** Registra o caminho local da imagem no PostgreSQL, permitindo que a API do Waifuletes sirva as imagens via endpoint HTTP `/media/*`.

### Como Executar:

```bash
# Download de todas as imagens pendentes com concorrência padrão (6 workers)
node scripts/downloadCharacterImages.js

# Download com maior concorrência e sincronização direta no banco
export DATABASE_URL="postgresql://waifu_user:sua_senha@localhost:5433/waifuletes_db?schema=public"
node scripts/downloadCharacterImages.js --concurrency 10 --sync-db
```
