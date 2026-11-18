import React from 'react';
import { client, info } from './lib/client';
import { GUIDANCE_PREFIX } from './lib/guidance';
import { Markdown } from './lib/markdown';
import { parseBlock, splitBlocks } from './blocks/catalog';
import { Node } from './blocks/render';

type Msg = { id: string; role: 'user' | 'assistant'; text: string; tools?: string[] };
type Model = { key: string; name: string; providerID: string; id: string };


const DEMO_PROGRAM = `root = Stack([intro, flow, chart])
intro = Card("How a request flows", [Text("The browser asks the server, the server asks the agent, and the agent writes the session to **SQLite**. Each hop adds latency, so the slowest hop sets the floor.")])
flow = Card("Shape of the path", [Diagram([{id: "b", label: "Browser", x: 16, y: 30, tone: "info"}, {id: "s", label: "Server", x: 50, y: 30}, {id: "a", label: "Agent", x: 50, y: 72}, {id: "d", label: "SQLite", x: 84, y: 72, tone: "success"}], [{from: "b", to: "s", label: "SSE"}, {from: "s", to: "a", label: "prompt"}, {from: "a", to: "d", label: "write"}], 220)])
chart = Card("Where the time goes", [ColumnChart(["browser", "server", "agent", "sqlite"], [Series("p50", [4, 6, 9, 3]), Series("p95", [9, 14, 22, 8])], "ms", false, "hop", "time")])
`;

function Demo() {
  const source = 'A short walkthrough of a request.\n\n```openui-lang\n' + DEMO_PROGRAM + '```\n\nEach hop is measured in milliseconds.';
  return (
    <div className="app">
      <header className="topbar"><div className="brand">niceui</div><span className="muted">block demo</span></header>
      <main className="transcript"><article className="msg msg-assistant"><div className="reply"><Reply text={source} /></div></article></main>
    </div>
  );
}

const SESSION_KEY = 'niceui.session';
const MODEL_KEY = 'niceui.model';
const readModel = (): { providerID: string; id: string } | null => {
  try {
    const value = JSON.parse(localStorage.getItem(MODEL_KEY) ?? 'null');
    return value && typeof value.providerID === 'string' && typeof value.id === 'string' ? value : null;
  } catch {
    return null;
  }
};
const stripGuidance = (text: string) => (text.startsWith(GUIDANCE_PREFIX) ? text.slice(GUIDANCE_PREFIX.length) : text);

function Block({ source }: { source: string }) {
  const parsed = React.useMemo(() => parseBlock(source), [source]);
  if (parsed.kind === 'ready') return <div className="ui-block"><Node value={parsed.root} /></div>;
  if (parsed.kind === 'invalid') {
    return (
      <details className="block-error">
        <summary>This block could not be drawn</summary>
        <pre>{source}</pre>
      </details>
    );
  }
  return null;
}

function Reply({ text }: { text: string }) {
  const parts = React.useMemo(() => splitBlocks(text), [text]);
  return (
    <>
      {parts.map((part, index) => ('block' in part
        ? <Block key={index} source={part.block} />
        : <Markdown key={index} text={part.text} />))}
    </>
  );
}

