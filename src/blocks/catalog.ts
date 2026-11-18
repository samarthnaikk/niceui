import { createLibrary, createParser, defineComponent } from '@openuidev/lang-core';
import { z } from 'zod';

const json = z.json();
const tone = z.enum(['neutral', 'info', 'success', 'warning', 'error']);
const nodes = z.array(json);
const series = z.array(json);

export const props = {
  Stack: z.object({ children: nodes }),
  Row: z.object({ children: nodes }),
  Card: z.object({ title: z.string(), children: nodes }),
  Text: z.object({ markdown: z.string() }),
  Badge: z.object({ label: z.string(), tone: tone.optional() }),
  Callout: z.object({ markdown: z.string(), tone: tone.optional(), title: z.string().optional() }),
  KeyValue: z.object({ items: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]) })) }),
  Table: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number()]))) }),
  Steps: z.object({
    items: z.array(z.object({ title: z.string(), markdown: z.string().optional(), status: z.enum(['done', 'current', 'todo', 'blocked']).optional() })),
    direction: z.enum(['column', 'row']).optional(),
  }),
  Series: z.object({ name: z.string(), values: z.array(z.number().nullable()) }),
  ColumnChart: z.object({
    labels: z.array(z.string()),
    series,
    unit: z.string().optional(),
    stacked: z.boolean().optional(),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
  }),
  Scatter: z.object({ x: z.array(z.number()), series, unit: z.string().optional(), xUnit: z.string().optional() }),
  Area: z.object({ labels: z.array(z.string()), series, unit: z.string().optional(), stacked: z.boolean().optional() }),
  Heatmap: z.object({ rows: z.array(z.string()), columns: z.array(z.string()), values: z.array(z.array(z.number())), unit: z.string().optional() }),
  Timeline: z.object({ items: z.array(z.object({ label: z.string(), start: z.number(), end: z.number(), tone: tone.optional() })), unit: z.string().optional() }),
  Diagram: z.object({
    nodes: z.array(z.object({
      id: z.string(),
      label: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      tone: tone.optional(),
    })),
    edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })),
    height: z.number().positive().optional(),
  }),
  Math: z.object({ latex: z.string(), block: z.boolean().optional() }),
  Sparkline: z.object({ values: z.array(z.number().nullable()), label: z.string().optional(), unit: z.string().optional() }),
};

const component = (name: keyof typeof props) => defineComponent({
  name,
  description: '',
  props: props[name],
  component: null,
});

export const library = createLibrary({
  components: [
    component('Stack'), component('Row'), component('Card'), component('Text'), component('Badge'),
    component('Callout'), component('KeyValue'), component('Table'), component('Steps'), component('Series'),
    component('ColumnChart'), component('Scatter'), component('Area'), component('Heatmap'), component('Timeline'),
    component('Diagram'), component('Math'), component('Sparkline'),
  ],
  root: 'Stack',
});

const parser = createParser(library.toJSONSchema(), 'Stack');

export type BlockValue = { typeName: string; props: Record<string, any> };

export type ParseResult = { kind: 'empty' } | { kind: 'ready'; root: BlockValue } | { kind: 'invalid'; errors: string[] };

export function parseBlock(source: string): ParseResult {
  const result = parser.parse(source);
  const errors = result.meta.errors.map((error) => `${error.component ?? ''} ${error.path ?? ''}: ${error.message}`.trim());
  if (!result.root) return errors.length ? { kind: 'invalid', errors } : { kind: 'empty' };
  if (result.root.typeName !== 'Stack') return { kind: 'invalid', errors: [...errors, 'The block needs root = Stack([...])'] };
  if (errors.length) return { kind: 'invalid', errors };
  return { kind: 'ready', root: JSON.parse(JSON.stringify(result.root)) as BlockValue };
}

/** Splits a reply into prose and complete openui-lang fences. */
export function splitBlocks(text: string): Array<{ text: string } | { block: string }> {
  const parts: Array<{ text: string } | { block: string }> = [];
  const re = /```openui-lang[^\n]*\n([\s\S]*?)```/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    if (match.index === undefined) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ block: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
