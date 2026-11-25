#!/usr/bin/env node
// Entry point for `npx github:<owner>/<repo>`. npm clones the repo into its cache, installs dependencies and runs
// `prepare` (builds the UI); then this script runs. The npx cache can be cleaned at any time, so `init` copies the
// app to ~/Library/Application Support/<Product>/app and registers the MCP server from there.
//
//   npx github:<repo>            first time: init, then start; later: start
//   npx github:<repo> init       copy the app, register the MCP server with Claude Code (asks before each step)
//   npx github:<repo> start      start the app (it also starts by itself when the coding agent opens a canvas)
//   npx github:<repo> status     what is installed and what voice needs
//   npx github:<repo> uninstall  remove the MCP server and the app copy; your canvases stay
//
// Options: --yes (no questions, for scripts), --no-mcp (skip registering with Claude Code).
// Environment for tests: HOME is respected everywhere; CLAUDE_BIN overrides the `claude` command.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE = fileURLToPath(new URL("..", import.meta.url));
// No .ts imports from SOURCE: inside the npx cache (node_modules) Node does not strip types. Only the copy in appDir runs .ts.
const pkg = JSON.parse(fs.readFileSync(path.join(SOURCE, "package.json"), "utf8"));
const PRODUCT = pkg.productName;
const SLUG = pkg.name;
const REPO = pkg.repository.replace(/^github:/, "");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const command = args.find((a) => !a.startsWith("--")) ?? "default";
const yes = flag("yes");
const home = os.homedir();
const dataDir = path.join(home, "Library/Application Support", PRODUCT);
const appDir = path.join(dataDir, "app");
const MARKER = ".user-install";
const MIN_NODE = 24;
const PORT = Number(process.env.CANVAS_PORT || 4720);

const out = (s = "") => process.stdout.write(s + "\n");
const step = (s) => out(`\n→ ${s}`);
const ok = (s) => out(`  ✓ ${s}`);
const note = (s) => out(`  · ${s}`);
const fail = (s) => {
  process.stderr.write(`  ✗ ${s}\n`);
  process.exitCode = 1;
};

async function ask(question, fallback = true) {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    fail(`${question} – no terminal to ask in. Run again with --yes.`);
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`  ? ${question} ${fallback ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
  rl.close();
  return answer ? answer.startsWith("y") || answer.startsWith("j") : fallback;
}

const installed = () => fs.existsSync(path.join(appDir, MARKER));
const version = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version ?? "?";
  } catch {
    return null;
  }
};

function checkPlatform() {
  if (process.platform !== "darwin") {
    fail(`${PRODUCT} runs on macOS only for now.`);
    return false;
  }
  const major = Number(process.versions.node.split(".")[0]);
  if (major < MIN_NODE) {
    fail(`Node ${MIN_NODE} or newer is needed (this is ${process.versions.node}). With mise: mise use -g node@${MIN_NODE}`);
    return false;
  }
  return true;
}

/** `claude` from PATH, or CLAUDE_BIN for tests. */
function claudeBin() {
  if (process.env.CLAUDE_BIN) return fs.existsSync(process.env.CLAUDE_BIN) ? process.env.CLAUDE_BIN : null;
  const r = spawnSync("/usr/bin/which", ["claude"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

const mcpCommand = () => [process.execPath, path.join(appDir, "src/mcp/server.ts")];

function printManualMcp() {
  const [cmd, server] = mcpCommand();
  note("Add this server to any MCP client (stdio):");
  out(JSON.stringify({ mcpServers: { [SLUG]: { command: cmd, args: [server] } } }, null, 2).replace(/^/gm, "    "));
}

/** Copy the app out of the npx cache. Data in dataDir stays untouched; only dataDir/app is replaced. */
function copyApp() {
  if (path.resolve(SOURCE) === path.resolve(appDir)) return ok("already running from the installed copy");
  const next = `${appDir}.next`;
  fs.rmSync(next, { recursive: true, force: true });
  fs.mkdirSync(next, { recursive: true });
  const skip = new Set([".git", "data", "build", "extensions", "spikes", "reviews", "test", "docs"]);
  for (const entry of fs.readdirSync(SOURCE)) {
    if (skip.has(entry)) continue;
    fs.cpSync(path.join(SOURCE, entry), path.join(next, entry), { recursive: true, verbatimSymlinks: true });
  }
  if (!fs.existsSync(path.join(next, "dist/renderer/index.html"))) throw new Error("UI not built (dist/renderer missing) – did `npm run prepare` fail?");
  // npx puts the dependencies next to the package (…/_npx/<hash>/node_modules/*), not inside it. Copy them along: exactly
  // the runtime dependencies, no network. Until 25.11. `npm prune --offline` was meant to rebuild them; with an empty
  // npm cache (a new Mac, CI) it failed silently and Electron was missing.
  const parent = path.dirname(path.resolve(SOURCE));
  if (!fs.existsSync(path.join(SOURCE, "node_modules")) && path.basename(parent) === "node_modules") {
    for (const entry of fs.readdirSync(parent)) {
      if (path.join(parent, entry) === path.resolve(SOURCE)) continue;
      fs.cpSync(path.join(parent, entry), path.join(next, "node_modules", entry), { recursive: true, verbatimSymlinks: true });
    }
  } else {
    // A checkout with its own node_modules: development tools are not needed at runtime. Offline: prune only removes.
    spawnSync("npm", ["prune", "--omit=dev", "--no-audit", "--no-fund", "--offline"], { cwd: next, stdio: "ignore" });
  }
  if (!fs.existsSync(path.join(next, "node_modules/electron/package.json"))) throw new Error("Dependencies missing in the app copy (node_modules/electron). Run init again; if it persists, please open an issue.");
  ensureElectron(next);
  fs.writeFileSync(path.join(next, MARKER), `${new Date().toISOString()}\n`);
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.renameSync(next, appDir);
  ok(`app copied to ${appDir.replace(home, "~")}`);
}

const electronBinary = (dir) => path.join(dir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");

/**
 * Electron fetches its binary on first use, not at install time. Do it here, visibly: later the MCP server starts
 * the app, and a download message on its stdout would break the MCP connection.
 */
function ensureElectron(dir) {
  if (fs.existsSync(electronBinary(dir))) return;
  note("downloading Electron (about 100 MB, once)");
  const r = spawnSync(process.execPath, [path.join(dir, "node_modules/electron/install.js")], { cwd: dir, stdio: "inherit" });
  if (r.status !== 0 || !fs.existsSync(electronBinary(dir))) throw new Error("Electron could not be downloaded. Check the network and run init again.");
}

function registerMcp() {
  const claude = claudeBin();
  if (!claude) {
    note("Claude Code (`claude`) not found.");
    return printManualMcp();
  }
  // Replace an older registration of the same name (e.g. after updating Node).
  spawnSync(claude, ["mcp", "remove", SLUG, "--scope", "user"], { stdio: "ignore" });
  const r = spawnSync(claude, ["mcp", "add", "--scope", "user", SLUG, "--", ...mcpCommand()], { encoding: "utf8" });
  if (r.status !== 0) {
    fail(`claude mcp add failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    return printManualMcp();
  }
  ok(`MCP server "${SLUG}" registered with Claude Code (user scope). New Claude Code sessions can use it.`);
}

