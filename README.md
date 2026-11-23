# Sideview

A canvas next to your Claude Code thread. Claude puts screenshots on it – of a website, a Figma frame, your app. You zoom in, frame the spots that bother you, type or speak a note, and click **Done**. Claude gets every note with a crop of the spot, fixes what you asked for, and checks each note off with a one-line reply.

It is a small macOS app with a local MCP server. Everything stays on your Mac.

![Three landing pages side by side; Claude waits while a frame with a note marks one header](docs/images/review.png)

> Status: a personal tool, shared as is. It works well for me every day; it may not for you. Issues are welcome, support is not promised.

## Install

You need macOS, [Node](https://nodejs.org) 24 or newer and [Claude Code](https://claude.com/claude-code).

```bash
npx github:threeaio/sideview
```

This copies the app to `~/Library/Application Support/Sideview/app`, registers the MCP server `sideview` with Claude Code for all your projects (it asks first), and starts the app. Start a new Claude session afterwards so it sees the new tools.

Later: `npx github:threeaio/sideview status`, `… start`, `… uninstall` (your canvases stay). Running the first command again updates the app.

## Use

Say "Sideview" (or "canvas") in Claude Code and point at material:

- *"Put the screenshots in ./shots on the canvas."*
- *"Take full-page screenshots of example.com, desktop and mobile, and open them on the canvas. Let's review the header."*
- *"Open this Figma section on the canvas: https://www.figma.com/design/…"* (needs the Figma MCP connector)

Then, in the canvas:

| What | How |
|---|---|
| Zoom | pinch, or ⌘ + scroll; ⌘+ / ⌘– ; ⌘0 is 100 %; Shift+1 shows everything |
| Pan | two fingers, scroll, or hold Space and drag |
| Frame a spot | Shift + drag, or drag with the Mark tool (M). Type a note, Enter saves |
| Pin a point | click an image with the Mark tool |
| Next / previous image | → / ←, or the arrows in the toolbar |
| Send to Claude | **Done** at the top (or say "done") |
| Mark as done / reopen | select a note, **Done** / **Reopen**; Claude does this itself after fixing something |
| Undo | ⌘Z, ⌘⇧Z |
| Table of contents | click the canvas name or press I |
| All notes | click the counter top right or press A |
| All canvases | "Canvases" top left, ⌘O; new canvas ⌘N |
| Drop or paste images | drag image files onto the canvas, or ⌘V |

Once Claude has fixed something, it checks the note off with a one-line reply. The note stays on the canvas, so you can see what was done and reopen it.

![A note checked off, with Claude's reply](docs/images/resolved.png)

When Claude replaces an image with a revised version, the old versions stay stacked behind it.

![A page replaced by its next version, the earlier versions stacked behind it](docs/images/versions.png)

## Voice (optional)

Hold **Option (⌥)** and speak: "overview", "next", "show me the header", "note three", dictate a note, "done". German works as well as English (Settings → Language).

Speech recognition runs locally with [whisper.cpp](https://github.com/ggml-org/whisper.cpp):

```bash
brew install whisper-cpp ffmpeg
mkdir -p ~/.cache/whisper-cpp
curl -L -o ~/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
```

Restart the app. Without anything else, dictation and commands with their exact wording work.

To understand free sentences ("go back to the one with the pricing table"), Sideview asks a small decision model: [Jev](https://docs.typesafe.ai) by TypeSafe. Put your API key in Settings (⌘,) → Understanding commands; it is stored in the macOS Keychain. Any service with the same API (`POST /v1/systemone`) works too – set its address and model in the same place, e.g. a local [Kev](https://github.com/jaredpalmer/kev) (its model cards list English only). Only the transcribed sentence and the names of the options on screen are sent; audio never leaves your Mac.

## Website screenshots

Sideview reads `regions.json` next to a screenshot and then knows the header, sections and footer by name ("show me the pricing section"). The companion skill [page-shots](https://github.com/threeaio/page-shots) takes such screenshots: desktop and mobile, cookie banners declined, lazy images loaded. It is optional; any image works.

## Other MCP clients

The server is a plain stdio MCP server. Add it to any client:

```json
{ "mcpServers": { "sideview": { "command": "node", "args": ["~/Library/Application Support/Sideview/app/src/mcp/server.ts"] } } }
```

(Use absolute paths; `npx github:threeaio/sideview status` prints them.) `sideview_review` waits until you click Done. Clients without progress notifications get a "still open" answer after 45 seconds and simply call again; nothing is lost. Tested with Claude Code.

## Tools

`sideview_open`, `sideview_review`, `sideview_get`, `sideview_list`, `sideview_resolve_annotations`, `sideview_remove_annotations`, `sideview_remove`. Canvases are stored as [JSON Canvas](https://jsoncanvas.org) files in `~/Library/Application Support/Sideview/canvases`, notes as extra fields.

## Extensions (experimental)

There is a small extension point, built for one private add-on (a search in a personal image library) and kept because it was cheap. Drop a folder into `extensions/<name>/` and rebuild: it can add a layer to the UI, its own IPC channels, image origins for the MCP server and terms for speech recognition (`src/shared/extensions.ts`). It is not a plugin system: extensions import app internals, there is no stable API, they run with the app's full rights, and the UI part is bundled at build time. Expect it to change.

## Development

```bash
git clone https://github.com/threeaio/sideview && cd sideview
npm install
npm run app          # builds the UI on install; runs on port 4730 with data in ./data
npm test && npm run typecheck
node scripts/check-npx.mjs   # the install path end to end, offline, with a fresh home folder
npm run check:labels         # note numbers and cards at every zoom level, expects 0 problems
```

Code comments are partly German; the app speaks both.

## License

MIT
