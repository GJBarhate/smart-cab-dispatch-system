import { create } from 'zustand';
import { persist } from 'zustand/middleware';
// Documented trade-off (plan.md §18 DESIGN.md item 13): JWT in localStorage
// over httpOnly cookies — avoids cross-site cookie complexity between the
// Vercel-hosted frontend and the Render-hosted API; accepts XSS exposure,
// mitigated by short token expiry and no third-party scripts.
export const useAuthStore = create()(persist(set => ({
  token: null,
  role: null,
  name: null,
  setSession: ({
    token,
    role,
    name
  }) => set({
    token,
    role,
    name
  }),
  clear: () => set({
    token: null,
    role: null,
    name: null
  })
}), {
  name: 'eventride-admin-auth'
}));
