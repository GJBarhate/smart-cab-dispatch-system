# Demo Script — Loom Recording

Aim for 6–8 minutes. Have three browser windows ready before you hit record: guest PWA (phone-sized viewport), admin portal, and a second admin/driver tab for the RBAC proof. Seed fresh data first: `npm run seed -w server -- --fresh` from the repo root, and keep the printed credentials table visible in a terminal for quick reference.

```
0:00  Problem + architecture diagram (30s)
      "A fixed fleet, hundreds of guests, one event. Zero paid services.
      Here's the shape of it." Show docs/diagrams/architecture.mmd rendered
      on GitHub or in an editor.

0:30  Guest app on a phone-sized frame: log in with a seeded booking ref +
      phone. Show the Home screen's arrival details and the line
      "we'll assign a car automatically." Point out there is no driver
      list anywhere.

1:15  Guest raises an on-demand request from /request -> PENDING state.
      Narrate the stepper: Requested -> Approval pending -> Driver
      assigned -> On the way.

1:35  Switch to admin: the request appears in the Approval Inbox within
      ~1s (live via Socket.IO, no refresh). Show the feasibility preview
      chip, then APPROVE.

1:50  Trip auto-created in under 2s. Open the trip and show
      assignmentMeta.costBreakdown — narrate 2-3 of the terms (eta,
      priority, idle) and why this driver won.

2:10  Driver tab: the offer appears with a countdown ring -> ACCEPT ->
      ARRIVED -> BOARD. Point out: exactly one button visible at a time,
      no visibility into any other trip or driver.

2:40  Back to guest: live marker moving smoothly along the route, ETA
      counting down. No teleporting.

3:00  DISPATCH CONSOLE: run "Preview batch", show the cost-matrix heatmap,
      click a cell, walk through its full cost breakdown. This is the
      algorithm made visible — spend real time here, it's the highest-value
      screen in the whole demo.

4:00  Drag the Traffic slider to 2.0x. Watch ETAs shift live and a
      DEADLINE_AT_RISK alert appear in the admin alerts feed.

4:30  Detour insertion: raise a new on-demand request near a driver who's
      already mid-trip; approve it; show it slot into the existing trip's
      stops with the added minutes displayed, and the existing guest's ETA
      unaffected.

5:00  Group of 14 (seeded): show it split across 2 vehicles with a
      "Convoy" badge linking the sibling trips in the Trip Board.

5:20  RBAC proof: log out of admin, log in as a driver -> only /driver
      exists. Type an admin URL directly into the address bar -> redirect.
      Optionally show the automated RBAC suite passing
      (`npm test -w server`) to prove this is enforced server-side, not
      just hidden in the UI.

5:45  Terminal: `npm run simulate -- --drivers 60 --guests 250 --burst 90
      --minutes 20 --speed 30x` — let the report print, highlight the
      assertions all passing and the routing cache hit rate.

6:30  Trade-offs slide (from DESIGN.md §12), thank you.
```

## Fallback if something misbehaves live

- OSRM demo is flaky by design (no SLA) — if ETAs look off, point at the "~estimated" badge and the routing health chip in the admin header; this is the documented fallback chain working as intended, not a bug.
- If Render is cold (free tier sleeps after 15 min), the frontend shows a "Waking up the server…" splash — narrate that this is a known, handled limitation (§14.4 of the original plan), not a crash.
