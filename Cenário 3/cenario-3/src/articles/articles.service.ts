import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, isValidObjectId } from 'mongoose';
import { Article, ArticleDocument } from './schemas/article.schema';

@Injectable()
export class ArticlesService {
  constructor(
    @InjectModel(Article.name) private model: Model<ArticleDocument>,
  ) {}

  async listLatest({
    page,
    pageSize,
    sourceId,
    language,
    from,
    to,
  }: {
    page: number;
    pageSize: number;
    sourceId?: string;
    language?: string;
    from?: Date;
    to?: Date;
  }) {
    const filter: FilterQuery<Article> = {};
    if (sourceId) filter.sourceId = sourceId;
    if (language) filter.language = language;
    if (from || to) {
      filter.publishedAtUtc = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }
    const cursor = this.model
      .find(filter, { raw: 0 })
      .sort({ publishedAtUtc: -1, collectedAtUtc: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);
    const [items, total] = await Promise.all([
      cursor.lean(),
      this.model.countDocuments(filter),
    ]);
    return { page, pageSize, total, items };
  }

  async search({
    q,
    page,
    pageSize,
    sourceId,
    language,
  }: {
    q: string;
    page: number;
    pageSize: number;
    sourceId?: string;
    language?: string;
  }) {
    const searchFilter: FilterQuery<Article> = { $text: { $search: q } };
    if (sourceId) searchFilter.sourceId = sourceId;
    if (language) searchFilter.language = language;
    const cursor = this.model
      .find(searchFilter, { score: { $meta: 'textScore' }, raw: 0 })
      .sort({ score: { $meta: 'textScore' }, publishedAtUtc: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);
    const [items, total] = await Promise.all([
      cursor.lean(),
      this.model.countDocuments(searchFilter),
    ]);
    return { page, pageSize, total, items };
  }

  async getById(id: string) {
    const byId =
      /^[a-f0-9]{24}$/.test(id) && isValidObjectId(id)
        ? await this.model.findById(id).lean()
        : null;
    const doc = byId || (await this.model.findOne({ articleId: id }).lean());
    if (!doc) throw new NotFoundException('Article not found');
    return doc;
  }
}
