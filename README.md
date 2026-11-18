# niceui

A small browser chat for **learning with a model**, built on your local [OpenCode](https://opencode.ai)
server. No code editor, no diffs, no terminal — just a conversation that can draw real charts,
diagrams and LaTeX.

- Real charts (`ColumnChart` with axes, ticks and value labels, `Scatter`, stacked `Area`,
  `Heatmap`, `Timeline`, `Sparkline`)
- Shape diagrams with labelled arrows (`Diagram`)
- LaTeX through KaTeX (`Math`)
- A teaching voice: the model explains simply and draws anything with shape, order or comparison
- Fenced ` ```openui-lang ` blocks, parsed with [OpenUI Lang](https://www.openui.com/docs/openui-lang)

## Requirements

- Node 24+
- [Bun](https://bun.sh)
- The `opencode` CLI on your `PATH`

It connects to the OpenCode background service (`@opencode/client/service`), so it uses the same
providers, models and sessions as your terminal.

## Run

```bash
bun install
bun run build
bun start            # http://localhost:5180
```

Or use the launcher:

```bash
ln -sf "$PWD/scripts/openc.sh" ~/.local/bin/openc
openc                # starts the server and opens the browser
openc --stop
```

`bun run dev` starts Vite with HMR and proxies `/oc` to `OC_URL` (default
`http://127.0.0.1:4096`).

## How the model knows the block language

The first message of each chat carries a short teaching contract (`src/lib/guidance.ts`) that
lists the components and their argument order. The UI hides that prefix and renders only your
text. Block syntax is checked by the parser; a block that does not parse is shown as its source
instead of an empty box.

## Credit

The visual block format follows **OpenUI Lang** (Thesys, MIT). The component set, chart rules and
teaching guidance were developed while exploring [OpenChamber](https://github.com/openchamber/openchamber)
(MIT), and this app keeps that experience with a far smaller surface.

## License

MIT. See [LICENSE](LICENSE).
