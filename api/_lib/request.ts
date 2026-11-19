/**
 * The login a request names: from the path, or from the `login` parameter Vercel's rewrite adds. Any other parameter is
 * refused with null, because the CDN caches per query string, so `?x=1`, `?x=2` would each run the function again.
 */
export function requestedLogin(url: URL): string | null {
  if ([...url.searchParams.keys()].some((name) => name !== 'login')) return null;
  const segment = url.pathname.split('/').pop() ?? '';
  const query = url.searchParams.get('login');
  if (segment === '[login]') return query;
  return query === null || query === segment ? segment : null;
}
