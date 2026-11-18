import React from 'react';
import katex from 'katex';
import { z } from 'zod';
import { Icon } from '@/components/icon/Icon';
import { Button as UiButton } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Radio } from '@/components/ui/radio';
import { SortableTabsStrip } from '@/components/ui/sortable-tabs-strip';
import { DatePicker, TimePill } from '@/components/ui/date-time';
import { Input as FieldInput } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useOptionalThemeSystem } from '@/contexts/useThemeSystem';
import { useCalendarPreferences } from '@/components/ui/useCalendarPreferences';
import { useI18n } from '@/lib/i18n';
import { KIT_SHARED_CSS, kitVariables, seriesColor } from '../lib/visualKit';
import { cn } from '@/lib/utils';
import { MarkdownContent } from '../MarkdownRenderer';
import { MarkdownPresentationContext } from '../markdown/MarkdownPresentationContext';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { axisTicks } from './axisTicks';
import { reconcileTableWithChart, verifyBlockTree } from './verify';
import { ExtensionBlockFrame } from './ExtensionBlockFrame';
import { useExtensionBlocks } from './useExtensionBlocks';
import { dispatchTabStep } from '../lib/scroll/timelineScrollIntent';
import {
  answeringFrame,
  NO_EXTENSION_BLOCKS, type ExtensionBlocks, blockDecisions, blockFields, cardDecision, choiceOption, DEFAULT_TIME, decisionOf, decisionTitles, blockName, blockNode, blockPath, blockProps, noteSlot, parseUiBlock, sliderStart, type BlockName, type BlockPath, type BlockValue, tones,
} from './catalog';
import {
  describeUiBlockAnswer,
  pageAnswerNamesButton,
  describeUiBlockReplyAnswer,
  type UiBlockAnswer,
  type UiBlockAnswerData,
  type UiBlockFieldValue,
  type UiBlockReplyAnswerData,
} from './answer';

export type UiBlockHost =
  | { kind: 'page'; submit: ((answer: UiBlockAnswer) => Promise<void>) | null; answered: UiBlockAnswerData | null }
  | {
    kind: 'reply';
    submit: ((answer: UiBlockReplyAnswerData, text: string) => Promise<void>) | null;
    answered: UiBlockReplyAnswerData | null;
  };

const noHost: UiBlockHost = { kind: 'reply', submit: null, answered: null };

type Chosen = ReadonlyMap<string, string | null>;
type Notes = ReadonlyMap<string, string>;

const chosenFrom = (host: UiBlockHost): Chosen => {
  if (!host.answered) return new Map();
  if (host.kind === 'page') return new Map([[host.answered.value ?? '', host.answered.button]]);
  return new Map(host.answered.picks.map((pick) => [pick.value ?? '', pick.button ?? null]));
};

const notesFrom = (host: UiBlockHost): Notes => (host.kind === 'reply' && host.answered
  ? new Map(host.answered.picks.flatMap((pick) => (pick.note ? [[pick.value ?? '', pick.note]] : [])))
  : new Map());

type FormState = {
  values: Record<string, UiBlockFieldValue>;
  setValue: (name: string, value: UiBlockFieldValue) => void;
  press: (button: string, value?: string) => void;
  disabled: boolean;
  chosen: Chosen;
  folds: boolean;
  titles: ReadonlySet<string>;
  notes: Notes;
  setNote: (decision: string, note: string) => void;
  answerWithNote: (decision: string) => void;
  reopen: (decision: string) => void;
};

const FormContext = React.createContext<FormState>({
  values: {},
  setValue: () => {},
  press: () => {},
  disabled: true,
  chosen: new Map(),
  folds: false,
  titles: new Set(),
  notes: new Map(),
  setNote: () => {},
  answerWithNote: () => {},
  reopen: () => {},
});


type Tone = (typeof tones)[number];
type NodeProps = { props: BlockValue };

const toneText = {
  neutral: 'text-muted-foreground',
  info: 'text-[var(--status-info)]',
  success: 'text-[var(--status-success)]',
  warning: 'text-[var(--status-warning)]',
  error: 'text-[var(--status-error)]',
} satisfies Record<Tone, string>;
const toneFill = {
  neutral: 'oc-tile',
  info: 'bg-[var(--status-info-background)]',
  success: 'bg-[var(--status-success-background)]',
  warning: 'bg-[var(--status-warning-background)]',
  error: 'bg-[var(--status-error-background)]',
} satisfies Record<Tone, string>;

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 });
const formatNumber = (value: number) => numberFormat.format(value).replace(/,/g, ' ');
const unitSuffix = (unit?: string) => (!unit ? '' : /^[%°]/.test(unit) ? unit : ` ${unit}`);
const unitLeads = (unit?: string) => unit === '$' || unit === '£';
const formatWithUnit = (value: number, unit?: string) => (unitLeads(unit) ? `${unit}${formatNumber(value)}` : `${formatNumber(value)}${unitSuffix(unit)}`);
const number = z.number();
const display = (value: string | number) => {
  const parsed = number.safeParse(value);
  return parsed.success ? formatNumber(parsed.data) : String(value);
};

function useBlockProps<S extends z.ZodType>(schema: S, props: BlockValue): z.infer<S> | null {
  const parsed = schema.safeParse(props);
  const last = React.useRef<z.infer<S> | null>(null);
  if (parsed.success) last.current = parsed.data;
  return last.current;
}

function Markdown({ source, className }: { source?: string; className?: string }) {
  const presentation = React.useContext(MarkdownPresentationContext);
  if (presentation?.purpose === 'image') {
    return source ? <MarkdownContent content={source} purpose="image" theme={presentation.theme}
      preparedHighlights={presentation.preparedHighlights} onExportCode={presentation.onExportCode}
      className={cn('oc-ui-block-text', className)}
    /> : null;
  }
  return <ScreenMarkdown source={source} className={className} />;
}

function ScreenMarkdown({ source, className }: { source?: string; className?: string }) {
  const directory = useEffectiveDirectory() ?? '';
  if (!source) return null;
  return <MarkdownContent content={source} mode="static" settled directory={directory} className={cn('oc-ui-block-text', className)} />;
}

const isButtonNode = (value: BlockValue) => blockNode.safeParse(value).data?.typeName === 'Button';

const PathContext = React.createContext<BlockPath>('');
type Slot = { parent: BlockPath; index: number; element: React.ReactNode; trailing?: React.ReactNode };
const SlotContext = React.createContext<Slot | null>(null);
const RowTrailingContext = React.createContext<React.ReactNode>(null);

function Children({ nodes, skip = 0 }: { nodes: BlockValue[]; skip?: number }) {
  const path = React.useContext(PathContext);
  const slot = React.useContext(SlotContext);
  const groups: Array<Array<{ node: BlockValue; index: number }>> = [];
  nodes.forEach((node, index) => {
    if (index < skip) return;
    const last = groups.at(-1);
    if (last && isButtonNode(node) && isButtonNode(last[0].node)) last.push({ node, index });
    else groups.push([{ node, index }]);
  });
  const child = ({ node, index }: { node: BlockValue; index: number }) => (
    <PathContext.Provider key={index} value={blockPath(path, index)}><Node value={node} /></PathContext.Provider>
  );
  return (
    <>
      {groups.map((group) => {
        const here = slot && slot.parent === path && slot.index === group[0].index ? slot : null;
        const trailing = here?.trailing;
        const drawn = group.length > 1 || (trailing && isButtonNode(group[0].node))
          ? <div className="flex flex-wrap items-center gap-2">{group.map(child)}{trailing}</div>
          : trailing ? <RowTrailingContext.Provider value={trailing}>{child(group[0])}</RowTrailingContext.Provider> : child(group[0]);
        return (
          <React.Fragment key={group[0].index}>
            {here?.element}
            {drawn}
          </React.Fragment>
        );
      })}
    </>
  );
}

function Stack({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Stack, props);
  return value && <div className="flex flex-col gap-3"><Children nodes={value.children} /></div>;
}

function Row({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Row, props);
  const trailing = React.useContext(RowTrailingContext);
  if (!value) return null;
  const stats = value.children.length > 0 && value.children.every((child) => blockNode.safeParse(child).data?.typeName === 'Stat');
  return (
    <div
      className={stats
        ? 'grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3 [&>div]:w-full'
        : 'flex flex-wrap items-stretch gap-3 [&>div]:min-w-[12rem] [&>div]:flex-1 [&>button]:self-center [&>span]:self-center'}
    >
      <RowTrailingContext.Provider value={null}><Children nodes={value.children} /></RowTrailingContext.Provider>
      {trailing}
    </div>
  );
}

const isBadgeNode = (value: BlockValue) => blockNode.safeParse(value).data?.typeName === 'Badge';

function CardTitle({ title, className }: { title: string; className?: string }) {
  return <Markdown source={title} className={cn('oc-ui-block-title font-medium', className)} />;
}

const CardTitleContext = React.createContext('');

function Card({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Card, props);
  const form = React.useContext(FormContext);
  const path = React.useContext(PathContext);
  if (!value) return null;
  const card: BlockValue = { type: 'element', typeName: 'Card', props: { title: value.title, children: value.children } };
  const decision = form.folds ? cardDecision(card, form.titles) : null;
  if (decision !== null && form.chosen.has(decision)) return <AnsweredCard title={value.title} decision={decision} />;
  const badges = value.title ? value.children.findIndex((child) => !isBadgeNode(child)) : 0;
  const headerBadges = badges === -1 ? value.children.length : badges;
  const body = <Children nodes={value.children} skip={headerBadges} />;
  return (
    <div className="oc-box flex flex-col gap-2">
      {value.title && (
        <div className="flex items-start gap-2">
          <CardTitle title={value.title} className="min-w-0 flex-1" />
          {headerBadges > 0 && (
            <span className="flex shrink-0 flex-wrap justify-end gap-1">
              {value.children.slice(0, headerBadges).map((child, index) => (
                <PathContext.Provider key={index} value={blockPath(path, index)}><Node value={child} /></PathContext.Provider>
              ))}
            </span>
          )}
        </div>
      )}
      <InCardContext.Provider value>
        <CardTitleContext.Provider value={value.title}>
          {decision === null ? body : <CardNoteSlot decision={decision} card={card}>{body}</CardNoteSlot>}
        </CardTitleContext.Provider>
      </InCardContext.Provider>
    </div>
  );
}

