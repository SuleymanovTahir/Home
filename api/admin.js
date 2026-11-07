import { head } from '@vercel/blob';
import {
  clearSessionCookie,
  createSessionCookie,
  deleteModelBlob,
  hasValidSession,
  isAdminConfigured,
  isStorageConfigured,
  passwordMatches,
  readCatalog,
  saveCatalog,
} from '../lib/catalog.js';

const attempts = new Map();

export default {
  async fetch(request) {
    if (request.method === 'GET') return getAdminData(request);
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (!hasSameOrigin(request)) return json({ error: 'FORBIDDEN' }, 403);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'INVALID_JSON' }, 400);
    }

    if (body.action === 'login') return login(request, body.password);
    if (body.action === 'logout') {
      return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
    }

    if (!hasValidSession(request)) return json({ error: 'UNAUTHORIZED' }, 401);
    if (!isStorageConfigured()) return json({ error: 'STORAGE_NOT_CONFIGURED' }, 503);

    try {
      const catalog = await readCatalog();
      if (body.action === 'register-upload') return registerUploadedModel(catalog, body);
      if (body.action === 'rename') return renameModel(catalog, body);
      if (body.action === 'toggle') return toggleModel(catalog, body);
      if (body.action === 'reorder') return reorderModels(catalog, body);
      if (body.action === 'delete') return removeModel(catalog, body);
      return json({ error: 'UNKNOWN_ACTION' }, 400);
    } catch (error) {
      console.error('Model administration failed:', error?.message ?? 'unknown error');
      return json({ error: 'OPERATION_FAILED' }, 500);
    }
  },
};

async function getAdminData(request) {
  if (!hasValidSession(request)) return json({ error: 'UNAUTHORIZED' }, 401);
  if (!isStorageConfigured()) return json({ error: 'STORAGE_NOT_CONFIGURED' }, 503);

  try {
    const catalog = await readCatalog();
    return json({ models: catalog.models }, 200);
  } catch {
    return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
  }
}

function login(request, password) {
  if (!isAdminConfigured()) return json({ error: 'ADMIN_NOT_CONFIGURED' }, 503);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const now = Date.now();
  const current = attempts.get(ip);
  if (current && current.resetAt > now && current.count >= 8) {
    return json({ error: 'TOO_MANY_ATTEMPTS' }, 429);
  }

  if (!passwordMatches(password)) {
    if (!current || current.resetAt <= now) attempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    else attempts.set(ip, { count: current.count + 1, resetAt: current.resetAt });
    return json({ error: 'INVALID_PASSWORD' }, 401);
  }

  attempts.delete(ip);
  return json({ ok: true }, 200, { 'Set-Cookie': createSessionCookie() });
}

async function registerUploadedModel(catalog, body) {
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 100) {
    return json({ error: 'INVALID_TITLE' }, 400);
  }
  if (typeof body.description !== 'string' || body.description.length > 180) {
    return json({ error: 'INVALID_DESCRIPTION' }, 400);
  }

  const match = /^models\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.html$/i.exec(body.pathname ?? '');
  if (!match) {
    return json({ error: 'INVALID_FILE' }, 400);
  }

  const id = match[1];
  const storagePath = body.pathname;
  if (catalog.models.some((item) => item.id === id || item.storagePath === storagePath)) {
    return json({ error: 'MODEL_ALREADY_EXISTS' }, 409);
  }

  let blob;
  try {
    blob = await head(storagePath);
  } catch {
    return json({ error: 'UPLOAD_NOT_FOUND' }, 404);
  }
  if (!blob.contentType?.toLowerCase().startsWith('text/html')) {
    await deleteModelBlob(storagePath).catch(() => {});
    return json({ error: 'HTML_REQUIRED' }, 400);
  }

  catalog.models.push({
    id,
    title: body.title.trim(),
    description: body.description.trim().slice(0, 180) || 'Загруженная модель',
    storagePath,
    hidden: false,
    order: catalog.models.length,
    createdAt: new Date().toISOString(),
  });

  try {
    await saveCatalog(catalog);
  } catch (error) {
    await deleteModelBlob(storagePath).catch(() => {});
    throw error;
  }

  return json({ ok: true, id });
}

async function toggleModel(catalog, body) {
  const model = catalog.models.find((item) => item.id === body.id);
  if (!model || typeof body.hidden !== 'boolean') return json({ error: 'MODEL_NOT_FOUND' }, 404);

  model.hidden = body.hidden;
  await saveCatalog(catalog);
  return json({ ok: true });
}

async function renameModel(catalog, body) {
  const model = catalog.models.find((item) => item.id === body.id);
  if (!model) return json({ error: 'MODEL_NOT_FOUND' }, 404);
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 100) {
    return json({ error: 'INVALID_TITLE' }, 400);
  }

  model.title = body.title.trim();
  await saveCatalog(catalog);
  return json({ ok: true });
}

async function reorderModels(catalog, body) {
  const ids = body.ids;
  const currentIds = catalog.models.map((item) => item.id);
  if (
    !Array.isArray(ids) ||
    ids.length !== currentIds.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !currentIds.includes(id))
  ) {
    return json({ error: 'INVALID_ORDER' }, 400);
  }

  const byId = new Map(catalog.models.map((model) => [model.id, model]));
  catalog.models = ids.map((id, order) => ({ ...byId.get(id), order }));
  await saveCatalog(catalog);
  return json({ ok: true });
}

async function removeModel(catalog, body) {
  const index = catalog.models.findIndex((item) => item.id === body.id);
  if (index < 0) return json({ error: 'MODEL_NOT_FOUND' }, 404);

  const [model] = catalog.models.splice(index, 1);
  catalog.models.forEach((item, order) => { item.order = order; });
  await saveCatalog(catalog);
  if (model.storagePath) await deleteModelBlob(model.storagePath).catch(() => {});
  return json({ ok: true });
}

function hasSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...extraHeaders },
  });
}
