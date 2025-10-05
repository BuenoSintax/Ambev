# Market Pulse API — Cenário 3

API NestJS para coleta e consulta de artigos de notícias com MongoDB, Fastify e logs estruturados via Pino.

## Dependências principais

```bash
npm i @nestjs/config mongoose @nestjs/mongoose class-validator class-transformer \
      @nestjs/swagger swagger-ui-express @fastify/rate-limit axios nestjs-pino pino-pretty
npm i -D @types/node ts-node tsconfig-paths
```

## Preparação do ambiente

1. Subir o MongoDB com Docker:
   ```bash
   docker run -d --name mongo -p 27017:27017 \
     -e MONGO_INITDB_ROOT_USERNAME=root \
     -e MONGO_INITDB_ROOT_PASSWORD=pass mongo:6
   ```
2. Copiar variáveis de ambiente e ajustar `MONGODB_URI`/`SEED_API_KEY` se necessário:
   ```bash
   cp .env.example .env
   ```
3. Instalar dependências do projeto:
   ```bash
   npm install
   ```
4. Colar o JSON de fontes em `sources.json` (o arquivo já possui um exemplo com três entradas; atualize as URLs e chaves conforme necessário).
5. Popular o banco com as fontes/artigos:
   ```bash
   npm run seed
   ```
6. Subir a API em modo desenvolvimento:
   ```bash
   npm run start:dev
   ```

## Recursos disponíveis

- Swagger UI em `http://localhost:3000/docs`.
- Global Validation Pipe com `class-validator`/`class-transformer`.
- Rate limiting simples configurado em Fastify (60 req/min).
- Logs estruturados com `nestjs-pino`/`pino-pretty`.

## Endpoints principais

- `GET /api/v1/articles/latest?page=1&pageSize=20`
- `GET /api/v1/articles/search?q=health&page=1`
- `GET /api/v1/articles/{articleId}`
- `GET /api/v1/sources`

## Estrutura de pastas (resumo)

```
src/
  articles/
  common/
  config/
  database/seed/
  sources/
```

Cada módulo encapsula controladores, serviços e schemas Mongoose correspondentes.
