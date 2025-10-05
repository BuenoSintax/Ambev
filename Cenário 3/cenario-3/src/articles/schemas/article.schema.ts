import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true, collection: 'articles' })
export class Article {
  @Prop({ unique: true, required: true }) articleId: string; // use o contentHash
  @Prop({ required: true }) sourceId: string;
  @Prop() sourceName?: string;
  @Prop() title?: string;
  @Prop() author?: string;
  @Prop() url?: string;
  @Prop() urlToImage?: string;
  @Prop() publishedAtUtc?: Date;
  @Prop({ required: true }) collectedAtUtc: Date;
  @Prop() description?: string;
  @Prop() content?: string;
  @Prop() language?: string;
  @Prop() country?: string;
  @Prop({ unique: true, required: true }) contentHash: string;
  @Prop({ type: Object }) raw?: Record<string, any>;
  @Prop() _ingestDate?: Date;
}

export type ArticleDocument = HydratedDocument<Article>;
export const ArticleSchema = SchemaFactory.createForClass(Article);
ArticleSchema.index({ publishedAtUtc: -1 });
ArticleSchema.index({ _ingestDate: -1 });
ArticleSchema.index(
  { title: 'text', description: 'text', content: 'text' },
  { default_language: 'english' },
);
