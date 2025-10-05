import { Body, Controller, Headers, Post } from '@nestjs/common';
import { SourcesService } from './sources.service';
import { Source } from './schemas/source.schema';

type IncomingSourceDto = Partial<Source> & {
  api_endpoint?: string;
  rate_limit_per_min?: number;
  timeout_ms?: number;
};

@Controller('/api/admin/sources')
export class SourcesAdminController {
  constructor(private readonly svc: SourcesService) {}

  @Post('/upsert-many')
  async upsertMany(
    @Headers('x-api-key') apiKey: string,
    @Body() body: IncomingSourceDto[] = [],
  ) {
    if (process.env.SEED_API_KEY && apiKey !== process.env.SEED_API_KEY) {
      return { ok: false, error: 'unauthorized' };
    }

    const normalized = body.map((source) => {
      const tags = Array.isArray(source.tags)
        ? source.tags.filter((tag): tag is string => typeof tag === 'string')
        : [];

      return {
        id: source.id,
        name: source.name,
        apiEndpoint: source.apiEndpoint ?? source.api_endpoint,
        description: source.description,
        active: source.active ?? true,
        rateLimitPerMin:
          source.rateLimitPerMin ?? source.rate_limit_per_min ?? 60,
        timeoutMs: source.timeoutMs ?? source.timeout_ms ?? 10000,
        headers: source.headers,
        tags,
      };
    });

    const result = await this.svc.upsertMany(normalized);
    return { ok: true, result };
  }
}
