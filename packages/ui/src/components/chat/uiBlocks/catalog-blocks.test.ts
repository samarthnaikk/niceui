import { describe, expect, test } from 'bun:test';
import { blockName, parseUiBlock } from './catalog';

const program = `root = Stack([scatter, area, heat, time, flow, formula, mini, cols])
scatter = Scatter([1, 2], [Series("a", [1, 2])], "ms", "rps")
area = Area(["Mon", "Tue"], [Series("a", [1, 2])], "req", true)
heat = Heatmap(["00", "12"], ["Mon", "Tue"], [[1, 2], [3, 4]], "req")
time = Timeline([{label: "parse", start: 0, end: 3}], "ms")
flow = Diagram([{id: "a", label: "A", x: 20, y: 30}, {id: "b", label: "B", x: 70, y: 30}], [{from: "a", to: "b", label: "next"}], 200)
formula = Math("x^2")
mini = Sparkline([1, 2, 3], "requests", "/s")
cols = ColumnChart(["a", "b"], [Series("p50", [1, 2])], "ms", false, "service", "latency")
`;

describe('new block catalog', () => {
  test('every new block is a drawn name', () => {
    for (const name of ['Scatter', 'Area', 'Heatmap', 'Timeline', 'Diagram', 'Math', 'Sparkline', 'ColumnChart']) {
      expect(blockName.safeParse(name).success).toBe(true);
    }
  });

  test('one program draws all of them', () => {
    const parsed = parseUiBlock(program, true);
    if (parsed.kind !== 'ready') throw new Error(`expected ready, got ${parsed.kind}`);
    expect(parsed.root).toBeTruthy();
  });

  test('a chart argument in the wrong place is rejected', () => {
    expect(parseUiBlock('root = Stack([ColumnChart("a", [Series("p", [1])])])', true).kind).not.toBe('ready');
  });
});
