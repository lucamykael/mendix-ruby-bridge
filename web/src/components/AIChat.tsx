import { useEffect, useRef, useState } from "react";

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

async function callAnthropic(apiKey: string, model: string, messages: Message[]): Promise<string> {
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

async function callOpenAI(apiKey: string, model: string, messages: Message[]): Promise<string> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `OpenAI error ${r.status}`);
  }
  const body = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return body.choices[0]?.message?.content ?? "";
}

export default function AIChat() {
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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const switchProvider = (p: Provider) => {
    setProvider(p);
    localStorage.setItem("mrb-chat-provider", p);
    const savedModel = localStorage.getItem(`mrb-chat-model-${p}`) ?? PROVIDERS[p].defaultModel;
    setModel(savedModel);
    const savedKey = localStorage.getItem(`mrb-apikey-${p}`) ?? "";
    setApiKey(savedKey);
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
    const userMsg: Message = { role: "user", content: input.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setSending(true);
    setError(undefined);
    try {
      const reply =
        provider === "anthropic"
          ? await callAnthropic(apiKey, model, next)
          : await callOpenAI(apiKey, model, next);
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
      </div>

      <div className="ai-messages">
        {messages.length === 0 && (
          <p className="ai-empty">Ask anything about your Mendix project.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg-${m.role}`}>
            <span className="ai-msg-role">{m.role === "user" ? "You" : cfg.label.split(" ")[0]}</span>
            <pre className="ai-msg-body">{m.content}</pre>
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
          placeholder={apiKey ? "Ask a question…" : "Enter API key above first"}
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
