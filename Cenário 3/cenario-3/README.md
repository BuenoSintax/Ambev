
---

# Market Pulse API — Cenário 3

API NestJS para consulta de artigos de notícias (leitura) com MongoDB, validação, logs estruturados e documentação Swagger.

> **Visão simples (não técnica):**
> Esta API é a “porta de entrada” para analistas e aplicações internas verem as notícias que já foram coletadas e normalizadas pelo pipeline do Cenário 2. Ela lista os artigos mais recentes, permite buscar por palavra-chave e obter o detalhe de um artigo específico — com rapidez, segurança e alta disponibilidade.

---

## Sumário

* [Arquitetura (visão geral)](#arquitetura-visão-geral)
* [Fluxo de dados](#fluxo-de-dados)
* [Contrato da API](#contrato-da-api)

  * [Listar artigos mais recentes](#1-listar-artigos-mais-recentes)
  * [Buscar por palavra-chave](#2-buscar-por-palavra-chave)
  * [Obter detalhes por ID](#3-obter-detalhes-por-id)
  * [Modelo de paginação e erros](#modelo-de-paginação-e-erros)
* [Padrões e estruturas (resiliência e eficiência)](#padrões-e-estruturas-resiliência-e-eficiência)
* [Estratégias de escalabilidade](#estratégias-de-escalabilidade)
* [Segurança (proteção, autenticação e autorização)](#segurança-proteção-autenticação-e-autorização)
* [Manutenibilidade](#manutenibilidade)
* [Índices e coleções](#índices-e-coleções)
* [Orquestração da ingestão (seed)](#orquestração-da-ingestão-seed)
* [Ambiente local (como rodar)](#ambiente-local-como-rodar)
* [Variáveis de ambiente](#variáveis-de-ambiente)

---

## Arquitetura

![Arquitetura – leitura no Cenário 3](../../assets/Ambev2.png)

**Overview**

* **Clientes** (analistas e apps) → chamam a **API**.
* A API lê do **MongoDB** (dados já materializados pelo Cenário 2).
* Há **validação**, **documentação Swagger**, **logs** e (**opcional**) **cache**.
* **Segurança**: SSO/JWT/API-Key, CORS restrito e proteção de borda via gateway.

**Resumo técnico**

* NestJS (Express) stateless; DTOs com `class-validator/transformer`.
* Pool de conexões Mongoose; índices para `latest` e `search`.
* Suporte a cache curto (Redis) para endpoints quentes.
* Observabilidade: logs estruturados (Pino), health/readiness, métricas.

---

## Fluxo de dados



1. **Seed/ETL (Cenário 2)** coleta/normaliza e grava na coleção `articles`.
2. **API** expõe leitura:

   * **/latest**: ordenado por data (`publishedAtUtc` desc).
   * **/search**: índice textual (`title`, `description`, `content`).
   * **/articles/{id}**: busca por `_id` ou `articleId/contentHash`.



![Endpoints](../../assets/endpoints.png)

---

## Contrato da API

**Base:** `http://localhost:3000` (ou porta configurada).
**Swagger UI:** `http://localhost:3000/docs`.

### 1) Listar artigos mais recentes

![Latest_articles](../../assets/latest_articles.png)

**GET** `/api/v1/articles/latest`

**Query params**

* `page` (number, default 1, min 1)
* `pageSize` (number, default 20, max 100)
* `sourceId` (string, opcional)
* `from`, `to` (ISO date, opcionais)
* `lang` (string, opcional; ex.: `en`, `pt`)

**Resposta 200 (ex.)**

```json
{
  "page": 1,
  "pageSize": 10,
  "total": 54,
  "items": [
    {
      "_id": "68e21b8e0491af5993236082",
      "articleId": "f16c0e...",
      "sourceId": "newsapi-top",
      "sourceName": "NewsAPI Top Headlines",
      "title": "Embattled WNBA commish...",
      "publishedAtUtc": "2025-10-04T05:33:00.000Z",
      "url": "https://www.washingtonpost.com/...",
      "urlToImage": "https://www.washingtonpost.com/...",
      "description": "The WNBA commissioner...",
      "language": "en"
    }
  ]
}
```

### 2) Buscar por palavra-chave

**GET** `/api/v1/articles/search`

**Query params**

* `q` (string, **obrigatório**; busca em `title/description/content`)
* `page`, `pageSize` (paginação)
* `sourceId`, `from`, `to`, `lang` (opcionais)

**Resposta 200 (ex.)**

```json
{
  "page": 1,
  "pageSize": 10,
  "total": 312,
  "items": [
    { "_id": "68e21...", "title": "Google reportedly testing...", "publishedAtUtc": "2025-10-03T21:58:00Z", "url": "http://9to5google.com/...", "sourceId": "newsapi-technology" }
  ]
}
```

### 3) Obter detalhes por ID

**GET** `/api/v1/articles/{id}`

* `id` aceita o `_id` do Mongo (string hexadecimal) **ou** `articleId/contentHash` se o serviço estiver implementado para ambos.

![Article by id](../../assets/article_byID.png)

**Resposta 200 (ex.)**

```json
{
  "_id": "68e21b8e0491af5993236082",
  "articleId": "f16c0efc...",
  "sourceId": "newsapi-top",
  "sourceName": "NewsAPI Top Headlines",
  "title": "Embattled WNBA commish...",
  "publishedAtUtc": "2025-10-04T05:33:00.000Z",
  "url": "https://www.washingtonpost.com/...",
  "urlToImage": "https://www.washingtonpost.com/...",
  "description": "The WNBA commissioner...",
  "content": "WNBABefore Game 1...",
  "raw": { "...": "payload original normalizado" }
}
```

### Modelo de paginação e erros


**Paginação (todas as listas):**

```json
{ "page": 1, "pageSize": 10, "total": 54, "items": [ ... ] }
```

**Erros (exemplos):**

```json
// 400 - validação
{ "error": "Bad Request", "message": "pageSize must not be greater than 100" }

// 401 - auth faltando/inválida (em rotas protegidas)
{ "error": "Unauthorized", "message": "Invalid token" }

// 404 - não encontrado
{ "error": "Not Found", "message": "Article not found" }
```

---

## Padrões e estruturas (resiliência e eficiência)

* **Stateless**: a API não mantém sessão em memória; fácil escalar horizontalmente.
* **Validação**: `ValidationPipe` com DTOs (entrada consistente, menos 500).
* **Mongoose pool**: conexões reutilizadas, latência menor em picos.
* **Índices corretos**: chaves para `/latest` (data) e `/search` (texto) → respostas rápidas.
* **Projeção**: retornamos só campos úteis (menos bytes na rede).
* **Observabilidade**: logs estruturados (Pino) com `requestId`, health/readiness, métricas (p95/p99).
* **Backpressure de API**: limites de `pageSize`, timeouts e rate-limit na borda.

---

## Estratégias de escalabilidade

* **Horizontais (API)**: múltiplas réplicas atrás de **load balancer** (NGINX/API Gateway/ALB).
* **Base de dados**: **MongoDB Replica Set** — leitura em secundários via `readPreference=secondaryPreferred` nas rotas GET quentes.
* **Cache**: **Redis** opcional para `/latest` e consultas recorrentes (TTL curto 30–60s).
* **Query budget**: paginação obrigatória com limite máximo (ex.: `pageSize ≤ 100`) e **projeção**.
* **Compressão**: gzip/br no edge.
* **Sharding (evolutivo)**: se necessário, shard por `_ingestDate` ou `sourceId`.

---

## Segurança (proteção, autenticação e autorização)

* **Borda/Edge**: TLS, **WAF**, rate-limit, CORS restrito e **Helmet**.
* **Autenticação**:

  * **SSO corporativo (OIDC/JWT)**: valida issuer/audience/expirations; roles no token.
  * **API Key** para **endpoints administrativos** (ex.: `/api/admin/sources/upsert-many`).
* **Autorização**: RBAC por **scopes/roles** (ex.: `read:articles`, `admin:sources`).
* **Banco**: usuário de app com **privilégios mínimos** (read-only para leitura em produção).
* **Segredos**: gerenciados por cofre (Vault/Secrets Manager), nunca commitados.

---

## Manutenibilidade

* **Modularidade Nest**: `articles/`, `sources/`, `common/`, `config/`, `database/`.
* **DTOs e serviços** isolam regras de negócio.
* **Swagger** sempre atualizado com decorators.
* **Scripts** de seed/migração/índices padronizados.
* **Testes smoke** para ingestão e rotas críticas.
* **Logs e métricas** facilitam troubleshooting e capacity planning.

---

## Índices e coleções

**Coleção `articles`**

* `contentHash` **unique** (idempotência)
* `publishedAtUtc` (desc) → `/latest`
* Índice **text**: `title`, `description`, `content` → `/search`
* (Opcional) `{ sourceId: 1, publishedAtUtc: -1 }`

**Coleção `sources`**

* `id` **unique**
* `active` (bool)
* `tags` (array)
* Campos: `apiEndpoint`, `name`, `description`, `timeoutMs`, `rateLimitPerMin`, `headers`, `lastFetchedAt`.

---

## Orquestração da ingestão (seed)

> **O que é:** o *seed* é o processo que **coleta e normaliza** artigos das fontes (a partir da collection `sources`) e grava na coleção `articles`.
> **Onde roda:** pode ser executado **on-demand** (via script CLI) ou **recorrentemente** (agendado) para manter os dados atualizados.

**Modos de execução**

* **On-demand**: usado para popular rapidamente ambientes (ex.: local, CI) ou reprocessar uma fonte específica.
* **Agendado**: execução periódica contínua (ex.: a cada 10–15 min) com janelas curtas para “near real-time”.

**Garantias e controles**

* **Idempotência por conteúdo**: cálculo de `contentHash` (ex.: `sourceId|url|publishedAt|title`) e *upsert* por hash → sem duplicados lógicos.
* **Normalização de payload**: padronização dos campos (`title`, `description`, `content`, `publishedAtUtc`, `language`, `sourceId/name`, `raw`) para o esquema unificado.
* **Politeness/rate-limit**: limites por fonte (RPS/RPM) e concorrência global para evitar bloqueios dos provedores.
* **Retries com backoff**: re-tentativas com atraso progressivo para erros transitórios; falhas permanentes viram eventos de alerta.
* **Cache HTTP condicional**: aproveitamento de `If-None-Match`/`If-Modified-Since` quando a fonte suporta (economia de tráfego).
* **Particionamento lógico**: `_ingestDate` diário em todos os documentos para filtros, SLAs e limpeza.
* **Observabilidade**: logs estruturados por fonte (status HTTP, duração, itens buscados, inseridos/atualizados/ignorados/falhos), métricas de latência (p95/p99) e alarmes para falhas repetidas.
* **Segurança**: leitura de segredos via ambiente (URI do Mongo, chaves/headers de fontes quando existirem); endpoints administrativos protegidos por API Key e RBAC.

**Opções de agendamento suportadas**

* **Processo interno com cron** (simples).
* **Fila distribuída (ex.: BullMQ/Redis)** com *scheduler*+*workers* (recomendado para escala, DLQ e visibilidade).
* **Kubernetes CronJob** (cada execução dispara um Pod com o seed).
* **Airflow** (DAG de controle para governança, *backfills* e dependências).

**SLA sugerido**

* Frequência a cada **15 min** para “near real-time”.
* Latência p95 por fonte: coleta+parse < **3s**; persistência < **200ms/lote**.
* 3 tentativas com backoff; alertar após falhas repetidas.

---

## Ambiente local (como rodar)

```bash
# 0) Dependências
npm install

# 1) Subir Mongo
docker run -d --name mongo -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=root \
  -e MONGO_INITDB_ROOT_PASSWORD=pass \
  -e MONGO_INITDB_DATABASE=market_pulse \
  -v mongo_data:/data/db \
  --health-cmd='mongosh --quiet --eval "db.adminCommand({ ping: 1 })" || exit 1' \
  --health-interval=10s --health-timeout=5s --health-retries=5 \
  mongo:6

# 2) Configurar .env
cp .env.example .env
# edite MONGODB_URI/PORT/SEED_MAX_PER_SOURCE/SEED_API_KEY se necessário

# 3) Popular fontes/artigos
npm run seed        # ou npm run seed:dry para simular

# 4) Subir API
npm run start:dev

# Swagger
open http://localhost:3000/docs
```

**Swagger – exemplos reais**

* Listar fontes (`GET /api/v1/sources`)
![Swagger – sources](../../assets/endpoints.png)

* Upsert de fontes admin (`POST /api/admin/sources/upsert-many`)
  ![Swagger – admin upsert](../../assets/upsert_many.png)
  ![Swagger – admin sources](../../assets/sources.png)


---

## Variáveis de ambiente

```env
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://root:pass@localhost:27017/market_pulse?authSource=admin
REQUEST_TIMEOUT_MS=10000
SEED_MAX_PER_SOURCE=200
SEED_API_KEY=dev-key-change-me
```

---

### Nota final

* **Resiliência:** API stateless, índices corretos, pool de conexões, healthz, logs e rate-limit.
* **Escalabilidade:** réplicas da API + leitura em secundários do Mongo + cache Redis.
* **Segurança:** SSO/JWT/Scopes, API-Key para admin, princípio do menor privilégio no DB.
* **Evolução:** fácil trocar adaptador (Express ↔ Fastify), plugar Redis/OTel, ou migrar a busca para Atlas Search/OpenSearch mantendo o mesmo contrato HTTP.
