import { readCatalog } from '../lib/catalog.js';

export default {
  async fetch() {
    try {
      const catalog = await readCatalog();
      const models = catalog.models
        .filter((model) => !model.hidden)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(({ id, title, description }) => ({
          id,
          title,
          description: description ?? '',
          href: `/viewer.html?id=${encodeURIComponent(id)}`,
        }));

      return Response.json(
        { models },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch {
      return Response.json(
        { error: 'CATALOG_UNAVAILABLE', models: [] },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  },
};
