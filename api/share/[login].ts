import { LOGIN_PATTERN } from '../../shared/contract.js';
import { CARD_HEIGHT, CARD_WIDTH } from '../_lib/card.js';
import { requestedLogin, requestedYear } from '../_lib/request.js';

/**
 * What a link preview reads for `/<username>`, or `/<username>/<year>` for one year: the same address, with a title and
 * picture of that user's city or year. The site's one page can't carry these, because it is the same file for every
 * username. `vercel.json` sends only the programs that fetch previews here. People, and search engines, get the city.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const login = requestedLogin(url, true);
  const year = requestedYear(url);
  if (login === null || !LOGIN_PATTERN.test(login) || year === undefined) {
    return new Response('Not a GitHub username, or not a year.', {
      status: 400,
      headers: { 'cache-control': 'no-store' },
    });
  }

  // A login is letters, digits and hyphens, and a year four digits, so both can go into the page as they are
  const page = year === null ? `${url.origin}/${login}` : `${url.origin}/${login}/${year}`;
  const card = `${url.origin}/api/card/${login.toLowerCase()}${year === null ? '' : `?year=${year}`}`;
  const title = year === null ? `${login} · contriscape` : `${login}'s ${year} on GitHub · contriscape`;
  // LinkedIn's Post Inspector warns about a description under 100 characters, which the first sentence is for a
  // short username
  const description =
    year === null
      ? `Fly a starfighter through a city built from ${login}'s GitHub contributions, one tower per day. It runs in the browser, with nothing to install.`
      : `Fly through ${login}'s ${year} on GitHub as a city, one tower per day, past the year's busiest day, biggest month and longest streak. It runs in the browser.`;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${page}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="contriscape" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${page}" />
    <meta property="og:image" content="${card}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="${CARD_WIDTH}" />
    <meta property="og:image:height" content="${CARD_HEIGHT}" />
    <meta property="og:image:alt" content="${year === null ? `A skyline of ${login}'s GitHub contributions.` : `${login}'s ${year} on GitHub, as a gold skyline.`}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${card}" />
  </head>
  <body>
    <p>${description} Not affiliated with GitHub.</p>
    <p><a href="${url.origin}/">contriscape</a></p>
  </body>
</html>
`;
  // Never cached, so a preview's page can't be handed to a person asking for the same address
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
