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
- [x] Unit tests, browser tests under the production CSP, lint and typecheck all pass
- [x] Name confirmed by Ces
- [ ] Deployed to production with a real token, verified on the live URL
- [ ] Tested on a real phone and on a low-end GPU

## Out of scope

- Accounts, logins or storing anything about visitors
- Private contributions beyond what a user already shows on their public profile
- Organisation pages, which have no contribution calendar
- Multiplayer, leaderboards or sound
- STL export, which `gh-skyline` already does
- Payment or advertising

## Bar

Small public production tool. No secrets in code, validation at every boundary, typed errors for GitHub failures, and bounded use of GitHub's quota. A single maintainer with no on-call, so failures must degrade to a clear message and recover by themselves.

## Decision

Ces, after flying a stranger's city on the live URL from a phone and a laptop.

## Revision history

- 2026-11-02: initial scope
- 2026-11-02: named contriscape
