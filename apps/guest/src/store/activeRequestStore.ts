import { create } from 'zustand';

// There is no "list my pending requests" endpoint (by design — see docs/API.md).
// The pending-approval stepper needs to survive a reload/reconnect, so we keep
// a pointer to the guest's own most-recent request id locally and resync its
// real state over REST (GET /api/guest/requests/:id) on mount. This is a
// client-side convenience only — never a source of truth.
const KEY = 'eventride_active_request_id';

interface ActiveRequestState {
  requestId: string | null;
  setRequestId: (id: string | null) => void;
}

export const useActiveRequestStore = create<ActiveRequestState>((set) => ({
  requestId: localStorage.getItem(KEY),
  setRequestId: (id) => {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
    set({ requestId: id });
  }
}));
