import 'dotenv/config';
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import mongoose, { Model } from 'mongoose';
import {
  Source,
  SourceDocument,
  SourceSchema,
} from '../../sources/schemas/source.schema';
import { Article, ArticleSchema } from '../../articles/schemas/article.schema';
import { sha256 } from '../../common/utils/hash.util';

const USER_AGENT = 'MarketPulse-Seed/1.0';
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [0, 1000, 3000];
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RATE_LIMIT = 60;
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_SEED_MAX = 200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RemoteArticle = {
  title?: string | string[];
  headline?: string | string[];
  author?: string | string[];
  creator?: string | string[];
  url?: string;
  link?: string;
  urlToImage?: string;
  image?: string;
  publishedAt?: string;
  pubDate?: string;
  published_at?: string;
  description?: string | string[];
  summary?: string | string[];
  content?: string | string[];
  body?: string | string[];
  language?: string;
  lang?: string;
  country?: string;
  [key: string]: unknown;
};

type RemotePayload =
  | { articles?: RemoteArticle[]; sources?: Record<string, unknown>[] }
  | RemoteArticle[];

type ArticleMetrics = {
  inserted: number;
  updated: number;
  skipped: number;
  simulated: number;
  failed: number;
  fetched: number;
};

type SourceResult = {
  sourceId: string;
  sourceName: string;
  httpStatus?: number;
  durationMs: number;
  metrics: ArticleMetrics;
  error?: string;
};

type SeedSummary = {
  results: SourceResult[];
  totals: ArticleMetrics;
};

type CliOptions = {
  dryRun?: boolean;
  filterSourceId?: string;
  concurrency?: number;
  bootstrapSources?: boolean;
};

const defaultOptions: Required<
  Pick<CliOptions, 'dryRun' | 'concurrency' | 'bootstrapSources'>
> = {
  dryRun: false,
  concurrency: DEFAULT_CONCURRENCY,
  bootstrapSources: false,
};

const toStringValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const firstString = value.find(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0,
    );
    return firstString ? firstString.trim() : null;
  }
  return null;
};

const parseDate = (raw: string | null): Date | undefined => {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const normalizeArticle = (article: RemoteArticle) => {
  const title = toStringValue(article.title) ?? toStringValue(article.headline);
  const url = article.url ?? article.link ?? null;
  const publishedRaw =
    article.publishedAt ?? article.pubDate ?? article.published_at ?? null;
  const publishedAtUtc = parseDate(publishedRaw ?? null);
  const author =
    toStringValue(article.author) ?? toStringValue(article.creator);
  const urlToImage = article.urlToImage ?? article.image ?? null;
  const description =
    toStringValue(article.description) ?? toStringValue(article.summary);
  const content = toStringValue(article.content) ?? toStringValue(article.body);
  const language = article.language ?? article.lang ?? 'en';
  const country = article.country ?? undefined;

  return {
    title,
    url,
    publishedAtUtc,
    author,
    urlToImage,
    description,
    content,
    language,
    country,
  };
};

const isRemoteSourcesPayload = (
  value: RemotePayload,
): value is { sources: Record<string, unknown>[] } => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { sources?: unknown };
  return Array.isArray(candidate.sources);
};

const safeArrayFrom = (payload: RemotePayload): RemoteArticle[] => {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.articles)) return payload.articles;
  }
  return [];
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = { ...defaultOptions };

  argv.forEach((arg) => {
    if (arg.startsWith('--source=')) {
      options.filterSourceId = arg.split('=')[1];
    }
    if (arg === '--dry') {
      options.dryRun = true;
    }
    if (arg.startsWith('--concurrency=')) {
      const value = Number(arg.split('=')[1]);
      if (!Number.isNaN(value) && value > 0) {
        options.concurrency = value;
      }
    }
    if (arg === '--bootstrap-sources') {
      options.bootstrapSources = true;
    }
  });

  return options;
};

