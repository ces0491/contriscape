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

| Pilot control     | Action                                   |
| ----------------- | ---------------------------------------- |
| WASD or arrows    | Steer                                    |
| Q / E             | Down / up                                |
| Shift             | Boost                                    |
| C                 | Brake                                    |
| Click or Space    | Fire                                     |
| Double-tap A or D | Barrel roll that way, one alley across   |
| W with A or D     | Fly on the side that way, turning harder |
| M                 | Mouse steering on/off                    |
| I                 | Invert Y                                 |
| N                 | Sound on/off                             |

A tap of a steering key nudges the nose and holding it turns harder. A double tap of a direction rolls the ship once round and carries it one alley across. Holding W, or the up arrow, with a direction puts the ship on its side and pulls it round that way half as fast again, without climbing. Mouse steering is off by default, so the mouse stays free for the buttons, and the ship stops while a panel is open.

On a phone, drag to steer, pinch to zoom, and use the Fire, Boost and Brake buttons. Dragging up and down climbs and dives, so there are no buttons for those. The barrel roll and flying on the side are on the keyboard only.

All years opens the list of years, which keeps the screen the same size however long the history is. Settings holds sound, music, mouse steering, Invert Y, the screensaver, the look, the ship and the colours. N switches sound on and off in Autopilot and Orbit as well as Pilot. The Guide button on the page covers the controls, the buttons and where the badges come from. Esc closes any panel.

A city lives at `/<username>`, so the address is the share link. On a first visit the site root shows `torvalds` as an example, and its first hint says so. After that the root opens the city the browser opened last, at that city's own address, and falls back to the example if the account has gone.

A link pasted into Slack, LinkedIn and the like previews with a card of that user's history as a skyline. The site's one page is the same file for every username and can't carry a card of its own, so `vercel.json` sends the programs that fetch previews, picked out by their user agent, to a small page that names the card. People and search engines get the city.

### Screensaver

Start, under Screensaver in Settings, turns the city into a screensaver. It takes the whole screen where the browser allows it and hides the page around the view. It flies the city's busier years one at a time, those with at least a twentieth of the busiest year's contributions, and the whole history where there is more than one year, in a shuffled order. In a history of more than one year it doesn't fly the same one twice running. After each flight it orbits the city for 20 seconds. Flights are watched from behind the ship, from further back and from the cockpit, in turn, and each opens with a line naming the city and its years, which fades after eight seconds.

Moving the mouse, pressing a key, clicking, tapping or scrolling ends it. The key or scroll that ends it does nothing else, so Space doesn't also pause the flight, though a key still lets the sound start. The view stays where the screensaver left it, at the visitor's own zoom. Moves of the mouse in the first second are ignored, so the hand that pressed Start can let go. The engine, the whooshes and the jumps go quiet while it runs, and the music plays on if it is on.

After 2 minutes idle, beside Start, lets it start by itself once the page has had no input for two minutes. It is off until switched on and stays in the browser. It won't start over an open panel, during a race or Your year, or under the card that ends either or offers a challenge. Started that way it stays inside the browser window, because browsers only give a page the whole screen on a click or key press.

`/<username>#screensaver` opens a city straight into its screensaver, for a screen left showing it, also inside the window. Leaving takes the fragment off the address, so a reload opens the city as usual.

### Explore

Explore, beside the username box, lists other cities to fly, for a visitor with no username in mind. Most of the lists are fields, such as statistics, security or games. A field's list holds up to twelve people whose GitHub bio has the field's words, such as "game developer", most followed first, each with 200 followers or more. One more list comes from repos, as they stood when the lists were made: the people who own the most-starred repos on GitHub. An organisation has no contribution calendar, so a repo counts only if a person owns it. To be listed, an account also needs at least 365 contributions in the year before, so its city has something in it. Random city picks one of them, and never the city already on screen.

A city picked there opens with its owner's name and bio. The panel's other half, This city, says more about any city's owner: the bio, the follower count, the languages most of their repos are in, and the repos they pinned, or their most-starred if they pinned none, each linked to GitHub.

