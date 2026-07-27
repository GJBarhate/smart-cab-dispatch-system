import { useAuthStore } from '../store/authStore';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const API_URL = import.meta.env.VITE_API_URL;

// Set once by <App> via useNavigate() so a 401 anywhere can kick the user back
// to /login without a full page reload. Falls back to a hard redirect if App
// hasn't mounted yet (shouldn't happen in practice).
let onUnauthorized: (() => void) | null = null;
export function registerUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }

  let json: { ok: boolean; data?: T; error?: { code: string; message: string; details?: unknown } } | null = null;
  try {
    json = await res.json();
  } catch {
    // no/invalid JSON body
  }

  if (res.status === 401) {
    useAuthStore.getState().logout();
    if (onUnauthorized) onUnauthorized();
    else window.location.assign('/login');
  }

  if (!res.ok || !json || !json.ok) {
    const err = json?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? 'Something went wrong. Please try again.', err?.details);
  }

  return json.data as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path)
};
