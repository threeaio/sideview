// Acceptance test for the public version, as a stranger would get it: `npx github:<repo>` on a Mac with a fresh home
// folder. Instead of GitHub it installs from this repository's committed branch (git+file), offline from the local npm
// and Electron caches, so nothing is downloaded. `claude` is a stub that records its arguments.
//
// Steps: npx … init --yes (timed) → the copy is clean (no extensions, no private names) → the MCP server registered by
// init starts the app by itself → a real round trip with a plain MCP client: open a page-shots screenshot, review,
// draw a frame, type a note, click "Done", the note comes back → status → uninstall (canvases stay).
//
//   node scripts/check-npx.mjs [branch]      (default: current branch; commit first, npx installs the committed state)

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const branch = process.argv[2] || execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const PORT = "4751";
const realHome = os.homedir();
const home = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-fresh-home-"));
const appDir = path.join(home, "Library/Application Support/Sideview/app");
const dataDir = path.dirname(appDir);
const shots = path.join(home, "Desktop/shots/fixture-page");

const results = [];
const ok = (name, facts = {}) => {
  results.push({ name, ok: true, ...facts });
  console.log(`ok   ${name}`, Object.keys(facts).length ? JSON.stringify(facts) : "");
};
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// `claude` stub: records every call; `mcp get` succeeds once something was added.
const stubDir = path.join(home, "stub-bin");
fs.mkdirSync(stubDir, { recursive: true });
const callsLog = path.join(home, "claude-calls.log");
fs.writeFileSync(
  path.join(stubDir, "claude"),
  `#!/bin/sh\necho "$@" >> "${callsLog}"\nif [ "$1 $2" = "mcp get" ]; then grep -q "^mcp add" "${callsLog}" && exit 0; exit 1; fi\nexit 0\n`,
  { mode: 0o755 },
);