The lists are a file, `public/explore.json`, which `npm run explore` writes from GitHub's search, so opening the panel costs GitHub nothing. They are a snapshot, and the panel gives its date. There is no list of trending repos. GitHub's API has none, and the nearest search, new repos by stars, turns up whatever is popular that month, which nobody can check before it is on the page. Explore also works when a username isn't found, where there is no city to show.

### Racing

Race, beside the timeline, offers two kinds of race on any year with contributions: Rival, against Autopilot, and Time attack, below. Under Rival it lists those years newest first, each with the rival's time and your fastest. A race takes the ship to a start line west of that year's block and counts down from three. The course is the line Autopilot takes down the year's alleys, then once round its busiest day, climbing, to finish on a short straight. Gold rings are the gates: the next one is bright and has a marker, the few after it are dim, and one flown past has to be gone back for. The end of an Autopilot flight also offers Race it.

The rival is Autopilot, flying the same line in another ship. It picks up speed as the ship does and takes each stretch as fast as its corners allow. On the courses tested it averages from Pilot's cruising speed to a third faster, so a clean run at cruise ties or loses, and one that boosts where it can wins. The readout under the header gives the gate, the clock, the gap to the rival at the last gate, and the score.

Passing close to a tower at speed scores a near miss, more the closer and faster, and each tower counts once a race. Near misses in quick succession build a chain, multiplied by up to three, which banks when two seconds pass without another or it reaches the top multiplier. Clipping a tower loses the chain, and costs speed as it does outside a race. An open panel holds the race. Changing mode, year or ship calls it off.

The fastest time and the highest score are kept for each year and each ship, and the list marks a year where the rival has been beaten. The fastest run with a ship is kept as a ghost, a faint copy that flies alongside in later races on that course with that ship. The browser keeps the 20 most recent ghosts.

A result can be copied as a challenge: a link such as `/<username>#race=2025&beat=41.2&ship=rocket`, which opens on a card offering that race with the time to beat, and the readout shows it. Nothing checks the time, which is fine between friends.

Explore names a day's course at the top of its lists: one of its cities, picked by the date, on one of that city's busier years, picked by the date too, so everyone with the same lists gets the same course that day. Its link opens on a card offering the race.

Explore also lists the cities flown in this browser, under Flown here, with what was done on each, and marks them in the other lists as Flown, Raced or Cleared.

### Time attack

Time attack, the other half of the Race panel, is flown against the clock with no rival. The course goes out from the west end of a year's block to its east end, round a loop past it, and back to finish near the start. Each way it weaves: a ring low down an alley between the towers, then one over the roofs of the next row on the way to the alley beside it, or, where those roofs are too tall to hop, one high up the walls of the same alley. A ring over the roofs clears the row it crosses by more than the ring's own radius. A course has a dozen rings or more, and a busy year keeps more of them down in its alleys.

The clock starts with enough time to reach the first ring at 21 units a second, plus three seconds. Each ring adds the time the stretch to the next one takes at that speed, so flying the line at cruising speed runs out partway, and averaging more than 21 along it finishes with time to spare. As with a race's gates, a ring flown past has to be gone back for, an open panel holds the clock, and changing mode, year or ship calls the run off. The readout gives the ring, the clock, the time the last ring added, and this ship's best. The clock turns red and ticks in its last three seconds, and running out ends the run at the ring it was heading for. The most rings reached and the most time left at a finish are kept for each year and ship, and the list marks a year finished in any ship. A time attack has no ghost, near-miss score or challenge link.

### Badges

Illustrated medallions float over the days a user hit a milestone: joining GitHub, a first pull request, a thousandth contribution, a longest streak, a busiest day. In Pilot, gold markers show the badges still standing, with their distance. Up to four of the nearest out of view are pinned to the edge of the screen with their artwork, pointing the way. Or open the Badges list and pick one to jump there, and the ship waits in front of it while you line up the shot.

A badge is earned by shooting it or by flying into it. One flown into throws out its gold around the ship, without the fireball and shake of a shot, which would fill the view from just behind. It counts once a wingtip reaches the medallion's rim, and a fast ship can't skip one between frames. When the wait in front of a badge runs out, the ship flies on into it.

A badge found by its marker is earned as flown, and the list tags it and keeps count. One won from where a jump set the ship down, or within 120 units of flying after it, is earned without the tag. With no badge left standing, a marker in the buildings' colour points back to the city once the ship is more than 40 units clear of it.

