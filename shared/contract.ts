import { z } from 'zod';

/** GitHub logins are 1 to 39 letters, digits or hyphens. Some older accounts end in a hyphen. */
export const LOGIN_PATTERN = /^[a-z\d][a-z\d-]{0,38}$/i;

const firstDate = z.iso.date().nullable();

/** Repos listed in a profile, and languages named in one. */
export const PROFILE_REPOS = 6;
export const PROFILE_LANGUAGES = 3;

const repoSchema = z.object({
  owner: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  stars: z.number().int().nonnegative(),
  language: z.string().nullable(),
});

/** What a user's GitHub profile says about their work, in GitHub's own fields. */
const profileSchema = z.object({
  bio: z.string().nullable(),
  followers: z.number().int().nonnegative(),
  /** The main languages of the user's pinned and most-starred repos, the commonest first. */
  languages: z.array(z.string()).max(PROFILE_LANGUAGES),
  /** The repos the user pinned to their profile, or their most-starred ones if they pinned none. */
  repos: z.array(repoSchema).max(PROFILE_REPOS),
  pinned: z.boolean(),
});

export const contributionsSchema = z.object({
  login: z.string().regex(LOGIN_PATTERN),
  name: z.string().nullable(),
  snapshot: z.iso.date(),
  /** Daily counts per year, starting 1 January. The current year stops at the snapshot date. */
  years: z.record(z.string().regex(/^\d{4}$/), z.array(z.number().int().nonnegative())),
  /** A user's firsts on GitHub. Absent from replies the CDN cached before this field existed. */
  firsts: z.object({ joined: firstDate, repository: firstDate, pullRequest: firstDate, issue: firstDate }).optional(),
  /** Absent when GitHub couldn't give it. The city doesn't depend on it. */
  profile: profileSchema.optional(),
});

export type Contributions = z.infer<typeof contributionsSchema>;
export type Profile = z.infer<typeof profileSchema>;

export type ApiError = 'invalid-login' | 'not-found' | 'rate-limited' | 'unavailable';
