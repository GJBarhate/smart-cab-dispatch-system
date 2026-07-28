import { useAuthStore } from '../store/authStore';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}
interface ApiFailure {
  ok: false;
  error: { code: string; message: string; details?: unknown };
}

let onUnauthorized: (() => void) | null = null;
export function registerUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

// A 401 with a token attached means the session died mid-use (expired or
// revoked) rather than a bad password. Recording it lets /login say so instead
// of silently presenting an empty form, which reads as "the app logged me out
// for no reason". sessionStorage, not a module variable, so it survives the
// hard redirect fallback and dies with the tab.
const SESSION_EXPIRED_KEY = 'eventride-admin-session-expired';

function markSessionExpired(): void {
  try {
    sessionStorage.setItem(SESSION_EXPIRED_KEY, '1');
  } catch {
    // Blocked storage — the user just gets the plain sign-in form.
  }
}

/** Reads and clears the flag, so the notice shows exactly once. */
export function consumeSessionExpired(): boolean {
  try {
    const expired = sessionStorage.getItem(SESSION_EXPIRED_KEY) === '1';
    if (expired) sessionStorage.removeItem(SESSION_EXPIRED_KEY);
    return expired;
  } catch {
    return false;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const token = useAuthStore.getState().token;
  const headers = new Headers(options.headers);
  const isForm = options.body instanceof FormData;
  if (!isForm && options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { ...options, headers });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
  }

  let body: ApiSuccess<T> | ApiFailure | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (res.status === 401) {
    // `token` present ⇒ we had a session and it stopped being accepted. A 401
    // on the login call itself has no token and is just a wrong password.
    if (token) markSessionExpired();
    useAuthStore.getState().clear();
    onUnauthorized?.();
  }

  if (!res.ok || !body || body.ok === false) {
    const err = body && 'ok' in body && body.ok === false ? body.error : { code: 'UNKNOWN', message: `Request failed (${res.status})` };
    throw new ApiError(res.status, err.code, err.message, (err as { details?: unknown }).details);
  }

  return { data: (body as ApiSuccess<T>).data, meta: (body as ApiSuccess<T>).meta };
}

export const apiClient = {
  get: async <T>(path: string): Promise<T> => (await request<T>(path, { method: 'GET' })).data,
  getWithMeta: async <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: async <T>(path: string, body?: unknown): Promise<T> =>
    (await request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined })).data,
  patch: async <T>(path: string, body?: unknown): Promise<T> =>
    (await request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined })).data,
  delete: async <T>(path: string): Promise<T> => (await request<T>(path, { method: 'DELETE' })).data,
  postForm: async <T>(path: string, form: FormData): Promise<T> => (await request<T>(path, { method: 'POST', body: form })).data
};
