import { createHmac, timingSafeEqual } from 'node:crypto';
import { del, get, put } from '@vercel/blob';

export const CATALOG_PATH = 'catalog/models.json';

export const SEED_CATALOG = {
  models: [
    {
      id: 'house-two-floors',
      title: 'Два этажа',
      description: 'Навес-балкон 12 × 3 м · кирпич',
      path: 'model-sources/house-two-floor.html.txt',
      hidden: false,
      createdAt: '2026-11-07T00:00:00.000Z',
    },
    {
      id: 'house-attic',
      title: 'Два этажа и мансарда',
      description: 'Навес-балкон 12 × 3 м · кирпич',
      path: 'model-sources/house-attic.html.txt',
      hidden: false,
      createdAt: '2026-11-07T00:00:00.000Z',
    },
  ],
};

export function isStorageConfigured() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.BLOB_STORE_ID && process.env.VERCEL === '1'),
  );
}

export function isAdminConfigured() {
  return Boolean(
    process.env.ADMIN_PASSWORD?.length >= 16 &&
      process.env.SESSION_SECRET &&
      process.env.SESSION_SECRET.length >= 32,
  );
}

export async function readCatalog() {
  if (!isStorageConfigured()) return structuredClone(SEED_CATALOG);

  const stored = await get(CATALOG_PATH, {
    access: 'private',
    useCache: false,
  });

  if (!stored) return structuredClone(SEED_CATALOG);

  const parsed = JSON.parse(await new Response(stored.stream).text());
  if (!parsed || !Array.isArray(parsed.models)) {
    throw new Error('CATALOG_INVALID');
  }

  return parsed;
}

export async function saveCatalog(catalog) {
  await put(CATALOG_PATH, JSON.stringify(catalog), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json; charset=utf-8',
    cacheControlMaxAge: 60,
  });
}

export function createSessionCookie() {
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  const signature = sign(String(expiresAt));
  return `model_admin=${expiresAt}.${signature}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return 'model_admin=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';
}

export function hasValidSession(request) {
  if (!isAdminConfigured()) return false;

  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('model_admin='));
  const token = cookie?.slice('model_admin='.length);
  if (!token) return false;

  const [expiresAt, signature] = token.split('.');
  if (!expiresAt || !signature || Number(expiresAt) <= Date.now()) return false;

  const expected = Buffer.from(sign(expiresAt));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function passwordMatches(password) {
  const expected = Buffer.from(process.env.ADMIN_PASSWORD ?? '');
  const received = Buffer.from(typeof password === 'string' ? password : '');
  return expected.length > 0 && expected.length === received.length && timingSafeEqual(expected, received);
}

export async function deleteModelBlob(pathname) {
  if (pathname) await del(pathname);
}

function sign(value) {
  return createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('base64url');
}
