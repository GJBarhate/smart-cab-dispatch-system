"use strict";

// Bootstrap wrapper. The simulation's job is to load-test the dispatch
// engine's correctness and throughput, not to benchmark the free public
// OSRM/ORS demo servers — which have no SLA and can be slow to fail rather
// than fast (plan.md §16.26), badly distorting tick-duration and
// match-latency measurements under a compressed-time load test. Force the
// zero-network haversine estimator instead. A dynamic import (not a static
// one) is required: static imports are hoisted above this file's own
// top-level code, which would let config/env.ts read process.env before
// these overrides land.
process.env.ROUTING_PROVIDER = 'haversine';
process.env.ORS_API_KEY = '';
import('./simulateRun').catch(err => {
  // eslint-disable-next-line no-console
  console.error('simulation crashed', err);
  process.exit(1);
});
