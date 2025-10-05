# Boletim Diário de Inteligência de Mercado — **Arquitetura de IA (Esboço)**

> **Importante:** este documento descreve o **design** e o **fluxo lógico** de uma solução de IA para gerar o *Boletim Diário*. **Não é** a implementação final. O objetivo é demonstrar as decisões de arquitetura, a orquestração entre componentes (“agentes”) e o processo de engenharia para garantir qualidade, custo e governança.
>
> **Contexto:** esta etapa vem **depois** de todo o pipeline de ingestão/processamento (Kubernetes → NestJS → Kafka → Databricks Streaming → S3 Data Lake em Bronze/Silver/Gold → Unity Catalog → OpenSearch/BI). O *Boletim Diário* consome os **dados já refinados** (Silver/Gold) e/ou a **API** do Cenário 3 para gerar uma síntese executiva para os analistas.

---

## 1) Visão geral (explicação não técnica)

Todos os dias, o sistema:

1. **Lê as notícias do dia** (do nosso data lake, warehouse e/ou API interna).
2. **Organiza os textos por assunto**, removendo duplicidades.
3. **Identifica os 3 principais tópicos** do dia.
4. Para cada tópico, produz:

   * um **resumo curto**,
   * uma **análise do impacto de negócio** (ex.: consumidores, concorrência, regulação),
   * o **sentimento predominante** (positivo/negativo/ neutro),
   * **links** das matérias usadas.
5. **Monta o boletim** (Markdown/HTML + JSON estruturado) e **publica** (Mongo “bulletins”, e-mail/Slack, e opcionalmente envia para BI).

O desenho separa o problema em **agentes especializados** (leitor, limpador, clusterizador, resumidor, analista de impacto, classificador de sentimento, editor) e um **orquestrador** que garante que tudo aconteça na ordem certa, com qualidade e custo controlados.

---

## 2) Arquitetura

### 2.1 Componentes/Agentes

* **Fetcher/Reader**
  Lê artigos do dia via:

  * **Silver/Gold** (Delta/S3) pela camada de serving (ex.: Databricks SQL Warehouse), **OU**
  * **API Cenário 3** (`/api/v1/articles/latest?from=YYYY-MM-DD&to=...&lang=...`).

* **Cleaner & Deduper**
  Normaliza texto (remove HTML/boilerplate), *chunking* quando necessário, deduplicação por `contentHash` + *similaridade* (embeddings).

* **Embedder & Index (opcional)**
  Gera **embeddings** e indexa em **vector store** (OpenSearch k-NN / FAISS / Pinecone) para *retrieval* rápido e melhor clusterização.

* **Topic Clusterer**
  Clusteriza embeddings (DBSCAN/KMeans/HDBSCAN). Um **LLM “namer”** resume e dá um **rótulo** para cada cluster.

* **Topic Summarizer**
  *Prompt* com **grounding**: “resuma apenas com base nas passagens/links fornecidos”. Saída JSON: `{ summary, links[] }`.

* **Impact Analyst**
  Classifica **categoria de impacto** (Consumidor, Concorrência, Regulação, Operações, Marca…) e **horizonte** (curto/médio/longo) + justificativa.

* **Sentiment Classifier**
  Gera `Positive | Negative | Neutral` com **rationale** (2 linhas). Pode usar um modelo leve (classificador) ou LLM com *few-shot*.

* **Ranker (Top 3)**
  `score = volume * w1 + diversidade * w2 + frescor * w3 + afinidade_ambev * w4`. Seleciona **3 tópicos**.

* **Editor/Assembler**
  Monta **Markdown/HTML** e **JSON** final (para API, Slack, e-mail, BI), com cabeçalho (data), 3 tópicos (título, resumo, impacto, sentimento, links).

* **Guardrails & QA**
  Valida **formato**, **tamanho**, **citações**, ausência de alucinação (tudo deve vir do contexto). Em caso de falha, reprocessa o nó específico.

* **Publisher**
  Persiste em `bulletins` (Mongo ou Delta), dispara **Slack/e-mail**, opcionalmente atualiza um **dashboard**.

### 2.2 Orquestração (LangGraph-like)

A orquestração segue o padrão **StateGraph** (como seu SQLAgent), com **checkpoints**, **paralelismo** e **retries**:

```
START
 └─ fetch_articles
     └─ clean_dedupe
         └─ embed_index (opcional)
             └─ cluster_topics
                 └─ summarize_topics   (parallel por cluster)
                     └─ analyze_impact (parallel por cluster)
                         └─ classify_sentiment (parallel por cluster)
                             └─ rank_topics
                                 └─ assemble_report
                                     └─ guardrails_qa
                                         └─ publish
                                             └─ END
```

**Boas práticas técnicas**

* **Timeout + retry/backoff** por nó de LLM.
* **Token budgeting** e *batching* (reduz custo/latência).
* **Checkpoints** do `state` (para *resume*).
* **Fan-out** de nós paralelizáveis (ex.: *summarize/impact/sentiment* por cluster).
* **Observabilidade**: métricas por nó (latência, tokens, custo), logs estruturados.

---

## 3) Fluxo de dados (de onde vem e para onde vai)

1. **Entrada**: artigos do dia (já refinados) via Data Warehouse/Lake (**Silver/Gold**) ou **API Cenário 3**.
2. **Processamento**: limpeza, embeddings, clusterização, sumarização, impacto, sentimento, ranking, montagem.
3. **Saída**:

   * **JSON estruturado** do boletim (para API e histórico),
   * **Markdown/HTML** (para e-mail/Slack),
   * **Persistência** em `bulletins`,
   * **Eventual carga** em BI (tabelas para KPIs de cobertura/sentimento por tema/tempo).