A city cleared by flying, from no badge earned to the last, is timed. The clock sits under the date in Pilot and counts while the ship is in your hands, so it stops for an open panel. A jump from the list ends the timing. The fastest clear is kept in the browser, shown in the Badges list, and outlasts a reset.

Aim close to a badge with no tower in the way and the targeting computer locks on, with a tone and its name. Shots fired while locked curve into it, which helps on a phone. A hit blows the badge up and earns it. These are this site's own badges, dated from GitHub's API. GitHub has no API for its profile achievements, so they aren't shown. Earned badges are stored only in the visitor's browser and don't change anything on GitHub. Reset, at the top of the list, brings back the ones earned on that city after a second press.

Earning a city's last badge clears it: rockets climb and burst across the view, lighting the towers under them, the ship does a victory roll, and the Badges button turns gold. The Guide leaves this out so it stays a surprise. With reduced motion on, a message marks the moment and the show is skipped.

### Looks

Settings has six looks. A look changes how the city is drawn at once, applies to every city, and stays in the visitor's browser. Flying, badges, colours and sound are the same in all of them, and a shared link's card is drawn in the night look.

| Look   | What it is                                                                                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Night  | The default: lit windows, flat roofs, painted streets, a wet street's reflection, a ringed planet overhead and the rest of the city far off along the horizon                                                             |
| Blocks | The same city by day. Each tower is a stack of blocks in the buildings' colour, pale for a quiet day and full colour for a busy one, on sand under a square sun and clouds made of squares, with flat-topped hills beyond |
| Poster | Flat colour on pale paper with heavy black lettering, after the site for GitHub Universe '26. Seven colours, one to a tower, so the Buildings colour doesn't apply. One flat sun sits low in the sky                      |
| Vector | Glowing outlines on black, as an old vector display drew things, with the hidden lines taken out and two mountain ranges drawn as outlines                                                                                |
| 16-bit | A bright afternoon as a 16-bit console drew one: towers shaded in flat bands, baked earth, a sky in stripes with round clouds and hills, in big square pixels                                                             |
| VGA    | The city as a shooter of the early 1990s drew a level: walls of bolted metal with a strip of light in the buildings' colour, light that dims with distance in steps, and a painted dusk, in the same big pixels           |

16-bit and VGA are looks of an era and copy no game: no character, level, texture or name of one is used. Both are drawn at an old screen's resolution and scaled up, so a big pixel is a square of one colour with hard edges, a whole number of the display's pixels across. There are about 320 rows of them down a wide view, which is more than those machines had: at their 200 or so, a tower in a city as dense as `torvalds` is narrower than a big pixel from Orbit. Neither look is dithered, and neither has the glow or the streak at speed that the others have, because both blur big pixels.

Where there is a sun the towers throw shadows across the streets, the busiest days carry a blinking red block where the night has a red light, and the fireworks for a cleared city fall as confetti. The shadows are dropped at the lowest quality step.

Poster takes its palette and its way of writing a name, as in `2026/`, from that site, and nothing else. No logo, mascot or artwork of GitHub's is used.

### Ships

Settings has five ships: Interceptor, the swept delta the site started with, then Dart, Rocket, Saucer and Brick, which is built of boxes. A sixth, the Comet, a twin-boom ship with an engine on each boom, flies only in Your year. Each takes the ship and trim colours, is the same size against the towers, and fires the same bolts from guns built into its own shape: in the Interceptor's wing roots, under the Dart's and the Comet's chins, on stubs either side of the Rocket, under the Saucer's rim, and as blocks on the Brick's wings. Each has one power of its own in Pilot:

| Ship        | Power       | What it does                               |
| ----------- | ----------- | ------------------------------------------ |
| Interceptor | Long lock   | Locks on to a badge from half as far again |
| Dart        | Quick turn  | Turns and climbs 30% faster                |
| Rocket      | Afterburner | Boosts 30% faster                          |
| Saucer      | Hover       | Brakes to a stop and hangs in the air      |
| Brick       | Thick skin  | Keeps its speed when it clips a tower      |

