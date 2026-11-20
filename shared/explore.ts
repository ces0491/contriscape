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

/** Each account in the catalogue once, under the first group that lists it, leaving out `current`. */
function everyone(catalogue: Catalogue, current: string | null): Choice[] {
  const choices = new Map<string, Choice>();
  for (const group of catalogue.groups) {
    for (const person of group.people) {
      const key = person.login.toLowerCase();
      if (key !== current?.toLowerCase() && !choices.has(key)) choices.set(key, { person, group });
    }
  }
  return [...choices.values()];
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
  const choices = everyone(catalogue, current);
  if (!choices.length) return null;
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}

/** A number from a piece of text, the same every time and spread evenly. FNV-1a. */
export function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The city a day's course is flown on, picked by the day, so everyone with the same lists gets the same one. */
export function dailyPick(catalogue: Catalogue, day: string): Choice {
  const choices = everyone(catalogue, null);
  return choices[hashText(day) % choices.length];
}