const nodeDir = path.dirname(process.execPath);
const env = {
  HOME: home,
  USER: os.userInfo().username,
  PATH: [nodeDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"),
  TMPDIR: os.tmpdir(),
  LANG: "en_US.UTF-8",
  // Offline from the real caches: npm packages and the Electron zip are already there.
  npm_config_cache: path.join(realHome, ".npm"),
  npm_config_prefer_offline: "true",
  npm_config_update_notifier: "false",
  npm_config_fund: "false",
  npm_config_audit: "false",
  electron_config_cache: path.join(realHome, "Library/Caches/electron"),
  CLAUDE_BIN: path.join(stubDir, "claude"),
  CANVAS_PORT: PORT,
  CANVAS_QUIET: "1",
  CANVAS_WHISPER_PORT: "4752",
};

let mcp = null;
let ui = null;
try {
  // 1. npx … init --yes
  const spec = `git+file://${ROOT}#${branch}`;
  const t0 = Date.now();
  const r = spawnSync("npx", ["--yes", `--package=${spec}`, "sideview", "init", "--yes"], { env, encoding: "utf8", timeout: 600_000 });
  const initSeconds = Math.round((Date.now() - t0) / 1000);
  fs.writeFileSync(path.join(home, "npx-init.log"), `${r.stdout}\n--- stderr ---\n${r.stderr}`);
  must(r.status === 0, `npx init failed (${r.status}): ${(r.stderr || r.stdout).slice(-1500)}`);
  ok("npx init on a fresh home, offline", { seconds: initSeconds });
  console.log(r.stdout.replace(/^/gm, "     | "));

  // 2. The copy is complete and clean.
  must(fs.existsSync(path.join(appDir, ".user-install")), "marker .user-install missing");
  must(fs.existsSync(path.join(appDir, "dist/renderer/index.html")), "UI not built");
  must(fs.existsSync(path.join(appDir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")), "Electron binary missing");
  must(!fs.existsSync(path.join(appDir, "extensions")), "extensions folder copied");
  must(!fs.existsSync(path.join(appDir, "node_modules/vite")), "dev dependencies not pruned");
  const grep = (pattern, dir) => spawnSync("grep", ["-rliwE", pattern, dir], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
  // Words that must not appear in the public copy (for the maintainer, e.g. private tool names), comma-separated.
  const privateWords = (process.env.CANVAS_PRIVATE_WORDS ?? "").split(",").map((w) => w.trim()).filter(Boolean);
  const leaks = privateWords.flatMap((w) => grep(w, path.join(appDir, "src")).concat(grep(w, path.join(appDir, "dist"))).map((f) => `${w}: ${f}`));
  must(leaks.length === 0, `private words in the public copy: ${leaks.join(", ")}`);
  const size = execFileSync("du", ["-sh", appDir], { encoding: "utf8" }).split("\t")[0];
  ok("copy complete and clean: UI built, Electron there, dev tools pruned, no extensions", { size, privateWordsChecked: privateWords.length });

  // 3. Registration with Claude Code.
  const calls = fs.readFileSync(callsLog, "utf8").trim().split("\n");
  const add = calls.find((c) => c.startsWith("mcp add"));
  must(add === `mcp add --scope user sideview -- ${process.execPath} ${path.join(appDir, "src/mcp/server.ts")}`, `unexpected registration: ${add}`);
  ok("MCP server registered for the user", { command: add });

  // 4. The registered server starts the app by itself.
  const fixture = await import(path.join(ROOT, "test/fixtures/stage.ts"));
  const { desktop } = await fixture.stagePageShots(shots);
  mcp = new Client({ name: "acceptance", version: "0" });
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(appDir, "src/mcp/server.ts")], env: { ...env, PATH: env.PATH } }));
  const tools = (await mcp.listTools()).tools.map((t) => t.name).sort();
  must(tools.includes("sideview_open") && tools.includes("sideview_review") && tools.includes("sideview_resolve_annotations"), `tools: ${tools}`);
  const t1 = Date.now();
  const listed = await mcp.callTool({ name: "sideview_list", arguments: {} });
  must(!listed.isError, `sideview_list: ${JSON.stringify(listed.content)}`);
  const health = await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json();
  ok("first MCP call starts the app from the installed copy", { seconds: Math.round((Date.now() - t1) / 1000), tools: tools.length, pid: health.pid });
  const started = path.join(dataDir, "logs/app.jsonl");
  must(fs.existsSync(started), "app log missing in the user's data folder");
  // Hand over to a window we can drive: stop the app the server started.
  process.kill(health.pid);
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/api/health`);
      await sleep(100);
    } catch {
      break;
    }
  }

  // 5. Round trip with the UI: the same installed copy, driven by Playwright.
  ui = await electron.launch({
    executablePath: path.join(appDir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
    args: [path.join(appDir, "src/electron/main.ts")],
    cwd: appDir,
    env: { ...env, CANVAS_DATA: dataDir },
  });
  const page = await ui.firstWindow();
  await page.waitForSelector(".review-bar", { timeout: 30_000 });
  const opened = await mcp.callTool({ name: "sideview_open", arguments: { images: [desktop], title: "Fresh install", focus: "Kopf" } });
  const openedText = opened.content[0]?.text ?? "";
  must(!opened.isError, `sideview_open: ${openedText}`);
  ok("sideview_open with a page-shots screenshot, regions read from regions.json", { head: openedText.split("\n")[0] });

  // No speech on a fresh Mac (no whisper model in this home): no voice bar, everything else works.
  await page.waitForSelector(".surface", { timeout: 15_000 });
  await sleep(1500);
  const voiceBar = await page.$(".voice");
  must(!voiceBar, "voice bar shown although speech recognition is not set up");
  ok("without a whisper model: no voice bar, no errors");

  const review = mcp.callTool({ name: "sideview_review", arguments: { canvas: "fresh-install", prompt: "Does the header work?" } }, undefined, { timeout: 120_000 });
  await page.waitForSelector(".claude-card [data-option=fertig]", { timeout: 15_000 });
  const box = await page.evaluate(() => JSON.parse(JSON.stringify(document.querySelector(".surface").getBoundingClientRect())));
  const a = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.35 };
  const b = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.55 };
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
  await page.mouse.up();
  await page.waitForSelector(".note-editor__text", { timeout: 5_000 });
  await page.keyboard.type("Headline too small on first view");
  await page.keyboard.press("Enter");
  await sleep(400);
  await page.click('.claude-card [data-option="fertig"]');
  const result = await review;
  const resultText = result.content[0]?.text ?? "";
  must(/Headline too small on first view/.test(resultText), `note did not come back: ${resultText.slice(0, 400)}`);
  ok("review round trip: frame, typed note, Done → back in the MCP client", { first: resultText.split("\n")[0] });

  const resolved = await mcp.callTool({ name: "sideview_resolve_annotations", arguments: { canvas: "fresh-install", annotations: [{ ref: "1", reply: "Made the headline larger." }] } });
  must(!resolved.isError, `resolve: ${resolved.content[0]?.text}`);
  ok("resolve with a reply");

  await ui.close();
  ui = null;
  await mcp.close();
  mcp = null;

  // 6. Update over an existing install: run init again from npx. Canvases stay, the registration is replaced.
  const before = fs.readdirSync(path.join(dataDir, "canvases")).sort();
  const t2 = Date.now();
  const again = spawnSync("npx", ["--yes", `--package=${spec}`, "sideview", "init", "--yes"], { env, encoding: "utf8", timeout: 600_000 });
  must(again.status === 0, `update failed: ${(again.stderr || again.stdout).slice(-800)}`);
  must(/Update the app/.test(again.stdout), `init did not recognise the existing install: ${again.stdout.slice(0, 300)}`);
  must(JSON.stringify(fs.readdirSync(path.join(dataDir, "canvases")).sort()) === JSON.stringify(before), "canvases changed by the update");
  const callsAfter = fs.readFileSync(callsLog, "utf8").trim().split("\n");
  must(callsAfter.filter((c) => c.startsWith("mcp add")).length === 2 && callsAfter.filter((c) => c.startsWith("mcp remove")).length >= 2, "registration not replaced on update");
  ok("update over an existing install keeps the canvases and replaces the registration", { seconds: Math.round((Date.now() - t2) / 1000), canvases: before.length });

  // 7. status and uninstall.
  const status = spawnSync(process.execPath, [path.join(appDir, "bin/sideview.mjs"), "status"], { env, encoding: "utf8" });
  must(/registered as "sideview"/.test(status.stdout), `status: ${status.stdout}`);
  must(/Missing: model/.test(status.stdout), `status should report the missing whisper model: ${status.stdout}`);
  ok("status reports app, MCP and what voice needs");
  const un = spawnSync(process.execPath, [path.join(appDir, "bin/sideview.mjs"), "uninstall", "--yes"], { env, encoding: "utf8" });
  must(un.status === 0 && !fs.existsSync(appDir), `uninstall: ${un.stdout}${un.stderr}`);
  must(fs.existsSync(path.join(dataDir, "canvases")), "canvases removed by uninstall");
  must(fs.readFileSync(callsLog, "utf8").includes("mcp remove sideview --scope user"), "MCP server not removed");
  ok("uninstall removes app copy and MCP server, canvases stay");

  console.log(`\nall ${results.length} steps ok. Fresh home: ${home}`);
} catch (e) {
  console.error(`\nFAILED: ${e.message}\nFresh home kept for inspection: ${home}`);
  process.exitCode = 1;
} finally {
  await ui?.close().catch(() => {});
  await mcp?.close().catch(() => {});
}
