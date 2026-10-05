# Guia de Contribuição — Waifuletes

Agradecemos o seu interesse em contribuir com o **Waifuletes**! Este projeto é construído em código aberto para a comunidade.

---

## 🛠️ Ambiente de Desenvolvimento

### Pré-requisitos
- **Node.js**: v20.x ou superior (v22 LTS recomendado)
- **Docker e Docker Compose**
- **npm**: v10.x ou superior

### Passos de Instalação

1. Faça o fork e clone o repositório:
   ```bash
   git clone https://github.com/seu-usuario/waifuletes.git
   cd waifuletes
   ```

2. Crie seu arquivo de ambiente:
   ```bash
   ./scripts/gen-env.sh
   ```

3. Inicie os serviços de infraestrutura (PostgreSQL e Redis):
   ```bash
   docker compose up -d postgres redis
   ```

4. Instale as dependências da API e execute as migrations:
   ```bash
   cd api
   npm install
   npx prisma migrate dev
   npm run dev
   ```

---

## 🧪 Padrões de Testes e Validação

Antes de enviar qualquer alteração, certifique-se de que os testes e a compilação passem sem erros:

```bash
cd api
npm run build
npm test
```

### Regras Estritas de Implementação
- **Concorrência:** Toda operação com impacto em cooldowns, saldo financeiro ou integridade de posse deve ser executada de maneira atômica (Redis Lua ou transações no banco).
- **Proteção de PII:** Endpoints públicos nunca devem expor identificadores internos, JIDs de WhatsApp ou números de telefone para chamadas sem autenticação de bot.
- **Tipagem Estrita:** Evite o uso de `any` no TypeScript. Tipos de domínio e schemas de validação Fastify devem estar estritamente alinhados.

---

## 📝 Convenções de Commits

Utilizamos o padrão **Conventional Commits** com mensagens em português ou inglês:

- `feat:` Nova funcionalidade
- `fix:` Correção de bug
- `perf:` Melhoria de performance ou latência
- `refactor:` Refatoração sem mudança de comportamento
- `test:` Adição ou correção de testes
- `docs:` Alterações em documentação
- `chore:` Tarefas de manutenção ou dependências

**Exemplos:**
- `feat: adicionar ordenação por raridade no endpoint de harém`
- `fix: evitar duplicidade em upsert concorrente de usuário`
- `perf: aplicar cache no pool de sorteio em memória`

---

## 🤖 Desenvolvimento Assistido por IA

Se você utiliza agentes de inteligência artificial (Claude, ChatGPT, Gemini, Copilot, Cursor, etc.):
- Consulte o arquivo [GEMINI.md](GEMINI.md) para diretrizes arquiteturais completas e regras do repositório.
- Certifique-se de que nenhum segredo, chave privada ou dados pessoais reais sejam incluídos em prompts ou commits.
