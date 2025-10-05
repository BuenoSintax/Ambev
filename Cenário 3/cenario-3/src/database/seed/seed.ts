import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import mongoose, { Model } from 'mongoose';
import { SourceSchema } from '../../sources/schemas/source.schema';
import { ArticleSchema } from '../../articles/schemas/article.schema';
import { sha256 } from '../../common/utils/hash.util';
import 'dotenv/config';

const USER_AGENT = 'MarketPulse-Seed/1.0';
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [0, 1000, 3000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const startOfDayUtc = (date: Date) => {
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  return utc;
};

type SeedSource = {
  id: string;
  name: string;
  api_endpoint: string;
  description?: string;
  active?: boolean;
};

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
  | { articles?: RemoteArticle[]; sources?: SeedSource[] }
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

type SeedOptions = {
  dryRun: boolean;
  filterSourceId?: string;
  concurrency: number;
};

const defaultOptions: SeedOptions = {
  dryRun: false,
  concurrency: 1,
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

const isSeedSource = (value: unknown): value is SeedSource => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.api_endpoint === 'string'
  );
};

const isRemoteSourcesPayload = (
  value: RemotePayload,
): value is { sources: SeedSource[] } => {
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

const parseArgs = (argv: string[]): SeedOptions => {
  const options: SeedOptions = { ...defaultOptions };

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
          Accept: 'application/json',
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

const logInfo = (message: string, payload: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ level: 'info', message, ...payload }));
};

