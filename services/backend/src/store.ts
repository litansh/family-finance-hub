import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// At household volume a month is two small JSON documents, so plain objects
// beat a database: nothing to provision, encrypted at rest, trivially backed up.
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

export const keys = {
  budget: (month: string) => `budgets/${month}.json`,
  transactions: (month: string) => `transactions/${month}.json`,
  meta: 'meta.json',
  // Everything the family creates in the hub lives under user/, apart from
  // RiseUp's data. The sync never writes here; the API never writes anywhere else.
  overrides: 'user/overrides.json',
  reco: 'user/recommendations.json',
  plans: 'user/plans.json',
  shifts: 'user/budget-shifts.json',
  commitments: 'user/commitments.json',
  strategy: 'user/strategy.json',
  chat: (jobId: string) => `user/chat/${jobId}.json`,
  layout: (emailHash: string) => `user/layout/${emailHash}.json`,
};

export interface Meta {
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  months: string[];
}

export const emptyMeta: Meta = { lastSyncAt: null, lastAttemptAt: null, lastError: null, months: [] };

export class S3Store implements Store {
  constructor(private bucket: string, private s3 = new S3Client({})) {}

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return JSON.parse(await out.Body!.transformToString()) as T;
    } catch (e) {
      if ((e as { name?: string }).name === 'NoSuchKey') return undefined;
      throw e;
    }
  }

  async put(key: string, value: unknown) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: JSON.stringify(value), ContentType: 'application/json' }));
  }
}

export class FileStore implements Store {
  constructor(private root: string) {}

  async get<T>(key: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(join(this.root, key), 'utf8')) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  }

  async put(key: string, value: unknown) {
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value, null, 2));
  }
}

export class MemoryStore implements Store {
  data = new Map<string, string>();
  async get<T>(key: string) {
    const v = this.data.get(key);
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }
  async put(key: string, value: unknown) {
    this.data.set(key, JSON.stringify(value));
  }
}
