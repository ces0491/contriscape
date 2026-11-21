# SCOPE — contriscape

## Purpose

Let anyone enter a GitHub username and fly through a 3D city of that person's public contributions, filling the gap GitHub left when it retired Skyline.

## Done

- [x] Any username loads a city, including accounts with long histories, gaps or no contributions
- [x] A shareable link opens a user's city directly
- [x] Autopilot, Pilot and Orbit work, with scroll zoom in all three
- [x] Autopilot never touches a tower, proven by tests across unusual account shapes
- [x] The GitHub token stays on the server, and repeat visits are served from the CDN
- [x] Missing users, rate limits and outages each show a clear message
- [x] Milestone badges sit on their real dates and can be earned by shooting them or flying into them, and reset, kept in the visitor's browser
- [x] Earning a city's last badge sets off fireworks and a victory roll, and marks the Badges button, with reduced motion respected
- [x] A December flight through the current year, with captions and a closing summary
- [x] Visitors can change the building and ship colours, choose mouse steering, and read a guide to the controls and badges on the page
- [x] Sound effects that start only after the visitor's first click, tap or key press, and switch off from Settings or a key, with the choice kept in the visitor's browser
- [x] Music made from the history, with its own switch in Settings, kept in the visitor's browser
- [x] In Pilot, markers lead to the badges still standing, a target lock curves shots onto a badge, and phones have Boost and Brake buttons
- [x] A flight through the whole history flies the busiest year and the latest busy one, and passes the others with each rising as the ship reaches it
- [x] A badge found by its marker is earned as flown, apart from one jumped to from the list
- [x] A city cleared by flying is timed, and the fastest clear is kept in the visitor's browser
- [x] Tower heights are measured against a busy day, so one outlying day doesn't flatten the rest
- [x] The end of an Autopilot flight offers the controls
- [x] A shared link previews with a card of that user's skyline, and falls back to the site's own picture when GitHub can't be read
- [x] Explore lists busy cities by field and by repo, from a file made ahead of time, and Random city picks one
- [x] A city says whose it is, from the bio, languages and repos on their GitHub profile, and still loads when GitHub can't give those
- [x] Six looks, chosen in Settings and kept in the visitor's browser: Night, Blocks, Poster, Vector, 16-bit and VGA, each readable on a city as dense as `torvalds`
- [x] Five ships to choose from, each with a power of its own in Pilot and a cockpit of its own
- [x] A ship picked where none is on screen is shown beside Settings
- [x] Where a look has a sun, the towers throw shadows
- [x] Any year with contributions can be raced against Autopilot through gates, with near misses scored, bests and a ghost kept for each year and ship, a challenge link, and a day's course in Explore
- [x] Any year with contributions has a time attack: rings low down its alleys and over or high up its walls, out and back, against a clock each ring adds to, with bests kept for each year and ship
- [x] A double tap of a direction rolls the ship one alley across, and up with a direction flies it on its side
- [x] The site root opens the city the browser opened last, and Explore lists the cities flown there
- [x] Your year opens on the year's number, counts up as it rises, celebrates its moments and badges, ends in fireworks, and flies a limited edition ship, colours, look and music
- [x] A year has its own address, which link previews show as a card of that year
- [x] A screensaver flies a city's busier years and whole history in turn with only the view on screen, from Settings, a link, or after two minutes idle where the visitor switches that on, and any input ends it
- [x] Unit tests, browser tests under the production CSP, lint and typecheck all pass
- [x] Name confirmed by Ces
- [x] Deployed to production with a real token, verified on the live URL
- [ ] Tested on a real phone and on a low-end GPU

## Out of scope

- Accounts, logins, cookies or storing anything that identifies a visitor
- Private contributions beyond what a user already shows on their public profile
- Organisation pages, which have no contribution calendar
- Multiplayer or leaderboards
- STL export, which `gh-skyline` already does
- Payment or advertising
- GitHub's own profile achievements, which have no API and whose art is GitHub's

## Bar

Small public production tool. No secrets in code, validation at every boundary, typed errors for GitHub failures, and bounded use of GitHub's quota. A single maintainer with no on-call, so failures must degrade to a clear message and recover by themselves.

## Decision

Ces, after flying a stranger's city on the live URL from a phone and a laptop.

## Revision history

- 2026-11-02: initial scope
- 2026-11-02: named contriscape
- 2026-11-02: deployed to contriscape.sheetsolved.com
- 2026-11-02: added badges and the December year flight
- 2026-11-02: added the guide, badge reset and colour choices
- 2026-11-02: added the mouse steering choice and exploding badges
- 2026-11-02: added the fireworks for a cleared city
- 2026-11-03: added sound effects, at Ces's request
- 2026-11-03: added Vercel Web Analytics, at Ces's request, and narrowed the visitor data rule to anything that identifies a visitor
- 2026-11-19: added music, badge markers, the target lock and a phone Boost button, and reworked the ship, sky, effects and sound mix, at Ces's request
- 2026-11-19: after a review, changed which years the whole-history flight flies and how it passes the others, marked badges as flown, added a marker back to the city and the front page's example hint, and started histories at the earliest year GitHub lists, at Ces's request
- 2026-11-19: measured tower heights against a busy day, timed a clear flown without a jump, offered the controls when Autopilot ends, gave phones a Brake button, and added a share card for each username, at Ces's request
- 2026-11-19: added Explore, Random city and the account of whose city it is, at Ces's request
- 2026-11-19: added five looks and four ships, tower shadows by day, and painted streets and roofs by night, at Ces's request
- 2026-11-20: took the list of new repos out of Explore, kept each field's list to bios that have its words, and gave a visitor over the firewall's limit a message of their own, after Ces asked for the open items to be closed
- 2026-11-20: replaced the Handheld and Arcade looks, which Ces found unplayable, with 16-bit and VGA; gave each ship a power and a cockpit; showed a picked ship beside Settings; took the plant rooms off the night's roofs; put something on each look's horizon; and softened the planet's shadow on its ring, at Ces's request
- 2026-11-20: added racing, with near misses, ghosts, challenge links, a day's course and the passport; the barrel roll and flying on the side; the root opening on the last city; and a Your year with an opening, a running count, celebrated moments, fireworks, a limited edition and its own share link and card, at Ces's request
- 2026-11-20: badges can be earned by flying into them, and races gained a time attack through rings against the clock, at Ces's request
- 2026-11-21: added a screensaver, at Ces's request
- 2026-11-21: redrew 16-bit and VGA at an old screen's own resolution, with hard-edged pixels and no glow or streak, after Ces found them blurry and glitchy
