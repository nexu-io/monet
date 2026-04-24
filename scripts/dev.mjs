import { execFile, spawn } from "node:child_process";
import process from "node:process";

const controllerToken = "monet-dev-token";
const controllerUrl = "http://127.0.0.1:3030";
const webUrl = "http://127.0.0.1:3000";
const defaultEnv = {
  ...process.env,
  MONET_CONTROLLER_BEARER_TOKEN: controllerToken,
  NEXT_PUBLIC_MONET_CONTROLLER_URL: controllerUrl,
  NEXT_PUBLIC_MONET_CONTROLLER_BEARER_TOKEN: controllerToken,
  MONET_DESKTOP_RENDERER_URL: webUrl,
  MONET_DESKTOP_CONTROLLER_URL: controllerUrl,
  MONET_DESKTOP_CONTROLLER_BEARER_TOKEN: controllerToken
};

const managedChildren = [];
let shuttingDown = false;

main().catch(async (error) => {
  console.error(`\n[monet dev] ${formatError(error)}`);
  await shutdownChildren();
  process.exit(1);
});

async function main() {
  installSignalHandlers();

  await runCommand("pnpm", ["run", "build:desktop"], {
    env: defaultEnv
  });

  const controllerManaged = !(await ensureControllerReady());
  const webManaged = !(await ensureWebReady());
  const skipDesktop = process.env.MONET_DEV_SKIP_DESKTOP === "1";

  if (skipDesktop) {
    console.log("[monet dev] skipping desktop launch (MONET_DEV_SKIP_DESKTOP=1)");
  } else {
    if (await shouldResetDevSession()) {
      await resetDevSession();
    }

    const controllerReadyAfterReset = await ensureControllerReady();
    const webReadyAfterReset = await ensureWebReady();

    if (!controllerManaged && controllerReadyAfterReset) {
      throw new Error("controller unexpectedly remained managed after reset");
    }

    if (!webManaged && webReadyAfterReset) {
      throw new Error("web unexpectedly remained managed after reset");
    }

    spawnManaged("desktop", "pnpm", ["--filter", "@monet/desktop", "dev"], {
      env: defaultEnv
    });
  }

  if (!controllerManaged && !webManaged && skipDesktop) {
    console.log("[monet dev] controller and web dev server already running; nothing to start.");
    return;
  }

  if (managedChildren.length === 0) {
    console.log("[monet dev] all dev services already running.");
    return;
  }

  await waitForChildren();
}

async function ensureControllerReady() {
  if (await isMonetControllerReady()) {
    console.log("[monet dev] reusing controller on 127.0.0.1:3030");
    return true;
  }

  if (await isPortReachable(controllerUrl)) {
    throw new Error("port 3030 is already in use by a non-Monet service");
  }

  console.log("[monet dev] starting controller on 127.0.0.1:3030");
  const child = spawnManaged("controller", "pnpm", ["--filter", "@monet/controller", "dev"], {
    env: defaultEnv,
    readinessCheck: isMonetControllerReady
  });

  await waitForReadiness({
    label: "controller",
    timeoutMs: 30000,
    check: isMonetControllerReady,
    child
  });

  return false;
}

async function ensureWebReady() {
  if (await isMonetWebReady()) {
    console.log("[monet dev] reusing web dev server on 127.0.0.1:3000");
    return true;
  }

  if (await isPortReachable(webUrl)) {
    throw new Error("port 3000 is already in use by a non-Monet service");
  }

  console.log("[monet dev] starting web dev server on 127.0.0.1:3000");
  const child = spawnManaged("web", "pnpm", ["--filter", "@monet/web-ui", "dev"], {
    env: defaultEnv,
    readinessCheck: isMonetWebReady
  });

  await waitForReadiness({
    label: "web",
    timeoutMs: 60000,
    check: isMonetWebReady,
    child
  });

  return false;
}

function spawnManaged(label, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: options.env ?? process.env
  });

  const record = {
    label,
    child,
    readinessCheck: options.readinessCheck ?? null,
    exit: null
  };

  child.once("error", (error) => {
    record.exit = {
      code: 1,
      signal: null
    };

    if (!shuttingDown) {
      console.error(`[monet dev] failed to start ${label}: ${formatError(error)}`);
      void shutdownChildren(record.child).finally(() => {
        process.exit(1);
      });
    }
  });

  child.once("exit", (code, signal) => {
    record.exit = { code, signal };

    if (!shuttingDown && code && code !== 0) {
      void shutdownChildren(record.child).finally(() => {
        process.exit(code);
      });
    }
  });

  managedChildren.push(record);
  return record;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: options.env ?? process.env
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}`));
    });
  });
}

async function waitForReadiness({ label, timeoutMs, check, child }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await check()) {
      console.log(`[monet dev] ${label} ready`);
      return;
    }

    if (child.exit) {
      const { code, signal } = child.exit;
      throw new Error(`${label} exited before becoming ready (${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`})`);
    }

    await sleep(400);
  }

  throw new Error(`timed out waiting for ${label} readiness`);
}

