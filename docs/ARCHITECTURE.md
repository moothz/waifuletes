# 🏛️ Arquitetura do Sistema — Waifuletes

Este documento fornece uma visão técnica aprofundada da arquitetura, fluxo de dados, modelo de concorrência e decisões de design do **Waifuletes**.

---

## 📐 Visão Geral da Arquitetura

O Waifuletes é uma API backend desenvolvida em Node.js e TypeScript com foco em baixíssima latência (p95 < 60ms para sorteios), alta tolerância a concorrência e integridade transacional rigorosa.

```
                      ┌────────────────────────────┐
                      │    Clientes / Bots         │
                      │  (WhatsGo, Telegram, Web)  │
                      └─────────────┬──────────────┘
                                    │ HTTP / REST
                                    ▼
                      ┌────────────────────────────┐
                      │       Fastify 4.x          │
                      │ ┌────────────────────────┐ │
                      │ │ Helmet + Rate Limiter  │ │
                      │ ├────────────────────────┤ │
                      │ │ Auth Plugin (Timing-   │ │
                      │ │ safe Bearer / PII Gate)│ │
                      │ ├────────────────────────┤ │
                      │ │ Global Error Handler   │ │
                      │ └────────────────────────┘ │
                      └───────┬────────────┬───────┘
                              │            │
            ┌─────────────────┘            └─────────────────┐
            ▼                                                ▼
  ┌──────────────────┐                             ┌──────────────────┐
  │   Redis 7.x      │                             │  PostgreSQL 16   │
  │ ──────────────── │                             │ ──────────────── │
  │ • Roll atomic Lua│                             │ • Prisma ORM     │
  │ • Claim locks    │                             │ • GIN Trigram Idx│
  │ • Seen user/group│                             │ • Kakera >= 0    │
  │ • Fast cache     │                             │ • Unique Harem   │
  └──────────────────┘                             └──────────────────┘
```

---

## 🧩 Camadas e Responsabilidades

1. **Fastify Framework:** Roteamento de alto desempenho, serialização JSON ultrarrápida via schemas e validação estrita com `Ajv`.
2. **Plugins de Segurança:**
   - `@fastify/helmet`: Headers de segurança HTTP (`CSP`, `X-Content-Type-Options`, `HSTS`).
   - `@fastify/rate-limit`: Proteção contra abusos de requisições anônimas.
   - `auth.ts`: Autenticação via `timingSafeEqual` para múltiplos tokens e gateway de privacidade (oculta PII de usuários em rotas públicas).
3. **Serviços de Domínio:**
   - `RollService`: Mecanismo de sorteio com pool de personagens ativos pré-carregado em memória e amostragem ponderada em duas fases O(1).
   - `CooldownService`: Controle de recarga de rolls via script Lua atômico no Redis com débito prévio e estorno em caso de falha.
   - `MarryService`: Gestão do casamento com trava não-exclusiva no Redis e garantia de dono global único no banco.
   - `KakeraService`: Economia transacional e concessão de bônus diários.
   - `HaremService`: Gestão do catálogo pessoal, favoritos e soulmates.
   - `UserService`: Upserts otimizados com cache no Redis para mitigar contenção de conexões no PostgreSQL.

---

## 🔒 Mecanismos de Concorrência e Integridade

### 1. Consumo Atômico de Rolls (Redis Lua)
Para eliminar race conditions em rajadas simultâneas de sorteio pelo mesmo jogador, o consumo de rolls é executado diretamente dentro do Redis através de um script Lua atômico. A verificação do saldo atual e a dedução ocorrem em um único ciclo do event loop do Redis, impedindo saldo negativo mesmo em centenas de requisições por segundo.

### 2. Janela de Casamento Não-Exclusiva (5 minutos)
Ao realizar um `/roll`, uma trava de sorteio (`claim:lock:<characterId>`) com TTL de 300 segundos é registrada no Redis. Qualquer usuário participante do grupo onde o roll foi realizado pode propor o casamento durante este período.

### 3. Unicidade Global de Dono (`@@unique([characterId])`)
No banco de dados relacional, a tabela `harem_entries` possui uma constraint de unicidade no campo `characterId`. Isso impede categoricamente que dois jogadores sejam donos simultâneos da mesma waifu. Casos de corrida entre comandos de casamento paralelos são resolvidos no nível do banco e tratados elegantemente na API via código `CHARACTER_ALREADY_CLAIMED`.

### 4. Integridade da Moeda (Kakera)
O saldo de Kakera é protegido por duas barreiras:
- Validação atômica no Prisma: `{ kakera: { gte: -amount } }`.
- Restrição formal no PostgreSQL: `CHECK (kakera >= 0)`.

---

## ⚡ Estratégias de Otimização de Performance

- **Pool de Sorteio em Memória:** Os personagens comuns ativos são mantidos na RAM da API. Isso reduz a latência da query de sorteio de centenas de milissegundos para menos de 10ms.
- **Índices GIN Trigram:** O PostgreSQL utiliza a extensão `pg_trgm` com índices GIN nas colunas `name`, `series` e `id`, permitindo buscas textuais parciais em menos de 8ms em bases com dezenas de milhares de registros.
- **Cache de Upsert de Usuários:** Interações repetidas de usuários no mesmo grupo são cacheadas no Redis (`seen:<userId>:<groupId>`), evitando centenas de queries redundantes de `upsert` no banco relacional.
