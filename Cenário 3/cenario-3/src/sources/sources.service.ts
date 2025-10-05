import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Source, SourceDocument } from './schemas/source.schema';

@Injectable()
export class SourcesService {
  constructor(
    @InjectModel(Source.name)
    private readonly sourceModel: Model<SourceDocument>,
  ) {}

  async listActive(): Promise<Source[]> {
    return this.sourceModel.find({ active: true }).sort({ name: 1 }).lean();
  }

  async upsertMany(docs: Partial<Source>[]) {
    const ops = docs.map((doc) => ({
      updateOne: {
        filter: { id: doc.id },
        update: {
          $set: {
            ...doc,
            active: doc.active ?? true,
            tags: doc.tags ?? [],
          },
        },
        upsert: true,
      },
    }));

    if (!ops.length) {
      return { matched: 0, upserted: 0, modified: 0 };
    }

    const result = await this.sourceModel.bulkWrite(ops, { ordered: false });
    return {
      matched: result.matchedCount,
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
    };
  }
}