function CardNoteSlot({ decision, card, children }: { decision: string; card: BlockValue; children: React.ReactNode }) {
  const { t } = useI18n();
  const form = React.useContext(FormContext);
  const path = React.useContext(PathContext);
  const note = form.notes.get(decision) ?? '';
  const [open, setOpen] = React.useState(note !== '');
  const place = noteSlot(card);
  if (!place || (form.disabled && !note)) return <>{children}</>;
  const element = open ? (
    <ShortTextarea
      value={note}
      placeholder={t('chat.uiBlock.note.placeholder')}
      aria-label={t('chat.uiBlock.note.label')}
      disabled={form.disabled}
      onChange={(event) => form.setNote(decision, event.target.value)}
      rows={1}
      autoFocus
    />
  ) : null;
  const trailing = form.disabled ? null : !open ? (
    <UiButton
      type="button"
      variant="ghost"
      size="icon"
      className="text-muted-foreground hover:bg-transparent hover:text-foreground"
      aria-label={t('chat.uiBlock.note.add')}
      title={t('chat.uiBlock.note.add')}
      onClick={() => setOpen(true)}
    >
      <Icon name="sticky-note" className="size-4" />
    </UiButton>
  ) : (
    <UiButton
      type="button"
      variant="ghost"
      className="text-muted-foreground hover:bg-transparent hover:text-foreground"
      disabled={!note.trim()}
      onClick={() => form.answerWithNote(decision)}
    >
      {t('chat.uiBlock.note.answerOnly')}
    </UiButton>
  );
  const slot = { parent: place.parent ? `${path}/${place.parent}` : path, index: place.index, element, trailing };
  return <SlotContext.Provider value={slot}>{children}</SlotContext.Provider>;
}

function NoteToggle({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <UiButton
      type="button"
      variant="ghost"
      size="xs"
      className="w-fit px-0 has-[>svg]:px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
      onClick={onOpen}
    >
      <Icon name="add" className="size-3.5" />
      {t('chat.uiBlock.note.add')}
    </UiButton>
  );
}

function AnsweredCard({ title, decision }: { title: string; decision: string }) {
  const { t } = useI18n();
  const form = React.useContext(FormContext);
  const button = form.chosen.get(decision) ?? null;
  const note = form.notes.get(decision)?.trim() ?? '';
  return (
    <div className="oc-box flex flex-col gap-0.5 py-2">
      <div className="flex items-center gap-2">
        <Icon name="checkbox-circle" className="size-4 shrink-0 text-[var(--status-success)]" />
        <CardTitle title={title} className="min-w-0 flex-1 truncate" />
        <span className="max-w-[50%] shrink-0 truncate typography-ui-label font-medium text-[var(--primary-text)]">
          {button ?? t('chat.uiBlock.note.label')}
        </span>
        {!form.disabled && (
          <UiButton
            type="button"
            variant="ghost"
            size="xs"
            className="shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => form.reopen(decision)}
          >
            {t('chat.uiBlock.change')}
          </UiButton>
        )}
      </div>
      {note && <div className="line-clamp-2 ps-6 typography-meta text-muted-foreground">{note}</div>}
    </div>
  );
}

function Text({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Text, props);
  return value && <Markdown source={value.markdown} />;
}

function Badge({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Badge, props);
  if (!value) return null;
  return (
    <span className="oc-badge w-fit" data-tone={value.tone && value.tone !== 'neutral' ? value.tone : undefined}>
      {value.label}
    </span>
  );
}

function Callout({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Callout, props);
  if (!value) return null;
  const tone = value.tone ?? 'neutral';
  const icon = tone === 'error' || tone === 'warning' ? 'error-warning' : tone === 'success' ? 'checkbox-circle' : 'information';
  const banner = tone === 'error' || tone === 'warning';
  return (
    <div className={cn('flex gap-2', banner ? cn('rounded-xl px-3 py-2', toneFill[tone]) : 'px-1')}>
      <Icon name={icon} className={cn('mt-[3px] size-4 shrink-0', toneText[tone])} />
      <div className="min-w-0 flex-1">
        {value.title && <div className={cn('font-medium', banner && toneText[tone])}>{value.title}</div>}
        <Markdown source={value.markdown} />
      </div>
    </div>
  );
}

