/** The year GitHub opened, before which nobody has a contribution. */
const FIRST_YEAR = 2008;

/**
 * The login a request names: from the path, or from the `login` parameter Vercel's rewrite adds. Any other parameter is
 * refused with null, because the CDN caches per query string, so `?x=1`, `?x=2` would each run the function again.
 * `year` is let through where a route takes one, and `requestedYear` holds it to the years there are.
 */
export function requestedLogin(url: URL, takesYear = false): string | null {
  if ([...url.searchParams.keys()].some((name) => name !== 'login' && !(takesYear && name === 'year'))) return null;
  const segment = url.pathname.split('/').pop() ?? '';
  const query = url.searchParams.get('login');
  if (segment === '[login]') return query;
  return query === null || query === segment ? segment : null;
}

/**
 * The year a request asks for: null when it asks for none, or undefined when it asks for one that can't be, which is
 * anything but four digits from GitHub's first year to this one. A link to a year gets that year's card and page, and
 * nothing else gets a cached copy of its own.
 */
export function requestedYear(url: URL, now = new Date()): number | null | undefined {
  const asked = url.searchParams.get('year');
  if (asked === null) return null;
  if (!/^\d{4}$/.test(asked)) return undefined;
  const year = Number(asked);
  return year >= FIRST_YEAR && year <= now.getUTCFullYear() ? year : undefined;
}
