# 🤖 Guia de Integração de Bots — Waifuletes API

> Documento técnico completo para desenvolvedores e agentes de IA implementarem a integração da API do Waifuletes com bots de WhatsApp (WhatsGo / Baileys / WPPConnect), Telegram e Discord.

---

## 📌 1. Visão Geral da Arquitetura de Integração

O **Waifuletes** opera como uma API REST de alta performance construída sobre Fastify. Os bots conectores são responsáveis pela camada de apresentação (receber mensagens dos usuários nas plataformas de chat, traduzir comandos para chamadas HTTP e formatar as respostas de volta no chat com imagens e emojis).

```
┌─────────────────┐             ┌─────────────────────┐             ┌──────────────────┐
│ Usuário no Chat │ ──(texto)─► │      Seu Bot        │ ──(HTTP)──► │  Waifuletes API  │
│ (WhatsApp/TG/DC)│ ◄─(imagem)─ │ (WhatsGo / Node.js) │ ◄─(JSON)─── │ (Fastify/Docker) │
└─────────────────┘             └─────────────────────┘             └──────────────────┘
```

### 🔑 Autenticação e Headers

Todas as requisições para rotas privadas (**Jogo, Harém, Usuários, Economia, Admin**) exigem o cabeçalho Bearer Token com a chave de API configurada:

```http
Authorization: Bearer <SUA_API_KEY>
Content-Type: application/json
```

- **Base URL Interna (Rede Local / Docker):** `http://localhost:3030` (ou o nome do serviço docker `http://waifuletes-api:3030`)
- **Base URL Pública (Mídias / Consultas externas):** `https://waifuletes.exemplo.com`

---

## ⚡ 2. Cadastro Automático (Zero Setup)

Você **não precisa** chamar endpoints de cadastro prévio de usuários ou grupos.
Ao enviar `userId` e `groupId` nas chamadas `/roll`, `/marry`, `/kakera/daily`, etc., o sistema cria ou atualiza automaticamente o registro no banco via upsert com cache no Redis.

> 💡 **Conversas Privadas (PV):**  
> Quando o usuário interagir no privado diretamente com o bot, defina `groupId` com o mesmo valor do `userId`. O sistema detectará automaticamente como um chat privado.

---

## 🗺️ 3. Tabela de Endpoints da API

### Rotas Públicas (Sem Autenticação Obrigatória)

> **Nota de Privacidade:** Chamadas anônimas nestas rotas protegem a privacidade dos jogadores (PII), omitindo IDs internos, telefones e JIDs. Chamadas autenticadas pelo bot recebem os metadados completos.

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/health` | Status de saúde do servidor (live/ready) |
| `GET` | `/docs` | Documentação interativa OpenAPI / Swagger |
| `GET` | `/media/characters/:slug/:file` | Servir arquivos de imagens das waifus |
| `GET` | `/characters` | Lista paginada de personagens com filtros |
| `GET` | `/characters/stats` | Estatísticas do banco e probabilidades de drop por categoria |
| `GET` | `/characters/:id` | Detalhes de um personagem específico |
| `GET` | `/leaderboard/characters` | Ranking dos personagens mais populares |
| `GET` | `/leaderboard/users` | Ranking de usuários por saldo de Kakera (anônimo oculta IDs) |

### Rotas Privadas (Exige Header `Authorization: Bearer <API_KEY>`)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/roll` | Executa um sorteio ponderado no grupo (suporta bônus) |
| `POST` | `/marry` | Realiza o casamento/claim de um personagem |
| `POST` | `/divorce` | Divorcia um personagem e resgata Kakera |
| `POST` | `/like` | Dá like/coração em um personagem |
| `GET` | `/user/:userId` | Perfil e contadores do jogador |
| `PATCH` | `/user/:userId/name` | Altera o nome de exibição do jogador |
| `GET` | `/user/:userId/cooldowns` | Consulta todos os cooldowns ativos |
| `GET` | `/user/:userId/groups` | Grupos que o jogador frequenta |
| `GET` | `/harem/:userId` | Lista todos os personagens do harém (suporta `sort=rarity`) |
| `PATCH` | `/harem/:userId/:id/favorite`| Define a waifu favorita em destaque |
| `PATCH` | `/harem/:userId/:id/note` | Adiciona nota pessoal ao personagem |
| `GET` | `/soulmates/:userId` | Lista todos os Soulmates (10+ keys) |
| `PATCH` | `/soulmates/:userId/:id` | Edita apelido ou nota de um Soulmate |
| `GET` | `/wishlist/:userId` | Lista de desejos do jogador |
| `POST` | `/wishlist` | Adiciona à wishlist (normal ou starwish) |
| `DELETE`| `/wishlist/:userId/:id` | Remove da lista de desejos |
| `GET` | `/kakera/:userId` | Consulta saldo de Kakera |
| `POST` | `/kakera/daily` | Resgata a recompensa diária de Kakera |
| `GET` | `/kakera/:userId/history` | Extrato histórico de transações |

---

## 🎮 4. Fluxos de Jogo Detalhados

### 🎲 Fluxo 1: Sorteio de Personagem (`/roll`)

Quando o usuário digitar `$roll`, `$waifu`, `$w` ou `$r`:

#### Chamada Básica (Usuário Padrão):
```http
POST /roll
Authorization: Bearer <SUA_API_KEY>
Content-Type: application/json

{
  "userId": "1234567890@s.whatsapp.net",
  "groupId": "120363000000000000@g.us",
  "name": "JogadorExemplo",
  "platform": "WHATSAPP",
  "gender": "FEMALE"
}
```

#### Resposta de Sucesso (HTTP 200):
```json
{
  "success": true,
  "data": {
    "character": {
      "id": "rem-rezero",
      "name": "Rem",
      "series": "Re:Zero kara Hajimeru Isekai Seikatsu",
      "description": "Uma das empregadas gêmeas que trabalham na mansão Roswaal.",
      "gender": "FEMALE",
      "rarity": "LEGENDARY",
      "imageUrl": "http://localhost:3030/media/characters/rem-rezero/default.jpg",
      "imageUrls": [
        "characters/rem-rezero/default.jpg",
        "characters/rem-rezero/image_1.jpg"
      ],
      "tags": ["maid", "demon", "short-hair"]
    },
    "available": true,
    "isWishlist": false,
    "isStarWish": false,
    "isOwner": false,
    "owner": null,
    "keyProgress": null,
    "kakeraValue": 350,
    "lockExpiresAt": "2026-10-03T15:05:00.000Z",
    "rollsRemaining": 9,
    "maxRolls": 10,
    "nextRollSeconds": 300
  }
}
```

#### Regras da Janela de Casamento (5 Minutos):
- O personagem sorteado fica disponível para casamento durante **5 minutos** (`lockExpiresAt`).
- Qualquer membro do grupo pode se casar com o personagem durante essa janela ativa.
- Caso o personagem já possua dono global (`available: false`), se o dono atual o sortear, ele recebe o valor de Kakera correspondente e adiciona progresso de chave (`keyProgress`).

---

### 💍 Fluxo 2: Casamento (`/marry`)

Quando qualquer jogador no grupo enviar uma reação ou digitar `$marry`, `$claim` ou `$casar`:

```http
POST /marry
Authorization: Bearer <SUA_API_KEY>
Content-Type: application/json

{
  "userId": "1234567890@s.whatsapp.net",
  "characterId": "rem-rezero",
  "groupId": "120363000000000000@g.us"
}
```

#### Resposta de Sucesso:
```json
{
  "success": true,
  "data": {
    "characterId": "rem-rezero",
    "characterName": "Rem",
    "characterSeries": "Re:Zero kara Hajimeru Isekai Seikatsu",
    "imageUrl": "http://localhost:3030/media/characters/rem-rezero/default.jpg",
    "nextClaimAt": "2026-10-03T18:00:00.000Z",
    "stolenFrom": null
  }
}
```

---

### 💔 Fluxo 3: Divórcio (`/divorce`)

Quando o jogador desejar divorciar um personagem de seu harém para receber Kakera:

```http
POST /divorce
Authorization: Bearer <SUA_API_KEY>
Content-Type: application/json

{
  "userId": "1234567890@s.whatsapp.net",
  "characterId": "rem-rezero"
}
```

#### Resposta de Sucesso:
```json
{
  "success": true,
  "data": {
    "kakeraEarned": 150,
    "newKakeraBalance": 520
  }
}
```

---

### 💎 Fluxo 4: Recompensa Diária (`/kakera/daily`)

```http
POST /kakera/daily
Authorization: Bearer <SUA_API_KEY>
Content-Type: application/json

{
  "userId": "1234567890@s.whatsapp.net"
}
```

#### Resposta de Sucesso:
```json
{
  "success": true,
  "data": {
    "reward": 200,
    "streak": 5,
    "streakBonus": 50,
    "totalReward": 250,
    "newBalance": 770,
    "nextDailyAt": "2026-10-04T12:00:00.000Z"
  }
}
```

---

## 🛡️ Tratamento de Erros e Códigos HTTP

A API do Waifuletes responde padronizada em caso de erro:

```json
{
  "success": false,
  "error": {
    "code": "COOLDOWN_ACTIVE",
    "message": "Você não possui rolls disponíveis (0/10)! Próximo roll em 5 min.",
    "remainingSeconds": 300,
    "retryAfter": "2026-10-03T15:05:00.000Z"
  }
}
```

### Principais Códigos de Erro:
| Código | HTTP Status | Causa |
|--------|-------------|-------|
| `UNAUTHORIZED` | 401 | Chave de API ausente ou inválida |
| `VALIDATION_ERROR` | 400 | Payload malformado ou campos com limites excedidos |
| `COOLDOWN_ACTIVE` | 400 | Jogador sem rolls ou claim em recarga |
| `CLAIM_EXPIRED` | 400 | A janela de 5 minutos para casar expirou |
| `CHARACTER_ALREADY_CLAIMED` | 400 | Outro jogador já se casou com o personagem |
| `NOT_FOUND` | 404 | Personagem ou usuário não encontrado |
| `NOT_OWNER` | 400 | Jogador tentou divorciar personagem que não possui |
| `INTERNAL_ERROR` | 500 | Erro interno não tratado no servidor |
