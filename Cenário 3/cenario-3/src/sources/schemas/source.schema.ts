import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SourceDocument = HydratedDocument<Source>;

@Schema({ collection: 'sources', timestamps: true })
export class Source {
  @Prop({ required: true, unique: true }) id: string;
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) apiEndpoint: string;
  @Prop() description?: string;
  @Prop({ default: true }) active: boolean;
  @Prop({ default: 60 }) rateLimitPerMin?: number;
  @Prop({ type: [String], default: [] }) tags?: string[];
  @Prop() lastFetchedAt?: Date;
  @Prop({ default: 10000 }) timeoutMs?: number;
  @Prop({ type: Object }) headers?: Record<string, string>;
}

export const SourceSchema = SchemaFactory.createForClass(Source);
SourceSchema.index({ active: 1 });
SourceSchema.index({ tags: 1 });