export function App() {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo")) return <Demo />;
  const [sessionID, setSessionID] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [live, setLive] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [activity, setActivity] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [models, setModels] = React.useState<Model[]>([]);
  const [modelKey, setModelKey] = React.useState('');
  const [directory, setDirectory] = React.useState('');
  const [teach, setTeach] = React.useState(() => localStorage.getItem('niceui.teach') !== 'off');
  const guided = React.useRef(new Set<string>());
  const liveText = React.useRef('');
  const bottom = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async (id: string) => {
    const list = await client.session.context({ sessionID: id });
    const next: Msg[] = [];
    for (const message of list as any[]) {
      if (message.type === 'user') {
        next.push({ id: message.id, role: 'user', text: stripGuidance(message.text ?? '') });
      } else if (message.type === 'assistant') {
        const content: any[] = message.content ?? [];
        const text = content.filter((part) => part.type === 'text').map((part) => part.text).join('\n\n');
        const tools = content.filter((part) => part.type === 'tool').map((part) => part.name);
        if (text || tools.length) next.push({ id: message.id, role: 'assistant', text, tools });
      }
    }
    setMessages(next);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { directory } = await info();
        const sessionKey = `${SESSION_KEY}:${directory}`;
        setDirectory(directory);
        const stored = readModel();
        let id = localStorage.getItem(sessionKey);
        if (id) {
          try {
            await client.session.get({ sessionID: id });
          } catch {
            id = null;
          }
        }
        if (!id) {
          const created = await client.session.create({
            location: { directory },
            ...(stored ? { model: stored } : {}),
          });
          id = created.id;
          localStorage.setItem(sessionKey, id);
        }
        if (cancelled) return;
        setSessionID(id);
        const session = await client.session.get({ sessionID: id });
        const model = (session as any).model ?? stored;
        if (model) setModelKey(`${model.providerID}/${model.id}`);
        await load(id);

        const catalog = await client.model.list().catch(() => null);
        if (catalog) {
          setModels(catalog.data.map((m) => ({ key: `${m.providerID}/${m.modelID}`, name: m.name, providerID: m.providerID, id: m.modelID })));
          if (!model) {
            const fallback = await client.model.default({ location: { directory } }).catch(() => null);
            if (fallback?.data) {
              const choice = { providerID: fallback.data.providerID, id: fallback.data.modelID };
              setModelKey(`${choice.providerID}/${choice.id}`);
              localStorage.setItem(MODEL_KEY, JSON.stringify(choice));
            }
          }
        }

        (async () => {
          for await (const event of client.event.subscribe()) {
            if (cancelled) return;
            const data = (event as any).data;
            if (!data || data.sessionID !== id) continue;
            switch ((event as any).type) {
              case 'session.text.started':
                liveText.current = '';
                setLive('');
                break;
              case 'session.text.delta':
                liveText.current += data.delta ?? '';
                setLive(liveText.current);
                break;
              case 'session.tool.called':
                setActivity(data.name ? `${data.name}…` : 'Working…');
                break;
              case 'session.tool.success':
              case 'session.tool.failed':
                setActivity(null);
                break;
              case 'session.idle':
                liveText.current = '';
                setLive('');
                setBusy(false);
                setActivity(null);
                await load(id);
                break;
            }
          }
        })().catch((cause) => setError(String(cause)));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  React.useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, live, activity]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !sessionID || busy) return;
    setDraft('');
    setBusy(true);
    setError(null);
    liveText.current = '';
    setLive('');
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: 'user', text }]);
    const guidedBefore = guided.current.has(sessionID);
    try {
      const chosen = models.find((item) => item.key === modelKey);
      if (chosen) {
        await client.session.switchModel({ sessionID, model: { providerID: chosen.providerID, id: chosen.id } });
      }
      await client.session.prompt({ sessionID, text: teach && !guidedBefore ? `${GUIDANCE_PREFIX}${text}` : text });
      if (teach) guided.current.add(sessionID);
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const stop = async () => {
    if (!sessionID) return;
    try {
      await client.session.interrupt({ sessionID });
    } catch {
      // nothing is running
    }
    liveText.current = '';
    setLive('');
    setBusy(false);
    setActivity(null);
    await load(sessionID).catch(() => undefined);
  };

  const newChat = async () => {
    try {
      const current = sessionID;
      if (current) {
        const chosen = models.find((item) => item.key === modelKey);
        const created = await client.session.create({
          location: directory ? { directory } : undefined,
          ...(chosen ? { model: { providerID: chosen.providerID, id: chosen.id } } : {}),
        });
        localStorage.setItem(`${SESSION_KEY}:${directory}`, created.id);
        setSessionID(created.id);
        setMessages([]);
        setLive('');
        setBusy(false);
        liveText.current = '';
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const changeModel = async (key: string) => {
    setModelKey(key);
    const model = models.find((item) => item.key === key);
    if (!model) return;
    localStorage.setItem(MODEL_KEY, JSON.stringify({ providerID: model.providerID, id: model.id }));
    if (!sessionID) return;
    try {
      await client.session.switchModel({ sessionID, model: { providerID: model.providerID, id: model.id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">niceui</div>
        <div className="topbar-actions">
          {models.length > 0 ? (
            <select className="model" value={modelKey} onChange={(event) => void changeModel(event.target.value)} aria-label="Model">
              {models.map((model) => <option key={model.key} value={model.key}>{model.name}</option>)}
            </select>
          ) : <span className="model muted">{modelKey || 'loading model…'}</span>}
          <button
            className={teach ? 'ghost on' : 'ghost'}
            aria-pressed={teach}
            title={teach ? 'Teaching answers: explain simply, draw when it helps' : 'Plain answers'}
            onClick={() => {
              const next = !teach;
              setTeach(next);
              localStorage.setItem('niceui.teach', next ? 'on' : 'off');
            }}
          >
            Teach
          </button>
          <button className="ghost" onClick={() => void newChat()} disabled={!sessionID}>New chat</button>
        </div>
      </header>

      <main className="transcript">
        {messages.length === 0 && !busy ? (
          <div className="empty">
            <h1>What do you want to understand?</h1>
            <p>Ask anything. Answers can include real charts, diagrams, and math.</p>
          </div>
        ) : null}

        {messages.map((message) => (
          <article key={message.id} className={`msg msg-${message.role}`}>
            {message.role === 'user'
              ? <div className="bubble">{message.text}</div>
              : (
                <div className="reply">
                  {message.tools?.length ? <div className="activity">{message.tools.join(' · ')}</div> : null}
                  {message.text ? <Reply text={message.text} /> : null}
                </div>
              )}
          </article>
        ))}

        {live ? (
          <article className="msg msg-assistant">
            <div className="reply"><Reply text={live} /><span className="caret" /></div>
          </article>
        ) : null}

        {activity ? <div className="activity">{activity}</div> : null}

        {error ? <div className="error">{error}</div> : null}
        <div ref={bottom} />
      </main>

      <footer className="composer">
        <textarea
          value={draft}
          rows={1}
          placeholder="Ask, or ask to be taught…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <button className="stop" onClick={() => void stop()}>Stop</button>
        ) : (
          <button className="send" onClick={() => void send()} disabled={!draft.trim()}>Send</button>
        )}
      </footer>
    </div>
  );
}
