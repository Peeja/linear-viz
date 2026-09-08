# Linear dependency graph

A small local app that renders the issues in a Linear cycle as a layered
dependency graph (Sugiyama layout, orthogonal arrows pointing downward).

## Setup

1. Copy the config template and add your Linear API key:

   ```sh
   cp config.example.jsonc config.jsonc
   ```

   Then edit `config.jsonc` and set `linearApiKey`, plus `team` — the key
   your issue IDs are prefixed with (e.g. `FIL`), which decides whose
   cycles appear in the dropdown. Get a key at
   <https://linear.app/settings/api> → Personal API keys. The config is
   JSONC, so `//`/`/* */` comments and trailing commas are allowed.

2. Start the server (requires Node; no npm install needed):

   ```sh
   node server.js
   ```

3. Open <http://localhost:8787>. It opens the **current cycle**; pick any
   other from the dropdown. The selection is kept in the URL
   (`?cycle=…`), so a refresh returns to it.

## How the key is handled

The Linear API key lives only in `config.jsonc`, which the server reads.
The server **proxies** GraphQL requests to Linear and injects the key
server-side — the key is never sent to the browser and never appears in
client-side code or network traffic from the page.

`config.jsonc` (and `config.json`) is gitignored so the key isn't
committed. Linear personal API keys have full read/write scope, so treat
the file as a secret and rotate the key if it's ever exposed.

## Config

| Field              | Meaning                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `linearApiKey`     | Your Linear personal API key.                                    |
| `workspace`        | Workspace slug, used for click-to-open issue links.              |
| `team`             | Team key (e.g. `FIL`) whose cycles fill the dropdown. Empty = all. |
| `port`             | Port the local server listens on (default `8787`).               |
| `startRepos`       | Repos (`owner/repo`) attached to a "start this issue" session.   |
| `skillRepo`        | Repo holding the `/start-issue` skill; always included.          |
| `startEnvironment` | Optional Claude Code cloud environment to pin (name or id).      |
| `pollMs`           | Live-refresh cadence in ms (default `20000`; `0` disables).      |
