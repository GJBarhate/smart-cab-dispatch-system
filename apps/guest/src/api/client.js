import { useAuthStore } from '../store/authStore';
export class ApiError extends Error {
  constructor(status, code, message, details) {
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
let onUnauthorized = null;
export function registerUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// A 401 carrying a token means the session expired mid-use, not a bad login.
// Recording it lets /login explain why the guest was bounced there. Stored in
// sessionStorage so it survives the hard-redirect fallback above.
const SESSION_EXPIRED_KEY = 'eventride-guest-session-expired';
function markSessionExpired() {
  try {
    sessionStorage.setItem(SESSION_EXPIRED_KEY, '1');
  } catch {
    // Blocked storage — the guest just gets the plain sign-in form.
  }
}

/** Reads and clears the flag, so the notice shows exactly once. */
export function consumeSessionExpired() {
  try {
    const expired = sessionStorage.getItem(SESSION_EXPIRED_KEY) === '1';
    if (expired) sessionStorage.removeItem(SESSION_EXPIRED_KEY);
    return expired;
  } catch {
    return false;
  }
}
async function request(method, path, body) {
  const token = useAuthStore.getState().token;
  const headers = {
    Accept: 'application/json'
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    // no/invalid JSON body
  }
  if (res.status === 401) {
    // Only a 401 on an authenticated call is an expiry; the login call carries
    // no token and a 401 there just means the details were wrong.
    if (token) markSessionExpired();
    useAuthStore.getState().logout();
    if (onUnauthorized) onUnauthorized();else window.location.assign('/login');
  }
  if (!res.ok || !json || !json.ok) {
    const err = json?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? 'Something went wrong. Please try again.', err?.details);
  }
  return json.data;
}
export const apiClient = {
  get: path => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body ?? {}),
  delete: path => request('DELETE', path)
};
