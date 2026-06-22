# Linear dependency graph

A small local app that renders a Linear epic's sub-issues as a layered
dependency graph (Sugiyama layout, orthogonal arrows pointing downward).

## Setup

1. Copy the config template and add your Linear API key:

   ```sh
   cp config.example.json config.json
   ```

   Then edit `config.json` and set `linearApiKey`. Get a key at
   <https://linear.app/settings/api> → Personal API keys.

2. Start the server (requires Node; no npm install needed):

   ```sh
   node server.js
   ```

3. Open <http://localhost:8787> and enter a parent issue identifier
   (e.g. `FIL-273`), then click **Load**.

## How the key is handled

The Linear API key lives only in `config.json`, which the server reads.
The server **proxies** GraphQL requests to Linear and injects the key
server-side — the key is never sent to the browser and never appears in
client-side code or network traffic from the page.

`config.json` is gitignored so the key isn't committed. Linear personal
API keys have full read/write scope, so treat the file as a secret and
rotate the key if it's ever exposed.

## Config

| Field          | Meaning                                              |
| -------------- | ---------------------------------------------------- |
| `linearApiKey` | Your Linear personal API key.                        |
| `workspace`    | Workspace slug, used for click-to-open issue links.  |
| `port`         | Port the local server listens on (default `8787`).   |
