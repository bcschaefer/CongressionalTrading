import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

type CacheEnvelope<T> = {
  value: T;
  expiresAt: number;
};

type ReadCacheOptions = {
  allowExpired?: boolean;
};

const CACHE_ROOT = path.join(process.cwd(), 'logs', 'api-cache');

function getCacheFilePath(namespace: string, key: string): string {
  const safeNamespace = encodeURIComponent(namespace);
  const safeKey = encodeURIComponent(key);
  return path.join(CACHE_ROOT, safeNamespace, `${safeKey}.json`);
}

export async function readLocalCache<T>(
  namespace: string,
  key: string,
  options: ReadCacheOptions = {}
): Promise<T | null> {
  const filePath = getCacheFilePath(namespace, key);
  try {
    const raw = await readFile(filePath, 'utf8');
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;

    if (!options.allowExpired && Date.now() > envelope.expiresAt) {
      return null;
    }

    return envelope.value;
  } catch {
    return null;
  }
}

export async function writeLocalCache<T>(
  namespace: string,
  key: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  const filePath = getCacheFilePath(namespace, key);
  const dirPath = path.dirname(filePath);

  await mkdir(dirPath, { recursive: true });

  const payload: CacheEnvelope<T> = {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };

  const tempFilePath = `${filePath}.tmp`;
  await writeFile(tempFilePath, JSON.stringify(payload), 'utf8');
  try {
    await rename(tempFilePath, filePath);
  } catch {
    await unlink(tempFilePath).catch(() => undefined);
    throw new Error(`Failed to write cache file for ${namespace}/${key}`);
  }
}