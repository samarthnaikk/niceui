import { tones, uiBlockLibrary } from './catalog';


export const UI_BLOCK_EXAMPLES = [
  [
    'root = Stack([note, flow])',
    'note = Callout("Routers rewrite the MAC header, keep the IP header.", "info")',
    'flow = Steps([{title: "Sender"}, {title: "Router"}, {title: "Receiver"}], "row")',
  ].join('\n'),
  [
    'root = Stack([a])',
    'a = Card("#12 Login on Safari", [Badge("bug", "error"), Text("Broken since 2.1 on macOS."), Button("Fix now", "primary", "#12 Login on Safari"), Button("Later", "secondary", "#12 Login on Safari")])',
  ].join('\n'),
  [
    'root = Stack([flow])',
    'flow = Diagram([{id: "ui", label: "Web UI", x: 22, y: 30}, {id: "api", label: "API", x: 52, y: 30}, {id: "db", label: "SQLite", x: 80, y: 62, tone: "info"}], [{from: "ui", to: "api"}, {from: "api", to: "db"}], 200)',
  ].join('\n'),
  [
    'root = Stack([trend, formula])',
    'trend = Scatter([1, 2, 3, 4], [Series("p50", [12, 18, 15, 24]), Series("p95", [30, 42, 38, 55])], "ms", "rps")',
    'formula = Math("x^2 + y^2 = z^2")',
  ].join('\n'),
];

const TONE_UNION = tones.map((tone) => `"${tone}"`).join(' | ');
const CHILD_LIST = /\((?:[A-Z]\w* \| )+[A-Z]\w*\)\[\]/g;

const componentLines = (): string => Object.values(uiBlockLibrary.toSpec().components)
  .map((component) => {
    const signature = component.signature.replaceAll(TONE_UNION, 'Tone').replace(CHILD_LIST, 'Item[]');
    return component.description ? `${signature}: ${component.description}` : signature;
  })
  .join('\n');

export function buildUiBlocksGuidance(): string {
  return [
    'UI blocks: a fenced openui-lang block in your reply draws native UI there; keep the explanation in Markdown around it. The fence is Markdown: a line ```openui-lang, the program, a line ```.',
    'Use one for data or structure the user would otherwise picture: values across items, comparisons, flows, trends, status. Not for a few numbers, a short list, code, or when asked for plain text. Several per reply are fine.',
    'Teaching: when the user asks to learn, understand, or be walked through something, teach instead of reporting. Start from what they already know, define each new term in one sentence, one idea per sentence, and give the example before the rule. Draw the idea whenever it has shape, size, order, or comparison: Diagram for how parts connect, ColumnChart for numbers across categories, LineChart or Area for change over time, Timeline for order and duration, Math for formulas. Name what the reader is looking at: set xLabel and yLabel on a chart, pass a unit, and label diagram arrows. Never draw a chart, graph, or diagram as ASCII art, box-drawing characters, a Markdown table of bars, or an image; the block draws it. Close with one short question that checks understanding, not a summary of everything.',
    'Asking the user, by what the answer needs:',
    '- a quick clarification its options fully answer: the question tool;',
    '- a choice that sets the direction of the work (scope, approach, a trade-off): always openchamber_render with ui (this language) and awaitAnswer, never the question tool, so the user can add conditions to the option they pick; the form adds a note field itself, read it in data.note;',
    '- decisions on several separate items, each with its own context: a block in your reply, a Card per item, a Button per option, value = the item. Choices collect until each decision has one (or the user sends early), then reach you together as your next turn, with any note the user wrote on a card.',
    '',
    'Syntax: one statement per line, name = Component(args); first line root = Stack([...]). Positional args in signature order, optional ones droppable from the end. Args are positional only; name: value is not supported in a call. Strings "...", arrays [...], objects {key: value}. Every name must be reachable from root.',
    `Item = any component below except Tab and Series. Card holds no Card or Tabs; Row holds no Row, Tabs or Details; Tab holds no Tabs; Details holds no Card, Tabs or Details. Tone = ${TONE_UNION}.`,
    '',
    'A Steps status is live execution progress only. For a flow that is not running (an architecture, a pipeline, a process the reply explains), leave status off: every step then reads at normal contrast instead of looking stalled.',
    '',
    'Examples:',
    UI_BLOCK_EXAMPLES.join('\n\n'),
    '',
    'Components:',
    componentLines(),
  ].join('\n');
}
