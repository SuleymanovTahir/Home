import { get } from '@vercel/blob';
import { readCatalog } from '../lib/catalog.js';

const sandboxPolicy = [
  'sandbox allow-scripts',
  "default-src https: data: blob:",
  "script-src https: 'unsafe-inline' 'unsafe-eval'",
  "style-src https: 'unsafe-inline'",
  'img-src https: data: blob:',
  'font-src https: data:',
  'connect-src https: data: blob:',
  'media-src https: data: blob:',
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

export default {
  async fetch(request) {
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return new Response('Not found', { status: 404 });

    try {
      const catalog = await readCatalog();
      const model = catalog.models.find((item) => item.id === id && !item.hidden);
      if (!model) return new Response('Not found', { status: 404 });

      const headers = {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': sandboxPolicy,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      };

      if (model.storagePath) {
        const blob = await get(model.storagePath, {
          access: 'private',
        });
        if (!blob) return new Response('Not found', { status: 404 });
        return new Response(blob.stream, { headers });
      }

      if (model.path) {
        const sourceUrl = new URL(`/${encodeURI(model.path)}`, request.url);
        const source = await fetch(sourceUrl);
        if (!source.ok) return new Response('Not found', { status: 404 });
        return new Response(await source.text(), { headers });
      }

      return new Response('Not found', { status: 404 });
    } catch {
      return new Response('Model unavailable', {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  },
};
