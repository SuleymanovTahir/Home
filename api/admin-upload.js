import { issueSignedToken } from '@vercel/blob';
import { handleUploadPresigned } from '@vercel/blob/client';
import { hasValidSession, isStorageConfigured } from '../lib/catalog.js';

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (!hasSameOrigin(request)) return json({ error: 'FORBIDDEN' }, 403);
    if (!hasValidSession(request)) return json({ error: 'UNAUTHORIZED' }, 401);
    if (!isStorageConfigured()) return json({ error: 'STORAGE_NOT_CONFIGURED' }, 503);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'INVALID_JSON' }, 400);
    }

    try {
      const result = await handleUploadPresigned({
        body,
        request,
        getSignedToken: async (pathname) => {
          if (!/^models\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.html$/i.test(pathname)) {
            throw new Error('INVALID_PATHNAME');
          }

          const token = await issueSignedToken({
            pathname,
            operations: ['put'],
            allowedContentTypes: ['text/html'],
            validUntil: Date.now() + 60 * 60 * 1000,
          });

          return {
            token,
            urlOptions: {
              allowedContentTypes: ['text/html'],
              contentType: 'text/html',
              addRandomSuffix: false,
              allowOverwrite: false,
              cacheControlMaxAge: 31_536_000,
            },
          };
        },
      });

      return json(result);
    } catch (error) {
      return json({ error: error?.message === 'INVALID_PATHNAME' ? 'INVALID_FILE' : 'UPLOAD_AUTH_FAILED' }, 400);
    }
  },
};

function hasSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