function KeyValue({ props }: NodeProps) {
  const value = useBlockProps(blockProps.KeyValue, props);
  if (!value) return null;
  return (
    <dl className="m-0 grid max-w-lg grid-cols-[fit-content(55%)_minmax(0,1fr)] gap-y-0.5">
      {value.items.map((item, index) => (
        <React.Fragment key={index}>
          <dt className="flex min-w-0 items-baseline gap-3 text-muted-foreground">
            <span className="min-w-0 [overflow-wrap:anywhere]">{item.label}</span>
            <span aria-hidden className="min-w-4 flex-1 border-b border-dotted border-border" />
          </dt>
          <dd className="m-0 flex min-w-0 items-baseline">
            <span aria-hidden className="min-w-0 flex-1 border-b border-dotted border-border" />
            <span className="ps-3 text-end tabular-nums [overflow-wrap:anywhere]">{display(item.value)}</span>
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

const tableCell = (cell: string | number | undefined) => (cell === undefined ? '' : number.safeParse(cell).success
  ? display(cell)
  : String(cell).replace(/(\\*)\|/g, (match, slashes: string) => (slashes.length % 2 ? match : `${slashes}\\|`)).replace(/\r?\n/g, ' '));

function Table({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Table, props);
  if (!value || value.columns.length === 0) return null;
  const numeric = value.columns.map((_, index) => value.rows.length > 0 && value.rows.every((row) => number.safeParse(row[index]).success));
  const lines = [
    `| ${value.columns.map((column) => tableCell(column)).join(' | ')} |`,
    `| ${numeric.map((isNumeric) => (isNumeric ? '---:' : '---')).join(' | ')} |`,
    ...value.rows.map((row) => `| ${value.columns.map((_, index) => tableCell(row[index])).join(' | ')} |`),
  ];
  return <TableMarkdown source={lines.join('\n')} />;
}

const TABLE_IN_CARD = [
  '[&_[data-streamdown=table-wrapper]]:w-full! [&_[data-streamdown=table]]:w-full!',
  '[&_[data-streamdown=table-wrapper]>div]:border-0! [&_[data-streamdown=table-wrapper]>div]:bg-transparent!',
  '[&_[data-streamdown=table-cell]]:border-e-0! [&_[data-streamdown=table-header-cell]]:border-e-0!',
  '[&_tr>*:first-child]:ps-0! [&_tr>*:last-child]:pe-0!',
].join(' ');

function TableMarkdown({ source }: { source: string }) {
  const inCard = React.useContext(InCardContext);
  return <Markdown source={source} className={inCard ? TABLE_IN_CARD : undefined} />;
}

const deltaDirection = (delta: string) => (/^\+/.test(delta) ? 'up' : /^[-\u2212]/.test(delta) ? 'down' : null);

function Stat({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Stat, props);
  if (!value) return null;
  const direction = value.delta ? deltaDirection(value.delta) : null;
  return (
    <div className="oc-box flex w-fit min-w-[10rem] flex-col gap-1">
      <span className="typography-meta text-muted-foreground">{value.label}</span>
      <span className="text-[1.625rem] font-semibold leading-tight tracking-[-0.01em] tabular-nums">{display(value.value)}</span>
      {value.delta && (
        <span className="oc-badge w-fit gap-0.5 tabular-nums" data-tone={value.tone && value.tone !== 'neutral' ? value.tone : undefined}>
          {direction && <Icon name={direction === 'up' ? 'arrow-up' : 'arrow-down'} className="size-3" />}
          {direction ? value.delta.slice(1) : value.delta}
        </span>
      )}
    </div>
  );
}

function Progress({ props }: NodeProps) {
  const { t } = useI18n();
  const value = useBlockProps(blockProps.Progress, props);
  if (!value) return null;
  const max = value.max ?? 100;
  const share = Math.max(0, Math.min(1, value.value / max));
  const done = share >= 1;
  const percent = done ? 100 : Math.max(0, Math.min(99, Math.floor((value.value * 100) / max)));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate">{value.label}</span>
        <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
          {max !== 100 && (
            <span className="typography-meta text-muted-foreground">
              {t('chat.uiBlock.progress.ofTotal', { value: formatNumber(value.value), max: formatNumber(max) })}
            </span>
          )}
          <span className={cn('flex items-center gap-0.5 font-semibold', done && 'text-[var(--status-success)]')}>
            {done && <Icon name="check" className="size-3.5" />}
            {percent}%
          </span>
        </span>
      </div>
      <div className="oc-track h-2 overflow-hidden rounded-full" role="progressbar" aria-valuenow={value.value} aria-valuemax={max} aria-label={value.label}>
        <div
          className="oc-bar-grow h-full rounded-full"
          style={{ width: `${share * 100}%`, background: done ? 'var(--status-success)' : seriesColor(0) }}
        />
      </div>
    </div>
  );
}

type StepStatus = z.infer<typeof blockProps.Steps>['items'][number]['status'];

function StepMark({ status, index }: { status: StepStatus; index: number }) {
  const base = 'flex size-[1.125rem] shrink-0 items-center justify-center rounded-full';
  if (status === 'done') {
    return <span className={cn(base, 'bg-[var(--status-success)] text-background')}><Icon name="check" className="size-3" /></span>;
  }
  if (status === 'blocked') {
    return <span className={cn(base, 'bg-[var(--status-error)] text-[0.6875rem] font-bold text-background')}>!</span>;
  }
  if (status === 'current') {
    return (
      <span className={cn(base, 'bg-[var(--primary)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_22%,transparent)]')}>
        <span className="size-1.5 rounded-full bg-background" />
      </span>
    );
  }
  return (
    <span className={cn(base, 'typography-micro tabular-nums shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--foreground)_22%,transparent)]', status === 'todo' ? 'text-muted-foreground' : 'text-foreground')}>
      {index + 1}
    </span>
  );
}

const stepTitleTone = {
  done: '',
  current: 'text-[var(--primary-text)]',
  blocked: 'text-[var(--status-error-text)]',
  todo: 'text-muted-foreground',
} satisfies Record<NonNullable<StepStatus>, string>;

const stepLine = (status: StepStatus) => (status === 'done' ? 'bg-[var(--status-success)]' : 'bg-[color-mix(in_srgb,var(--foreground)_12%,transparent)]');

const STEP_MIN_WIDTH_REM = 7;

function useStepsFitRow(count: number) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [fits, setFits] = React.useState(true);
  React.useLayoutEffect(() => {
    const element = ref.current;
    const view = element?.ownerDocument.defaultView;
    if (!element || !view || count === 0) return;
    const check = () => {
      const rem = parseFloat(view.getComputedStyle(element.ownerDocument.documentElement).fontSize) || 16;
      setFits(element.clientWidth >= count * STEP_MIN_WIDTH_REM * rem);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count]);
  return [ref, fits] as const;
}

function Steps({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Steps, props);
  const [ref, fits] = useStepsFitRow(value?.direction === 'row' ? value.items.length : 0);
  if (!value) return null;
  return <div ref={ref} className="ps-[3px] pt-[3px]">{value.direction === 'row' && fits ? <StepsRow items={value.items} /> : <StepsColumn items={value.items} />}</div>;
}

type StepItems = z.infer<typeof blockProps.Steps>['items'];

function StepText({ item }: { item: StepItems[number] }) {
  return (
    <>
      <div className={cn('font-medium', item.status ? stepTitleTone[item.status] : '')}>{item.title}</div>
      <Markdown source={item.markdown} className="typography-meta text-muted-foreground" />
    </>
  );
}

function StepsRow({ items }: { items: StepItems }) {
  return (
    <div className="grid" role="list" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item, index) => (
        <div key={index} className="flex min-w-0 flex-col gap-1.5" role="listitem">
          <div className="flex items-center">
            <StepMark status={item.status} index={index} />
            {index < items.length - 1 && <span className={cn('mx-1.5 h-0.5 flex-1 rounded-full', stepLine(item.status))} />}
          </div>
          <div className="min-w-0 pe-3"><StepText item={item} /></div>
        </div>
      ))}
    </div>
  );
}

function StepsColumn({ items }: { items: StepItems }) {
  return (
    <div className="flex flex-col" role="list">
      {items.map((item, index) => (
        <div key={index} className="flex gap-2.5" role="listitem">
          <div className="flex flex-col items-center pt-[3px]">
            <StepMark status={item.status} index={index} />
            {index < items.length - 1 && <span className={cn('my-1 min-h-3 w-0.5 flex-1 rounded-full', stepLine(item.status))} />}
          </div>
          <div className={cn('min-w-0 flex-1', index < items.length - 1 && 'pb-3')}><StepText item={item} /></div>
        </div>
      ))}
    </div>
  );
}

type Series = z.infer<typeof blockProps.Series>;

const seriesOf = (nodes: BlockValue[]): Series[] => nodes.flatMap((node) => {
  const series = blockProps.Series.safeParse(blockNode.safeParse(node).data?.props);
  return series.success ? [series.data] : [];
});

type SeriesFocus = {
  focused: number | null;
  picked: number | null;
  hover: (index: number | null) => void;
  rest: (index: number | null) => void;
  toggle: (index: number) => void;
};

const LINE_FOCUS_DELAY_MS = 200;
const LINE_UNFOCUS_DELAY_MS = 120;

function useSeriesFocus(count: number): SeriesFocus {
  const [hovered, setHovered] = React.useState<number | null>(null);
  const [picked, setPicked] = React.useState<number | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  React.useEffect(() => cancel, []);
  const inRange = (index: number | null) => (index !== null && index < count ? index : null);
  return {
    focused: inRange(hovered) ?? inRange(picked),
    picked: inRange(picked),
    hover: (index) => {
      cancel();
      setHovered(index);
    },
    rest: (index) => {
      cancel();
      if (index === hovered) return;
      timer.current = setTimeout(() => setHovered(index), index === null ? LINE_UNFOCUS_DELAY_MS : LINE_FOCUS_DELAY_MS);
    },
    toggle: (index) => setPicked((current) => (current === index ? null : index)),
  };
}

function ChartHeader({ series, focus }: { series: Series[]; focus?: SeriesFocus }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 typography-meta text-muted-foreground">
      {series.length > 1 && series.map((item, index) => {
        const content = (
          <>
            <span className="size-2 shrink-0 rounded-full" style={{ background: seriesColor(index) }} />
            {item.name}
          </>
        );
        if (!focus) return <span key={index} className="inline-flex items-center gap-1.5">{content}</span>;
        const dimmed = focus.focused !== null && focus.focused !== index;
        return (
          <button
            key={index}
            type="button"
            aria-pressed={focus.picked === index}
            className={cn(
              'inline-flex items-center gap-1.5 transition-[opacity,color] duration-150 hover:text-foreground',
              focus.focused === index && 'text-foreground',
              dimmed && 'opacity-40',
            )}
            onPointerEnter={(event) => { if (event.pointerType === 'mouse') focus.hover(index); }}
            onPointerLeave={(event) => { if (event.pointerType === 'mouse') focus.hover(null); }}
            onClick={() => focus.toggle(index)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

const InCardContext = React.createContext(false);

function ChartFrame({ className, ...props }: React.ComponentProps<'div'>) {
  const inCard = React.useContext(InCardContext);
  return <div {...props} className={cn(className, !inCard && 'oc-box')} />;
}

function HeadlineUnit({ unit, leading = false }: { unit?: string; leading?: boolean }) {
  if (!unit || unitLeads(unit) !== leading) return null;
  if (leading) return unit;
  return <span className="typography-meta font-normal text-muted-foreground">{unitSuffix(unit)}</span>;
}

const formatShare = (share: number) => (share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`);

const pointsOf = (series: Series[]) => series.flatMap((item) => item.values.filter((point) => point !== null));

function BarSummary({ points, unit, total }: { points: number[]; unit?: string; total: number | null }) {
  const { t } = useI18n();
  const average = points.reduce((sum, point) => sum + point, 0) / points.length;
  const figure = (label: string, value: number) => (
    <span className="flex flex-col">
      <span className="typography-meta text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums"><HeadlineUnit unit={unit} leading />{formatNumber(value)}<HeadlineUnit unit={unit} /></span>
    </span>
  );
  if (total !== null) {
    return (
      <div className="flex items-start gap-5">
        {figure(t('chat.uiBlock.chart.total'), total)}
        {figure(t('chat.uiBlock.chart.largest'), Math.max(...points))}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-5">
      {figure(t('chat.uiBlock.chart.largest'), Math.max(...points))}
      {figure(t('chat.uiBlock.chart.average'), Math.abs(average) >= 1000 ? Math.round(average) : Number(average.toPrecision(4)))}
    </div>
  );
}

function BarChart({ props }: NodeProps) {
  const value = useBlockProps(blockProps.BarChart, props);
  if (!value) return null;
  const series = seriesOf(value.series);
  const points = pointsOf(series);
  if (points.length === 0) return null;
  const ticks = axisTicks(0, Math.max(0, ...points));
  const scale = ticks[ticks.length - 1] || 1;
  const single = series.length === 1;
  const largest = Math.max(...points);
  const smallest = Math.min(...points);
  const width = (point: number) => `${Math.max(0, Math.min(1, point / scale)) * 100}%`;
  const strength = (point: number) => (largest === smallest ? 100 : Math.round(30 + (70 * (point - smallest)) / (largest - smallest)));
  const sum = points.reduce((total, point) => total + point, 0);
  const total = value.whole && single && smallest >= 0 && sum > 0 ? sum : null;
  const barWidth = (point: number) => (total === null ? width(point) : `${(point / total) * 100}%`);
  return (
    <ChartFrame className="flex flex-col gap-3">
      {single ? <BarSummary points={points} unit={value.unit} total={total} /> : <ChartHeader series={series} />}
      <div className="flex flex-col gap-3">
        {value.labels.map((label, labelIndex) => {
          const values = series.map((item) => item.values[labelIndex] ?? null);
          const top = single && values[0] === largest;
          return (
            <div key={labelIndex} className="group/bar flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 typography-meta">
                <span
                  className={cn('min-w-0 truncate transition-colors duration-150', top ? 'font-semibold text-foreground' : 'text-muted-foreground group-hover/bar:text-foreground')}
                  title={label}
                >
                  {label}
                </span>
                <span className="flex shrink-0 items-baseline gap-2.5 tabular-nums">
                  {values.map((point, seriesIndex) => (
                    <span key={seriesIndex} className={cn(top && 'font-semibold')} style={single ? undefined : { color: seriesColor(seriesIndex) }}>
                      {point === null ? '–' : formatWithUnit(point, value.unit)}
                    </span>
                  ))}
                  {total !== null && values[0] !== null && (
                    <span className="min-w-[2.5em] text-end font-normal text-muted-foreground">{formatShare(values[0] / total)}</span>
                  )}
                </span>
              </div>
              {values.map((point, seriesIndex) => (
                <div key={seriesIndex} className="oc-track h-1.5 rounded-full">
                  {point !== null && (
                    <div
                      className="oc-bar-grow h-full rounded-full transition-[filter] duration-150 group-hover/bar:brightness-125"
                      style={{
                        width: barWidth(point),
                        animationDelay: `${Math.min(labelIndex, 12) * 45}ms`,
                        background: single
                          ? `color-mix(in srgb, ${seriesColor(0)} ${strength(point)}%, transparent)`
                          : seriesColor(seriesIndex),
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}

const segmentsOf = (values: Array<number | null>): Array<Array<{ index: number; point: number }>> => {
  const segments: Array<Array<{ index: number; point: number }>> = [];
  let current: Array<{ index: number; point: number }> = [];
  values.forEach((point, index) => {
    if (point === null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push({ index, point });
    }
  });
  if (current.length) segments.push(current);
  return segments;
};

const MAX_DOTTED_POINTS = 12;

const lastPoint = (values: Array<number | null>) => {
  for (let index = values.length - 1; index >= 0; index--) {
    const point = values[index];
    if (point !== null && point !== undefined) return { index, point };
  }
  return null;
};

function TrendHeader({ series, labels, unit }: { series: Series; labels: string[]; unit?: string }) {
  const { t } = useI18n();
  const values = series.values.slice(0, labels.length);
  const first = values.findIndex((point) => point !== null);
  const last = lastPoint(values);
  if (first < 0 || !last) return null;
  const start = values[first] ?? 0;
  const change = start === 0 || last.index === first ? null : ((last.point - start) / Math.abs(start)) * 100;
  return (
    <div className="flex items-baseline">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold tabular-nums"><HeadlineUnit unit={unit} leading />{formatNumber(last.point)}<HeadlineUnit unit={unit} /></span>
        {change !== null && (
          <span className="typography-meta text-muted-foreground tabular-nums">
            {t('chat.uiBlock.chart.changeSince', { change: `${change > 0 ? '+' : ''}${formatNumber(Math.round(change))}%`, label: labels[first] })}
          </span>
        )}
      </span>
    </div>
  );
}

function LineChart({ props }: NodeProps) {
  const value = useBlockProps(blockProps.LineChart, props);
  const [pointed, setHovered] = React.useState<number | null>(null);
  const focus = useSeriesFocus(value ? seriesOf(value.series).length : 0);
  const gradientId = `oc-area-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  if (!value) return null;
  const { labels } = value;
  const hovered = pointed !== null && pointed < labels.length ? pointed : null;
  const series = seriesOf(value.series);
  const area = series.length === 1;
  const points = pointsOf(series);
  if (points.length === 0) return null;
  const ticks = area ? axisTicks(Math.min(...points), Math.max(...points)) : axisTicks(Math.min(...points, 0), Math.max(...points, 0));
  const end = area ? lastPoint(series[0].values.slice(0, labels.length)) : null;
  const low = ticks[0];
  const span = ticks[ticks.length - 1] - low || 1;
  const width = 600;
  const height = 140;
  const xShare = (index: number) => (labels.length < 2 ? 0.5 : index / (labels.length - 1));
  const yShare = (point: number) => 1 - (point - low) / span;
  const step = Math.max(1, Math.ceil((labels.length - 1) / 5));
  const axisLabels = labels.map((label, index) => ({ label, index }))
    .filter(({ index }) => index % step === 0 || index === labels.length - 1);
  const dotted = labels.length <= MAX_DOTTED_POINTS;
  const pointAt = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || labels.length === 0) return;
    const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setHovered(labels.length < 2 ? 0 : Math.round(share * (labels.length - 1)));
  };
  const hoveredShare = hovered === null ? 0 : xShare(hovered);
  const dimmedSeries = (index: number) => !area && focus.focused !== null && focus.focused !== index;
  const tickLabel = (tick: number) => (!area && tick === ticks[ticks.length - 1] ? formatWithUnit(tick, value.unit) : formatNumber(tick));
  return (
    <ChartFrame className="flex flex-col gap-2" dir="ltr">
      {area ? <TrendHeader series={series[0]} labels={labels} unit={value.unit} /> : <ChartHeader series={series} focus={focus} />}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5 pt-2">
        <div className="relative h-[140px] typography-meta text-muted-foreground tabular-nums">
          {ticks.map((tick) => (
            <span key={tick} className="block whitespace-nowrap text-end leading-none opacity-0" aria-hidden="true">{tickLabel(tick)}</span>
          ))}
          {ticks.map((tick) => (
            <span key={tick} className="absolute end-0 -translate-y-1/2 whitespace-nowrap leading-none" style={{ top: `${yShare(tick) * 100}%` }}>
              {tickLabel(tick)}
            </span>
          ))}
        </div>
        <div
          className="relative h-[140px] touch-pan-y"
          onPointerMove={pointAt}
          onPointerDown={pointAt}
          onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHovered(null); }}
        >
          <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" aria-hidden="true">
            {ticks.map((tick) => (
              <line
                key={tick}
                x1={0} x2={width} y1={yShare(tick) * height} y2={yShare(tick) * height}
                stroke="var(--interactive-border)" strokeWidth={1} strokeOpacity={tick === 0 && !area ? 1 : 0.5} vectorEffect="non-scaling-stroke"
              />
            ))}
            {area && (
              <>
                <defs>
                  <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={seriesColor(0)} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={seriesColor(0)} stopOpacity={0} />
                  </linearGradient>
                </defs>
                {segmentsOf(series[0].values.slice(0, labels.length)).map((segment, segmentIndex) => (
                  <polygon
                    key={segmentIndex}
                    fill={`url(#${gradientId})`}
                    points={[
                      `${xShare(segment[0].index) * width},${height}`,
                      ...segment.map(({ index, point }) => `${xShare(index) * width},${yShare(point) * height}`),
                      `${xShare(segment[segment.length - 1].index) * width},${height}`,
                    ].join(' ')}
                  />
                ))}
              </>
            )}
            {hovered !== null && (
              <line x1={hoveredShare * width} x2={hoveredShare * width} y1={0} y2={height} stroke="var(--muted-foreground)" strokeWidth={1} strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />
            )}
            {series.map((item, seriesIndex) => (
              <g
                key={seriesIndex}
                className="transition-opacity duration-150"
                opacity={dimmedSeries(seriesIndex) ? 0.15 : 1}
                onPointerEnter={area ? undefined : (event) => { if (event.pointerType === 'mouse') focus.rest(seriesIndex); }}
                onPointerLeave={area ? undefined : (event) => { if (event.pointerType === 'mouse') focus.rest(null); }}
              >
                {segmentsOf(item.values.slice(0, labels.length)).map((segment, segmentIndex) => {
                  const line = segment.map(({ index, point }) => `${xShare(index) * width},${yShare(point) * height}`).join(' ');
                  return (
                    <React.Fragment key={segmentIndex}>
                      {!area && <polyline fill="none" stroke="transparent" strokeWidth={14} vectorEffect="non-scaling-stroke" points={line} />}
                      <polyline
                        fill="none"
                        stroke={seriesColor(seriesIndex)}
                        strokeWidth={area ? 2.5 : 2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                        points={line}
                      />
                    </React.Fragment>
                  );
                })}
              </g>
            ))}
          </svg>
          {series.map((item, seriesIndex) => item.values.slice(0, labels.length).map((point, index) => {
            if (point === null) return null;
            const alone = (item.values[index - 1] ?? null) === null && (item.values[index + 1] ?? null) === null;
            const isEnd = end?.index === index;
            if (!dotted && !alone && !isEnd && hovered !== index) return null;
            const hollow = area && !isEnd && hovered !== index;
            return (
              <span
                key={`${seriesIndex}-${index}`}
                className={cn(
                  'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full',
                  hovered === index || isEnd ? 'size-2.5 ring-2 ring-[var(--surface-elevated)]' : hollow ? 'size-2' : 'size-1.5',
                )}
                style={{
                  opacity: dimmedSeries(seriesIndex) ? 0.15 : 1,
                  left: `${xShare(index) * 100}%`,
                  top: `${yShare(point) * 100}%`,
                  background: hollow ? 'var(--surface-elevated)' : seriesColor(seriesIndex),
                  border: hollow ? `1.5px solid ${seriesColor(seriesIndex)}` : undefined,
                }}
              />
            );
          }))}
          {end && hovered === null && (
            <span
              className={cn(
                'pointer-events-none absolute typography-meta font-semibold tabular-nums',
                yShare(end.point) < 0.2 ? 'pt-2' : '-translate-y-full pb-2',
                xShare(end.index) > 0.9 ? '-translate-x-full' : '-translate-x-1/2',
              )}
              style={{ left: `${xShare(end.index) * 100}%`, top: `${yShare(end.point) * 100}%` }}
            >
              {formatWithUnit(end.point, value.unit)}
            </span>
          )}
          {hovered !== null && (
            <div
              className={cn(
                'pointer-events-none absolute top-0 z-10 flex flex-col gap-0.5 rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-2 py-1.5 typography-meta shadow-md',
                hoveredShare > 0.5 ? '-translate-x-full -ms-2' : 'ms-2',
              )}
              style={{ left: `${hoveredShare * 100}%`, width: 'max-content', maxWidth: `calc(${Math.max(hoveredShare, 1 - hoveredShare) * 100}% - 0.5rem)` }}
            >
              <span className="font-medium">{labels[hovered]}</span>
              {series.map((item, seriesIndex) => {
                const point = item.values[hovered];
                return (
                  <span key={seriesIndex} className={cn('flex items-center gap-1.5', dimmedSeries(seriesIndex) && 'opacity-40')}>
                    <span className="size-2 shrink-0 rounded-full" style={{ background: seriesColor(seriesIndex) }} />
                    {series.length > 1 && <span className="min-w-0 truncate text-muted-foreground">{item.name}</span>}
                    <span className="ms-auto ps-2 tabular-nums">
                      {point === null || point === undefined ? '–' : formatWithUnit(point, value.unit)}
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <span />
        <div className="relative h-4 typography-meta text-muted-foreground">
          {axisLabels.map(({ label, index }) => {
            const edge = index === 0 ? 'translate-x-0' : index === labels.length - 1 ? '-translate-x-full' : '-translate-x-1/2';
            return <span key={index} className={cn('absolute top-0 whitespace-nowrap', edge)} style={{ left: `${xShare(index) * 100}%` }}>{label}</span>;
          })}
        </div>
      </div>
    </ChartFrame>
  );
}

const WaitingFormContext = React.createContext<{ endPath: BlockPath | null; end: React.ReactNode } | null>(null);

const CHART_W = 640;
const CHART_PAD = { left: 44, right: 14, top: 12, bottom: 26 };

const chartX = (value: number, min: number, max: number) =>
  CHART_PAD.left + ((value - min) / (max - min || 1)) * (CHART_W - CHART_PAD.left - CHART_PAD.right);
const chartY = (value: number, min: number, max: number, height: number) =>
  height - CHART_PAD.bottom - ((value - min) / (max - min || 1)) * (height - CHART_PAD.top - CHART_PAD.bottom);

function ChartAxes({ ticks, min, max, height }: { ticks: number[]; min: number; max: number; height: number }) {
  return (
    <>
      {ticks.map((tick) => {
        const y = chartY(tick, min, max, height);
        return (
          <g key={tick}>
            <line x1={CHART_PAD.left} x2={CHART_W - CHART_PAD.right} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
            <text x={CHART_PAD.left - 6} y={y + 3.5} textAnchor="end" fontSize="9" fill="var(--muted-foreground)">{formatNumber(tick)}</text>
          </g>
        );
      })}
    </>
  );
}

function Scatter({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Scatter, props);
  if (!value) return null;
  const series = seriesOf(value.series);
  const points = pointsOf(series);
  if (value.x.length === 0 || points.length === 0) return null;
  const height = 200;
  const ticks = axisTicks(Math.min(0, ...points), Math.max(...points));
  const low = ticks[0] ?? 0;
  const high = ticks[ticks.length - 1] ?? 1;
  const xMin = Math.min(...value.x);
  const xMax = Math.max(...value.x);
  const name = series.map((item) => item.name).join(', ');
  return (
    <ChartFrame className="flex flex-col gap-2">
      <ChartHeader series={series} />
      <svg viewBox={`0 0 ${CHART_W} ${height}`} role="img" aria-label={name} className="h-auto w-full">
        <ChartAxes ticks={ticks} min={low} max={high} height={height} />
        {series.map((item, seriesIndex) => item.values.map((point, index) => {
          if (point === null || value.x[index] === undefined) return null;
          return (
            <circle
              key={`${seriesIndex}-${index}`}
              cx={chartX(value.x[index], xMin, xMax)}
              cy={chartY(point, low, high, height)}
              r="3.5"
              fill={seriesColor(seriesIndex)}
              opacity="0.9"
            />
          );
        }))}
        <text x={CHART_PAD.left} y={height - 8} fontSize="9" fill="var(--muted-foreground)">{formatWithUnit(xMin, value.xUnit)}</text>
        <text x={CHART_W - CHART_PAD.right} y={height - 8} textAnchor="end" fontSize="9" fill="var(--muted-foreground)">{formatWithUnit(xMax, value.xUnit)}</text>
      </svg>
    </ChartFrame>
  );
}

function Area({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Area, props);
  if (!value) return null;
  const labels = value.labels;
  const series = seriesOf(value.series).map((item) => ({ ...item, values: item.values.slice(0, labels.length) }));
  if (labels.length === 0 || series.length === 0) return null;
  const height = 210;
  const stacked = value.stacked === true && series.length > 1;
  const base = labels.map(() => 0);
  const bands = series.map((item) => {
    const bottom = stacked ? [...base] : labels.map(() => 0);
    const top = item.values.map((point, index) => {
      const raised = (stacked ? bottom[index] : 0) + (point ?? 0);
      if (stacked) base[index] = raised;
      return raised;
    });
    return { item, bottom, top };
  });
  const highest = Math.max(...bands.map((band) => Math.max(...band.top)), 0);
  const lowest = Math.min(...bands.map((band) => Math.min(...band.bottom)), 0);
  const ticks = axisTicks(lowest, highest);
  const low = ticks[0] ?? 0;
  const high = ticks[ticks.length - 1] ?? 1;
  const xOf = (index: number) => CHART_PAD.left + (labels.length === 1 ? 0.5 : index / (labels.length - 1)) * (CHART_W - CHART_PAD.left - CHART_PAD.right);
  const path = (values: number[], close?: number[]) => {
    const top = values.map((point, index) => `${index === 0 ? 'M' : 'L'}${xOf(index).toFixed(1)},${chartY(point, low, high, height).toFixed(1)}`).join(' ');
    if (!close) return top;
    const back = [...close].reverse().map((point, index) => `L${xOf(labels.length - 1 - index).toFixed(1)},${chartY(point, low, high, height).toFixed(1)}`).join(' ');
    return `${top} ${back} Z`;
  };
  return (
    <ChartFrame className="flex flex-col gap-2">
      <ChartHeader series={series} />
      <svg viewBox={`0 0 ${CHART_W} ${height}`} role="img" aria-label={series.map((item) => item.name).join(', ')} className="h-auto w-full">
        <ChartAxes ticks={ticks} min={low} max={high} height={height} />
        {bands.map((band, index) => (
          <path
            key={index}
            d={path(band.top, stacked ? band.bottom : undefined)}
            fill={seriesColor(index)}
            fillOpacity={stacked ? 0.45 : 0.18}
            stroke={seriesColor(index)}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        ))}
        <text x={CHART_PAD.left} y={height - 8} fontSize="9" fill="var(--muted-foreground)">{labels[0]}</text>
        <text x={CHART_W - CHART_PAD.right} y={height - 8} textAnchor="end" fontSize="9" fill="var(--muted-foreground)">{labels[labels.length - 1]}</text>
      </svg>
    </ChartFrame>
  );
}

function Heatmap({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Heatmap, props);
  if (!value) return null;
  const flat = value.values.flat();
  if (flat.length === 0) return null;
  const low = Math.min(...flat);
  const high = Math.max(...flat);
  const intensity = (point: number) => (high === low ? 55 : 10 + (85 * (point - low)) / (high - low));
  return (
    <ChartFrame className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <div className="grid min-w-max gap-1" style={{ gridTemplateColumns: `minmax(3.5rem, auto) repeat(${value.columns.length}, minmax(1.5rem, 1fr))` }}>
          <span />
          {value.columns.map((column) => (
            <span key={column} className="truncate text-center typography-meta text-muted-foreground" title={column}>{column}</span>
          ))}
          {value.rows.map((row, rowIndex) => (
            <React.Fragment key={row}>
              <span className="truncate pe-1 typography-meta text-muted-foreground" title={row}>{row}</span>
              {value.columns.map((column, columnIndex) => {
                const point = value.values[rowIndex]?.[columnIndex];
                return (
                  <span
                    key={column}
                    className="flex h-7 items-center justify-center rounded-[calc(var(--radius)*0.5)] typography-meta tabular-nums"
                    style={point === undefined ? undefined : { background: `color-mix(in srgb, ${seriesColor(0)} ${intensity(point)}%, transparent)` }}
                    title={point === undefined ? undefined : `${row} · ${column}: ${formatWithUnit(point, value.unit)}`}
                  >
                    {point !== undefined && flat.length <= 60 ? formatNumber(point) : null}
                  </span>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between typography-meta text-muted-foreground">
        <span>{formatWithUnit(low, value.unit)}</span>
        <span className="h-1.5 w-24 rounded-full" style={{ background: `linear-gradient(to right, color-mix(in srgb, ${seriesColor(0)} 10%, transparent), ${seriesColor(0)})` }} />
        <span>{formatWithUnit(high, value.unit)}</span>
      </div>
    </ChartFrame>
  );
}

function Timeline({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Timeline, props);
  if (!value) return null;
  if (value.items.length === 0) return null;
  const start = Math.min(...value.items.map((item) => item.start));
  const end = Math.max(...value.items.map((item) => item.end));
  const span = end - start || 1;
  return (
    <ChartFrame className="flex flex-col gap-2.5">
      {value.items.map((item, index) => {
        const left = ((item.start - start) / span) * 100;
        const width = Math.max(((item.end - item.start) / span) * 100, 1.5);
        return (
          <div key={`${item.label}-${index}`} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate typography-meta text-muted-foreground" title={item.label}>{item.label}</span>
            <span className="relative h-2 flex-1 rounded-full bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)]">
              <span
                className="absolute inset-y-0 rounded-full"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: item.tone ? `var(--oc-tone-${item.tone})` : seriesColor(index),
                }}
              />
            </span>
            <span className="w-16 shrink-0 text-end typography-meta tabular-nums text-muted-foreground">{formatWithUnit(item.end - item.start, value.unit)}</span>
          </div>
        );
      })}
      <div className="flex justify-between typography-meta text-muted-foreground">
        <span>{formatWithUnit(start, value.unit)}</span>
        <span>{formatWithUnit(end, value.unit)}</span>
      </div>
    </ChartFrame>
  );
}

function Diagram({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Diagram, props);
  const arrow = React.useId().replace(/:/g, '');
  if (!value) return null;
  if (value.nodes.length === 0) return null;
  const height = value.height ?? 240;
  const width = CHART_W;
  const box = (node: (typeof value.nodes)[number]) => ({
    x: (node.x / 100) * width - ((node.width ?? 24) / 100) * width / 2,
    y: (node.y / 100) * height - ((node.height ?? 12) / 100) * height / 2,
    w: ((node.width ?? 24) / 100) * width,
    h: ((node.height ?? 12) / 100) * height,
    cx: (node.x / 100) * width,
    cy: (node.y / 100) * height,
  });
  const boxes = new Map(value.nodes.map((node) => [node.id, box(node)]));
  const clip = (rect: { cx: number; cy: number; w: number; h: number }, toward: { cx: number; cy: number }) => {
    const dx = toward.cx - rect.cx;
    const dy = toward.cy - rect.cy;
    const scale = Math.min(
      dx === 0 ? Infinity : (rect.w / 2) / Math.abs(dx),
      dy === 0 ? Infinity : (rect.h / 2) / Math.abs(dy),
    );
    const step = Number.isFinite(scale) ? scale : 0;
    return { x: rect.cx + dx * step, y: rect.cy + dy * step };
  };
  return (
    <ChartFrame className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={value.nodes.map((node) => node.label).join(', ')} className="h-auto w-full">
        <defs>
          <marker id={`oc-arrow-${arrow}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
          </marker>
        </defs>
        {value.edges.map((edge, index) => {
          const from = boxes.get(edge.from);
          const to = boxes.get(edge.to);
          if (!from || !to) return null;
          const start = clip(from, to);
          const end = clip(to, from);
          return (
            <g key={index}>
              <line
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke="var(--muted-foreground)"
                strokeOpacity="0.55"
                strokeWidth="1.25"
                markerEnd={`url(#oc-arrow-${arrow})`}
              />
              {edge.label ? (() => {
                const mx = start.x + (end.x - start.x) * 0.5;
                const my = start.y + (end.y - start.y) * 0.5;
                const width = Math.min(140, edge.label.length * 5.4 + 12);
                return (
                  <g>
                    <rect x={mx - width / 2} y={my - 15} width={width} height={15} rx="7.5" fill="var(--background)" stroke="var(--border)" strokeWidth="1" />
                    <text x={mx} y={my - 4.5} textAnchor="middle" fontSize="8.5" fill="var(--muted-foreground)">{edge.label}</text>
                  </g>
                );
              })() : null}
            </g>
          );
        })}
        {value.nodes.map((node) => {
          const rect = boxes.get(node.id);
          if (!rect) return null;
          const tone = node.tone ? `var(--oc-tone-${node.tone})` : null;
          const label = node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label;
          return (
            <g key={node.id}>
              <rect
                x={rect.x}
                y={rect.y}
                width={rect.w}
                height={rect.h}
                rx="10"
                fill={tone ? `color-mix(in srgb, ${tone} 16%, transparent)` : 'color-mix(in srgb, var(--foreground) 6%, transparent)'}
                stroke={tone ?? 'var(--border)'}
                strokeWidth="1"
              />
              <text x={rect.cx} y={rect.cy + 3.5} textAnchor="middle" fontSize="10" fill="var(--foreground)">{label}</text>
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

function MathBlock({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Math, props);
  if (!value) return null;
  const html = React.useMemo(() => {
    try {
      return katex.renderToString(value.latex, {
        displayMode: value.block !== false,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
        output: 'htmlAndMathml',
      });
    } catch {
      return null;
    }
  }, [value.latex, value.block]);
  return (
    <div className="oc-box overflow-x-auto text-center">
      {html
        ? <div dangerouslySetInnerHTML={{ __html: html }} />
        : <code className="typography-meta">{value.latex}</code>}
    </div>
  );
}

function Sparkline({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Sparkline, props);
  if (!value) return null;
  const points = value.values.filter((point): point is number => point !== null);
  if (points.length < 2) return null;
  const low = Math.min(...points);
  const high = Math.max(...points);
  const width = 132;
  const height = 30;
  const at = (point: number, index: number) => {
    const x = (index / (value.values.length - 1)) * width;
    const y = height - 3 - ((point - low) / (high - low || 1)) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const path = value.values
    .map((point, index) => (point === null ? null : `${index === 0 || value.values[index - 1] === null ? 'M' : 'L'}${at(point, index)}`))
    .filter((part): part is string => part !== null)
    .join(' ');
  const last = points[points.length - 1];
  return (
    <div className="flex flex-wrap items-center gap-2 typography-meta">
      {value.label ? <span className="text-muted-foreground">{value.label}</span> : null}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={value.label ?? 'trend'} className="h-7 w-[132px]">
        <path d={path} fill="none" stroke={seriesColor(0)} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className="font-medium tabular-nums">{formatWithUnit(last, value.unit)}</span>
    </div>
  );
}

function ColumnChart({ props }: NodeProps) {
  const value = useBlockProps(blockProps.ColumnChart, props);
  const arrowX = `oc-axis-x-${React.useId().replace(/:/g, '')}`;
  const arrowY = `oc-axis-y-${React.useId().replace(/:/g, '')}`;
  if (!value) return null;
  const labels = value.labels;
  const series = seriesOf(value.series).map((item) => ({ ...item, values: item.values.slice(0, labels.length) }));
  if (labels.length === 0 || series.length === 0) return null;
  const stacked = value.stacked === true && series.length > 1;
  const totals = labels.map((_, index) => (stacked
    ? series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0)
    : Math.max(...series.map((item) => item.values[index] ?? 0))));
  const ticks = axisTicks(Math.min(0, ...totals), Math.max(0, ...totals));
  const low = ticks[0] ?? 0;
  const high = ticks[ticks.length - 1] ?? 1;
  const height = 240;
  const left = 56;
  const right = 16;
  const top = 14;
  const bottom = 46;
  const plotW = CHART_W - left - right;
  const plotH = height - top - bottom;
  const group = plotW / labels.length;
  const barW = Math.max(4, (group * 0.62) / series.length);
  const yOf = (point: number) => top + plotH - ((point - low) / (high - low || 1)) * plotH;
  const every = Math.ceil(labels.length / 9);
  const showValues = labels.length * series.length <= 14;
  return (
    <ChartFrame className="flex flex-col gap-2">
      <ChartHeader series={series} />
      <svg viewBox={`0 0 ${CHART_W} ${height}`} role="img" aria-label={series.map((item) => item.name).join(', ')} className="h-auto w-full">
        <defs>
          <marker id={arrowX} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
          </marker>
          <marker id={arrowY} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
          </marker>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={CHART_W - right} y1={yOf(tick)} y2={yOf(tick)} stroke="var(--border)" strokeWidth="1" strokeDasharray={tick === 0 ? undefined : '3 4'} />
            <text x={left - 8} y={yOf(tick) + 3.5} textAnchor="end" fontSize="9" fill="var(--muted-foreground)">{formatNumber(tick)}</text>
          </g>
        ))}
        <line x1={left} x2={left} y1={top} y2={height - bottom} stroke="var(--muted-foreground)" strokeWidth="1" markerEnd={`url(#${arrowY})`} />
        <line x1={left} x2={CHART_W - right} y1={height - bottom} y2={height - bottom} stroke="var(--muted-foreground)" strokeWidth="1" markerEnd={`url(#${arrowX})`} />
        {value.yLabel ? (
          <text x={13} y={top + plotH / 2} textAnchor="middle" fontSize="9.5" fill="var(--muted-foreground)" transform={`rotate(-90 13 ${top + plotH / 2})`}>{value.yLabel}</text>
        ) : null}
        {value.xLabel ? (
          <text x={left + plotW / 2} y={height - 6} textAnchor="middle" fontSize="9.5" fill="var(--muted-foreground)">{value.xLabel}</text>
        ) : null}
        {labels.map((label, index) => {
          const center = left + group * index + group / 2;
          const base = stacked ? 0 : 0;
          let raised = base;
          return (
            <g key={`${label}-${index}`}>
              {series.map((item, seriesIndex) => {
                const point = item.values[index];
                if (point === null || point === undefined) return null;
                const from = stacked ? raised : Math.min(0, low);
                const to = stacked ? raised + point : Math.max(point, Math.min(0, low));
                if (stacked) raised += point;
                const x = stacked ? center - barW / 2 : center - (barW * series.length) / 2 + barW * seriesIndex;
                const y = Math.min(yOf(to), yOf(from));
                const h = Math.max(1.5, Math.abs(yOf(to) - yOf(from)));
                return (
                  <g key={seriesIndex}>
                    <rect x={x} y={y} width={stacked ? barW : Math.max(4, barW - 2)} height={h} rx="2.5" fill={seriesColor(seriesIndex)} opacity="0.92" />
                    {showValues && !stacked ? (
                      <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="8.5" fill="var(--muted-foreground)">{formatNumber(point)}</text>
                    ) : null}
                  </g>
                );
              })}
              {index % every === 0 ? (
                <text x={center} y={height - bottom + 14} textAnchor="middle" fontSize="9" fill="var(--muted-foreground)">{label.length > 12 ? `${label.slice(0, 11)}…` : label}</text>
              ) : null}
            </g>
          );
        })}
        {value.unit ? (
          <text x={left - 8} y={top - 3} textAnchor="end" fontSize="8.5" fill="var(--muted-foreground)">{value.unit}</text>
        ) : null}
      </svg>
    </ChartFrame>
  );
}

function Tabs({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Tabs, props);
  const waiting = React.useContext(WaitingFormContext);
  const path = React.useContext(PathContext);
  const slot = React.useContext(SlotContext);
  const { t } = useI18n();
  const [active, setActive] = React.useState('0');
  const panel = React.useRef<HTMLDivElement>(null);
  const block = React.useRef<HTMLDivElement>(null);
  const stepped = React.useRef(false);
  React.useEffect(() => {
    if (!stepped.current) return;
    stepped.current = false;
    panel.current?.focus({ preventScroll: true });
    dispatchTabStep(block.current);
  }, [active]);
  if (!value) return null;
  const tabs = value.tabs.flatMap((node) => {
    const tab = blockProps.Tab.safeParse(blockNode.safeParse(node).data?.props);
    return tab.success ? [{ ...tab.data, node }] : [];
  });
  const activeIndex = Number(active) < tabs.length ? Number(active) : 0;
  const current = tabs[activeIndex];
  const next = !waiting || activeIndex >= tabs.length - 1 ? null : (
    <UiButton
      type="button"
      variant="outline"
      className="w-fit"
      onClick={() => {
        stepped.current = true;
        setActive(String(activeIndex + 1));
      }}
    >
      {t('chat.questionCard.next')}
    </UiButton>
  );
  const run = next && current ? noteSlot(current.node) : null;
  const tabSlot = run?.parent === '' ? { parent: path, index: run.index, element: null, trailing: next } : null;
  const footer = tabSlot ? null : next ?? (waiting?.endPath === path ? waiting.end : null);
  return (
    <div ref={block} className="flex flex-col gap-2">
      <SortableTabsStrip
        items={tabs.map((tab, index) => ({ id: String(index), label: tab.label }))}
        activeId={current ? String(activeIndex) : null}
        onSelect={setActive}
        variant="active-pill"
        layoutMode="scrollable"
        intrinsicWidth
        pillSize="toolbar"
        className="h-7 max-w-full flex-none self-start"
      />
      {(current || footer) && (
        <div ref={panel} tabIndex={-1} className="oc-box flex flex-col gap-3 outline-none">
          {current && (
            <InCardContext.Provider value>
              <SlotContext.Provider value={tabSlot || slot}><Children nodes={current.children} /></SlotContext.Provider>
            </InCardContext.Provider>
          )}
          {footer}
        </div>
      )}
    </div>
  );
}

function Choice({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Choice, props);
  const form = React.useContext(FormContext);
  if (!value) return null;
  const current = form.values[value.name];
  const chosen = Array.isArray(current) ? current : current ? [current] : [];
  const toggle = (option: string) => {
    if (form.disabled) return;
    if (!value.multiple) {
      form.setValue(value.name, option);
      return;
    }
    form.setValue(value.name, chosen.includes(option) ? chosen.filter((item) => item !== option) : [...chosen, option]);
  };
  return (
    <div className="flex flex-col gap-0.5">
      {value.label && <span className="typography-meta font-medium text-foreground">{value.label}</span>}
      <div className="flex flex-col" role={value.multiple ? 'group' : 'radiogroup'} aria-label={value.label || value.name}>
        {value.options.map((entry) => {
          const { label: option, description } = choiceOption.parse(entry);
          const selected = chosen.includes(option);
          return (
            <div
              key={option}
              onClick={() => toggle(option)}
              className={cn('px-1.5 py-1', form.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}
            >
              <div className="flex items-center gap-2">
                {value.multiple
                  ? <Checkbox checked={selected} onChange={() => toggle(option)} disabled={form.disabled} ariaLabel={option} />
                  : <Radio checked={selected} onChange={() => toggle(option)} disabled={form.disabled} ariaLabel={option} />}
                <span className={cn('typography-meta min-w-0', selected ? 'font-medium text-foreground' : 'text-foreground/80')}>{option}</span>
              </div>
              {description && <div className="typography-micro break-words ps-[22px] text-muted-foreground">{description}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShortTextarea(props: React.ComponentProps<typeof Textarea>) {
  return <Textarea className="min-h-10" maxLength={4000} {...props} />;
}

function Input({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Input, props);
  const form = React.useContext(FormContext);
  if (!value) return null;
  const current = form.values[value.name];
  const text = Array.isArray(current) ? current.join(', ') : current ?? '';
  const onChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => form.setValue(value.name, event.target.value);
  return (
    <label className="flex flex-col gap-1">
      {value.label && <span className="typography-meta font-medium text-foreground">{value.label}</span>}
      {value.multiline
        ? <ShortTextarea rows={2} value={text} placeholder={value.placeholder} disabled={form.disabled} onChange={onChange} />
        : <FieldInput value={text} placeholder={value.placeholder} disabled={form.disabled} onChange={onChange} />}
    </label>
  );
}

function DateInput({ props }: NodeProps) {
  const value = useBlockProps(blockProps.DateInput, props);
  const form = React.useContext(FormContext);
  const { t } = useI18n();
  const { use24Hour } = useCalendarPreferences();
  const current = value ? form.values[value.name] : undefined;
  const text = Array.isArray(current) ? '' : current ?? '';
  const date = text.slice(0, 10);
  const [pendingTime, setPendingTime] = React.useState(DEFAULT_TIME);
  if (!value) return null;
  const time = text.slice(11, 16) || pendingTime;
  const set = (nextDate: string, nextTime: string) => {
    if (!form.disabled) form.setValue(value.name, value.time ? `${nextDate}T${nextTime}` : nextDate);
  };
  return (
    <div className="flex flex-col gap-1">
      {value.label && <span className="typography-meta font-medium text-foreground">{value.label}</span>}
      <fieldset disabled={form.disabled} className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
        <DatePicker
          value={date}
          onChange={(nextDate) => set(nextDate, time)}
          placeholder={t('sessions.scheduledTasks.editor.date.placeholder')}
          ariaLabel={value.label || value.name}
          disabled={form.disabled}
        />
        {value.time && (
          <TimePill
            value={time}
            use24Hour={use24Hour}
            hourAriaLabel={t('sessions.scheduledTasks.editor.time.hourAria')}
            minuteAriaLabel={t('sessions.scheduledTasks.editor.time.minuteAria')}
            periodAriaLabel={t('sessions.scheduledTasks.editor.time.periodAria')}
            amLabel={t('sessions.scheduledTasks.editor.time.period.am')}
            pmLabel={t('sessions.scheduledTasks.editor.time.period.pm')}
            onChange={(nextTime) => {
              setPendingTime(nextTime);
              if (date) set(date, nextTime);
            }}
          />
        )}
      </fieldset>
    </div>
  );
}

const SLIDER_CLASS = 'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--interactive-border)] disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--primary-base)] [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--primary-base)]';

function Slider({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Slider, props);
  const form = React.useContext(FormContext);
  if (!value) return null;
  const stored = Number(form.values[value.name]);
  const position = Number.isFinite(stored) ? stored : sliderStart(value);
  return (
    <label className="flex max-w-md flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-3 typography-meta">
        <span className="font-medium text-foreground">{value.label || value.name}</span>
        <span className="font-semibold tabular-nums text-foreground">{formatWithUnit(position, value.unit)}</span>
      </span>
      <input
        type="range"
        min={value.min}
        max={value.max}
        step={value.step ?? 1}
        value={position}
        disabled={form.disabled}
        onChange={(event) => form.setValue(value.name, event.target.value)}
        className={SLIDER_CLASS}
      />
      <span className="flex justify-between typography-micro tabular-nums text-muted-foreground">
        <span>{formatWithUnit(value.min, value.unit)}</span>
        <span>{formatWithUnit(value.max, value.unit)}</span>
      </span>
    </label>
  );
}

function Details({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Details, props);
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  if (!value || value.children.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-fit items-center gap-1 text-start font-medium text-foreground/80 transition-colors hover:text-foreground"
      >
        <Icon name="arrow-right-s" className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-150', open && 'rotate-90 rtl:-rotate-90')} />
        <Markdown source={value.title} className="oc-ui-block-title" />
      </button>
      <div id={panelId} hidden={!open} className="flex flex-col gap-3 ps-5">
        <Children nodes={value.children} />
      </div>
    </div>
  );
}

function Button({ props }: NodeProps) {
  const value = useBlockProps(blockProps.Button, props);
  const form = React.useContext(FormContext);
  const cardTitle = React.useContext(CardTitleContext);
  if (!value) return null;
  const decision = form.folds ? decisionOf(form.titles, cardTitle, value.value) : value.value ?? '';
  const chosen = form.chosen.get(decision) === value.label;
  const recommended = value.variant === 'primary' && !form.chosen.has(decision);
  return (
    <UiButton
      type="button"
      variant={chosen || recommended ? 'default' : 'outline'}
      className="w-fit"
      aria-pressed={chosen}
      disabled={form.disabled}
      onClick={() => form.press(value.label, form.folds ? decision : value.value)}
    >
      {chosen && <Icon name="check" className="size-3.5" />}
      {value.label}
    </UiButton>
  );
}

const renderers = {
  Stack, Row, Card, Tabs, Details, Text, Badge, Callout, KeyValue, Table, Stat, Progress, Steps, BarChart, LineChart,
  Scatter, Area, Heatmap, Timeline, Diagram, Math: MathBlock, Sparkline, ColumnChart,
  Choice, Input, DateInput, Slider, Button,
} satisfies Partial<Record<BlockName, React.FC<NodeProps>>>;
const drawn = blockName.extract([
  'Stack', 'Row', 'Card', 'Tabs', 'Details', 'Text', 'Badge', 'Callout', 'KeyValue', 'Table', 'Stat', 'Progress', 'Steps', 'BarChart',
  'LineChart', 'Scatter', 'Area', 'Heatmap', 'Timeline', 'Diagram', 'Math', 'Sparkline', 'ColumnChart',
  'Choice', 'Input', 'DateInput', 'Slider', 'Button',
]);

const ExtensionBlocksContext = React.createContext<{
  blocks: ExtensionBlocks;
  complete: boolean;
  answered: (name: string) => string | null;
  answer: (name: string, text: string) => Promise<void>;
}>({ blocks: NO_EXTENSION_BLOCKS, complete: false, answered: () => null, answer: () => Promise.reject(new Error('This block cannot take an answer.')) });

const extensionArgs = (props: Record<string, BlockValue>): Record<string, string> => Object.fromEntries(
  Object.entries(props).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);

function Node({ value }: { value: BlockValue }) {
  const extensions = React.useContext(ExtensionBlocksContext);
  const node = blockNode.safeParse(value);
  const extension = node.data ? extensions.blocks.get(node.data.typeName) : undefined;
  const nodeProps = node.data?.props;
  const args = React.useMemo(() => (extension && nodeProps ? extensionArgs(nodeProps) : null), [extension, nodeProps]);
  if (extension && args) return <ExtensionBlockFrame block={extension} args={args} complete={extensions.complete} answered={extensions.answered(extension.name)} answer={extensions.answer} />;
  const name = drawn.safeParse(node.data?.typeName);
  if (!node.success || !name.success) return null;
  const Renderer = renderers[name.data];
  return <Renderer props={node.data.props} />;
}

function NotDrawn({ source, errors, partial = false }: { source: string; errors: string[]; partial?: boolean }) {
  const { t } = useI18n();
  const image = React.useContext(MarkdownPresentationContext)?.purpose === 'image';
  const [open, setOpen] = React.useState(image);
  const panelId = React.useId();
  const shown = errors.map((error) => (/Unknown component "[A-Z]/.test(error) ? t('chat.uiBlocks.extensionBlock.unavailable') : error));
  return (
    <div className="flex flex-col gap-1 typography-meta">
      <div className={partial ? 'text-muted-foreground' : 'text-[var(--status-error)]'}>{t(partial ? 'chat.uiBlock.partial' : 'chat.uiBlock.invalid')}</div>
      {[...new Set(shown)].map((error) => <div key={error} className="text-muted-foreground">{error}</div>)}
      <button
        type="button"
        data-export-ignore
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-fit items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icon name="arrow-right-s" className={cn('size-4 shrink-0 transition-transform duration-150', open && 'rotate-90 rtl:-rotate-90')} />
        {t('chat.uiBlock.source')}
      </button>
      <pre id={panelId} hidden={!open} dir="ltr"><code>{source}</code></pre>
    </div>
  );
}

class BlockErrorBoundary extends React.Component<
  { source: string; fallback: React.ReactNode; onFailed?: (errors: string[]) => void; children: React.ReactNode },
  { failed: boolean; source: string }
> {
  state = { failed: false, source: this.props.source };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onFailed?.([`The chat failed to draw this block: ${error.message}`]);
  }

  static getDerivedStateFromProps(props: { source: string }, state: { source: string }) {
    return props.source !== state.source ? { source: props.source, failed: false } : null;
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function addKitStyles() {
  if (document.querySelector('style[data-oc-visual-kit]')) return;
  const style = document.createElement('style');
  style.dataset.ocVisualKit = '';
  style.textContent = KIT_SHARED_CSS;
  document.head.append(style);
}

function BlockIssues({ root }: { root: BlockValue }) {
  const { t } = useI18n();
  const issues = React.useMemo(() => [...verifyBlockTree(root), ...reconcileTableWithChart(root)], [root]);
  if (issues.length === 0) return null;
  return (
    <div className="mt-2 flex items-start gap-1.5 typography-meta text-[var(--status-warning)]" role="status" data-export-ignore>
      <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
      <span>{t('chat.uiBlock.verify.mismatch')}</span>
    </div>
  );
}

export function UiBlock({ source, complete, host = noHost, onNotDrawn, actions }: {
  source: string;
  complete: boolean;
  host?: UiBlockHost;
  actions?: React.ReactNode;
  onNotDrawn?: (errors: string[]) => void;
}) {
  const { t } = useI18n();
  const themeSystem = useOptionalThemeSystem();
  const presentation = React.useContext(MarkdownPresentationContext);
  const currentTheme = themeSystem?.currentTheme ?? presentation?.theme;
  if (!currentTheme) throw new Error('useThemeSystem must be used within a ThemeSystemProvider');
  const salvage = host.kind === 'reply';
  const availableExtensions = useExtensionBlocks();
  const extensionBlocks = presentation?.purpose === 'image' ? NO_EXTENSION_BLOCKS : availableExtensions;
  const parsed = React.useMemo(() => parseUiBlock(source, complete, salvage, extensionBlocks), [source, complete, salvage, extensionBlocks]);
  const blockRef = React.useRef<HTMLDivElement>(null);
  React.useInsertionEffect(addKitStyles, []);
  React.useLayoutEffect(() => {
    const element = blockRef.current;
    if (!element) return;
    for (const [name, color] of Object.entries(kitVariables(currentTheme))) element.style.setProperty(name, color);
  }, [currentTheme, parsed.kind]);
  const notDrawnErrors = parsed.kind === 'invalid' ? parsed.errors : null;
  React.useEffect(() => {
    if (notDrawnErrors) onNotDrawn?.(notDrawnErrors);
  }, [notDrawnErrors, onNotDrawn]);
  const [values, setValues] = React.useState<Record<string, UiBlockFieldValue>>(() => host.answered?.values ?? {});
  const [chosen, setChosen] = React.useState<Chosen>(() => chosenFrom(host));
  const [notes, setNotes] = React.useState<Notes>(() => notesFrom(host));
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(host.answered !== null);
  const [failed, setFailed] = React.useState(false);
  const pageNote = (answer: UiBlockHost['answered']) => (answer && 'note' in answer ? answer.note ?? '' : '');
  const [note, setNote] = React.useState(() => pageNote(host.answered));
  const [noteOpen, setNoteOpen] = React.useState(() => pageNote(host.answered) !== '');
  const [shownAnswer, setShownAnswer] = React.useState(host.answered);
  if (host.answered !== shownAnswer) {
    setShownAnswer(host.answered);
    if (host.answered) {
      setValues(host.answered.values);
      setChosen(chosenFrom(host));
      setNotes(notesFrom(host));
      setNote(pageNote(host.answered));
      setNoteOpen(pageNote(host.answered) !== '');
      setSent(true);
    }
  }
  const root = parsed.kind === 'ready' ? parsed.root : null;
  const frameName = React.useMemo(() => (root ? answeringFrame(root, extensionBlocks) : null), [extensionBlocks, root]);
  const trimmedNote = note.trim();
  const fields = React.useMemo(() => (root && complete ? blockFields(root) : []), [root, complete]);
  const decisions = React.useMemo(() => (root ? blockDecisions(root) : []), [root]);
  const titles = React.useMemo(() => (root ? decisionTitles(root) : new Set<string>()), [root]);
  const answerValues = React.useMemo<Record<string, UiBlockFieldValue>>(() => ({
    ...Object.fromEntries(fields.flatMap((field) => (field.initial === undefined ? [] : [[field.name, field.initial]]))),
    ...values,
  }), [fields, values]);
  const disabled = !host.submit || !complete || sending || sent;

  const delivering = React.useRef(false);
  const deliver = React.useCallback((send: () => Promise<void>) => {
    if (delivering.current) return Promise.resolve(false);
    delivering.current = true;
    setSending(true);
    setFailed(false);
    return send().then(() => {
      setSent(true);
      return true;
    }, () => {
      delivering.current = false;
      setFailed(true);
      return false;
    }).finally(() => setSending(false));
  }, []);
  const replyAnswer = React.useCallback((choices: Chosen) => {
    const answer: UiBlockReplyAnswerData = {
      picks: [],
      values: answerValues,
      skipped: [],
    };
    for (const decision of decisions) {
      const pick: UiBlockReplyAnswerData['picks'][number] = {};
      const button = choices.get(decision);
      const decisionNote = notes.get(decision)?.trim();
      if (button) pick.button = button;
      if (decision) pick.value = decision;
      if (decisionNote) pick.note = decisionNote;
      if (pick.button || pick.note) answer.picks.push(pick);
      else answer.skipped.push(decision);
    }
    if (frameName && trimmedNote) answer.picks.unshift({ value: frameName, note: trimmedNote });
    return answer;
  }, [decisions, answerValues, notes, frameName, trimmedNote]);
  const sendReply = React.useCallback((choices: Chosen) => {
    if (host.kind !== 'reply' || !host.submit) return;
    const { submit } = host;
    const answer = replyAnswer(choices);
    void deliver(() => submit(answer, describeUiBlockReplyAnswer(fields, answer)));
  }, [host, replyAnswer, fields, deliver]);

  const answerFromFrame = React.useCallback(async (name: string, text: string) => {
    if (disabled || delivering.current || !host.submit) throw new Error('This block cannot take an answer now.');
    const send = async () => {
      if (host.kind === 'reply') {
        const answer = replyAnswer(chosen);
        const others = answer.picks.filter((pick) => pick.value !== name);
        answer.picks = [{ button: text, value: name, ...(trimmedNote ? { note: trimmedNote } : {}) }, ...others];
        await host.submit?.(answer, describeUiBlockReplyAnswer(fields, answer));
      } else {
        const data: UiBlockAnswerData = { button: text, value: name, values: answerValues };
        if (trimmedNote) data.note = trimmedNote;
        await host.submit?.({ summary: describeUiBlockAnswer(fields, data, t('chat.uiBlock.note.label')), data });
      }
      setChosen((current) => new Map(current).set(name, text));
    };
    if (!await deliver(send)) throw new Error('The answer did not reach the agent.');
  }, [answerValues, chosen, deliver, disabled, fields, host, replyAnswer, t, trimmedNote]);
  const extensionContext = React.useMemo(() => ({
    blocks: extensionBlocks,
    complete,
    answered: (name: string) => chosen.get(name) ?? notes.get(name) ?? (sent && trimmedNote ? trimmedNote : null),
    answer: answerFromFrame,
  }), [answerFromFrame, chosen, complete, extensionBlocks, notes, sent, trimmedNote]);

  const form = React.useMemo<FormState>(() => ({
    values: answerValues,
    disabled,
    chosen,
    folds: host.kind === 'reply',
    titles,
    notes,
    setValue: (name, value) => setValues((previous) => ({ ...previous, [name]: value })),
    setNote: (decision, text) => setNotes((previous) => new Map(previous).set(decision, text)),
    answerWithNote: (decision) => {
      if (disabled) return;
      const next = new Map(chosen).set(decision, null);
      setChosen(next);
      if (decisions.every((item) => next.has(item))) sendReply(next);
    },
    reopen: (decision) => {
      if (disabled) return;
      const next = new Map(chosen);
      next.delete(decision);
      setChosen(next);
    },
    press: (button, value) => {
      if (disabled) return;
      const decision = value ?? '';
      if (host.kind === 'page') {
        if (!host.submit) return;
        const { submit } = host;
        const trimmedNote = note.trim();
        const data: UiBlockAnswerData = { button, values: answerValues };
        if (value) data.value = value;
        if (trimmedNote) data.note = trimmedNote;
        setChosen(new Map([[decision, button]]));
        void deliver(() => submit({ summary: describeUiBlockAnswer(fields, data, t('chat.uiBlock.note.label'), pageAnswerNamesButton(decisions.length, fields.length)), data }));
        return;
      }
      const next = new Map(chosen);
      if (next.get(decision) === button) next.delete(decision);
      else next.set(decision, button);
      setChosen(next);
      if (decisions.every((item) => next.has(item))) sendReply(next);
    },
  }), [answerValues, disabled, chosen, titles, notes, host, fields, decisions, deliver, sendReply, note, t]);
  const savedFrameNote = frameName ? notes.get(frameName) ?? '' : '';
  const shownNote = note || savedFrameNote;
  const showNote = (host.kind === 'page' || frameName !== null) && Boolean(host.submit || shownNote);
  const slotPlace = React.useMemo(() => (root && showNote ? noteSlot(root) : null), [root, showNote]);
  const noteElement = !showNote ? null : noteOpen || savedFrameNote ? (
    <ShortTextarea
      value={shownNote}
      placeholder={t('chat.uiBlock.note.placeholder')}
      aria-label={t('chat.uiBlock.note.label')}
      disabled={disabled}
      onChange={(event) => setNote(event.target.value)}
      rows={2}
      autoFocus={!sent}
      maxLength={4000}
    />
  ) : !disabled ? <NoteToggle onOpen={() => setNoteOpen(true)} /> : null;
  const slot = slotPlace && noteElement ? { ...slotPlace, element: noteElement } : null;
  const canSendChosen = host.kind === 'reply' && !sent && chosen.size > 0 && (chosen.size < decisions.length || failed);
  const sendButton = host.kind === 'page' && complete && decisions.length === 0 && (!frameName || (trimmedNote !== '' && !chosen.has(frameName))) && Boolean(host.submit || sent)
    ? { label: host.answered?.button ?? t('chat.uiBlock.send'), variant: 'primary' }
    : null;
  const replyForm = host.kind === 'reply' && complete && decisions.length === 0 && fields.length > 0 && Boolean(host.submit || sent);
  const hasValue = Object.values(answerValues).some((value) => (Array.isArray(value) ? value.length > 0 : value.trim() !== ''));
  const fallback = <NotDrawn source={source} errors={notDrawnErrors ?? []} />;
  const rootChildren = blockProps.Stack.safeParse(blockNode.safeParse(root).data?.props).data?.children ?? [];
  const endsWithTabs = blockNode.safeParse(rootChildren.at(-1)).data?.typeName === 'Tabs';
  const sendInTabs = sendButton !== null && !frameName && endsWithTabs;
  const sendBelow = sendInTabs ? null : sendButton;
  const waitingForm = host.kind === 'page' && Boolean(host.submit || sent)
    ? {
        endPath: sendInTabs ? blockPath('', rootChildren.length - 1) : null,
        end: sendInTabs ? <div className="flex flex-col gap-2">{noteElement}<Button props={sendButton} /></div> : null,
      }
    : null;
  if (parsed.kind === 'invalid') return fallback;
  if (parsed.kind === 'empty') return null;
  return (
    <div ref={blockRef} data-oc-ui-block="" className="oc-ui-block my-3">
      <BlockErrorBoundary source={source} fallback={fallback} onFailed={onNotDrawn}>
        <FormContext.Provider value={form}>
          <SlotContext.Provider value={slot}>
            <ExtensionBlocksContext.Provider value={extensionContext}>
              <WaitingFormContext.Provider value={waitingForm}>
                <Node value={parsed.root} />
              </WaitingFormContext.Provider>
            </ExtensionBlocksContext.Provider>
          </SlotContext.Provider>
        </FormContext.Provider>
      </BlockErrorBoundary>
      <BlockIssues root={parsed.root} />
      {showNote && !slot && noteElement && !sendInTabs ? <div className="mt-2">{noteElement}</div> : null}
      {sendBelow || actions ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {sendBelow ? (
            <FormContext.Provider value={form}>
              <Button props={sendBelow} />
            </FormContext.Provider>
          ) : null}
          {actions ? <fieldset disabled={disabled} className="contents">{actions}</fieldset> : null}
        </div>
      ) : null}
      {replyForm && !sent ? (
        <div className="mt-2">
          <UiButton type="button" className="w-fit" disabled={disabled || (!hasValue && !(frameName && trimmedNote))} onClick={() => sendReply(chosen)}>
            {t('chat.uiBlock.send')}
          </UiButton>
        </div>
      ) : null}
      {host.kind === 'reply' && frameName && trimmedNote && !sent && !replyForm ? (
        <div className="mt-2">
          <UiButton type="button" className="w-fit" disabled={disabled} onClick={() => sendReply(chosen)}>{t('chat.uiBlock.send')}</UiButton>
        </div>
      ) : null}
      {replyForm || ((decisions.length > 0 || frameName) && host.kind === 'reply' && (host.submit || sent)) ? (
        <div className="mt-1 flex min-h-6 items-center gap-2 typography-meta text-muted-foreground" aria-live="polite" data-export-ignore>
          {failed && (!replyForm || hasValue || frameName) ? <span className="text-[var(--status-error)]">{t('chat.uiBlock.sendFailed')}</span>
            : sent ? <span>{t('chat.uiBlock.sent')}</span>
              : chosen.size > 0 && decisions.length > 1
                ? <span>{t('chat.uiBlock.chosenCount', { count: chosen.size, total: decisions.length })}</span>
                : null}
          {canSendChosen ? (
            <UiButton type="button" variant="ghost" size="xs" className="text-foreground/80 hover:bg-transparent hover:text-foreground" disabled={disabled} onClick={() => sendReply(chosen)}>
              {t('chat.uiBlock.sendChosen')}
            </UiButton>
          ) : null}
        </div>
      ) : null}
      {parsed.dropped.length > 0 ? <div className="mt-2"><NotDrawn source={source} errors={parsed.dropped} partial /></div> : null}
    </div>
  );
}