const retryRequest = async <T = RemotePayload>(
  url: string,
  config: AxiosRequestConfig,
): Promise<AxiosResponse<T>> => {
  let attempt = 0;
  let lastError: AxiosError | undefined;

  while (attempt < MAX_RETRIES) {
    try {
      const response = await axios.get<T>(url, {
        ...config,
        headers: {
          'User-Agent': USER_AGENT,
          ...(config.headers ?? {}),
        },
      });
      return response;
    } catch (error) {
      lastError = error as AxiosError;
      const delay =
        RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      if (attempt >= MAX_RETRIES - 1) {
        break;
      }
      await sleep(delay);
      attempt += 1;
    }
  }

  throw lastError ?? new Error('Unknown axios error');
};

const aggregateTotals = (results: SourceResult[]): ArticleMetrics => {
  return results.reduce<ArticleMetrics>(
    (acc, result) => {
      acc.inserted += result.metrics.inserted;
      acc.updated += result.metrics.updated;
      acc.skipped += result.metrics.skipped;
      acc.simulated += result.metrics.simulated;
      acc.failed += result.metrics.failed;
      acc.fetched += result.metrics.fetched;
      return acc;
    },
    {
      inserted: 0,
      updated: 0,
      skipped: 0,
      simulated: 0,
      failed: 0,
      fetched: 0,
    },
  );
};

const runWithConcurrency = async <T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> => {
  const size = Math.max(1, Math.min(limit, items.length || 1));
  let index = 0;

  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= items.length) {
        break;
      }
      await worker(items[currentIndex]);
    }
  });

  await Promise.all(runners);
};

const normalizeJsonSource = (entry: Record<string, unknown>): Source | null => {
  const id = toStringValue(entry.id) ?? undefined;
  const name = toStringValue(entry.name) ?? undefined;
  const apiEndpoint =
    toStringValue(entry.apiEndpoint) ??
    toStringValue(entry.api_endpoint) ??
    undefined;

  if (!id || !name || !apiEndpoint) {
    return null;
  }

  const rateLimitPerMin =
    typeof entry.rateLimitPerMin === 'number'
      ? entry.rateLimitPerMin
      : typeof entry.rate_limit_per_min === 'number'
        ? entry.rate_limit_per_min
        : DEFAULT_RATE_LIMIT;

  const timeoutMs =
    typeof entry.timeoutMs === 'number'
      ? entry.timeoutMs
      : typeof entry.timeout_ms === 'number'
        ? entry.timeout_ms
        : DEFAULT_TIMEOUT;

  const tags = Array.isArray(entry.tags)
    ? entry.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];

  const headers =
    entry.headers &&
    typeof entry.headers === 'object' &&
    !Array.isArray(entry.headers)
      ? (entry.headers as Record<string, string>)
      : undefined;

  const lastFetchedAt =
    typeof entry.lastFetchedAt === 'string' ||
    entry.lastFetchedAt instanceof Date
      ? new Date(entry.lastFetchedAt as string | number)
      : undefined;

  const active =
    typeof entry.active === 'boolean'
      ? entry.active
      : typeof entry.active === 'string'
        ? entry.active !== 'false'
        : true;

  return {
    id,
    name,
    apiEndpoint,
    description: toStringValue(entry.description) ?? undefined,
    active,
    rateLimitPerMin,
    tags,
    lastFetchedAt,
    timeoutMs,
    headers,
  };
};

const loadSourcesFromJson = async (): Promise<Source[]> => {
  const filePath = path.join(process.cwd(), 'sources.json');
  try {
    await fs.promises.access(filePath);
  } catch {
    return [];
  }

  const raw = await fs.promises.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('sources.json must contain an array of sources');
  }

  return parsed
    .map((entry) => normalizeJsonSource(entry as Record<string, unknown>))
    .filter((entry): entry is Source => Boolean(entry));
};

const loadSourcesFromDb = async (
  SourceModel: Model<SourceDocument>,
): Promise<Source[]> => {
  return SourceModel.find({ active: true }).sort({ name: 1 }).lean<Source[]>();
};

const bulkUpsertSources = async (
  SourceModel: Model<SourceDocument>,
  docs: Partial<Source>[],
) => {
  const operations = docs
    .filter((doc) => doc.id)
    .map((doc) => ({
      updateOne: {
        filter: { id: doc.id },
        update: {
          $set: {
            ...doc,
            active: doc.active ?? true,
            rateLimitPerMin: doc.rateLimitPerMin ?? DEFAULT_RATE_LIMIT,
            timeoutMs: doc.timeoutMs ?? DEFAULT_TIMEOUT,
            tags: doc.tags ?? [],
          },
        },
        upsert: true,
      },
    }));

  if (!operations.length) {
    return { matched: 0, upserted: 0, modified: 0 };
  }

  const result = await SourceModel.bulkWrite(operations, { ordered: false });
  return {
    matched: result.matchedCount,
    upserted: result.upsertedCount,
    modified: result.modifiedCount,
  };
};

