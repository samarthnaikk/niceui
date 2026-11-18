# niceui

A browser UI for OpenCode with a richer rendering layer: real charts, shape diagrams,
LaTeX, and a teaching voice the agent follows when you ask it to explain something.

Built on **[OpenChamber](https://github.com/openchamber/openchamber)** (MIT, by Bohdan
Triapitsyn and contributors). OpenChamber provides the agent workspace, session sync,
composer, diffs, terminal, and the `openui-lang` block system this fork extends. The
visual-block format itself follows **[OpenUI Lang](https://www.openui.com/docs/openui-lang)**
(Thesys, MIT); the catalog-and-schema approach is the same one used by
**[json-render](https://json-render.dev)** and **[A2UI](https://a2ui.org)**.

## What this fork adds

| Area | Change |
|---|---|
| Charts | `ColumnChart` with a value axis, tick labels, axis titles, arrowheads, legend, and value labels; `Scatter`, stacked `Area`, `Heatmap`, `Timeline`, `Sparkline` |
| Diagrams | `Diagram` block: positioned boxes, arrows clipped to box edges, labels on chips — drawn as shapes, never an image |
| Math | `Math` block rendering LaTeX through KaTeX, with styles loaded in shared/standalone documents |
| Teaching | Generated model guidance: explain simply, define terms, draw anything with shape/order/comparison, never draw a graph as ASCII or an image |
| Verification | `verify.ts` catches mismatched series lengths, negative bars, bad heatmap grids, reversed timelines, dangling diagram edges, and table↔chart label mismatches |
| Tooling | `bun run blocks:preview` renders every block to a standalone page; `openc` opens the app on the current folder |

## Requirements

- Node **24.14+**
- [Bun](https://bun.sh)
- An `opencode` CLI on `PATH`

## Build and run

```bash
bun install
bun run build:web      # server + browser bundle
bun run dev            # development, with HMR
```

`bun run dev` prints the UI URL (default `http://localhost:5180`).

### `openc`

A launcher that opens the built app on a folder, the way `opencode` opens a session there:

```bash
ln -s "$PWD/scripts/openc.sh" ~/.local/bin/openc   # once
openc                 # opens http://localhost:5180/?dir=$PWD
openc ~/code/app      # another folder
openc --stop          # stop the server it started
```

The `?dir=` parameter adds that folder as a project and selects it.

## Look at the blocks without an agent

```bash
bun run blocks:preview            # writes /tmp/oc-blocks-preview.html
```

## How the agent knows the language

The server sends `packages/web/server/lib/session-knowledge/ui-blocks-guidance.js`, generated
from the catalog and `guidance.ts`. After changing either, regenerate it:

```bash
bun run --cwd packages/ui ui-blocks:generate
```

## Differences from upstream

This fork keeps only the web build: the desktop (Electron), mobile (Capacitor), and VS Code
shells, the docs site, and their CI are removed. Upstream's embedded Google OAuth client
credentials are also removed; set `OPENCHAMBER_GOOGLE_GEMINI_CLIENT_ID` /
`OPENCHAMBER_GOOGLE_GEMINI_CLIENT_SECRET` (or the `ANTIGRAVITY` pair) if you use that quota
provider.

## License

MIT. See [LICENSE](LICENSE), which retains the upstream copyright.
