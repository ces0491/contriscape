import { z } from 'zod';

/** GitHub logins are 1 to 39 letters, digits or hyphens. Some older accounts end in a hyphen. */
export const LOGIN_PATTERN = /^[a-z\d][a-z\d-]{0,38}$/i;

const firstDate = z.iso.date().nullable();

export const contributionsSchema = z.object({
  login: z.string().regex(LOGIN_PATTERN),
  name: z.string().nullable(),
  snapshot: z.iso.date(),
  /** Daily counts per year, starting 1 January. The current year stops at the snapshot date. */
  years: z.record(z.string().regex(/^\d{4}$/), z.array(z.number().int().nonnegative())),
  /** A user's firsts on GitHub. Absent from replies the CDN cached before this field existed. */
  firsts: z.object({ joined: firstDate, repository: firstDate, pullRequest: firstDate, issue: firstDate }).optional(),
});

export type Contributions = z.infer<typeof contributionsSchema>;

export type ApiError = 'invalid-login' | 'not-found' | 'rate-limited' | 'unavailable';
