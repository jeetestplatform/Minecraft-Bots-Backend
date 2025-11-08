# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Common commands

- Install dependencies (root bots + backend API):
  - PowerShell
    - Root: `npm install`
    - Backend: `npm --prefix backend install`
  - Bash
    - Root: `npm install`
    - Backend: `(cd backend && npm install)`

- Start the manager API (Express, spawns bot processes):
  - PowerShell: `npm --prefix backend start`
  - Bash: `(cd backend && npm start)`
  - Env vars:
    - `PORT` (default 3000)
    - `CORS_ORIGIN` (comma‑separated list or `*`)

- Health check: `curl http://localhost:3000/healthz`

- List bots known to the manager (from `backend/config/bots.json`):
  - `curl http://localhost:3000/bots`

- Spawn/stop a bot (examples show `minebot`; replace with any id listed below):
  - PowerShell (Invoke‑RestMethod)
    - Spawn: `Invoke-RestMethod -Method Post -Uri http://localhost:3000/bots/minebot/spawn -Body '{}' -ContentType 'application/json'`
    - Stop: `Invoke-RestMethod -Method Post -Uri http://localhost:3000/bots/minebot/stop`
  - curl
    - Spawn: `curl -X POST http://localhost:3000/bots/minebot/spawn -H 'Content-Type: application/json' -d '{}'`
    - Stop: `curl -X POST http://localhost:3000/bots/minebot/stop`

- Stream bot logs (WebSocket): connect to `ws://localhost:3000/logs?id=<botId>` with any WS client.

- Run a bot directly (bypass manager) from repo root, e.g.:
  - `node minebot.js`
  - `node homebot.js`

Notes
- No linting or test scripts are defined in the package.json files; there is no test suite at this time.
- Node.js version: backend declares `engines: { node: ">=18" }`. Use Node 18+.

## Architecture overview

Two layers live in this repo:

1) Bot scripts (repo root)
- Files like `minebot.js`, `botnew.js`, `homebot.js`, `cavebot.js`, `goldfarmbot.js`, `netherbot.js`, `strongholdbot.js`, `xpfarmbot.js` implement Mineflayer bot behaviors.
- All bots hardcode server connection details (host, port, username, protocol version) at the top of each file.
- Shared patterns across bots:
  - Auto‑reconnect/backoff on disconnect; basic error handling.
  - Chat command handlers to trigger actions. Example (minebot): `!mine x1 y1 z1 x2 y2 z2`, `!collect food`, `!mine coal`, `!mine iron`, `!stop mining`, `!drop inventory`, plus teleport helpers.
  - Pathfinding, combat, mining, and item collection utilities in the more advanced bots (`minebot.js`, `botnew.js`) using `mineflayer-pathfinder`, `vec3`, and inventory/tool selection helpers.

2) Manager API (backend/)
- `backend/server.js` is an Express app that manages bot processes via `child_process.spawn`.
- Configuration is in `backend/config/bots.json` and maps an id/label to the script path relative to the repo root. Example entries:
  - bot ids: `bot`, `botnew`, `minebot`, `cavebot`, `goldfarmbot`, `homebot`, `netherbot`, `strongholdbot`, `xpfarmbot`
  - each has a `script` field like `minebot.js`.
- Runtime model (in‑memory):
  - Tracks `id -> { proc, status, lastExit }`.
  - Exposes REST endpoints:
    - `GET /healthz` simple health.
    - `GET /bots` returns id/label/status/lastExit for all configured bots.
    - `POST /bots/:id/spawn` starts a bot process (merges body as env into child process).
    - `POST /bots/:id/stop` sends SIGTERM to the bot process.
  - WebSocket `ws://.../logs?id=<id>` broadcasts stdout/stderr lines for a given bot.
- Process details:
  - Uses `process.execPath` to run the child with the same Node version as the manager.
  - `cwd` is the repo root; `script` in `bots.json` must resolve there.
  - CORS is configurable via `CORS_ORIGIN` (supports `*` or a comma‑separated allowlist).

3) Deployment helper
- `render-build.sh` installs production dependencies for both the repo root and `backend/` (intended for platforms like Render). Not required for local dev on Windows; it’s a Bash script.

## Developing productively

- Edit bot behavior directly in the relevant root script. For iterative work, run that bot with `node <file>.js` to see immediate effects.
- When integrating with a UI or external controller, prefer running the manager (`backend/server.js`) and driving bots via its REST+WS interface.
- To add a new managed bot: place the script at repo root (or adjust pathing), then add an entry to `backend/config/bots.json` with a unique `id` and the `script` filename.
