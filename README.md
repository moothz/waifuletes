# 🌸 Waifuletes API

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-4.x-000000?style=for-the-badge&logo=fastify&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**API RESTful de alta performance para jogos de Gacha, Harém e Coleção de Personagens em Bots de Mensagens.**  
Construída com Fastify, PostgreSQL, Redis e Prisma para oferecer respostas com p95 < 60ms e concorrência estrita à prova de race conditions.

[Visão Geral](#-visão-geral) •
[Início Rápido](#-início-rápido) •
[Arquitetura](#-arquitetura-e-funcionalidades) •
[Endpoints](#-tabela-de-endpoints) •
[Documentação](#-documentação) •
[Avisos Legais](#-avisos-legais-e-isenção-de-responsabilidade)

</div>

---

## 📖 Visão Geral

O **Waifuletes** é um motor de jogo de coleção e sorteio de personagens de animes, jogos e cultura pop, projetado para alimentar bots de chat (WhatsApp, Discord, Telegram) e painéis web de forma desacoplada e escalável.

### Principais Destaques:
- ⚡ **Latência Ultrabaixa:** Mecanismo de sorteio com pool de personagens ativos pré-carregado em memória (sorteios em < 10ms, p95 < 60ms).
- 🔒 **Concorrência Atômica:** Controle de recarga e consumo de rolls executado diretamente via scripts Lua no Redis, evitando saldo negativo sob qualquer concorrência.
- 💍 **Casamento Competitivo:** Janela de casamento (*claim window*) de 5 minutos não-exclusiva — qualquer participante do grupo pode se casar com o personagem sorteado.
- 👑 **Dono Global Único:** Garantia de unicidade global de posse por personagem via banco de dados (`@@unique([characterId])`).
- 🛡️ **Proteção Nativa de Privacidade (PII):** Rotas públicas ocultam identificadores internos, telefones e JIDs dos jogadores para visitantes anônimos, fornecendo metadados apenas para requisições autenticadas de bots.
- 🔍 **Buscas em Tempo Recorde:** Índices GIN Trigram no PostgreSQL (`pg_trgm`) para busca textual instantânea por nome, série e apelidos.
- 🐳 **Docker-First:** Deploy simples e padronizado com Docker Compose incluindo healthchecks e migrations automatizadas.

---

## 🚀 Início Rápido (3 Comandos)

Pré-requisitos: [Docker](https://www.docker.com/) e [Docker Compose](https://docs.docker.com/compose/) instalados.

```bash
# 1. Clonar o repositório
git clone https://github.com/moothz/waifuletes.git && cd waifuletes

# 2. Gerar credenciais criptográficas seguras no arquivo .env
./scripts/gen-env.sh

# 3. Subir toda a stack em segundo plano
docker compose up -d
```

A API estará disponível imediatamente em `http://localhost:3030`.  
Para verificar a saúde do serviço:
```bash
curl http://localhost:3030/health
```

---

## 🏗️ Arquitetura e Funcionalidades

```
┌─────────────────────────────────┐
│        Bots e Aplicações        │ (WhatsApp / Discord / Telegram / Web)
└────────────────┬────────────────┘
                 │ HTTP (Bearer Token)
                 ▼
┌─────────────────────────────────┐
│        Fastify 4.x Server       │ • Helmet Security & Rate Limiting
│                                 │ • Timing-Safe API Key Verification
│                                 │ • Privacy Guard (PII Protection)
└────────┬───────────────┬────────┘
         │               │
         ▼               ▼
┌────────────────┐ ┌────────────────┐
│   Redis 7.x    │ │ PostgreSQL 16  │
│ ────────────── │ │ ────────────── │
│ • Roll Lua     │ │ • Prisma ORM   │
│ • Claim Locks  │ │ • GIN Trigram  │
│ • Fast Cache   │ │ • Check Kakera │
└────────────────┘ └────────────────┘
```

Para mais detalhes sobre as decisões arquiteturais e fluxos de dados, consulte [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 🗺️ Tabela de Endpoints

### Rotas Públicas (Proteção de PII Ativa)
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/health` | Verificação de integridade geral |
| `GET` | `/health/live` | Liveness probe do processo Fastify |
| `GET` | `/health/ready` | Readiness probe com checagem de PostgreSQL e Redis |
| `GET` | `/characters` | Listagem paginada e filtros de personagens |
| `GET` | `/characters/stats` | Estatísticas gerais do catálogo e probabilidades |
| `GET` | `/characters/:id` | Detalhes de um personagem específico |
| `GET` | `/leaderboard/users` | Ranking de jogadores mais ricos (IDs ocultos para anônimos) |
| `GET` | `/leaderboard/characters` | Ranking dos personagens mais populares |
| `GET` | `/media/characters/*` | Entrega de imagens dos cards locais |

### Rotas Privadas do Jogo (Exige `Authorization: Bearer <API_KEY>`)
| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/roll` | Executa sorteio ponderado com janela de casamento de 5 minutos |
| `POST` | `/marry` | Realiza casamento com o personagem ativo |
| `POST` | `/divorce` | Divorcia personagem em troca de Kakera |
| `POST` | `/like` | Adiciona coração a um personagem |
| `GET` | `/harem/:userId` | Consulta harém do jogador (suporta `sort=rarity`) |
| `PATCH` | `/harem/:userId/:id/favorite` | Define a waifu em destaque no perfil |
| `POST` | `/kakera/daily` | Resgata a recompensa diária de moeda |
| `GET` | `/user/:userId` | Perfil e contadores do jogador |
| `GET` | `/wishlist/:userId` | Lista de desejos e StarWish |

---

## 📚 Documentação

- 🤖 **[Guia de Integração de Bots](docs/BOT_INTEGRATION.md):** Exemplos práticos em Node.js/WhatsGo para integração com comandos `$roll`, `$marry`, `$harem`, `$daily`.
- 📥 **[Guia de Importação de Catálogo](docs/IMPORTACAO_MUDAE.md):** Como importar dados oficiais e baixar fotos de personagens.
- 🏛️ **[Arquitetura do Sistema](docs/ARCHITECTURE.md):** Detalhes sobre modelagem de concorrência, caching e banco de dados.
- 🤝 **[Guia de Contribuição](CONTRIBUTING.md):** Padrões de código, Conventional Commits e fluxo de desenvolvimento.
- 🛡️ **[Política de Segurança](SECURITY.md):** Como relatar vulnerabilidades de forma responsável.

---

## 🧪 Testes e Benchmark

Para executar a suíte de testes de concorrência e integridade:

```bash
cd api
npm install
npm test
```

Para executar o benchmark de latência e concorrência:
```bash
npx tsx scripts/bench.ts
```

---

## ⚖️ Avisos Legais e Isenção de Responsabilidade

1. **Direitos Autorais e Propriedade Intelectual:**  
   O Waifuletes é um projeto de código aberto desenvolvido com propósitos educacionais, de pesquisa e de entretenimento não-comercial. Todos os personagens, nomes, séries, obras originais e marcas registradas citados pertencem exclusivamente aos seus respectivos autores, ilustradores, produtoras e detentores de direitos autorais.

2. **Isenção sobre Conteúdo de Terceiros:**  
   Este repositório **não contém**, **não armazena** e **não distribui** pacotes de imagens protegidas por direitos autorais ou dados proprietários. Os scripts fornecidos em `scripts/` servem apenas como utilitários de consulta a APIs públicas e diretórios externos sob responsabilidade do usuário que os executa.

---

## 📄 Licença

Este projeto é licenciado sob os termos da licença **MIT**. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.
