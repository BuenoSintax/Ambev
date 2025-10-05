import 'dotenv/config';
import mongoose from 'mongoose';
import { Article, ArticleSchema } from '../../articles/schemas/article.schema';
import {
  Source,
  SourceDocument,
  SourceSchema,
} from '../../sources/schemas/source.schema';

const ensureIndexes = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI must be set');
  }

  await mongoose.connect(uri);

  try {
    const ArticleModel = mongoose.model(Article.name, ArticleSchema);
    const SourceModel = mongoose.model(
      Source.name,
      SourceSchema,
    ) as mongoose.Model<SourceDocument>;

    await ArticleModel.collection.createIndex(
      { contentHash: 1 },
      { unique: true },
    );
    await ArticleModel.collection.createIndex({ publishedAtUtc: -1 });
    await ArticleModel.collection.createIndex({ _ingestDate: -1 });
    await ArticleModel.collection.createIndex(
      { title: 'text', description: 'text', content: 'text' },
      { default_language: 'english' },
    );

    await SourceModel.collection.createIndex({ id: 1 }, { unique: true });
    await SourceModel.collection.createIndex({ active: 1 });
    await SourceModel.collection.createIndex({ tags: 1 });

    console.log('Indexes ensured successfully.');
  } finally {
    if (
      mongoose.connection.readyState !== mongoose.ConnectionStates.disconnected
    ) {
      await mongoose.disconnect();
    }
  }
};

void ensureIndexes().catch((error) => {
  console.error('Index creation failed', error);
  process.exitCode = 1;
});
