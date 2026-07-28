// Pre-flight for `npm run dev`.
//
// Both dev-server failure modes on this project produce a raw Node stack trace
// that says nothing about how to fix it:
//
//   EADDRINUSE  a previous dev stack is still alive and holding the port. This
//               happens easily: if one workspace crashes, the others keep
//               running and keep their ports (mitigated by --kill-others-on-fail
//               in the root dev script, but a hard kill still orphans them).
//   EACCES      on Windows, the port sits inside a range the OS has reserved.
//               Hyper-V/WinNAT claims blocks dynamically, so a port that worked
//               yesterday can be unusable today after a reboot.
//
// Binding each port here first turns both into an actionable message before
// three workspaces start racing each other to fail.
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Server port comes from apps/server/.env; the Vite ports are strictPort. */
function serverPort() {
  const envPath = path.join(root, 'apps', 'server', '.env');
  try {
    const match = fs.readFileSync(envPath, 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);
    if (match) return Number(match[1]);
  } catch {
    // No .env yet — the server would default to 4000.
  }
  return 4000;
}

const PORTS = [
  { port: serverPort(), label: 'server' },
  { port: 5173, label: 'guest' },
  { port: 5174, label: 'admin' }
];

// A single probe host is not enough on Windows, because a listener only
// collides with a bind that overlaps it:
//
//   holder            probe 0.0.0.0   probe :: (no host)   probe 127.0.0.1
//   :: (our server)   OK              EADDRINUSE           OK
//   127.0.0.1 (vite)  OK              OK                   EADDRINUSE
//   0.0.0.0           EADDRINUSE      OK                   OK
//
// `httpServer.listen(port)` with no host binds '::', so a probe on '0.0.0.0'
// alone reported the port free while the server then died on EADDRINUSE — the
// exact failure this script exists to prevent. Trying all three catches every
// holder shape.
const PROBE_HOSTS = [undefined, '0.0.0.0', '127.0.0.1'];

function bindOnce(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (err) => resolve(err.code));
    srv.once('listening', () => srv.close(() => resolve(null)));
    if (host === undefined) srv.listen(port);
    else srv.listen(port, host);
  });
}

async function probe({ port, label }) {
  // Sequential, never parallel: two probes of the same port would collide with
  // each other and report a port that is actually free as in use.
  for (const host of PROBE_HOSTS) {
    const code = await bindOnce(port, host);
    if (code) return { port, label, code };
  }
  return { port, label, code: null };
}

/** Best-effort PID lookup so the message can name what to kill. */
function holders(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano -p tcp | findstr ":${port} " | findstr LISTENING`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const pids = [...new Set(out.trim().split(/\r?\n/).map((l) => l.trim().split(/\s+/).pop()))];
      return pids.filter(Boolean);
    }
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return [...new Set(out.trim().split(/\r?\n/).filter(Boolean))];
  } catch {
    return [];
  }
}

function reservedRangesHint(port) {
  if (process.platform !== 'win32') return '';
  try {
    const out = execSync('netsh interface ipv4 show excludedportrange protocol=tcp', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    for (const line of out.split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)\s+(\d+)/);
      if (m && port >= Number(m[1]) && port <= Number(m[2])) {
        return `\n     Windows has reserved ports ${m[1]}-${m[2]}, which contains ${port}.`;
      }
    }
  } catch {
    // netsh unavailable — fall through to the generic message.
  }
  return '';
}

const results = await Promise.all(PORTS.map(probe));
const blocked = results.filter((r) => r.code);

if (blocked.length === 0) {
  process.exit(0);
}

console.error('\n  Cannot start the dev stack — a port is unavailable.\n');

for (const { port, label, code } of blocked) {
  if (code === 'EADDRINUSE') {
    const pids = holders(port);
    console.error(`  x ${label} port ${port} is already in use.`);
    if (pids.length) {
      console.error(`     Held by PID ${pids.join(', ')} — almost certainly a dev server that outlived its terminal.`);
      console.error(
        process.platform === 'win32'
          ? `     Free it with:  taskkill /F ${pids.map((p) => `/PID ${p}`).join(' ')}`
          : `     Free it with:  kill -9 ${pids.join(' ')}`
      );
    }
  } else if (code === 'EACCES') {
    console.error(`  x ${label} port ${port} is not permitted.${reservedRangesHint(port)}`);
    console.error('     Inspect the reserved ranges with:');
    console.error('       netsh interface ipv4 show excludedportrange protocol=tcp');
    console.error('     Then either pick a port outside every listed range, or free the range with an');
    console.error('     elevated:  net stop winnat && net start winnat');
    if (label === 'server') {
      console.error('     If you change the server PORT, update VITE_API_URL and VITE_SOCKET_URL in');
      console.error('     apps/guest/.env and apps/admin/.env to match, or the frontends will call a dead port.');
    }
  } else {
    console.error(`  x ${label} port ${port} failed to bind (${code}).`);
  }
  console.error('');
}

process.exit(1);
