const legacyModels = new Map([
  ['/3D-модель дома-2.html', 'house-two-floors'],
  ['/3D-модель дома-3.html', 'house-attic'],
]);

export default function proxy(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const id = legacyModels.get(pathname);
  const destination = new URL(
    id ? `/viewer.html?id=${encodeURIComponent(id)}` : '/',
    request.url,
  );

  return Response.redirect(destination, 307);
}