---

## 4) Prompts e Qualidade (processo de engenharia)

* **Formato estrito** (JSON Schema pequeno) para cada agente — facilita *parsing* e testes automatizados.
* **Few-shot** mínimos, realistas, com *negative examples* (quando **não** classificar como positivo, p.ex.).
* **Grounding** obrigatório: “cite no máximo 3 links **do contexto**; se faltar evidência, retorne `INSUFFICIENT_EVIDENCE`”.
* **Test Harness**:

  * *Fixtures* de artigos (amostras reais),
  * Asserts de: JSON válido, tamanho máximo, presença de links, ausência de afirmações não suportadas,
  * Métricas: custo/run, latência por nó, qualidade amostral (revisão humana).
* **Tuning contínuo**: ajuste de temperatura/top-p, tamanho de *chunks*, regras do ranker e do QA.

---

## 5) Operação, Resiliência e Eficiência

* **Agendador**: CronJob diário (ex.: 07:00) + *rebuild sob demanda* (`/ops/bulletin?date=...`).
* **Escalabilidade**:

  * Paralelismo por cluster (workers),
  * Cache de embeddings,
  * *Batch* para prompts (quando possível),
  * Vector store para reduzir tokens (recupera apenas trechos relevantes).
* **Confiabilidade**:

  * Retries com backoff,
  * Circuit-breakers por provedor LLM,
  * Quotas e *rate limits*,
  * Checkpoints para *resume*.
* **Observabilidade**:

  * Logs estruturados (correlação por `runId`),
  * Métricas (tempo por nó, tokens, custo total),
  * Alertas (falhas consecutivas, custo fora do envelope).

---

## 6) Segurança & Governança

* **Dados sensíveis**: nenhum dado pessoal; apenas conteúdos públicos de notícias.
* **Segredos**: chaves LLM/embeddings em **Secrets Manager** (nunca em código).
* **Acesso**: política *least-privilege* a buckets/tabelas/índices.
* **Rastreabilidade**: cada tópico traz **links** usados; guardamos `context_snapshot` do que foi lido para auditoria.
* **Política de Estilo** no *guardrail* (sem linguagem inadequada; sem opiniões sem fontes).

---

## 7) Saídas (formato)

### 7.1 JSON (exemplo)

```json
{
  "date": "2025-10-05",
  "generatedAt": "2025-10-05T07:05:12Z",
  "topics": [
    {
      "title": "Pressão de custos de insumos no varejo alimentício",
      "summary": "Notícias destacam alta de grãos e logística...",
      "impact": { "category": "Operações", "horizon": "short", "analysis": "Impacto em margem no 4T..." },
      "sentiment": "Negative",
      "links": ["https://.../mat1", "https://.../mat2"]
    },
    { "...": "..." },
    { "...": "..." }
  ]
}
```

### 7.2 Markdown/HTML

* Cabeçalho com **data/hora**,
* 3 seções (cada tópico com: **título**, **resumo**, **impacto**, **sentimento**, **links**),
* Rodapé com observações/metodologia.

---

## 8) Riscos & Trade-offs

* **Custo** (LLM em múltiplos passos): mitigar com *batching*, cache, prompts enxutos, paralelismo eficiente.
* **Qualidade/Drift**: mitigar com guardrails, *style guide* e QA automatizado + amostral humano.
* **Complexidade** (LangGraph, paralelismo, checkpoints): traz previsibilidade e *debug*, mas exige disciplina de engenharia.
* **Bias de Fontes**: balancear diversidade de fontes e ajustar pesos no *ranker*.

### Quando **não** usar essa solução completa

* **Baixo volume** ou necessidade apenas de “manchetes do dia”.
* **Alternativa simples**: query agregada (warehouse + Atlas/OpenSearch) → **um único prompt** “summarize highlights” → e-mail/Slack. Menor custo e esforço.

---

## 9) Stack sugerida

* **Orquestração LLM:** LangChain + **LangGraph** (StateGraph com checkpoints e paralelismo).
* **LLM/Embeddings:** provedor corporativo (seguro), temperatura baixa, limites de tokens e custos.
* **Vector store:** OpenSearch k-NN (aproveita seu stack) ou FAISS local.
* **Persistência:** `bulletins` (Mongo/Delta), artefatos em S3/Unity Catalog.
* **Entrega:** Slack/e-mail via *Publisher*; endpoints internos para recuperar boletins (ex.: `/api/v1/bulletins?date=...`).
* **Infra:** Kubernetes (CronJob diário), observabilidade (OpenTelemetry, Prometheus/Grafana), *Secrets Manager*.

---

## 10) Mini-roadmap de implantação

1. **MVP (1–4 sprints)**

   * Ler do Silver/Gold/API; clusterização simples (KMeans), sumarização → Top 3 → Markdown + JSON → publicar/guardar.
2. **V2**

   * Impacto/sentimento dedicados, guardrails e QA, vector store.
3. **V3**

   * Avaliações automáticas, dashboards de qualidade/custo, *human-in-the-loop* para curadoria.

---

## 11) Observação final

Este **esboço** foi pensado para **encaixar naturalmente após o pipeline Kafka/Databricks/S3** já definido. A separação em **agentes** e o uso de **LangGraph** dão previsibilidade, testes e governança — sem engessar a evolução. Quando a volumetria/custo for maior, o desenho suporta **paralelismo por cluster**, **cache de embeddings** e **controle fino de tokens**, mantendo o boletim **rápido, auditável e útil** para o negócio.
