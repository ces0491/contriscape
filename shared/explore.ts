import { z } from 'zod';
import { LOGIN_PATTERN } from './contract';

const personSchema = z.object({
  login: z.string().regex(LOGIN_PATTERN),
  name: z.string().nullable(),
  /** The account's bio, or its repo's description in a group picked by repo. Empty when GitHub has neither. */
  about: z.string(),
  /** The repo that put this account in a group picked by repo. */
  repo: z.object({ name: z.string().min(1), stars: z.number().int().nonnegative() }).optional(),
});

const groupSchema = z.object({
  id: z.string().regex(/^[a-z][a-z-]*$/),
  title: z.string().min(1),
  /** How the group was picked, in a sentence a visitor reads. */
  blurb: z.string().min(1),
  people: z.array(personSchema).min(1),
});

/** The cities Explore offers. `scripts/explore.ts` writes it to `public/explore.json` from GitHub's search. */
export const catalogueSchema = z.object({
  /** The day the lists were made. */
  generated: z.iso.date(),
  groups: z.array(groupSchema).min(1),
});

export type Person = z.infer<typeof personSchema>;
export type Group = z.infer<typeof groupSchema>;
export type Catalogue = z.infer<typeof catalogueSchema>;

export interface Choice {
  person: Person;
  /** The first group that lists them. */
  group: Group;
}

/**
 * Someone from the catalogue other than the city being shown. Each account is as likely as any other, however many
 * groups list it. `null` when there is nobody else to offer.
 */
export function pickRandom(
  catalogue: Catalogue,
  current: string | null,
  random: () => number = Math.random,
): Choice | null {
  const choices = new Map<string, Choice>();
  for (const group of catalogue.groups) {
    for (const person of group.people) {
      const key = person.login.toLowerCase();
      if (key !== current?.toLowerCase() && !choices.has(key)) choices.set(key, { person, group });
    }
  }
  if (!choices.size) return null;
  return [...choices.values()][Math.min(choices.size - 1, Math.floor(random() * choices.size))];
}
