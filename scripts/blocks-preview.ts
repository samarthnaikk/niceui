/**
 * Builds one standalone HTML page that draws sample UI blocks with the app's own renderer
 * and stylesheet. Used to look at the block catalog without a running agent.
 *
 *   bun scripts/blocks-preview.ts [outFile]
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { build, type InlineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { SHARE_DOCUMENT_ENTRY, SHARE_DOCUMENT_SHIMS } from '../packages/ui/src/share-document/shims';
import { buildShareUiDocument } from '../packages/ui/src/share-document/page';

const uiSource = path.resolve(import.meta.dir, '../packages/ui/src');
const stripExtension = (file: string) => file.replace(/\.(tsx?|jsx?)$/, '');

const shimPlugin: Plugin = {
  name: 'openchamber-share-document-shims',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    if (!resolved) return null;
    const shims = new Map(Object.entries(SHARE_DOCUMENT_SHIMS).map(([target, shim]) => [
      path.join(uiSource, target),
      path.join(uiSource, shim),
    ]));
    return shims.get(stripExtension(resolved.id.split('?')[0])) ?? null;
  },
};

const bundle = async () => {
  const config: InlineConfig = {
    configFile: false,
    root: uiSource,
    logLevel: 'warn',
    mode: 'development',
    plugins: [shimPlugin, react()],
    resolve: {
      alias: [
        { find: '@openchamber/sdk/schemas', replacement: path.resolve(import.meta.dir, '../packages/sdk/src/schemas.ts') },
        { find: '@openchamber/sdk', replacement: path.resolve(import.meta.dir, '../packages/sdk/src/index.ts') },
        { find: '@openchamber/ui', replacement: uiSource },
        { find: '@', replacement: uiSource },
      ],
    },
    define: { 'process.env.NODE_ENV': JSON.stringify('development'), 'process.env': {}, global: 'globalThis' },
    build: {
      write: false,
      emptyOutDir: false,
      minify: false,
      sourcemap: false,
      reportCompressedSize: false,
      lib: { entry: path.join(uiSource, SHARE_DOCUMENT_ENTRY), formats: ['iife'], name: 'OpenChamberShareDocument', fileName: () => 'share-document.js' },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  };
  const result = await build(config);
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => ('output' in entry ? entry.output : []));
  const chunk = outputs.find((output) => output.type === 'chunk' && output.isEntry);
  if (!chunk || chunk.type !== 'chunk') throw new Error('The share document build produced no script');
  return chunk.code;
};

const program = `root = Stack([intro, teaching, flow, charts, grid, work, formula, numbers, mismatch, mini])
intro = Card("Complex blocks", [Text("Drawn by the app's own block renderer, in the theme's colours."), Row([Badge("diagram", "info"), Badge("charts", "success"), Badge("math", "warning")])])
teaching = Card("How a request flows", [Text("A request starts in the browser. The server forwards it to the agent, and the agent writes the session to **SQLite**. Each hop adds latency, so the slowest hop sets the floor."), Diagram([{id: "b", label: "Browser", x: 16, y: 30, tone: "info"}, {id: "s", label: "Server", x: 50, y: 30}, {id: "a", label: "Agent", x: 50, y: 70}, {id: "d", label: "SQLite", x: 84, y: 70, tone: "success"}], [{from: "b", to: "s", label: "SSE"}, {from: "s", to: "a", label: "prompt"}, {from: "a", to: "d", label: "write"}], 200), ColumnChart(["browser", "server", "agent", "sqlite"], [Series("p50", [4, 6, 9, 3])], "ms", false, "hop", "time")])
flow = Card("Architecture", [Diagram([{id: "ui", label: "Browser UI", x: 18, y: 26, tone: "info"}, {id: "api", label: "OpenChamber server", x: 50, y: 26}, {id: "agent", label: "OpenCode agent", x: 50, y: 70}, {id: "db", label: "Sessions", x: 82, y: 70, tone: "success"}], [{from: "ui", to: "api", label: "SSE"}, {from: "api", to: "agent"}, {from: "agent", to: "db"}], 230)])
charts = Card("Charts", [Scatter([1, 2, 3, 4, 5], [Series("p50", [12, 18, 15, 24, 21]), Series("p95", [30, 42, 38, 55, 47])], "ms", "rps"), Area(["Mon", "Tue", "Wed", "Thu", "Fri"], [Series("cache", [10, 14, 18, 22, 26]), Series("origin", [4, 6, 5, 8, 7])], "req/s", true)])
grid = Card("Heatmap", [Heatmap(["00", "06", "12", "18"], ["Mon", "Tue", "Wed", "Thu"], [[2, 9, 14, 6], [3, 11, 18, 8], [1, 7, 12, 5], [4, 13, 21, 9]], "req")])
work = Card("Timeline", [Timeline([{label: "parse", start: 0, end: 3, tone: "info"}, {label: "chart", start: 3, end: 9}, {label: "verify", start: 9, end: 12, tone: "success"}, {label: "render", start: 12, end: 14}], "ms")])
formula = Card("Math", [Math("\\\\int_0^1 x^2\\\\,dx = \\\\frac{1}{3}"), Math("P(x) = \\\\frac{1}{\\\\sigma\\\\sqrt{2\\\\pi}} e^{-(x-\\\\mu)^2/2\\\\sigma^2}")])
numbers = Card("Table and chart", [Table(["service", "p50"], [["api", 12], ["web", 18], ["db", 7]]), ColumnChart(["api", "web", "db"], [Series("p50", [12, 18, 7]), Series("p95", [30, 44, 19])], "ms", false, "service", "latency")])
mismatch = Card("Mismatch check", [Table(["service", "p50"], [["api", 12], ["web", 18], ["db", 7]]), ColumnChart(["api", "edge", "db"], [Series("p50", [12, 3, 7])], "ms", false, "service", "latency")])
mini = Card("Sparkline", [Sparkline([4, 7, 6, 9, 12, 11, 15], "requests", "/s")])
`;

const out = process.argv[2] ?? '/tmp/oc-blocks-preview.html';
const html = buildShareUiDocument({ ui: program, title: 'Blocks preview', expectAnswer: false, bundle: await bundle() });
writeFileSync(out, html);
console.log(out);
