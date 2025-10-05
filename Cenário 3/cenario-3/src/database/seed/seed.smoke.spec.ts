/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/unbound-method */
jest.mock('axios');

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      access: jest.fn(),
      readFile: jest.fn(),
    },
  };
});

jest.mock('mongoose', () => {
  const actual = jest.requireActual<typeof import('mongoose')>('mongoose');
  const sourceModel: any = {};
  sourceModel.find = jest.fn(() => sourceModel);
  sourceModel.sort = jest.fn(() => sourceModel);
  sourceModel.lean = jest.fn();
  sourceModel.bulkWrite = jest.fn();
  sourceModel.updateOne = jest
    .fn()
    .mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
  const articleModel = {
    updateOne: jest
      .fn()
      .mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 }),
  };
  let readyState = 0;
  const ConnectionStates = {
    disconnected: 0,
    connected: 1,
    connecting: 2,
    disconnecting: 3,
    uninitialized: 99,
  };
  const connection = {
    get readyState() {
      return readyState;
    },
    set readyState(value: number) {
      readyState = value;
    },
  };
  const connect = jest.fn().mockImplementation(async () => {
    connection.readyState = ConnectionStates.connected;
  });
  const disconnect = jest.fn().mockImplementation(async () => {
    connection.readyState = ConnectionStates.disconnected;
  });

  const model = jest.fn((name: string) => {
    if (name === 'Source') return sourceModel;
    if (name === 'Article') return articleModel;
    return {};
  });

  const mock: any = {
    __esModule: true,
    Schema: actual.Schema,
    Types: actual.Types,
    Error: actual.Error,
    model,
    connect,
    disconnect,
    connection,
    ConnectionStates,
    __sourceModel: sourceModel,
    __articleModel: articleModel,
  };
  mock.default = mock;
  return mock;
});

import axios from 'axios';
import * as fs from 'fs';
import mongoose from 'mongoose';
import { runSeed } from './seed';

type MongooseMock = typeof mongoose & {
  __sourceModel: {
    find: jest.Mock;
    sort: jest.Mock;
    lean: jest.Mock;
    bulkWrite: jest.Mock;
    updateOne: jest.Mock;
  };
  __articleModel: {
    updateOne: jest.Mock;
  };
};

const mongooseMock = mongoose as unknown as MongooseMock;
const axiosMock = axios as jest.Mocked<typeof axios>;
const fsPromises = fs.promises as jest.Mocked<typeof fs.promises>;

beforeAll(() => {
  process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
});

const resetSourceModel = () => {
  const model = mongooseMock.__sourceModel;
  model.find.mockReset();
  model.sort.mockReset();
  model.find.mockReturnValue(model);
  model.sort.mockReturnValue(model);
  model.lean.mockReset();
  model.bulkWrite.mockReset();
  model.updateOne.mockReturnValue({
    exec: jest.fn().mockResolvedValue(undefined),
  });
};

describe('seed script smoke tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSourceModel();
    mongooseMock.__articleModel.updateOne.mockClear();
    (mongooseMock.connection as any).readyState =
      mongooseMock.ConnectionStates.disconnected;
    fsPromises.access.mockReset().mockRejectedValue(new Error('missing'));
    fsPromises.readFile.mockReset();
  });

  it('uses database sources when available (dry-run)', async () => {
    mongooseMock.__sourceModel.lean.mockResolvedValueOnce([
      {
        id: 'db-source',
        name: 'DB Source',
        apiEndpoint: 'https://example.com/articles',
        active: true,
        rateLimitPerMin: 60,
        timeoutMs: 5000,
        tags: [],
      },
    ]);

    axiosMock.get.mockResolvedValueOnce({
      status: 200,
      data: {
        articles: [
          {
            title: 'Breaking News',
            url: 'https://example.com/news',
            publishedAt: '2024-01-01T00:00:00Z',
          },
        ],
      },
    });

    const summary = await runSeed({ dryRun: true, concurrency: 1 });

    expect(mongooseMock.connect).toHaveBeenCalled();
    expect(axiosMock.get).toHaveBeenCalledWith(
      'https://example.com/articles',
      expect.objectContaining({
        timeout: expect.any(Number),
      }),
    );
    expect(summary.results[0].metrics.fetched).toBe(1);
    expect(summary.totals.simulated).toBe(1);
    expect(mongooseMock.__articleModel.updateOne).not.toHaveBeenCalled();
  });

  it('bootstraps sources from JSON when database is empty', async () => {
    mongooseMock.__sourceModel.lean.mockResolvedValueOnce([]);
    fsPromises.access.mockResolvedValueOnce(undefined);
    fsPromises.readFile.mockResolvedValueOnce(
      JSON.stringify([
        {
          id: 'json-source',
          name: 'JSON Source',
          api_endpoint: 'https://example.com/json',
        },
      ]),
    );
    mongooseMock.__sourceModel.bulkWrite.mockResolvedValueOnce({
      matchedCount: 0,
      upsertedCount: 1,
      modifiedCount: 0,
    });

    const summary = await runSeed({
      dryRun: true,
      bootstrapSources: true,
      concurrency: 1,
    });

    expect(mongooseMock.__sourceModel.bulkWrite).toHaveBeenCalledTimes(1);
    expect(summary.results).toHaveLength(0);
    expect(axiosMock.get).not.toHaveBeenCalled();
  });
});
