jest.mock('axios');

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: jest.fn(),
  };
});

jest.mock('mongoose', () => {
  const actual = jest.requireActual<typeof import('mongoose')>('mongoose');
  const sourceModel = {
    updateOne: jest
      .fn()
      .mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 }),
  };
  const articleModel = {
    updateOne: jest
      .fn()
      .mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 }),
  };
  const mockConnection = {
    ...actual.connection,
    readyState: 0,
  } as typeof actual.connection;
  const connect = jest.fn().mockResolvedValue(undefined);
  const disconnect = jest.fn().mockResolvedValue(undefined);
  const model = jest.fn((name: string) => {
    if (name === 'Source') return sourceModel;
    if (name === 'Article') return articleModel;
    return { updateOne: jest.fn().mockResolvedValue({}) };
  }) as unknown as typeof actual.model;

  const mock: typeof actual & {
    __sourceModel: typeof sourceModel;
    __articleModel: typeof articleModel;
  } = {
    ...actual,
    ConnectionStates: actual.ConnectionStates,
    connection: mockConnection,
    connect: connect as typeof actual.connect,
    disconnect: disconnect as typeof actual.disconnect,
    model,
    __sourceModel: sourceModel,
    __articleModel: articleModel,
  };

  return {
    __esModule: true,
    ...mock,
    default: mock,
  };
});

import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import mongoose from 'mongoose';
import { runSeed } from './seed';

type MongooseMock = typeof mongoose & {
  connection: { readyState: number };
  __sourceModel: { updateOne: jest.Mock };
  __articleModel: { updateOne: jest.Mock };
};

const mongooseMock = mongoose as unknown as MongooseMock;
const axiosMock = axios as jest.Mocked<typeof axios>;
const readFileSyncMock = fs.readFileSync as jest.MockedFunction<
  typeof fs.readFileSync
>;

describe('seed script smoke tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readFileSyncMock.mockReset();
    mongooseMock.connection.readyState = 0;
    mongooseMock.__sourceModel.updateOne.mockClear();
    mongooseMock.__articleModel.updateOne.mockClear();
  });

  it('runs dry-run for articles payload', async () => {
    readFileSyncMock.mockReturnValueOnce(
      JSON.stringify([
        {
          id: 'saurav-tech-latest',
          name: 'Saurav Tech Latest',
          api_endpoint: 'https://example.com/articles',
        },
      ]),
    );

    axiosMock.get.mockResolvedValueOnce({
      status: 200,
      data: {
        articles: [
          {
            title: 'Breaking News',
            url: 'https://example.com/news',
            publishedAt: '2024-01-01T00:00:00Z',
            description: 'Sample description',
            language: 'en',
          },
        ],
      },
    });

    const summary = await runSeed({ dryRun: true, concurrency: 1 });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(axiosMock.get).toHaveBeenCalledWith(
      'https://example.com/articles',
      expect.anything(),
    );
    const [, config] = axiosMock.get.mock.calls[0] as [
      string,
      AxiosRequestConfig?,
    ];
    expect(config?.timeout ?? 0).toBeGreaterThan(0);
    const headers = (config?.headers ?? {}) as Record<string, unknown>;
    expect(headers['User-Agent']).toBe('MarketPulse-Seed/1.0');
    expect(mongooseMock.connect).not.toHaveBeenCalled();
    expect(mongooseMock.__sourceModel.updateOne).not.toHaveBeenCalled();
    expect(mongooseMock.__articleModel.updateOne).not.toHaveBeenCalled();
    expect(summary.totals.simulated).toBe(2);
    expect(summary.totals.inserted).toBe(0);
    expect(summary.results[0].metrics.fetched).toBe(1);
  });

  it('processes remote sources payload', async () => {
    readFileSyncMock.mockReturnValueOnce(
      JSON.stringify([
        {
          id: 'saurav-tech-sources',
          name: 'Saurav Tech Sources',
          api_endpoint: 'https://example.com/sources',
        },
      ]),
    );

    axiosMock.get.mockResolvedValueOnce({
      status: 200,
      data: {
        sources: [
          {
            id: 'cnn-feed',
            name: 'CNN Feed',
            api_endpoint: 'https://example.com/cnn',
          },
        ],
      },
    });

    const summary = await runSeed({ dryRun: true, concurrency: 1 });

    expect(summary.totals.simulated).toBe(2);
    expect(summary.results[0].metrics.fetched).toBe(1);
    expect(mongooseMock.__sourceModel.updateOne).not.toHaveBeenCalled();
  });
});