Autopilot flies them all alike. Boost heats every ship's engines: the turbines down its nozzles burn white and the metal round them glows from red to orange-white, with a flash as boost lights, and they cool more slowly once it is let go. In a race the rival's turbines glow where it flies well above cruise. Each ship also has its own cockpit, seen by scrolling all the way in: a faceted canopy, a pointed windscreen, a porthole, a dome and three square panes, each with a speed dial and lamps for a lock and for boost.

Picking a ship or a ship colour in Settings holds the ship up beside the panel, turning, until the panel closes. Orbit has no ship in it and the cockpit has the pilot inside it, so a choice made there would otherwise change nothing on screen. The choice stays in the visitor's browser.

### Colours

Settings changes the buildings, the ship and the ship's trim, from swatches or a free colour picker. The choice applies to every city and stays in the visitor's browser. A building colour keeps its hue, and each step of its ramp is set to the default green's brightness, which holds glare close to the default's and keeps dark picks visible. The timeline and the green controls follow the buildings.

### Sound

Lasers, hits, bumps, exploding badges, hyperspace jumps, boosts, the target lock and the fireworks have sound effects. The engine hums louder and higher with speed, quieter in Autopilot than in Pilot, and towers rushing past close to the ship whoosh on their own side. Effects sit left or right of the camera and ring in a reverb. An earned badge chimes, and a cleared city gets a short fanfare.

Music plays under the effects: slow chords, with a melody made from the history. In Autopilot each note is the busiest day just passed, higher for a busier day, so a quiet stretch goes silent and a busy one climbs. In Pilot the towers the ship crosses play, and in Orbit pointing at a tower plays it. The melody keeps to one pentatonic scale, over chords voiced to fit it.

The sounds and music are made in the browser with the Web Audio API, so there are no audio files. Both are on by default and start at the first click, tap or key press, because browsers block audio until then. An iPhone in silent mode mutes them, as iOS does for web audio. N or Settings switches all sound off, Settings switches the music off on its own, and the choices stay in the visitor's browser.

### Your year on GitHub

From 15 November through December a button offers a flight through the year, and through the first half of January the year just ended. It opens on the year's number over its empty block, with a fanfare, while the camera pushes in. Then the year rises week by week, a little slower than other flights, with its count running under the header. It stops for the first contribution, the biggest month, the busiest day, the longest streak and the year's badges, each lit with a burst and a chime, and closes with fireworks over the block.

Then the year comes as cards, one fact to a card, each the shape of a phone's story: the year's number over a picture of its city, the total against the year before, the active days as the year's grid, the longest streak, the busiest day, the biggest month, a style, the badges reached in the year, and a last card with all the numbers over the city again. The style is a name for how the year went, from the first of these it meets: a streak of 30 days or more (Marathoner), 35% or more of the contributions at weekends (Weekend builder), something on 60% or more of the days (Regular), a busiest day at least eight times the middle active day, in a year of ten active days or more (Sprinter), or under 8% at weekends in a year of 50 contributions or more (Weekday worker). Anyone else is an All-rounder. The card says which fact the name comes from.

The cards turn every six seconds until the visitor taps, clicks or uses the arrow keys, and holding one pauses it. Each card can be saved as a picture, 1,080 by 1,920, and where the device can hand a picture to another app, as phones do, shared. What is saved is what is on screen, and every card carries the year's address, an invitation to fly your own year at the site's address, and the line that the site isn't GitHub's. Under the cards, Fly your own takes a username straight to that person's flight through the same year, so someone sent a year can fly theirs next. Copy link gives that address, Watch again flies the year again, and Close or Esc puts the visitor's own ship, colours, look and music back. The cards and their pictures are drawn in the browser, and nothing is uploaded.

The year's flight is a limited edition: its own ship, the Comet, in midnight blue and gold, a gold city at night under an aurora with snow falling, and bells in the music. None of it can be picked in Settings. The visitor's own ship, colours, look and music come back when the card closes, or sooner if they fly another way.

A year has its own address, `/<username>/<year>`, which Copy link and Share give and which opens straight on that year's flight. Its link preview is a card of the year in gold: the name, the year written large, its total, active days and longest streak, and its weeks as a skyline. The preview's text ends by asking whoever sees it to fly their own. `/<username>#your-year` opens the latest year at any time.

