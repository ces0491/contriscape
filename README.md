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

Autopilot keeps to a steady height through each year, set by that year's towers. It sits above about two thirds of the days, so the busiest ones rise past the ship.

Scroll zooms in all three. In Autopilot and Pilot it runs from far behind the ship into the cockpit, and scrolling out leaves the cockpit again.

| Pilot control  | Action                |
| -------------- | --------------------- |
| WASD or arrows | Steer                 |
| Q / E          | Down / up             |
| Shift          | Boost                 |
| C              | Brake                 |
| Click or Space | Fire                  |
| M              | Mouse steering on/off |
| I              | Invert Y              |
| N              | Sound on/off          |

A tap of a steering key nudges the nose and holding it turns harder. Mouse steering is off by default, so the mouse stays free for the buttons, and the ship stops while a panel is open.

On a phone, drag to steer, pinch to zoom and use the Fire button.

All years opens the list of years, which keeps the screen the same size however long the history is. Settings holds sound, mouse steering, Invert Y and the colours. N switches sound on and off in Autopilot and Orbit as well as Pilot. The Guide button on the page covers the controls, the buttons and where the badges come from. Esc closes any panel.

A city lives at `/<username>`, so the address is the share link. The site root shows `torvalds`.

### Badges

Illustrated medallions float over the days a user hit a milestone: joining GitHub, a first pull request, a thousandth contribution, a longest streak, a busiest day. Open the Badges list to see them and fly to one. The ship waits in front of it while you line up the shot, and a hit blows the badge up and earns it. These are this site's own badges, dated from GitHub's API. GitHub has no API for its profile achievements, so they aren't shown. Earned badges are stored only in the visitor's browser and don't change anything on GitHub. Reset, at the top of the list, brings back the ones earned on that city after a second press.

Shooting a city's last badge clears it: fireworks go up across the view, the ship does a victory roll, and the Badges button turns gold. The Guide leaves this out so it stays a surprise. With reduced motion on, a message marks the moment and the show is skipped.

### Colours

Settings changes the buildings, the ship and the ship's trim, from swatches or a free colour picker. The choice applies to every city and stays in the visitor's browser. A building colour keeps its hue, and each step of its ramp is set to the default green's brightness, which holds glare close to the default's and keeps dark picks visible. The timeline and the green controls follow the buildings.

### Sound

Lasers, hits, bumps, exploding badges, hyperspace jumps and the fireworks have sound effects, and in Pilot the engine hums louder and higher with speed. An earned badge chimes, and a cleared city gets a short fanfare. The sounds are made in the browser with the Web Audio API, so there are no audio files. Sound is on by default and starts at the first click, tap or key press, because browsers block audio until then. An iPhone in silent mode mutes it, as iOS does for web audio. N or Settings switches it off, and the choice stays in the visitor's browser.

### Your year on GitHub

During December a button offers a flight through the current year, with captions for its biggest moments and a closing summary. `/<username>#your-year` opens it at any time of year.

## Data and privacy

The page shows what a user's public GitHub profile already shows. Private contributions appear as anonymous counts only if that user has turned them on in their profile settings. Responses are cached on the CDN for six hours, and the site has no database, accounts or cookies. [Vercel Web Analytics](https://vercel.com/docs/analytics/privacy-policy) counts page views without cookies, recording the page, the referrer, a rough location, and the device and browser, with nothing that identifies a visitor. Only production builds load it. Earned badges and settings, including whether sound is on, stay in the visitor's own browser. Fonts load from Google Fonts.

Tower height is the square root of the day's contributions, scaled to that user's busiest day, so typical days stay visible beside a huge one.

## Running it

Requires Node 24.

```sh
npm install
cp .env.example .env.local   # then add a token, see below
npm run dev
```

`GITHUB_TOKEN` is a [personal access token (classic)](https://github.com/settings/tokens) with no scopes ticked. GitHub's GraphQL API needs a token even for public data, so it lives on the server. `npm run dev` runs the API inside the Vite dev server, with no Vercel login needed.

| Command            | Does                                                              |
| ------------------ | ----------------------------------------------------------------- |
| `npm test`         | API, route, ride, badge, year, zoom, colour, show and sound tests |
| `npm run test:e2e` | Browser tests with a stubbed API, under the production CSP        |
| `npm run lint`     | ESLint                                                            |
| `npm run build`    | Typecheck, then build to `dist`                                   |

`npx playwright install chromium` fetches the browser for the end-to-end tests.

## How it's built

- `api/contributions/[login].ts` is a Vercel Function that validates the login and sets cache headers. `api/_lib/github.ts` talks to GitHub.
- `shared/contract.ts` holds the API's schema, used on both sides.
- `src/main.ts` loads a city. A browser without WebGL 2 gets the Guide as the page instead, and the API isn't called.
- `src/calendar.ts`, `src/map.ts` and `src/routes.ts` hold the data, the city grid and the flight paths. `src/milestones.ts` and `src/review.ts` work out the badges and the year story, and `src/colours.ts`, `src/zoom.ts`, `src/steering.ts` and `src/quality.ts` hold the colour palettes, the zoom steps, the key response and the frame average that lowers quality on a slow GPU. None of them need WebGL, which is what makes them testable.
- `src/world.ts`, `src/fighter.ts`, `src/badges.ts`, `src/blast.ts`, `src/fireworks.ts` and `src/app.ts` are the three.js scene, the ship, the floating badges, their explosions, the show for a cleared city and the flight modes.
- `src/badge-art.ts` draws the badge artwork at runtime, and `src/hud.ts` is everything on screen that isn't the 3D scene.
- `src/sound.ts` makes the sound effects with the Web Audio API, and builds nothing until the visitor's first click, tap or key press.

## GitHub's limits

GitHub allows a token 5,000 GraphQL points an hour. A username not in the cache costs 1 point, plus 1 for every three years of history, so a typical user costs 4 to 8 points. That covers roughly 600 to 1,200 new usernames an hour, and repeat visits cost nothing. Past that, visitors see a message asking them to try again. Requests covering all of a long history at once fail on GitHub's side, so the API fetches three years at a time.

## Deploying

1. Create a Vercel project from this repo. The framework preset is Vite.
2. Add `GITHUB_TOKEN` to the project's environment variables, then redeploy, because new variables only reach new deployments.
3. Add a Vercel Firewall rate-limit rule on `/api/contributions`, keyed on IP. The Hobby plan allows one.
4. Add the custom domain and create the DNS record Vercel gives you. The generated `contriscape.vercel.app` alias goes on serving the whole site after that, so `vercel.json` redirects it to the custom domain. Change that rule if the domain changes.
5. Turn on Web Analytics in the project's Analytics tab. Its routes arrive with the next deployment, so deploy again afterwards.

## Licence

MIT. See [LICENSE](LICENSE).
