/**
 * service-manager.ts
 *
 * Starts the two local Python services (prompt optimizer, code intelligence)
 * when they aren't already running, so users don't need extra terminals.
 *
 * - If a service already answers /health (e.g. you started it yourself with
 *   `npm run python:dev`), it is reused and never touched.
 * - Packaged app: runs the bundled executable from resources/services/
 *   (built by scripts/build-services.ps1).
 * - From source: runs the service's own venv (`run_service.py`).
 * - Only processes started here are stopped on quit.
 * - Each service's output goes to <userData>/logs/<service>.log.
 * - Set PRMPT_MANAGE_SERVICES=0 to turn this off.
 */

import { app } from 'electron';
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

export interface ServiceSpec {
  /** Short id used in logs, e.g. "optimizer". */
  name: string;
  /** Base URL the app talks to, e.g. http://127.0.0.1:8001 */
  baseUrl: string;
  /** Source folder relative to the repo root, e.g. "python-service". */
  sourceDir: string;
  /** venv folder inside sourceDir. */
  venvDir: string;
  /** Bundled executable name (without .exe) in resources/services/<name>/. */
  bundleName: string;
}

interface Launch {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  kind: 'bundled' | 'source';
}

const HEALTH_TIMEOUT_MS = 1500;

function checkHealth(baseUrl: string, timeoutMs = HEALTH_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
    try {
      const req = http.get(new URL('/health', baseUrl), { timeout: timeoutMs }, (res) => {
        res.resume();
        done(res.statusCode === 200);
      });
      req.on('timeout', () => { req.destroy(); done(false); });
      req.on('error', () => done(false));
    } catch {
      done(false);
    }
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ServiceManager {
  private readonly children = new Map<string, ChildProcess>();
  private stopping = false;

  constructor(private readonly specs: ServiceSpec[]) {}

  /** Start any service that isn't running. Resolves once all are healthy or timed out. */
  async ensureRunning(timeoutMs = 120_000): Promise<Record<string, boolean>> {
    if (process.env.PRMPT_MANAGE_SERVICES === '0') {
      console.log('[Services] PRMPT_MANAGE_SERVICES=0, not starting services');
      return {};
    }
    const results = await Promise.all(this.specs.map((s) => this.ensureOne(s, timeoutMs)));
    return Object.fromEntries(this.specs.map((s, i) => [s.name, results[i]]));
  }

  /** Stop only the processes this manager started. */
  stopAll(): void {
    this.stopping = true;
    for (const [name, child] of this.children) {
      if (child.exitCode === null) {
        console.log(`[Services] Stopping ${name} (pid ${child.pid})`);
        try { child.kill(); } catch { /* already gone */ }
      }
    }
    this.children.clear();
  }

  private async ensureOne(spec: ServiceSpec, timeoutMs: number): Promise<boolean> {
    let url: URL;
    try { url = new URL(spec.baseUrl); } catch { return false; }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      return checkHealth(spec.baseUrl); // remote service: not ours to start
    }

    if (await checkHealth(spec.baseUrl)) {
      console.log(`[Services] ${spec.name} already running at ${spec.baseUrl} (reusing it)`);
      return true;
    }

    const port = url.port || '80';
    const launch = this.resolveLaunch(spec, port);
    if (!launch) {
      console.warn(`[Services] ${spec.name} isn't running and no bundled or source copy was found to start`);
      return false;
    }

    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `${spec.name}.log`);
    const logFd = fs.openSync(logPath, 'w');

    const t0 = Date.now();
    console.log(`[Services] Starting ${spec.name} (${launch.kind}): ${launch.command} ${launch.args.join(' ')}`);
    console.log(`[Services] ${spec.name} log: ${logPath}`);
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: { ...process.env, ...launch.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PRMPT_PARENT_PID: String(process.pid) },
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    });
    fs.closeSync(logFd);
    this.children.set(spec.name, child);

    let exited = false;
    child.on('error', (err) => {
      exited = true;
      console.error(`[Services] ${spec.name} failed to start:`, err.message);
    });
    child.on('exit', (code, signal) => {
      exited = true;
      this.children.delete(spec.name);
      if (!this.stopping) {
        console.warn(`[Services] ${spec.name} exited (code ${code}, signal ${signal}). See ${logPath}`);
      }
    });

    while (Date.now() - t0 < timeoutMs && !exited) {
      if (await checkHealth(spec.baseUrl, 1000)) {
        console.log(`[Services] ${spec.name} ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        return true;
      }
      await sleep(400);
    }
    if (!exited) {
      console.warn(`[Services] ${spec.name} not healthy after ${Math.round(timeoutMs / 1000)}s; still starting? See ${logPath}`);
    }
    return false;
  }

  private resolveLaunch(spec: ServiceSpec, port: string): Launch | null {
    const userData = app.getPath('userData');

    if (app.isPackaged) {
      const exe = path.join(
        process.resourcesPath, 'services', spec.bundleName,
        process.platform === 'win32' ? `${spec.bundleName}.exe` : spec.bundleName,
      );
      if (fs.existsSync(exe)) {
        return {
          kind: 'bundled',
          command: exe,
          args: ['--port', port],
          cwd: path.dirname(exe),
          env: {
            PRMPT_FILES_DIR: path.join(process.resourcesPath, 'files'),
            PRMPT_SERVICE_DATA_DIR: path.join(userData, 'services', spec.name),
          },
        };
      }
    }

    // From source: dist/main/services → three levels up is the repo root.
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const dir = path.join(repoRoot, spec.sourceDir);
    const python = process.platform === 'win32'
      ? path.join(dir, spec.venvDir, 'Scripts', 'python.exe')
      : path.join(dir, spec.venvDir, 'bin', 'python');
    if (fs.existsSync(python) && fs.existsSync(path.join(dir, 'run_service.py'))) {
      return { kind: 'source', command: python, args: ['run_service.py', '--port', port], cwd: dir, env: {} };
    }
    return null;
  }
}
