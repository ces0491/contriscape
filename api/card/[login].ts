import { LOGIN_PATTERN } from '../../shared/contract.js';
import { drawCard, drawYearCard } from '../_lib/card.js';
import { fetchContributions, GitHubError } from '../_lib/github.js';
import { requestedLogin, requestedYear } from '../_lib/request.js';

const FOUND = 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400';
const NOT_FOUND = 'public, max-age=300, s-maxage=3600';
const UNCACHED = 'no-store';

/** The site's own picture, for a link whose card can't be drawn. A preview with the general card beats one with none. */
const general = (url: URL, cache: string): Response =>
  new Response(null, { status: 302, headers: { location: new URL('/og.png', url).href, 'cache-control': cache } });

/**
 * The picture a shared link to a city shows: that user's history as a skyline, or with `?year=` one year of it, in the
 * year's own gold. It reads GitHub as the city itself does, so a card the CDN hasn't got costs the same quota as a
 * visit, and it is cached for as long. A year with nothing in it gets the history's card.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const login = requestedLogin(url, true);
  const year = requestedYear(url);
  if (login === null || !LOGIN_PATTERN.test(login) || year === undefined) {
    return new Response('Not a GitHub username, or not a year.', {
      status: 400,
      headers: { 'cache-control': NOT_FOUND },
    });
  }

  // One cached copy per user and year, however the name is capitalised
  const canonical = login.toLowerCase();
  if (login !== canonical) {
    return Response.redirect(new URL(`/api/card/${canonical}${year === null ? '' : `?year=${year}`}`, url), 308);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is not set');
    return general(url, UNCACHED);
  }

  try {
    const data = await fetchContributions(canonical, token);
    const picture = (year === null ? null : drawYearCard(data, year)) ?? drawCard(data);
    return new Response(picture.png(), { headers: { 'content-type': 'image/png', 'cache-control': FOUND } });
  } catch (error) {
    if (error instanceof GitHubError && error.kind === 'not-found') return general(url, NOT_FOUND);
    if (!(error instanceof GitHubError)) console.error('Could not draw a card', error);
    return general(url, UNCACHED);
  }
}