async function voiceReport(dir) {
  const { checkSpeech } = await import(pathToFileURL(path.join(dir, "src/main/voice/setup.ts")).href);
  const speech = checkSpeech();
  if (!speech.missing.length) ok(`speech recognition ready (${path.basename(speech.model)})`);
  else {
    note(`Voice is optional. Missing: ${speech.missing.join(", ")}. To enable it:`);
    if (speech.missing.includes("whisper") || speech.missing.includes("ffmpeg")) out("      brew install whisper-cpp ffmpeg");
    if (speech.missing.includes("model"))
      out("      mkdir -p ~/.cache/whisper-cpp && curl -L -o ~/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin \\\n        https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin");
    note("Then restart the app. Free-form commands also need a Jev key (Settings → Understanding commands).");
  }
}

async function health() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function start() {
  if (!installed()) return fail(`Not installed yet. Run: npx github:${REPO} init`);
  const dir = appDir;
  const electron = electronBinary(dir);
  if (!fs.existsSync(electron)) return fail(`Electron missing in ${dir}. Run init again.`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(electron, [path.join(dir, "src/electron/main.ts")], { cwd: dir, detached: true, stdio: "ignore", env }).unref();
  ok(`${PRODUCT} started`);
}

async function init() {
  out(`${PRODUCT} – setup`);
  if (!checkPlatform()) return false;
  const was = version(appDir);
  step(was ? `Update the app in ${appDir.replace(home, "~")} (installed: ${was}, new: ${version(SOURCE)})` : `Copy the app to ${appDir.replace(home, "~")}`);
  if (!(await ask("Go ahead?"))) return false;
  try {
    copyApp();
  } catch (e) {
    fail(String(e.message ?? e));
    return false;
  }
  if (was && (await health())) note(`${PRODUCT} is running the old version: quit it (⌘Q) and start it again.`);
  if (!flag("no-mcp")) {
    step(`Register the MCP server "${SLUG}" with Claude Code`);
    if (await ask("Register it for all your projects (claude mcp add --scope user)?")) registerMcp();
    else printManualMcp();
  }
  step("Voice (optional)");
  await voiceReport(appDir);
  step("Website screenshots (optional)");
  note(`Your coding agent can shoot full-page screenshots with regions with the page-shots skill: npx github:${REPO.replace(/\/[^/]+$/, "")}/page-shots install`);
  out(`\nDone. In Claude Code, try: "Open my last screenshot on the canvas."`);
  return true;
}

async function status() {
  out(`${PRODUCT} – status`);
  out(`  app:      ${installed() ? `${appDir.replace(home, "~")} (${version(appDir)})` : "not installed"}`);
  out(`  data:     ${dataDir.replace(home, "~")}`);
  const h = await health();
  out(`  running:  ${h ? `yes (pid ${h.pid})` : "no"}`);
  const claude = claudeBin();
  const registered = claude ? spawnSync(claude, ["mcp", "get", SLUG], { encoding: "utf8" }).status === 0 : false;
  out(`  MCP:      ${claude ? (registered ? `registered as "${SLUG}"` : "not registered") : "Claude Code not found"}`);
  if (installed()) await voiceReport(appDir);
}

async function uninstall() {
  out(`${PRODUCT} – uninstall (your canvases in ${dataDir.replace(home, "~")} stay)`);
  if (!(await ask("Remove the MCP server and the app copy?", false))) return;
  const claude = claudeBin();
  if (claude) spawnSync(claude, ["mcp", "remove", SLUG, "--scope", "user"], { stdio: "ignore" });
  const h = await health();
  if (h?.pid) {
    try {
      process.kill(h.pid);
    } catch {
      // already gone
    }
  }
  fs.rmSync(appDir, { recursive: true, force: true });
  ok("removed");
}

switch (command) {
  case "init":
    await init();
    break;
  case "start":
    if (checkPlatform()) start();
    break;
  case "status":
    await status();
    break;
  case "uninstall":
    await uninstall();
    break;
  case "default":
    if (!installed() || version(appDir) !== version(SOURCE)) {
      if (await init()) start();
    } else if (checkPlatform()) start();
    break;
  default:
    fail(`unknown command: ${command} (init, start, status, uninstall)`);
}