## Data and privacy

The page shows what a user's public GitHub profile already shows, including the bio and repos in Explore. Private contributions appear as anonymous counts only if that user has turned them on in their profile settings. Responses are cached on the CDN for six hours, and the site has no database, accounts or cookies. [Vercel Web Analytics](https://vercel.com/docs/analytics/privacy-policy) counts page views without cookies, recording the page, the referrer, a rough location, and the device and browser, with nothing that identifies a visitor. Only production builds load it. Earned badges and settings, including whether sound and music are on, stay in the visitor's own browser, and so do race bests, ghosts, the cities flown and the one opened last. Fonts load from Google Fonts.

Tower height is the square root of the day's contributions, measured against a busy day for that user: 99 in 100 of their active days have no more. The few days above that stand a little taller, by up to a third, so one enormous day doesn't leave every other tower a stub. The busiest day is still the tallest tower. With fewer than 50 active days, heights are measured against the busiest. The towers' colours and the music's notes follow the same measure.

## Running it

Requires Node 24.

```sh
npm install
cp .env.example .env.local   # then add a token, see below
npm run dev
```

`GITHUB_TOKEN` is a [personal access token (classic)](https://github.com/settings/tokens) with no scopes ticked. GitHub's GraphQL API needs a token even for public data, so it lives on the server. `npm run dev` runs the API inside the Vite dev server, with no Vercel login needed.

| Command            | Does                                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`         | API, card, route, ride, race, time attack, near-miss, badge, year, zoom, colour, look, ship, sound, music, aiming, collision, sight, clock, passport, screensaver and Explore tests |
| `npm run test:e2e` | Browser tests with a stubbed API, under the production CSP                                                                                                                          |
| `npm run lint`     | ESLint                                                                                                                                                                              |
| `npm run build`    | Typecheck, then build to `dist`                                                                                                                                                     |
| `npm run explore`  | Rewrites `public/explore.json` from GitHub's search. Needs `GITHUB_TOKEN`, from the environment or `.env.local`                                                                     |

`npx playwright install chromium` fetches the browser for the end-to-end tests.

## How it's built

- `api/contributions/[login].ts` is a Vercel Function that validates the login and sets cache headers. `api/_lib/github.ts` talks to GitHub, and reads the user's profile in the same request as their account.
- `api/card/[login].ts` draws the card a shared link previews with, a city's or with `?year=` one year's, and `api/share/[login].ts` is the page a preview fetcher reads. `vercel.json` sends preview fetchers for `/<username>` and `/<username>/<year>` there. `api/_lib/card.ts` lays the cards out, and `api/_lib/png.ts` and `api/_lib/letters.ts` draw it as rectangles and block capitals with Node's own zlib, so it needs no image library.
- `shared/contract.ts` holds the API's schema, used on both sides.
- `scripts/catalogue.ts` builds Explore's lists from GitHub's search and `scripts/explore.ts` writes them to `public/explore.json`. `scripts/run.ts` loads them through Vite, so there is no build step. `shared/explore.ts` holds the file's schema and the random pick, and `src/explorer.ts` is the panel.
- `src/main.ts` loads a city. A browser without WebGL 2 gets the Guide as the page instead, and the API isn't called.
- `src/calendar.ts`, `src/map.ts` and `src/routes.ts` hold the data, the city grid and the flight paths. `src/milestones.ts` and `src/review.ts` work out the badges and the year's flight, `src/story.ts` turns a year into its cards, `src/run.ts` keeps the clock on a timed clear, and `src/colours.ts`, `src/zoom.ts`, `src/steering.ts` and `src/quality.ts` hold the colour palettes, the zoom steps, the key response and the frame average that lowers quality on a slow GPU. `src/aim.ts` picks the badge to lock on to and curves a bolt towards it, `src/lights.ts` chooses which flashes light the towers each frame, and `src/markers.ts` places the markers and chooses which to show. `src/screensaver.ts` picks the order of the screensaver's flights and tells a hand letting go of the mouse from one moving it. `src/collision.ts` pushes the ship back out of a tower it has hit, and `src/sight.ts` holds the lines of sight: the tower being aimed at, whether one hides a badge, how far back the chase camera can sit, and the height to come at a badge from. None of them need WebGL, which is what makes them testable.
- `src/world.ts`, `src/fighter.ts`, `src/badges.ts`, `src/blast.ts`, `src/fireworks.ts` and `src/app.ts` are the three.js scene, the ship and its guns, the floating badges, their explosions, the show for a cleared city and the flight modes. `src/environment.ts` renders what the ship's metal and glass reflect, and `src/trails.ts` draws the vapour off its wingtips.
- `src/skins.ts` holds the looks. A look is how the city itself is drawn, plus the screen it is drawn on: 16-bit and VGA are drawn at an old screen's resolution, which `screenGrid` lays over the view, and the last pass scales that up one reading to a pixel. `dress` compiles a shader for a look: each version sits under a name such as `BLOCKS`, `SHOOTER` or `DAY` in `src/shaders.ts`, so every look is its own program and none pays for another.
- The five ships are designs in `src/fighter.ts`. A design places its own parts, its guns among them, and says where its engines, wingtips and muzzles are. The flames and lights are fitted the same way on all of them, and the bolts and muzzle flashes start at the design's muzzles. Wings, fins and canards are lofted with a section that thins to both edges, and the seams and plating on the metal come from `PLATING` in `src/shaders.ts`. `src/powers.ts` holds what each does differently in Pilot, and `src/cockpits.ts` draws each one's cockpit as SVG over the view.
- `src/race.ts` builds a year's course from `courseRoute` in `src/routes.ts`, sets its gates, works out the rival's flight ahead of the race, and keeps the race, the bests, the ghosts, challenge links and the day's course. `src/attack.ts` plans a year's time attack, lifts its line over the city with `sampled` in `src/routes.ts` at a sharper setting than Autopilot's, sets its rings, and keeps the clock and the bests. `src/near.ts` scores near misses, `src/gates.ts` draws the gates and rings, `src/race-hud.ts` is the readout, panel and cards for both, and `src/passport.ts` remembers the cities flown here. None of them but the gates need WebGL.
- `src/story-art.ts` draws a year's cards on a canvas the size of a phone's story, and `src/story-view.ts` shows them, turns them and saves or shares them as pictures.
- `src/badge-art.ts` draws the badge artwork at runtime, and `src/hud.ts` is everything on screen that isn't the 3D scene.
- `src/sound.ts` makes the sound effects and mixes them with the music from `src/music.ts`, all with the Web Audio API, and builds nothing until the visitor's first click, tap or key press.

## GitHub's limits

GitHub allows a token 5,000 GraphQL points an hour. A username not in the cache costs 1 point, plus 1 for every three years of history, so a typical user costs 4 to 8 points. That covers roughly 600 to 1,200 new usernames an hour, and repeat visits cost nothing. A history starts at the earliest year GitHub lists for the user, which can be before the account was made, and goes back no more than 30 years, so the most a username can cost is 11 points. The profile comes in the account's request, for the same point. If GitHub refuses that request, the account is asked for again without the profile, which costs one more. A card the CDN doesn't hold costs the same as a visit and is cached as long. Past that, visitors see a message asking them to try again. Requests covering all of a long history at once fail on GitHub's side, so the API fetches three years at a time.

## Deploying

1. Create a Vercel project from this repo. The framework preset is Vite.
2. Add `GITHUB_TOKEN` to the project's environment variables, then redeploy, because new variables only reach new deployments.
3. Add a Vercel Firewall rate-limit rule on `/api/contributions/` and `/api/card/`, keyed on IP, since both read GitHub. The rule here counts 30 requests a minute for an address. The Hobby plan allows one rule. The firewall answers a request over the limit with a 429, and the page tells that visitor to try again in a minute.
4. Add the custom domain and create the DNS record Vercel gives you. The generated `contriscape.vercel.app` alias goes on serving the whole site after that, so `vercel.json` redirects it to the custom domain. Change that rule if the domain changes.
5. Turn on Web Analytics in the project's Analytics tab. Its routes arrive with the next deployment, so deploy again afterwards.

## Licence

MIT. See [LICENSE](LICENSE).
