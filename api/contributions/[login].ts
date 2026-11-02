import { LOGIN_PATTERN, type ApiError } from '../../shared/contract.js';
import { fetchContributions, GitHubError } from '../_lib/github.js';

const FOUND = 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400';
const NOT_FOUND = 'public, max-age=300, s-maxage=3600';
const UNCACHED = 'no-store';

const failure = (error: ApiError, status: number, cache: string, headers: Record<string, string> = {}): Response =>
  Response.json({ error }, { status, headers: { 'cache-control': cache, ...headers } });

/**
 * The login from the path, or from the `login` parameter Vercel's rewrite adds.
 * Any other parameter is refused: the CDN caches per query string, so `?x=1`, `?x=2` would each cost GitHub quota.
 */
function requestedLogin(url: URL): string | null {
  if ([...url.searchParams.keys()].some((name) => name !== 'login')) return null;
  const segment = url.pathname.split('/').pop() ?? '';
  const query = url.searchParams.get('login');
  if (segment === '[login]') return query;
  return query === null || query === segment ? segment : null;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const login = requestedLogin(url);
  if (login === null || !LOGIN_PATTERN.test(login)) return failure('invalid-login', 400, NOT_FOUND);

  // One cached copy per user, however the name is capitalised
  const canonical = login.toLowerCase();
  if (login !== canonical) return Response.redirect(new URL(`/api/contributions/${canonical}`, url), 308);

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is not set');
    return failure('unavailable', 503, UNCACHED);
  }

  try {
    const body = await fetchContributions(canonical, token);
    return Response.json(body, { headers: { 'cache-control': FOUND } });
  } catch (error) {
    if (error instanceof GitHubError) {
      if (error.kind === 'not-found') return failure('not-found', 404, NOT_FOUND);
      if (error.kind === 'rate-limited') {
        return failure('rate-limited', 429, UNCACHED, { 'retry-after': String(error.retryAfter ?? 60) });
      }
    } else {
      console.error('Unexpected reply from GitHub', error);
    }
    return failure('unavailable', 502, UNCACHED);
  }
}
