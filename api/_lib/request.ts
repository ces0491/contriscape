/** The year GitHub opened, before which nobody has a contribution. */
const FIRST_YEAR = 2008;
/** The address a year is shared at, `/<username>/<year>`. */
const YEAR_ADDRESS = /^\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/(\d{4})$/;

/**
 * The login a request names: from the path, or from the `login` parameter Vercel's rewrite adds. Any other parameter is
 * refused with null, because the CDN caches per query string, so `?x=1`, `?x=2` would each run the function again.
 * `year` is let through where a route takes one, and `requestedYear` holds it to the years there are.
 *
 * A rewritten request can reach the function at the function's own path, with `[login]` in it, or at the address that
 * was asked for, which for a year is `/<username>/<year>`. Where the parameter names a login, the path has to name the
 * same one, so a path and a parameter can't point at two different people.
 */
export function requestedLogin(url: URL, takesYear = false): string | null {
  if ([...url.searchParams.keys()].some((name) => name !== 'login' && !(takesYear && name === 'year'))) return null;
  const segments = url.pathname.split('/');
  const last = segments.pop() ?? '';
  const query = url.searchParams.get('login');
  if (last === '[login]') return query;
  if (query === null || query === last) return last;
  return takesYear && YEAR_ADDRESS.exec(url.pathname)?.[1] === query ? query : null;
}

/**
 * The year a request asks for, from `?year=` or from an address of the form `/<username>/<year>`: null when it asks for
 * none, or undefined when it asks for one that can't be, which is anything but four digits from GitHub's first year to
 * this one. A link to a year gets that year's card and page, and nothing else gets a cached copy of its own.
 */
export function requestedYear(url: URL, now = new Date()): number | null | undefined {
  const asked = url.searchParams.get('year') ?? YEAR_ADDRESS.exec(url.pathname)?.[2] ?? null;
  if (asked === null) return null;
  if (!/^\d{4}$/.test(asked)) return undefined;
  const year = Number(asked);
  return year >= FIRST_YEAR && year <= now.getUTCFullYear() ? year : undefined;
}
