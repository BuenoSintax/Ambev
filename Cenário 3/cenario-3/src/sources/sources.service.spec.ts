import type { Model } from 'mongoose';
import { SourcesService } from './sources.service';
import { Source, SourceDocument } from './schemas/source.schema';

type SourceModelMock = {
  find: jest.Mock<SourceModelMock, [Record<string, unknown>]>;
  sort: jest.Mock<SourceModelMock, [Record<string, number>]>;
  lean: jest.Mock<Promise<Source[]>, []>;
  bulkWrite: jest.Mock<
    Promise<{
      matchedCount: number;
      modifiedCount: number;
      upsertedCount: number;
    }>,
    [unknown[], { ordered: boolean }?]
  >;
};

const createSourceModelMock = (): SourceModelMock => {
  const mock: Partial<SourceModelMock> = {};
  mock.find = jest.fn<SourceModelMock, [Record<string, unknown>]>(
    () => mock as SourceModelMock,
  );
  mock.sort = jest.fn<SourceModelMock, [Record<string, number>]>(
    () => mock as SourceModelMock,
  );
  mock.lean = jest.fn<Promise<Source[]>, []>();
  mock.bulkWrite = jest.fn<
    Promise<{
      matchedCount: number;
      modifiedCount: number;
      upsertedCount: number;
    }>,
    [unknown[], { ordered: boolean }?]
  >();
  return mock as SourceModelMock;
};

describe('SourcesService', () => {
  const sourceModel = createSourceModelMock();
  const service = new SourcesService(
    sourceModel as unknown as Model<SourceDocument>,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists active sources ordered by name', async () => {
    const docs: Source[] = [
      {
        id: 'a',
        name: 'A',
        apiEndpoint: 'https://example.com/a',
        active: true,
        rateLimitPerMin: 60,
        tags: [],
        timeoutMs: 10000,
      },
    ];
    sourceModel.lean.mockResolvedValueOnce(docs);

    const result = await service.listActive();

    expect(sourceModel.find).toHaveBeenCalledWith({ active: true });
    expect(sourceModel.sort).toHaveBeenCalledWith({ name: 1 });
    expect(sourceModel.lean).toHaveBeenCalled();
    expect(result).toEqual(docs);
  });

  it('bulk upserts many sources', async () => {
    sourceModel.bulkWrite.mockResolvedValueOnce({
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 2,
    });

    const payload: Partial<Source>[] = [
      { id: 's1', name: 'Source 1', apiEndpoint: 'https://example.com/1' },
      { id: 's2', name: 'Source 2', apiEndpoint: 'https://example.com/2' },
    ];

    const summary = await service.upsertMany(payload);

    expect(sourceModel.bulkWrite).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ matched: 1, upserted: 2, modified: 1 });
  });

  it('returns zeros when upserting empty array', async () => {
    const summary = await service.upsertMany([]);
    expect(sourceModel.bulkWrite).not.toHaveBeenCalled();
    expect(summary).toEqual({ matched: 0, upserted: 0, modified: 0 });
  });
});