function waitForChildren() {
  return new Promise((resolve) => {
    let remaining = managedChildren.filter((record) => !record.exit).length;

    if (remaining === 0) {
      resolve();
      return;
    }

    for (const record of managedChildren) {
      record.child.once("exit", () => {
        remaining -= 1;
        if (remaining === 0) {
          resolve();
        }
      });
    }
  });
}

async function shutdownChildren(exceptChild = null) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  const targets = managedChildren.filter((record) => record.child !== exceptChild && !record.child.killed);

  for (const record of targets) {
    record.child.kill("SIGTERM");
  }

  await Promise.all(
    targets.map(
      (record) =>
        new Promise((resolve) => {
          if (record.exit) {
            resolve();
            return;
          }

          const timer = setTimeout(() => {
            if (!record.exit) {
              record.child.kill("SIGKILL");
            }
          }, 3000);

          record.child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        })
    )
  );
}

function installSignalHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      void shutdownChildren().finally(() => {
        process.exit(0);
      });
    });
  }
}

async function isMonetControllerReady() {
  try {
    const response = await fetch(`${controllerUrl}/api/health`, {
      headers: {
        Authorization: `Bearer ${controllerToken}`
      }
    });

    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    return payload?.service === "controller" && payload?.status === "ok";
  } catch {
    return false;
  }
}

async function isMonetWebReady() {
  try {
    const response = await fetch(webUrl);

    if (!response.ok) {
      return false;
    }

    const body = await response.text();
    return body.includes("<title>Monet</title>");
  } catch {
    return false;
  }
}

async function isPortReachable(url) {
  try {
    const response = await fetch(url);
    await response.arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

async function shouldResetDevSession() {
  const desktopPids = await listMonetDesktopPids();
  const rootDevPids = await listRootDevSessionPids();

  return desktopPids.length > 0 || rootDevPids.length > 0;
}

async function resetDevSession() {
  const rootDevPids = await listRootDevSessionPids();
  const desktopPids = await listMonetDesktopPids();
  const controllerPids = await listControllerPids();
  const webPids = await listWebPids();
  const pids = uniquePids([...rootDevPids, ...desktopPids, ...controllerPids, ...webPids]);

  if (pids.length === 0) {
    return false;
  }

  console.log(`[monet dev] resetting Monet dev session (${pids.join(", ")})`);

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
  }

  await waitForDevSessionExit();
  return true;
}

function waitForDevSessionExit() {
  return waitForCondition(async () => (await listAllDevSessionPids()).length === 0, 10000, 200, "Monet dev session to exit");
}

async function listAllDevSessionPids() {
  return uniquePids([
    ...(await listRootDevSessionPids()),
    ...(await listMonetDesktopPids()),
    ...(await listControllerPids()),
    ...(await listWebPids())
  ]);
}

function listRootDevSessionPids() {
  return execPgrep(["-f", "node ./scripts/dev.mjs|scripts/dev.mjs"]);
}

function listMonetDesktopPids() {
  return execPgrep(["-f", "electron/cli.js dist/main.js|Electron.app/Contents/MacOS/Electron dist/main.js"]);
}

function listControllerPids() {
  return execPgrep(["-f", "tsx.*src/index.ts"]);
}

function listWebPids() {
  return execPgrep(["-f", "next-server \\(v|next dev --hostname 127.0.0.1 --port 3000"]);
}

function execPgrep(args) {
  return new Promise((resolve, reject) => {
    execFile("pgrep", args, (error, stdout) => {
      if (!error) {
        resolve(parsePidList(stdout));
        return;
      }

      const exitCode = typeof error.code === "number" ? error.code : null;

      if (exitCode === 1) {
        resolve([]);
        return;
      }

      reject(error);
    });
  });
}

function parsePidList(stdout) {
  return stdout
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function uniquePids(pids) {
  return [...new Set(pids)];
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForCondition(check, timeoutMs, intervalMs, label) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }

    await sleep(intervalMs);
  }

  throw new Error(`timed out waiting for ${label}`);
}

function isMissingProcessError(error) {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
