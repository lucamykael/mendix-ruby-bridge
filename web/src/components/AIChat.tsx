import { useEffect, useRef, useState } from "react";
import { runMdl, type MdlResult } from "../model/api";

type Provider = "anthropic" | "openai";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ProviderConfig {
  label: string;
  models: string[];
  defaultModel: string;
  keyPlaceholder: string;
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  anthropic: {
    label: "Claude (Anthropic)",
    models: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
    defaultModel: "claude-sonnet-4-6",
    keyPlaceholder: "sk-ant-…",
  },
  openai: {
    label: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    defaultModel: "gpt-4o",
    keyPlaceholder: "sk-…",
  },
};

// Teaches the model to act as a live developer: it can modify the project by
// emitting MDL in ```mdl fenced blocks, which the user validates/applies here.
function systemPrompt(context?: string): string {
  return [
    "You are an assistant embedded in a Mendix project viewer. You can inspect the project and MODIFY it live.",
    "To change the project, output MDL (Mendix Definition Language) inside a fenced code block tagged `mdl`.",
    "The user gets Validate/Apply buttons on each mdl block; Apply runs `mxcli exec` against the .mpr.",
    "MDL essentials:",
    "- CREATE MODULE Name;",
    "- CREATE ENTITY Mod.Name; / CREATE ENUMERATION Mod.Name VALUES ('A','B');",
    "- CREATE PAGE Mod.Name (Title: 'T', Layout: Atlas_Core.Atlas_Default) {}",
    "- CREATE MICROFLOW Mod.Name () BEGIN ... return; END;",
    "- ALTER PAGE Mod.Name { SET (Prop = value) ON widget; INSERT AFTER widget { ... }; DROP WIDGET name; REPLACE widget WITH { ... }; };",
    "- Widget props inside CREATE/INSERT/REPLACE use colon syntax: dynamictext t (Content: 'Hi', RenderMode: H1)",
    "- Read-only queries: OQL against the running app, SQL against the DB.",
    "Keep each mdl block a single coherent change. Explain briefly, then give the block. Only emit MDL when the user asks to change something.",
    context ? `\nProject context:\n${context}` : "",
  ].join("\n");
}

async function callAnthropic(apiKey: string, model: string, system: string, messages: Message[]): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-allow-browser": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Anthropic error ${r.status}`);
  }
  const body = (await r.json()) as { content: Array<{ text: string }> };
  return body.content.map((c) => c.text).join("");
}

async function callOpenAI(apiKey: string, model: string, system: string, messages: Message[]): Promise<string> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
    }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `OpenAI error ${r.status}`);
  }
  const body = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return body.choices[0]?.message?.content ?? "";
}

// Split a message into plain-text and executable MDL segments.
type Segment = { type: "text"; text: string } | { type: "mdl"; code: string };
function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const re = /```mdl\s*\n([\s\S]*?)```/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m.index > last) segments.push({ type: "text", text: content.slice(last, m.index) });
    segments.push({ type: "mdl", code: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < content.length) segments.push({ type: "text", text: content.slice(last) });
  return segments;
}

function MdlBlock({ code, studioClosed }: { code: string; studioClosed: boolean }) {
  const [result, setResult] = useState<MdlResult>();
  const [busy, setBusy] = useState(false);

  const run = async (apply: boolean) => {
    setBusy(true);
    setResult(await runMdl(code, apply, studioClosed));
    setBusy(false);
  };

  return (
    <div className="ai-mdl">
      <pre className="ai-mdl-code">{code}</pre>
      <div className="ai-mdl-actions">
        <button disabled={busy} onClick={() => void run(false)}>Validate</button>
        <button className="ai-mdl-apply" disabled={busy} onClick={() => void run(true)}>▶ Apply</button>
        {result && (
          <span className={result.ok ? "ai-mdl-ok" : "ai-mdl-err"}>
            {result.applied ? "✓ applied · " : result.ok ? "✓ valid · " : "✕ "}
            {result.message}
          </span>
        )}
      </div>
    </div>
  );
}

