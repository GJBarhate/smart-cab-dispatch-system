import { create } from 'zustand';
const TOKEN_KEY = 'eventride_guest_token';
const NAME_KEY = 'eventride_guest_name';
function decodeGuestId(token) {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const json = atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json);
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload.guestId ?? null;
  } catch {
    return null;
  }
}
const initialToken = localStorage.getItem(TOKEN_KEY);
const initialGuestId = initialToken ? decodeGuestId(initialToken) : null;
export const useAuthStore = create(set => ({
  // If the stored token is expired/malformed, don't trust it as "logged in".
  token: initialGuestId ? initialToken : null,
  name: initialGuestId ? localStorage.getItem(NAME_KEY) : null,
  guestId: initialGuestId,
  setAuth: (token, name) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(NAME_KEY, name);
    set({
      token,
      name,
      guestId: decodeGuestId(token)
    });
  },
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(NAME_KEY);
    set({
      token: null,
      name: null,
      guestId: null
    });
  }
}));
