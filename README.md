# contriscape

**[contriscape.sheetsolved.com](https://contriscape.sheetsolved.com)**

Enter a GitHub username and fly a starfighter through a 3D city of that person's contributions. Each tower is one day, and each year is a block of 53 by 7 towers with alleys you can fly down.

The name is short for contribution landscape: GitHub's calendar counts commits, pull requests, issues and reviews, and so does the city. This is an independent project, not affiliated with or endorsed by GitHub.

## Flying

| Mode      | What it does                                                                                 |
| --------- | -------------------------------------------------------------------------------------------- |
| Autopilot | Replays the history as a flight. The city rises as the date passes. Click Pilot to take over |
| Pilot     | You fly. Gold markers lead to the badges, and aiming at a tower reads its date and count     |
| Orbit     | Rotate and zoom around the finished city, and hover over a tower to read it                  |

Autopilot keeps to a steady height through each year, set by that year's towers. It sits above about two thirds of the days, so the busiest ones rise past the ship.

A flight through the whole history flies down the alleys of two years: the busiest, and the latest busy one. It passes the others at speed up the west side of the city, over the year numbers painted there, with the date running ahead so each year rises as the ship reaches it. Picking a year from All years flies that year alone. When a flight ends the view pulls out to Orbit and offers the controls.

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

On a phone, drag to steer, pinch to zoom, and use the Fire, Boost and Brake buttons. Dragging up and down climbs and dives, so there are no buttons for those.

All years opens the list of years, which keeps the screen the same size however long the history is. Settings holds sound, music, mouse steering, Invert Y and the colours. N switches sound on and off in Autopilot and Orbit as well as Pilot. The Guide button on the page covers the controls, the buttons and where the badges come from. Esc closes any panel.

A city lives at `/<username>`, so the address is the share link. The site root shows `torvalds` as an example, and its first hint says so.

A link pasted into Slack, LinkedIn and the like previews with a card of that user's history as a skyline. The site's one page is the same file for every username and can't carry a card of its own, so `vercel.json` sends the programs that fetch previews, picked out by their user agent, to a small page that names the card. People and search engines get the city.

### Badges

Illustrated medallions float over the days a user hit a milestone: joining GitHub, a first pull request, a thousandth contribution, a longest streak, a busiest day. In Pilot, gold markers show the badges still standing, with their distance. Up to four of the nearest out of view are pinned to the edge of the screen with their artwork, pointing the way. Or open the Badges list and pick one to jump there, and the ship waits in front of it while you line up the shot.

A badge found by its marker is earned as flown, and the list tags it and keeps count. One shot from where a jump set the ship down, or within 120 units of flying after it, is earned without the tag. With no badge left standing, a marker in the buildings' colour points back to the city once the ship is more than 40 units clear of it.

A city cleared by flying, from no badge earned to the last, is timed. The clock sits under the date in Pilot and counts while the ship is in your hands, so it stops for an open panel. A jump from the list ends the timing. The fastest clear is kept in the browser, shown in the Badges list, and outlasts a reset.

Aim close to a badge with no tower in the way and the targeting computer locks on, with a tone and its name. Shots fired while locked curve into it, which helps on a phone. A hit blows the badge up and earns it. These are this site's own badges, dated from GitHub's API. GitHub has no API for its profile achievements, so they aren't shown. Earned badges are stored only in the visitor's browser and don't change anything on GitHub. Reset, at the top of the list, brings back the ones earned on that city after a second press.

Shooting a city's last badge clears it: rockets climb and burst across the view, lighting the towers under them, the ship does a victory roll, and the Badges button turns gold. The Guide leaves this out so it stays a surprise. With reduced motion on, a message marks the moment and the show is skipped.

### Colours

Settings changes the buildings, the ship and the ship's trim, from swatches or a free colour picker. The choice applies to every city and stays in the visitor's browser. A building colour keeps its hue, and each step of its ramp is set to the default green's brightness, which holds glare close to the default's and keeps dark picks visible. The timeline and the green controls follow the buildings.

### Sound

Lasers, hits, bumps, exploding badges, hyperspace jumps, boosts, the target lock and the fireworks have sound effects. The engine hums louder and higher with speed, quieter in Autopilot than in Pilot, and towers rushing past close to the ship whoosh on their own side. Effects sit left or right of the camera and ring in a reverb. An earned badge chimes, and a cleared city gets a short fanfare.

Music plays under the effects: slow chords, with a melody made from the history. In Autopilot each note is the busiest day just passed, higher for a busier day, so a quiet stretch goes silent and a busy one climbs. In Pilot the towers the ship crosses play, and in Orbit pointing at a tower plays it. The melody keeps to one pentatonic scale, over chords voiced to fit it.

The sounds and music are made in the browser with the Web Audio API, so there are no audio files. Both are on by default and start at the first click, tap or key press, because browsers block audio until then. An iPhone in silent mode mutes them, as iOS does for web audio. N or Settings switches all sound off, Settings switches the music off on its own, and the choices stay in the visitor's browser.

### Your year on GitHub

During December a button offers a flight through the current year, with captions for its biggest moments and a closing summary. `/<username>#your-year` opens it at any time of year.

## Data and privacy

The page shows what a user's public GitHub profile already shows. Private contributions appear as anonymous counts only if that user has turned them on in their profile settings. Responses are cached on the CDN for six hours, and the site has no database, accounts or cookies. [Vercel Web Analytics](https://vercel.com/docs/analytics/privacy-policy) counts page views without cookies, recording the page, the referrer, a rough location, and the device and browser, with nothing that identifies a visitor. Only production builds load it. Earned badges and settings, including whether sound and music are on, stay in the visitor's own browser. Fonts load from Google Fonts.

Tower height is the square root of the day's contributions, measured against a busy day for that user: 99 in 100 of their active days have no more. The few days above that stand a little taller, by up to a third, so one enormous day doesn't leave every other tower a stub. The busiest day is still the tallest tower. With fewer than 50 active days, heights are measured against the busiest. The towers' colours and the music's notes follow the same measure.

## Running it

Requires Node 24.

```sh
npm install
cp .env.example .env.local   # then add a token, see below
npm run dev
```

`GITHUB_TOKEN` is a [personal access token (classic)](https://github.com/settings/tokens) with no scopes ticked. GitHub's GraphQL API needs a token even for public data, so it lives on the server. `npm run dev` runs the API inside the Vite dev server, with no Vercel login needed.

| Command            | Does                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `npm test`         | API, route, ride, badge, year, zoom, colour, show, sound, music, aiming, collision, sight and clock tests |
| `npm run test:e2e` | Browser tests with a stubbed API, under the production CSP                                                |
| `npm run lint`     | ESLint                                                                                                    |
| `npm run build`    | Typecheck, then build to `dist`                                                                           |

`npx playwright install chromium` fetches the browser for the end-to-end tests.

## How it's built

- `api/contributions/[login].ts` is a Vercel Function that validates the login and sets cache headers. `api/_lib/github.ts` talks to GitHub.
- `api/card/[login].ts` draws the card a shared link previews with, and `api/share/[login].ts` is the page a preview fetcher reads. `api/_lib/card.ts` lays the card out, and `api/_lib/png.ts` and `api/_lib/letters.ts` draw it as rectangles and block capitals with Node's own zlib, so it needs no image library.
- `shared/contract.ts` holds the API's schema, used on both sides.
- `src/main.ts` loads a city. A browser without WebGL 2 gets the Guide as the page instead, and the API isn't called.
- `src/calendar.ts`, `src/map.ts` and `src/routes.ts` hold the data, the city grid and the flight paths. `src/milestones.ts` and `src/review.ts` work out the badges and the year story, `src/run.ts` keeps the clock on a timed clear, and `src/colours.ts`, `src/zoom.ts`, `src/steering.ts` and `src/quality.ts` hold the colour palettes, the zoom steps, the key response and the frame average that lowers quality on a slow GPU. `src/aim.ts` picks the badge to lock on to and curves a bolt towards it, `src/lights.ts` chooses which flashes light the towers each frame, and `src/markers.ts` places the markers and chooses which to show. `src/collision.ts` pushes the ship back out of a tower it has hit, and `src/sight.ts` holds the lines of sight: the tower being aimed at, whether one hides a badge, how far back the chase camera can sit, and the height to come at a badge from. None of them need WebGL, which is what makes them testable.
- `src/world.ts`, `src/fighter.ts`, `src/badges.ts`, `src/blast.ts`, `src/fireworks.ts` and `src/app.ts` are the three.js scene, the ship and its guns, the floating badges, their explosions, the show for a cleared city and the flight modes. `src/environment.ts` renders what the ship's metal and glass reflect, and `src/trails.ts` draws the vapour off its wingtips.
- `src/badge-art.ts` draws the badge artwork at runtime, and `src/hud.ts` is everything on screen that isn't the 3D scene.
- `src/sound.ts` makes the sound effects and mixes them with the music from `src/music.ts`, all with the Web Audio API, and builds nothing until the visitor's first click, tap or key press.

## GitHub's limits

GitHub allows a token 5,000 GraphQL points an hour. A username not in the cache costs 1 point, plus 1 for every three years of history, so a typical user costs 4 to 8 points. That covers roughly 600 to 1,200 new usernames an hour, and repeat visits cost nothing. A history starts at the earliest year GitHub lists for the user, which can be before the account was made, and goes back no more than 30 years, so the most a username can cost is 11 points. A card the CDN doesn't hold costs the same as a visit and is cached as long. Past that, visitors see a message asking them to try again. Requests covering all of a long history at once fail on GitHub's side, so the API fetches three years at a time.

## Deploying

1. Create a Vercel project from this repo. The framework preset is Vite.
2. Add `GITHUB_TOKEN` to the project's environment variables, then redeploy, because new variables only reach new deployments.
3. Add a Vercel Firewall rate-limit rule on `/api/contributions` and `/api/card`, keyed on IP, since both read GitHub. The Hobby plan allows one rule.
4. Add the custom domain and create the DNS record Vercel gives you. The generated `contriscape.vercel.app` alias goes on serving the whole site after that, so `vercel.json` redirects it to the custom domain. Change that rule if the domain changes.
5. Turn on Web Analytics in the project's Analytics tab. Its routes arrive with the next deployment, so deploy again afterwards.

## Licence

MIT. See [LICENSE](LICENSE).
