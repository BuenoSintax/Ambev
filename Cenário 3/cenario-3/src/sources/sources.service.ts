import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Source, SourceDocument } from './schemas/source.schema';

@Injectable()
export class SourcesService {
  constructor(@InjectModel(Source.name) private model: Model<SourceDocument>) {}

  findAll() {
    return this.model.find({ active: true }).lean();
  }

  upsertMany(items: Partial<Source>[]) {
    return Promise.all(
      items.map((s) =>
        this.model.updateOne(
          { id: s.id },
          { ...s, active: s.active ?? true },
          { upsert: true },
        ),
      ),
    );
  }
}
