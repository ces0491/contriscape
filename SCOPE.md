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
- [x] Milestone badges sit on their real dates and can be shot, earned, blown up and reset, kept in the visitor's browser
- [x] Shooting a city's last badge sets off fireworks and a victory roll, and marks the Badges button, with reduced motion respected
- [x] A December flight through the current year, with captions and a closing summary
- [x] Visitors can change the building and ship colours, choose mouse steering, and read a guide to the controls and badges on the page
- [x] Sound effects that start only after the visitor's first click, tap or key press, and switch off from Settings or a key, with the choice kept in the visitor's browser
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