const logError = (message: string, payload: Record<string, unknown> = {}) => {
  console.error(JSON.stringify({ level: 'error', message, ...payload }));
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

const ensureSeedSources = (raw: unknown[]): SeedSource[] => {
  const validated: SeedSource[] = [];
  for (const entry of raw) {
    if (isSeedSource(entry)) {
      validated.push(entry);
    } else {
      logError('Invalid source entry skipped', { entry });
    }
  }
  return validated;
};

const normalizeRemoteSource = (
  entry: Partial<SeedSource> & Record<string, unknown>,
): SeedSource | null => {
  const idCandidate =
    toStringValue(entry.id) ??
    toStringValue(entry.name) ??
    toStringValue(entry.slug);
  const apiCandidate =
    toStringValue(entry.api_endpoint) ??
    toStringValue(entry.url) ??
    toStringValue(entry.apiKey) ??
    toStringValue(entry.endpoint);
  const nameCandidate = toStringValue(entry.name) ?? toStringValue(entry.title);

  if (!idCandidate || !nameCandidate || !apiCandidate) {
    return null;
  }

  return {
    id: idCandidate,
    name: nameCandidate,
    api_endpoint: apiCandidate,
    description: toStringValue(entry.description) ?? undefined,
    active: typeof entry.active === 'boolean' ? entry.active : true,
  };
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

const processArticle = async (
  ArticleModel: Model<any>,
  source: SeedSource,
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
      _ingestDate: startOfDayUtc(new Date()),
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

const upsertSource = async (
  SourceModel: Model<any>,
  source: SeedSource,
  dryRun: boolean,
): Promise<'inserted' | 'updated' | 'skipped' | 'simulated'> => {
  if (dryRun) {
    return 'simulated';
  }

  const result = await SourceModel.updateOne(
    { id: source.id },
    { ...source, active: source.active ?? true },
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
  options: SeedOptions = defaultOptions,
): Promise<SeedSummary> => {
  const args = { ...defaultOptions, ...options };
  const sourcesFile = path.join(process.cwd(), 'sources.json');
  const sourcesRaw = fs.readFileSync(sourcesFile, 'utf8');
  const parsed = JSON.parse(sourcesRaw) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('sources.json must contain an array of sources');
  }

  const configuredSources = ensureSeedSources(parsed);
  const filteredSources = args.filterSourceId
    ? configuredSources.filter((s) => s.id === args.filterSourceId)
    : configuredSources;

  if (filteredSources.length === 0) {
    throw new Error('No sources found for seeding');
  }

  const MONGODB_URI = process.env.MONGODB_URI ?? '';
  if (!MONGODB_URI && !args.dryRun) {
    throw new Error('MONGODB_URI must be set');
  }

  const seedMaxRaw = Number(process.env.SEED_MAX_PER_SOURCE || 200);
  const SEED_MAX =
    Number.isFinite(seedMaxRaw) && seedMaxRaw > 0 ? seedMaxRaw : 200;
  const timeoutRaw = Number(process.env.REQUEST_TIMEOUT_MS || 10000);
  const REQUEST_TIMEOUT =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 10000;

  const results: SourceResult[] = [];

  const connectIfNeeded = async () => {
    if (args.dryRun) {
      return;
    }
    if (
      mongoose.connection.readyState === mongoose.ConnectionStates.disconnected
    ) {
      await mongoose.connect(MONGODB_URI);
    }
  };

  await connectIfNeeded();

  const SourceModel = mongoose.model('Source', SourceSchema);
  const ArticleModel = mongoose.model('Article', ArticleSchema);

  try {
    await runWithConcurrency(
      filteredSources,
      args.concurrency,
      async (source) => {
        const startedAt = Date.now();
        const metrics: ArticleMetrics = {
          inserted: 0,
          updated: 0,
          skipped: 0,
          simulated: 0,
          failed: 0,
          fetched: 0,
        };
        try {
          const sourceResult = await upsertSource(
            SourceModel,
            source,
            args.dryRun,
          );
          metrics[sourceResult] += 1;
        } catch (error) {
          metrics.failed += 1;
          logError('Failed to upsert source metadata', {
            sourceId: source.id,
            error: (error as Error).message,
          });
        }

        try {
          const response = await retryRequest<RemotePayload>(
            source.api_endpoint,
            {
              timeout: REQUEST_TIMEOUT,
            },
          );
          const payload = response.data;
          const httpStatus = response.status;

          if (isRemoteSourcesPayload(payload)) {
            const remoteSources = payload.sources
              .map((entry) => normalizeRemoteSource(entry))
              .filter((entry): entry is SeedSource => Boolean(entry));

            metrics.fetched = remoteSources.length;

            for (const remoteSource of remoteSources) {
              try {
                const result = await upsertSource(
                  SourceModel,
                  remoteSource,
                  args.dryRun,
                );
                metrics[result] += 1;
              } catch (error) {
                metrics.failed += 1;
                logError('Failed to upsert remote source from payload', {
                  sourceId: source.id,
                  remoteSourceId: remoteSource.id,
                  error: (error as Error).message,
                });
              }
            }

            logInfo('seed:source:result', {
              sourceId: source.id,
              httpStatus,
              durationMs: Date.now() - startedAt,
              ...metrics,
              dryRun: args.dryRun,
            });

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
              logError('Failed to process article', {
                sourceId: source.id,
                error: (error as Error).message,
              });
            }
          }

          logInfo('seed:source:result', {
            sourceId: source.id,
            httpStatus,
            durationMs: Date.now() - startedAt,
            ...metrics,
            dryRun: args.dryRun,
          });

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
          logError('Failed to fetch source endpoint', {
            sourceId: source.id,
            error: axiosError.message,
            status: axiosError.response?.status,
          });
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
  } finally {
    if (!args.dryRun) {
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
    }
  }

  const totals = aggregateTotals(results);
  logInfo('seed:summary', { ...totals, dryRun: args.dryRun });

  return { results, totals };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  let exitCode = 0;

  try {
    const summary = await runSeed(options);
    if (summary.totals.failed > 0) {
      exitCode = 1;
      logError('Seed finished with errors', { failed: summary.totals.failed });
    } else {
      logInfo('Seed completed successfully');
    }
  } catch (error) {
    exitCode = 1;
    logError('Seed failed', { error: (error as Error).message });
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