const processArticle = async (
  ArticleModel: Model<any>,
  source: Source,
  rawArticle: RemoteArticle,
  dryRun: boolean,
): Promise<'inserted' | 'updated' | 'skipped' | 'simulated'> => {
  const normalized = normalizeArticle(rawArticle);
  const publishedAtIso = normalized.publishedAtUtc?.toISOString() ?? '';
  const hash = sha256(
    `${source.id}|${normalized.url ?? ''}|${publishedAtIso}|${normalized.title ?? ''}`,
  );

  if (dryRun) {
    return 'simulated';
  }

  const result = await ArticleModel.updateOne(
    { contentHash: hash },
    {
      articleId: hash,
      sourceId: source.id,
      sourceName: source.name,
      title: normalized.title,
      author: normalized.author,
      url: normalized.url,
      urlToImage: normalized.urlToImage,
      publishedAtUtc: normalized.publishedAtUtc,
      collectedAtUtc: new Date(),
      description: normalized.description,
      content: normalized.content,
      language: normalized.language,
      country: normalized.country,
      contentHash: hash,
      raw: rawArticle,
      _ingestDate: new Date(new Date().toISOString().substring(0, 10)),
    },
    { upsert: true },
  );

  const { upsertedCount = 0, modifiedCount = 0 } = result as {
    upsertedCount?: number;
    modifiedCount?: number;
  };

  if (upsertedCount > 0) {
    return 'inserted';
  }

  if (modifiedCount > 0) {
    return 'updated';
  }

  return 'skipped';
};

