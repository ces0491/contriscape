import type { Contributions } from '../shared/contract';
import { catalogueSchema, pickRandom, type Catalogue, type Group, type Person } from '../shared/explore';
import { formatCount, MONTHS } from './calendar';

const CATALOGUE_URL = '/explore.json';
const GITHUB = 'https://github.com';
/** Holds which list a visitor picked a city from, for the one page load that follows. */
const ARRIVAL_KEY = 'contriscape:arrival';

/** The panel's two halves: the lists of other cities, and whose city this one is. */
type View = 'others' | 'city';

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] => {
  const made = document.createElement(tag);
  made.textContent = text;
  return made;
};

/** A link out to GitHub, opened in its own tab so the city stays where it is. */
function outside(href: string, text: string): HTMLAnchorElement {
  const link = make('a', text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

/** "19 Nov 2026" from "2026-11-19". */
export function writtenDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** "R", "R and C" or "R, C and Go". */
export function listed(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The line under a name in a list: the bio, or the repo that put them there and what it is. */
export function personLine(person: Person): string {
  if (!person.repo) return person.about;
  const repo = `${person.repo.name}, ${formatCount(person.repo.stars)} stars`;
  return person.about ? `${repo}. ${person.about}` : repo;
}

/** Remembers the list a city was picked from, so the city can say so when it opens. */
export function noteArrival(login: string, from: string): void {
  try {
    sessionStorage.setItem(ARRIVAL_KEY, JSON.stringify({ login: login.toLowerCase(), from }));
  } catch {
    // Blocked storage only costs the introduction
  }
}

/** The list this city was picked from, if the visitor has just come from Explore. It is told once. */
export function takeArrival(login: string): string | null {
  try {
    const stored = sessionStorage.getItem(ARRIVAL_KEY);
    sessionStorage.removeItem(ARRIVAL_KEY);
    const arrival = JSON.parse(stored ?? 'null') as { login?: unknown; from?: unknown } | null;
    return arrival?.login === login.toLowerCase() && typeof arrival.from === 'string' ? arrival.from : null;
  } catch {
    return null;
  }
}

/**
 * The Explore panel: who the city on screen belongs to, and lists of other cities to fly, with one picked at random
 * for a visitor who doesn't know what to look for. The lists are a file made ahead of time, so opening the panel
 * costs GitHub nothing.
 */
export class Explorer {
  private catalogue: Catalogue | null = null;
  private loading: Promise<Catalogue | null> | null = null;
  /** The list on show, by its place in the catalogue. */
  private shown = 0;
  /** The city on screen, which Random never picks. */
  private current: string | null = null;
  private view: View = 'others';
  /** Set once the app runs the panels. Until then there may be no city, and the button opens the panel itself. */
  private hosted = false;

  constructor() {
    const panel = element('explorePanel');
    const button = element('explore');
    const show = (open: boolean) => {
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      // With no city, the middle of the page holds the message about why, which the panel would sit across
      document.body.classList.toggle('exploring', open);
      if (open) this.open();
    };
    // Registered before the app's own listener, so the button always opens on the lists it is named for
    button.addEventListener('click', () => {
      this.show('others');
      if (!this.hosted) show(panel.hasAttribute('hidden'));
    });
    element('viewOthers').addEventListener('click', () => this.show('others'));
    element('viewCity').addEventListener('click', () => this.show('city'));
    panel.querySelector('.panel-close')?.addEventListener('click', () => {
      if (!this.hosted) show(false);
    });
    document.addEventListener('keydown', (e) => {
      if (!this.hosted && e.code === 'Escape') show(false);
    });
    element('random').addEventListener('click', () => void this.random());
  }

  /** Hands opening and closing to the app, which keeps one panel open at a time and stops the ship for it. */
  host(): void {
    this.hosted = true;
    document.body.classList.remove('exploring');
  }

  /** Switches between the lists of other cities and the account of this one. */
  show(view: View): void {
    // Until a city has been described there is only the lists to show
    this.view = this.current === null ? 'others' : view;
    element('about').hidden = this.view !== 'city';
    element('others').hidden = this.view !== 'others';
    element('viewCity').setAttribute('aria-pressed', String(this.view === 'city'));
    element('viewOthers').setAttribute('aria-pressed', String(this.view === 'others'));
  }

  /** Fills in whose city this is, from what their GitHub profile says. */
  describe(data: Contributions): void {
    this.current = data.login;
    const { profile } = data;
    element('aboutName').textContent = data.name ?? data.login;
    element('aboutLink').replaceChildren(outside(`${GITHUB}/${data.login}`, `${data.login} on GitHub`));

    const bio = element('aboutBio');
    bio.textContent = profile?.bio ?? '';
    bio.hidden = !profile?.bio;

    const facts = element('aboutFacts');
    const followers = profile ? `${formatCount(profile.followers)} follower${profile.followers === 1 ? '' : 's'}.` : '';
    const languages = profile?.languages.length ? `Repos mostly in ${listed(profile.languages)}.` : '';
    facts.textContent = [followers, languages].filter(Boolean).join(' ');
    facts.hidden = facts.textContent === '';

    const repos = profile?.repos ?? [];
    const heading = element('aboutReposTitle');
    heading.textContent = profile?.pinned ? 'Pinned' : 'Most starred';
    heading.hidden = repos.length === 0;
    element('aboutRepos').replaceChildren(
      ...repos.map((repo) => {
        const own = repo.owner.toLowerCase() === data.login.toLowerCase();
        const item = make('li');
        // Encoded, so whatever a name holds, the link stays a path on GitHub
        const address = `${GITHUB}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
        item.append(outside(address, own ? repo.name : `${repo.owner}/${repo.name}`));
        if (repo.description) item.append(make('span', repo.description));
        const stars = `${formatCount(repo.stars)} star${repo.stars === 1 ? '' : 's'}`;
        item.append(make('small', repo.language ? `${stars} · ${repo.language}` : stars));
        return item;
      }),
    );
    element('exploreViews').hidden = false;
    this.show(this.view);
    if (this.catalogue) this.render(this.catalogue);
  }

  /** Called as the panel opens. The lists load the first time, and again after a failure. */
  open(): void {
    void this.load();
  }

  private load(): Promise<Catalogue | null> {
    if (this.loading) return this.loading;
    const note = element('exploreNote');
    if (!this.catalogue) note.textContent = 'Loading the lists…';
    this.loading = fetch(CATALOGUE_URL)
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : Promise.reject(new Error('no list'))))
      .then((body) => {
        const catalogue = catalogueSchema.parse(body);
        this.catalogue = catalogue;
        this.render(catalogue);
        return catalogue;
      })
      .catch(() => {
        this.loading = null;
        note.textContent = "The lists didn't load. Close this and open it again to retry.";
        return null;
      });
    return this.loading;
  }

  private render(catalogue: Catalogue): void {
    element('exploreNote').textContent =
      `Busy cities, picked from GitHub's search on ${writtenDay(catalogue.generated)}. Pick a list, then a city.`;
    const group = catalogue.groups[Math.min(this.shown, catalogue.groups.length - 1)];
    element('exploreGroups').replaceChildren(
      ...catalogue.groups.map((each, i) => {
        const tab = make('button', each.title);
        tab.type = 'button';
        tab.setAttribute('aria-pressed', String(each === group));
        tab.addEventListener('click', () => {
          this.shown = i;
          this.render(catalogue);
        });
        return tab;
      }),
    );
    element('exploreBlurb').textContent = group.blurb;
    element('explorePeople').replaceChildren(...group.people.map((person) => this.row(person, group)));
  }

  private row(person: Person, group: Group): HTMLLIElement {
    const item = make('li');
    const link = make('a');
    link.href = `/${person.login}`;
    if (person.login.toLowerCase() === this.current?.toLowerCase()) link.setAttribute('aria-current', 'page');
    const name = make('b', person.name ?? person.login);
    if (person.name) name.append(make('small', person.login));
    link.append(name);
    const line = personLine(person);
    if (line) link.append(make('span', line));
    link.addEventListener('click', () => noteArrival(person.login, group.title));
    item.append(link);
    return item;
  }

  private async random(): Promise<void> {
    const button = element<HTMLButtonElement>('random');
    button.disabled = true;
    const catalogue = await this.load();
    button.disabled = false;
    const choice = catalogue && pickRandom(catalogue, this.current);
    if (!choice) return;
    noteArrival(choice.person.login, choice.group.title);
    location.assign(`/${choice.person.login}`);
  }
}
