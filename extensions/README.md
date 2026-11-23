# Extensions

Optional add-ons live here, one folder per extension (`extensions/<name>/`). This folder is empty in the public repository; each extension is its own repository cloned into it. See `src/shared/extensions.ts` for the contract:

- `main.ts` – main process: own IPC channels (`ext:<name>:<channel>`), place images on a canvas
- `renderer.tsx` – a layer on top of the canvas UI
- `mcp.ts` – extra image origin kinds and a paragraph for the MCP instructions
- `glossary.json` – extra terms for speech recognition