export const runSeed = async (
  options: CliOptions = defaultOptions,
): Promise<SeedSummary> => {
  const args = { ...defaultOptions, ...options };
  const MONGODB_URI = process.env.MONGODB_URI ?? '';
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI must be set');
  }

  await mongoose.connect(MONGODB_URI);

  const SourceModel = mongoose.model(
    Source.name,
    SourceSchema,
  ) as Model<SourceDocument>;
  const ArticleModel = mongoose.model(Article.name, ArticleSchema);

  let sources = await loadSourcesFromDb(SourceModel);
  let bootstrapInfo:
    | { matched: number; upserted: number; modified: number }
    | undefined;

  if (!sources.length) {
    const fromJson = await loadSourcesFromJson();
    sources = fromJson;

    if (args.bootstrapSources && fromJson.length) {
      bootstrapInfo = await bulkUpsertSources(SourceModel, fromJson);
      if (args.dryRun) {
        return {
          results: [],
          totals: {
            inserted: 0,
            updated: 0,
            skipped: 0,
            simulated: 0,
            failed: 0,
            fetched: 0,
          },
        };
      }
      sources = await loadSourcesFromDb(SourceModel);
    }
  }

  if (args.filterSourceId) {
    sources = sources.filter((source) => source.id === args.filterSourceId);
  }

  if (!sources.length) {
    throw new Error('No sources available for seeding');
  }

  const timeoutRaw = Number(process.env.REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT);
  const REQUEST_TIMEOUT =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0
      ? timeoutRaw
      : DEFAULT_TIMEOUT;
  const seedMaxRaw = Number(
    process.env.SEED_MAX_PER_SOURCE || DEFAULT_SEED_MAX,
  );
  const SEED_MAX =
    Number.isFinite(seedMaxRaw) && seedMaxRaw > 0
      ? seedMaxRaw
      : DEFAULT_SEED_MAX;

  const results: SourceResult[] = [];

  await runWithConcurrency(
    sources,
    args.concurrency ?? DEFAULT_CONCURRENCY,
    async (source) => {
      const metrics: ArticleMetrics = {
        inserted: 0,
        updated: 0,
        skipped: 0,
        simulated: 0,
        failed: 0,
        fetched: 0,
      };
      const startedAt = Date.now();

      const waitBetweenRequestsMs = Math.max(
        0,
        Math.ceil(
          60000 / Math.max(1, source.rateLimitPerMin ?? DEFAULT_RATE_LIMIT),
        ),
      );
      if (waitBetweenRequestsMs > 0) {
        await sleep(waitBetweenRequestsMs);
      }

      try {
        const timeout = source.timeoutMs ?? REQUEST_TIMEOUT;
        const response = await retryRequest<RemotePayload>(source.apiEndpoint, {
          timeout,
          headers: source.headers,
        });
        const payload = response.data;
        const httpStatus = response.status;

        if (isRemoteSourcesPayload(payload)) {
          const remoteSources = payload.sources
            .map((entry) => normalizeJsonSource(entry))
            .filter((entry): entry is Source => Boolean(entry));

          metrics.fetched = remoteSources.length;

          for (const remoteSource of remoteSources) {
            if (args.dryRun) {
              metrics.simulated += 1;
              continue;
            }
            try {
              const result = await bulkUpsertSources(SourceModel, [
                remoteSource,
              ]);
              metrics.inserted += result.upserted;
              metrics.updated += result.modified;
            } catch (error) {
              metrics.failed += 1;
              console.error(
                JSON.stringify({
                  level: 'error',
                  message: 'Failed to upsert remote source from payload',
                  sourceId: source.id,
                  remoteSourceId: remoteSource.id,
                  error: (error as Error).message,
                }),
              );
            }
          }

          results.push({
            sourceId: source.id,
            sourceName: source.name,
            httpStatus,
            durationMs: Date.now() - startedAt,
            metrics,
          });
          return;
        }

        const articles = safeArrayFrom(payload).slice(0, SEED_MAX);
        metrics.fetched = articles.length;

        for (const article of articles) {
          try {
            const result = await processArticle(
              ArticleModel,
              source,
              article,
              args.dryRun,
            );
            metrics[result] += 1;
          } catch (error) {
            metrics.failed += 1;
            console.error(
              JSON.stringify({
                level: 'error',
                message: 'Failed to process article',
                sourceId: source.id,
                error: (error as Error).message,
              }),
            );
          }
        }

        if (!args.dryRun) {
          await SourceModel.updateOne(
            { id: source.id },
            { $set: { lastFetchedAt: new Date() } },
            { upsert: false },
          ).exec();
        }

        console.log(
          JSON.stringify({
            level: 'info',
            message: 'seed:source:result',
            sourceId: source.id,
            httpStatus,
            durationMs: Date.now() - startedAt,
            ...metrics,
            dryRun: args.dryRun,
          }),
        );

        results.push({
          sourceId: source.id,
          sourceName: source.name,
          httpStatus,
          durationMs: Date.now() - startedAt,
          metrics,
        });
      } catch (error) {
        metrics.failed += 1;
        const axiosError = error as AxiosError;
        console.error(
          JSON.stringify({
            level: 'error',
            message: 'Failed to fetch source endpoint',
            sourceId: source.id,
            error: axiosError.message,
            status: axiosError.response?.status,
          }),
        );
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          durationMs: Date.now() - startedAt,
          metrics,
          error: axiosError.message,
          httpStatus: axiosError.response?.status,
        });
      }
    },
  );

  const totals = aggregateTotals(results);
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'seed:summary',
      ...totals,
      dryRun: args.dryRun,
      bootstrap: Boolean(bootstrapInfo),
    }),
  );

  return { results, totals };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  let exitCode = 0;

  try {
    const summary = await runSeed(options);
    if (summary.totals.failed > 0) {
      exitCode = 1;
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'Seed finished with errors',
          failed: summary.totals.failed,
        }),
      );
    } else {
      console.log(
        JSON.stringify({
          level: 'info',
          message: 'Seed completed successfully',
        }),
      );
    }
  } catch (error) {
    exitCode = 1;
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Seed failed',
        error: (error as Error).message,
      }),
    );
  } finally {
    try {
      if (
        mongoose.connection.readyState !==
        mongoose.ConnectionStates.disconnected
      ) {
        await mongoose.disconnect();
      }
    } catch (disconnectError) {
      console.warn('mongoose disconnect error:', disconnectError);
    }
    process.exit(exitCode);
  }
};

if (require.main === module) {
  void main();
}

export const cli = {
  parseArgs,
};