export default function AIChat({ context }: { context?: string }) {
  const [provider, setProvider] = useState<Provider>(
    () => (localStorage.getItem("mrb-chat-provider") as Provider | null) ?? "anthropic",
  );
  const [model, setModel] = useState<string>(
    () => localStorage.getItem(`mrb-chat-model-${provider}`) ?? PROVIDERS[provider].defaultModel,
  );
  const [apiKey, setApiKey] = useState<string>(
    () => localStorage.getItem(`mrb-apikey-${provider}`) ?? "",
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [showKey, setShowKey] = useState(false);
  const [studioClosed, setStudioClosed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const switchProvider = (p: Provider) => {
    setProvider(p);
    localStorage.setItem("mrb-chat-provider", p);
    setModel(localStorage.getItem(`mrb-chat-model-${p}`) ?? PROVIDERS[p].defaultModel);
    setApiKey(localStorage.getItem(`mrb-apikey-${p}`) ?? "");
  };

  const saveKey = (k: string) => {
    setApiKey(k);
    localStorage.setItem(`mrb-apikey-${provider}`, k);
  };

  const saveModel = (m: string) => {
    setModel(m);
    localStorage.setItem(`mrb-chat-model-${provider}`, m);
  };

  const send = async () => {
    if (!input.trim() || !apiKey.trim() || sending) return;
    const next = [...messages, { role: "user", content: input.trim() } as Message];
    setMessages(next);
    setInput("");
    setSending(true);
    setError(undefined);
    try {
      const system = systemPrompt(context);
      const reply =
        provider === "anthropic"
          ? await callAnthropic(apiKey, model, system, next)
          : await callOpenAI(apiKey, model, system, next);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSending(false);
    }
  };

  const cfg = PROVIDERS[provider];

  return (
    <div className="ai-chat">
      <div className="ai-chat-config">
        <div className="ai-row">
          <select value={provider} onChange={(e) => switchProvider(e.target.value as Provider)}>
            {(Object.entries(PROVIDERS) as [Provider, ProviderConfig][]).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <select value={model} onChange={(e) => saveModel(e.target.value)}>
            {cfg.models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="ai-key-row">
          <input
            type={showKey ? "text" : "password"}
            placeholder={cfg.keyPlaceholder}
            value={apiKey}
            onChange={(e) => saveKey(e.target.value)}
          />
          <button className="ai-key-toggle" onClick={() => setShowKey((v) => !v)} title={showKey ? "Hide" : "Show"}>
            {showKey ? "◎" : "●"}
          </button>
        </div>
        <label className="ai-studio-closed" title="Applying MDL writes to the .mpr, which Studio Pro locks while open">
          <input type="checkbox" checked={studioClosed} onChange={(e) => setStudioClosed(e.target.checked)} />
          Studio Pro is closed (required to Apply)
        </label>
      </div>

      <div className="ai-messages">
        {messages.length === 0 && (
          <p className="ai-empty">Ask about your project — or ask me to change it. I can create modules, pages, microflows, alter pages, and more; you Validate/Apply each change.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg-${m.role}`}>
            <span className="ai-msg-role">{m.role === "user" ? "You" : cfg.label.split(" ")[0]}</span>
            {m.role === "assistant" ? (
              <div className="ai-msg-body">
                {parseSegments(m.content).map((seg, j) =>
                  seg.type === "text"
                    ? seg.text.trim() && <p key={j} className="ai-text">{seg.text.trim()}</p>
                    : <MdlBlock key={j} code={seg.code} studioClosed={studioClosed} />,
                )}
              </div>
            ) : (
              <pre className="ai-msg-body">{m.content}</pre>
            )}
          </div>
        ))}
        {sending && (
          <div className="ai-msg ai-msg-assistant">
            <span className="ai-msg-role">{cfg.label.split(" ")[0]}</span>
            <span className="ai-thinking">Thinking…</span>
          </div>
        )}
        {error && <div className="ai-error">{error}</div>}
        <div ref={bottomRef} />
      </div>

      <div className="ai-input-row">
        <textarea
          className="ai-input"
          placeholder={apiKey ? "Ask a question or request a change…" : "Enter API key above first"}
          value={input}
          disabled={!apiKey.trim() || sending}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="ai-send w-btn" disabled={!apiKey.trim() || !input.trim() || sending} onClick={() => void send()}>
          {sending ? "…" : "Send"}
        </button>
      </div>
      {messages.length > 0 && (
        <button className="ai-clear" onClick={() => { setMessages([]); setError(undefined); }}>
          Clear conversation
        </button>
      )}
    </div>
  );
}
