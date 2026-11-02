# contriscape

**[contriscape.sheetsolved.com](https://contriscape.sheetsolved.com)**

Enter a GitHub username and fly a starfighter through a 3D city of that person's contributions. Each tower is one day, and each year is a block of 53 by 7 towers with alleys you can fly down.

The name is short for contribution landscape: GitHub's calendar counts commits, pull requests, issues and reviews, and so does the city. This is an independent project, not affiliated with or endorsed by GitHub.

## Flying

| Mode      | What it does                                                                                 |
| --------- | -------------------------------------------------------------------------------------------- |
| Autopilot | Replays the history as a flight. The city rises as the date passes. Click Pilot to take over |
| Pilot     | You fly. Aim at a tower to read its date and count                                           |
| Orbit     | Rotate and zoom around the finished city, and hover over a tower to read it                  |

Scroll zooms in all three. In Autopilot and Pilot it runs from far behind the ship into the cockpit.

| Pilot control         | Action    |
| --------------------- | --------- |
| Mouse, WASD or arrows | Steer     |
| Q / E                 | Down / up |
| Shift                 | Boost     |
| C                     | Brake     |
| Click or Space        | Fire      |
| I                     | Invert Y  |

On a phone, drag to steer, pinch to zoom and use the Fire button.

A city lives at `/<username>`, so the address is the share link. The site root shows `torvalds`.

### Badges

Illustrated medallions float over the days a user hit a milestone: joining GitHub, a first pull request, a thousandth contribution, a longest streak, a busiest day. Open the Badges list to see them and fly to one, then shoot it to earn it. These are this site's own badges, dated from GitHub's API. GitHub has no API for its profile achievements, so they aren't shown. Earned badges are stored only in the visitor's browser and don't change anything on GitHub.

### Your year on GitHub

During December a button offers a flight through the current year, with captions for its biggest moments and a closing summary. `/<username>#your-year` opens it at any time of year.

## Data and privacy

The page shows what a user's public GitHub profile already shows. Private contributions appear as anonymous counts only if that user has turned them on in their profile settings. Responses are cached on the CDN for six hours, and the site has no database, accounts, cookies or analytics. Earned badges and the Invert Y setting stay in the visitor's own browser. Fonts load from Google Fonts.

Tower height is the square root of the day's contributions, scaled to that user's busiest day, so typical days stay visible beside a huge one.

## Running it

Requires Node 24.

```sh
npm install
cp .env.example .env.local   # then add a token, see below
npm run dev
```

`GITHUB_TOKEN` is a [personal access token (classic)](https://github.com/settings/tokens) with no scopes ticked. GitHub's GraphQL API needs a token even for public data, so it lives on the server. `npm run dev` runs the API inside the Vite dev server, with no Vercel login needed.

| Command            | Does                                                       |
| ------------------ | ---------------------------------------------------------- |
| `npm test`         | API, flight route, ride quality, badge and year tests      |
| `npm run test:e2e` | Browser tests with a stubbed API, under the production CSP |
| `npm run lint`     | ESLint                                                     |
| `npm run build`    | Typecheck, then build to `dist`                            |

`npx playwright install chromium` fetches the browser for the end-to-end tests.

## How it's built

- `api/contributions/[login].ts` is a Vercel Function that validates the login and sets cache headers. `api/_lib/github.ts` talks to GitHub.
- `shared/contract.ts` holds the API's schema, used on both sides.
- `src/calendar.ts`, `src/map.ts` and `src/routes.ts` hold the data, the city grid and the flight paths. `src/milestones.ts` and `src/review.ts` work out the badges and the year story. None of them need WebGL, which is what makes them testable.
- `src/world.ts`, `src/fighter.ts`, `src/badges.ts` and `src/app.ts` are the three.js scene, the ship, the floating badges and the flight modes.
- `src/badge-art.ts` draws the badge artwork at runtime, and `src/hud.ts` is everything on screen that isn't the 3D scene.

## GitHub's limits

GitHub allows a token 5,000 GraphQL points an hour. A username not in the cache costs 1 point, plus 1 for every three years of history, so a typical user costs 4 to 8 points. That covers roughly 600 to 1,200 new usernames an hour, and repeat visits cost nothing. Past that, visitors see a message asking them to try again. Requests covering all of a long history at once fail on GitHub's side, so the API fetches three years at a time.

## Deploying

1. Create a Vercel project from this repo. The framework preset is Vite.
2. Add `GITHUB_TOKEN` to the project's environment variables, then redeploy, because new variables only reach new deployments.
3. Add a Vercel Firewall rate-limit rule on `/api/contributions`, keyed on IP. The Hobby plan allows one.
4. Add the custom domain and create the DNS record Vercel gives you.

## Licence

MIT. See [LICENSE](LICENSE).
