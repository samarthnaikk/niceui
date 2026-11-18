import { blockNode, blockProps, type BlockValue } from './catalog';

/**
 * Structural checks for a drawn block tree.
 *
 * These catch the failures a schema cannot: a chart whose series is shorter than its
 * labels, a heatmap whose rows do not match its headings, a timeline that ends before
 * it starts. They never guess at meaning, so they stay cheap and never fire on a
 * well-formed block.
 */
export type BlockIssueCode =
  | 'series-length'
  | 'empty-labels'
  | 'negative-bars'
  | 'too-many-points'
  | 'heatmap-shape'
  | 'timeline-order'
  | 'diagram-edge'
  | 'diagram-node'
  | 'math-empty'
  | 'table-chart-mismatch';

export type BlockIssue = {
  code: BlockIssueCode;
  typeName: string;
  path: string;
  detail: string;
};

const MAX_POINTS = 200;

const seriesOf = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = blockProps.Series.safeParse(blockNode.safeParse(item).data?.props);
    return parsed.success ? [parsed.data] : [];
  });
};

const pointsOf = (series: Array<{ values: Array<number | null> }>) =>
  series.flatMap((item) => item.values.filter((point): point is number => point !== null));

const labelsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

const chartIssues = (node: { typeName: string; props: Record<string, unknown> }, path: string): BlockIssue[] => {
  const issues: BlockIssue[] = [];
  const series = seriesOf(node.props.series);
  const labels = labelsOf(node.props.labels);
  const points = pointsOf(series);

  if (labels.length === 0 && series.some((item) => item.values.length > 0)) {
    issues.push({ code: 'empty-labels', typeName: node.typeName, path, detail: 'no labels' });
  }

  for (const item of series) {
    if (labels.length > 0 && item.values.length !== labels.length) {
      issues.push({
        code: 'series-length',
        typeName: node.typeName,
        path,
        detail: `${item.name}: ${item.values.length} values for ${labels.length} labels`,
      });
    }
  }

  if (node.typeName === 'BarChart' && points.some((point) => point < 0)) {
    issues.push({ code: 'negative-bars', typeName: node.typeName, path, detail: 'a bar below zero' });
  }

  if (points.length > MAX_POINTS) {
    issues.push({ code: 'too-many-points', typeName: node.typeName, path, detail: `${points.length} points` });
  }

  return issues;
};

const heatmapIssues = (node: { typeName: string; props: Record<string, unknown> }, path: string): BlockIssue[] => {
  const rows = labelsOf(node.props.rows);
  const columns = labelsOf(node.props.columns);
  const values = Array.isArray(node.props.values) ? node.props.values : [];
  if (values.length !== rows.length || values.some((row) => !Array.isArray(row) || row.length !== columns.length)) {
    return [{
      code: 'heatmap-shape',
      typeName: node.typeName,
      path,
      detail: `${values.length} rows for ${rows.length}, against ${columns.length} columns`,
    }];
  }
  return [];
};

const timelineIssues = (node: { typeName: string; props: Record<string, unknown> }, path: string): BlockIssue[] => {
  const items = Array.isArray(node.props.items) ? node.props.items : [];
  const broken = items.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const { start, end } = item as { start?: unknown; end?: unknown };
    return typeof start === 'number' && typeof end === 'number' && end < start;
  }).length;
  if (broken === 0) return [];
  return [{ code: 'timeline-order', typeName: node.typeName, path, detail: `${broken} ending before they start` }];
};

const diagramIssues = (node: { typeName: string; props: Record<string, unknown> }, path: string): BlockIssue[] => {
  const nodes = Array.isArray(node.props.nodes) ? node.props.nodes : [];
  const edges = Array.isArray(node.props.edges) ? node.props.edges : [];
  const ids = new Set(nodes.flatMap((item) => {
    const id = item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined;
    return typeof id === 'string' ? [id] : [];
  }));
  const issues: BlockIssue[] = [];
  if (ids.size !== nodes.length) {
    issues.push({ code: 'diagram-node', typeName: node.typeName, path, detail: 'two nodes share an id' });
  }
  for (const edge of edges) {
    if (!edge || typeof edge !== 'object') continue;
    const { from, to } = edge as { from?: unknown; to?: unknown };
    if ((typeof from === 'string' && !ids.has(from)) || (typeof to === 'string' && !ids.has(to))) {
      issues.push({ code: 'diagram-edge', typeName: node.typeName, path, detail: `${String(from)} → ${String(to)}` });
      break;
    }
  }
  return issues;
};

const check = (node: { typeName: string; props: Record<string, unknown> }, path: string): BlockIssue[] => {
  switch (node.typeName) {
    case 'BarChart':
    case 'LineChart':
    case 'Area':
    case 'Scatter':
      return chartIssues(node, path);
    case 'Heatmap':
      return heatmapIssues(node, path);
    case 'Timeline':
      return timelineIssues(node, path);
    case 'Diagram':
      return diagramIssues(node, path);
    case 'Math':
      return typeof node.props.latex === 'string' && node.props.latex.trim() === ''
        ? [{ code: 'math-empty', typeName: node.typeName, path, detail: 'empty formula' }]
        : [];
    default:
      return [];
  }
};

const visit = (value: unknown, path: string, out: BlockIssue[]) => {
  const parsed = blockNode.safeParse(value);
  if (!parsed.success) {
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`, out));
    return;
  }
  out.push(...check(parsed.data, path));
  for (const [key, child] of Object.entries(parsed.data.props)) {
    if (Array.isArray(child)) child.forEach((item, index) => visit(item, `${path}.${key}[${index}]`, out));
    else if (child && typeof child === 'object') visit(child, `${path}.${key}`, out);
  }
};

export function verifyBlockTree(root: BlockValue): BlockIssue[] {
  const issues: BlockIssue[] = [];
  visit(root, 'root', issues);
  return issues;
}

const collect = (root: BlockValue): Array<{ typeName: string; props: Record<string, unknown> }> => {
  const found: Array<{ typeName: string; props: Record<string, unknown> }> = [];
  const walk = (value: unknown) => {
    const parsed = blockNode.safeParse(value);
    if (!parsed.success) {
      if (Array.isArray(value)) value.forEach(walk);
      return;
    }
    found.push(parsed.data);
    for (const child of Object.values(parsed.data.props)) {
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === 'object') walk(child);
    }
  };
  walk(root);
  return found;
};

/**
 * A table and a chart in one answer should describe the same rows. Only compared when the
 * counts already line up and the table's first column holds words, so a layout table or a
 * chart of a subset never raises a false alarm.
 */
export function reconcileTableWithChart(root: BlockValue): BlockIssue[] {
  const nodes = collect(root);
  const table = nodes.find((node) => node.typeName === 'Table');
  const chart = nodes.find((node) => node.typeName === 'BarChart' || node.typeName === 'LineChart');
  if (!table || !chart) return [];
  const rows = Array.isArray(table.props.rows) ? table.props.rows : [];
  const labels = labelsOf(chart.props.labels);
  if (rows.length < 3 || rows.length !== labels.length) return [];
  const firstColumn = rows.map((row) => (Array.isArray(row) ? row[0] : undefined));
  if (!firstColumn.every((cell): cell is string => typeof cell === 'string')) return [];
  const known = new Set(firstColumn.map((cell) => cell.trim().toLowerCase()));
  const missing = labels.filter((label) => !known.has(label.trim().toLowerCase()));
  if (missing.length === 0) return [];
  return [{
    code: 'table-chart-mismatch',
    typeName: chart.typeName,
    path: 'root',
    detail: missing.slice(0, 3).join(', '),
  }];
}
