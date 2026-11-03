import { contributionsSchema, LOGIN_PATTERN, type ApiError, type Contributions } from '../shared/contract';
import { startApp } from './app';
import { APP_NAME, DEFAULT_LOGIN } from './brand';
import './style.css';

const MESSAGE_SECONDS = 5;

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const MESSAGES: Record<ApiError | 'network', (login: string) => string> = {
  'invalid-login': (login) => `“${login}” isn't a valid GitHub username.`,
  'not-found': (login) => `No GitHub user called “${login}”. Organisations don't have contribution calendars.`,
  'rate-limited': () => "GitHub's hourly limit has been reached. Try again in a few minutes.",
  unavailable: () => "GitHub didn't answer in time. Try again in a moment.",
  network: () => "Couldn't reach the server. Check your connection and try again.",
};

let statusTimer = 0;

function hideStatus(): void {
  clearTimeout(statusTimer);
  element('status').hidden = true;
}

function showStatus(message: string): void {
  const status = element('status');
  status.textContent = message;
  status.hidden = false;
}

async function load(login: string): Promise<Contributions | ApiError | 'network'> {
  let response: Response;
  try {
    response = await fetch(`/api/contributions/${login.toLowerCase()}`);
  } catch {
    return 'network';
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: ApiError } | null)?.error;
    return error && error in MESSAGES ? error : 'unavailable';
  }
  const parsed = contributionsSchema.safeParse(body);
  return parsed.success ? parsed.data : 'unavailable';
}

function wireForm(): void {
  const input = element<HTMLInputElement>('loginInput');
  input.addEventListener('input', hideStatus);
  element('lookup').addEventListener('submit', (e) => {
    e.preventDefault();
    const login = input.value.trim().replace(/^@/, '');
    if (!login) {
      input.focus();
    } else if (LOGIN_PATTERN.test(login)) {
      location.assign(`/${login}`);
    } else {
      showStatus(MESSAGES['invalid-login'](login));
      // With a city behind it, the message shouldn't sit over the view for long
      if (!document.body.classList.contains('empty'))
        statusTimer = window.setTimeout(hideStatus, MESSAGE_SECONDS * 1000);
    }
  });
}

function wireShare(login: string): void {
  const button = element('share');
  const url = `${location.origin}/${login}`;
  button.addEventListener('click', () => {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        button.textContent = 'Copied';
        setTimeout(() => {
          button.textContent = 'Copy link';
        }, 1800);
      })
      .catch(() => {
        const input = element<HTMLInputElement>('loginInput');
        input.value = url;
        input.select();
      });
  });
}

async function boot(): Promise<void> {
  if (location.hash === '#sound-check') (await import('./sound-check')).checkSound();
  wireForm();
  const requested = location.pathname.replace(/^\/|\/$/g, '');
  const login = requested || DEFAULT_LOGIN;

  if (!LOGIN_PATTERN.test(login)) {
    showStatus(MESSAGES['invalid-login'](login));
    return;
  }

  showStatus(`Surveying ${login}'s city…`);
  const data = await load(login);
  if (typeof data === 'string') {
    showStatus(MESSAGES[data](login));
    return;
  }

  try {
    startApp(data);
  } catch (error) {
    console.error(error);
    showStatus('This page needs WebGL, which is not available in this browser.');
    return;
  }

  element('status').hidden = true;
  document.body.classList.remove('empty');
  document.title = `${data.login} · ${APP_NAME}`;
  if (requested) history.replaceState(null, '', `/${data.login}`);
  wireShare(data.login);
}

void boot();
