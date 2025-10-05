import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true, collection: 'sources' })
export class Source {
  @Prop({ unique: true, required: true }) id: string;
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) api_endpoint: string;
  @Prop() description?: string;
  @Prop({ default: true }) active: boolean;
}

export type SourceDocument = HydratedDocument<Source>;
export const SourceSchema = SchemaFactory.createForClass(Source);
SourceSchema.index({ active: 1 });
