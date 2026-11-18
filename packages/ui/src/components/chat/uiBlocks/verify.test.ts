import { describe, expect, test } from 'bun:test';
import { blockNode, type BlockValue } from './catalog';
import { reconcileTableWithChart, verifyBlockTree } from './verify';

const node = (typeName: string, props: Record<string, unknown>): BlockValue => ({ type: 'element', typeName, props } as unknown as BlockValue);
const stack = (...children: BlockValue[]): BlockValue => node('Stack', { children });
const codes = (root: BlockValue) => verifyBlockTree(root).map((issue) => issue.code);

const series = (name: string, values: Array<number | null>) => node('Series', { name, values });

describe('verifyBlockTree', () => {
  test('a well-formed chart is clean', () => {
    const root = stack(node('BarChart', { labels: ['a', 'b'], series: [series('one', [1, 2])] }));
    expect(codes(root)).toEqual([]);
  });

  test('a series shorter than its labels is reported', () => {
    const root = stack(node('LineChart', { labels: ['a', 'b', 'c'], series: [series('one', [1, 2])] }));
    expect(codes(root)).toContain('series-length');
  });

  test('bars below zero are reported', () => {
    const root = stack(node('BarChart', { labels: ['a'], series: [series('one', [-3])] }));
    expect(codes(root)).toContain('negative-bars');
  });

  test('a heatmap whose grid does not match its headings is reported', () => {
    const root = stack(node('Heatmap', { rows: ['a', 'b'], columns: ['x', 'y'], values: [[1, 2]] }));
    expect(codes(root)).toContain('heatmap-shape');
  });

  test('a timeline item that ends before it starts is reported', () => {
    const root = stack(node('Timeline', { items: [{ label: 'build', start: 10, end: 4 }] }));
    expect(codes(root)).toContain('timeline-order');
  });

  test('an edge to a missing node is reported', () => {
    const root = stack(node('Diagram', {
      nodes: [{ id: 'a', label: 'A', x: 20, y: 20 }],
      edges: [{ from: 'a', to: 'ghost' }],
    }));
    expect(codes(root)).toContain('diagram-edge');
  });

  test('nested charts inside a card are checked too', () => {
    const chart = node('BarChart', { labels: ['a', 'b'], series: [series('one', [1])] });
    const root = stack(node('Card', { title: 'Numbers', children: [chart] }));
    expect(codes(root)).toContain('series-length');
  });
});

describe('reconcileTableWithChart', () => {
  const table = (rows: Array<Array<string | number>>) => node('Table', { columns: ['name', 'value'], rows });
  const chart = (labels: string[]) => node('BarChart', { labels, series: [series('value', labels.map(() => 1))] });

  test('matching labels are clean', () => {
    const root = stack(table([['a', 1], ['b', 2], ['c', 3]]), chart(['a', 'b', 'c']));
    expect(reconcileTableWithChart(root)).toEqual([]);
  });

  test('a chart label missing from the table is reported', () => {
    const root = stack(table([['a', 1], ['b', 2], ['c', 3]]), chart(['a', 'b', 'z']));
    expect(reconcileTableWithChart(root).map((issue) => issue.code)).toEqual(['table-chart-mismatch']);
  });

  test('a table of another size is left alone', () => {
    const root = stack(table([['a', 1], ['b', 2]]), chart(['x', 'y', 'z']));
    expect(reconcileTableWithChart(root)).toEqual([]);
  });

  test('pure numbers in the first column are not compared', () => {
    const root = stack(table([[1, 1], [2, 2], [3, 3]]), chart(['1', '2', '3']));
    expect(reconcileTableWithChart(root)).toEqual([]);
  });
});

test('blockNode accepts the new block props', () => {
  expect(blockNode.safeParse(node('Sparkline', { values: [1, null, 3] })).success).toBe(true);
  expect(blockNode.safeParse(node('Math', { latex: 'x^2' })).success).toBe(true);
});
