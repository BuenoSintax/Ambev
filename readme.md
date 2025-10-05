# Market Pulse — README do Projeto (Cenários 2, 3 e 4)

> **Propósito**
> Este repositório documenta uma proposta técnica para a plataforma **Market Pulse**, que monitora e analisa tendências de mercado a partir de notícias on-line. A entrega foca **planejamento, arquitetura e comunicação técnica** — **não** é uma implementação completa de produção.
> Cada **Cenário** abaixo corresponde aos itens do desafio: ingestão (Cenário 2), API de acesso (Cenário 3) e boletim de IA (Cenário 4).

---

## Índice

* [Contexto e Objetivo](#contexto-e-objetivo)
* [Estrutura de Pastas](#estrutura-de-pastas)
* [Cenário 2 — Ingestão, Orquestração e Armazenamento](#cenário-2--ingestão-orquestração-e-armazenamento)
* [Cenário 3 — API de Consulta para Analistas](#cenário-3--api-de-consulta-para-analistas)
* [Cenário 4 — Boletim Diário com IA](#cenário-4--boletim-diário-com-ia)
* [Evidências da Solução](#evidências-da-solução)
* [Como Avaliar a Proposta](#como-avaliar-a-proposta)
* [Autor](#autor)

---

## Contexto e Objetivo

**Problema**: Uma empresa de análise precisa de uma plataforma interna (**Market Pulse**) para **coletar, processar e analisar** milhares de notícias diariamente, apontando **tópicos relevantes** e **resumos diários** para o negócio.

**Objetivo do desafio**: Propor um **plano detalhado de arquitetura** cobrindo:

1. ingestão robusta e analítica (Cenário 2),
2. API de acesso rápido e seguro (Cenário 3),
3. geração de um **Boletim Diário de Inteligência** com IA (Cenário 4).

**Formato**: Esta proposta está organizada em pastas com diagramas, README’s e especificações, permitindo comunicar claramente **como** e **por que** as decisões técnicas foram tomadas.

---

## Estrutura de Pastas

```
/
├─ Cenário 2/                         # Pipeline de ingestão & dados analíticos
│  ├─ README.md                       # Arquitetura, orquestração e camadas de dados
│  
│
├─ Cenário 3/                         # API NestJS para consulta
│  ├─ cenario-3/                      # Projeto Nest (código de exemplo)
│    ├─ README.md                    # Como rodar, endpoints, contratos, segurança
│    └─ src/...                      # Módulos (articles, sources, seed, schemas)
│  
│
├─ Cenário 4/                         # Boletim Diário com IA (design/orquestração)
│  ├─ README.md                       # Arquitetura baseada em agentes (LangGraph-like)
│  
│  
│
└─ README.md                          # (este arquivo) visão macro dos três cenários
```

---

## Cenário 2 — Ingestão, Orquestração e Armazenamento

**O que é**
O **backbone** de dados do Market Pulse. Garante ingestão contínua e confiável de artigos, padroniza e **materializa** para uso analítico e operacional.

**Arquitetura proposta (resumo)**

* **Coleta e Orquestração**

  * **NestJS Ingestion Service** lê uma lista de fontes (recebida/armazenada) e publica mensagens em **Kafka**.
  * **Agendamento**: Cron (K8s CronJob), **BullMQ/Redis** (fila + DLQ) ou **Airflow** (governança e backfill).
  * **Politeness/rate-limit** por fonte, **retry/backoff** e **idempotência** via `contentHash`.

* **Streaming & Lakehouse**

  * **Kafka → Databricks Structured Streaming**: ingestão em **Bronze** (raw), **Silver** (limpeza/unificação de schema), **Gold** (vistas analíticas).
  * **S3/Delta/Unity Catalog** para versionamento, *time-travel* e governança.

* **Unificação de Esquema**

  * Campos canônicos: `sourceId`, `title`, `description`, `content`, `publishedAtUtc`, `language`, `url`, `raw`, `_ingestDate`.
  * Dedupe por `contentHash = sha256(sourceId|url|publishedAt|title)`.

* **Armazenamento e Consulta**

  * Dados **analíticos** em Delta (Gold) e **operacionais** indexados (OpenSearch/Atlas Search) para pesquisa textual.
  * **MongoDB** pode armazenar amostras/materializações para a API (Cenário 3).

* **Observabilidade & SLAs**

  * Logs estruturados, métricas (p95/p99), monitoria de DLQ, **SLA** de latência de ingestão “near real-time” (ex.: a cada 10–15 min).

**O que este cenário responde no desafio**

* **Orquestração e Agendamento**: como rodar periodicamente, com resiliência e controle.
* **Processamento e Unificação**: padronização, dedupe e camadas Bronze/Silver/Gold.
* **Armazenamento**: escolha de Lakehouse/Index para consultas analíticas e operacionais.
* **Diagrama**: fluxo do coletor → Kafka → Databricks → S3/Delta → Catálogo → Índices.

---

## Cenário 3 — API de Consulta para Analistas

**O que é**
Uma **API NestJS** que expõe leitura rápida e segura dos artigos já coletados/materializados (via Mongo e/ou índices).

**Principais endpoints (contrato)**

* `GET /api/v1/articles/latest?page=&pageSize=&sourceId=&from=&to=&lang=`
  Lista artigos mais recentes com **paginação** e filtros.

* `GET /api/v1/articles/search?q=&page=&pageSize=&sourceId=&from=&to=&lang=`
  Busca por palavra-chave em título/descrição/conteúdo (apoio por índice textual).

* `GET /api/v1/articles/{id}`
  Detalhe de um artigo por `_id` (Mongo) ou `articleId/contentHash`.

**Padrões de Arquitetura**

* **Stateless**, validação via `class-validator/transformer`, documentação **Swagger**.
* **Índices certos** (data desc, texto), projeção de campos (respostas enxutas).
* **Escalabilidade**: múltiplas réplicas atrás de LB, leitura em secundários do Mongo, **cache** (Redis) opcional para rotas quentes.
* **Segurança**: TLS/WAF/CORS, **JWT/SSO** para usuários internos; **API-Key** em rotas administrativas.
* **Manutenibilidade**: módulos segregados (`articles/`, `sources/`, `database/seed/`, `common/`), logs estruturados (Pino).

**No repositório**

* `Cenário 3/cenario-3/README.md` traz **passo a passo** para rodar local (Docker do Mongo, `.env`, `npm run seed`, `npm run start:dev`) e exemplos de resposta via Swagger.

**O que este cenário responde no desafio**

* **Contrato da API** com métodos, parâmetros e exemplos.
* **Arquitetura do Serviço** (resiliência/eficiência).
* **Escalabilidade** e **Segurança**.
* **Manutenibilidade** (organização de projeto e evolução).

---

## Cenário 4 — Boletim Diário com IA

**O que é**
Um **esboço de solução de IA** (pós-pipeline de dados) para gerar o **Boletim Diário de Inteligência de Mercado** com:

* **Top 3 tópicos** do dia,
* **Análise de impacto** (categoria/horizonte),
* **Sentimento** (Positivo/Negativo/Neutro),
* **Evidências** (links usados no resumo).

**Arquitetura por Agentes (LangGraph-like)**

* **Fetcher/Reader** → **Cleaner & Deduper** → (**Embedder & Index**) → **Topic Clusterer** →
  **Topic Summarizer** → **Impact Analyst** → **Sentiment Classifier** → **Ranker (Top 3)** →
  **Editor/Assembler** → **Guardrails & QA** → **Publisher** (Mongo `bulletins`, e-mail/Slack, BI).

**Orquestração**

* Grafo de estados (à la **LangGraph**), com **checkpoints**, **retries**, **paralelismo** por cluster e **guardrails** de groundedness (resumos só com base no contexto fornecido).

**Processo de Desenvolvimento**

* **Prompts** com **formato de saída fixo (JSON)** por agente.
* *Few-shots* curtos, *token budgeting*, testes automatizados (estrutura/limite de tamanho/citações).
* Métricas de qualidade e custo por run; tuning incremental.

**Riscos & Alternativa simples**

* **Riscos**: custo, complexidade de orquestração, variação de precisão.
* **Quando não usar**: baixo volume de notícias; alternativa: **consulta agregada** + **um único prompt** de *highlights* (mais barato e simples).

**O que este cenário responde no desafio**

* **Arquitetura e Orquestração** de uma solução de IA por agentes.
* **Processo de Desenvolvimento e Ferramentas** (prompts, LangChain/LangGraph).
* **Análise Crítica** (riscos, quando simplificar).

---

## Evidências da Solução

> Substitua pelos seus artefatos (links internos/externos):

* **Cenário 2**

  * Diagramas (ingestão → Kafka → Databricks → S3/Delta Bronze/Silver/Gold → Catálogo/Índice)
  * Documento de decisões (orquestração, índices, SLA)
* **Cenário 3**

  * Swagger (`/docs`) com endpoints e exemplos
  * Prints de respostas reais (latest/search/details)
  * README com `docker run` do Mongo e `npm run seed`
* **Cenário 4**

  * Diagrama do grafo de agentes
  * Modelo de JSON do boletim (exemplo)
  * Esboços de prompts por agente

---

## Como Avaliar a Proposta

1. **Clareza do desenho**: fluxos e decisões justificadas (por que Kafka, por que Bronze/Silver/Gold, por que índices X/Y).
2. **Resiliência/Escala**: retries, rate-limit, idempotência, DLQ; réplicas, cache, leitura em secundários.
3. **Segurança**: borda (WAF/TLS/CORS), authZ (RBAC/Scopes), segredos (Vault/Secrets Manager).
4. **Evolução**: modularidade (Nest), contratos estáveis, camadas de dados canônicas, IA com prompts versionados e guardrails.
5. **Aderência ao desafio**: cada Cenário responde aos itens solicitados (orquestração, API, IA).

---

## Autor

* **Nome Completo**: Mauricio Bueno | Data Engineer & AI Dev
* **Observação**: Esta entrega prioriza **planejamento e arquitetura**; onde há código, serve como **simulação** e **material de apoio** (Cenário 3).
