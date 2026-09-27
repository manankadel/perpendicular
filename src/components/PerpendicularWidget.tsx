"use client";

import { useEffect, useMemo, useState } from "react";

type WidgetConfig = { greeting: string; employee: { id: string; name: string; title: string; avatar: string } };
type WidgetMessage = { role: "user" | "assistant"; content: string; citations?: string[] };

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");

export default function PerpendicularWidget({ workspaceId, publicKey, initialAttribution }: { workspaceId: string; publicKey: string; initialAttribution?: Record<string, string> }) {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem(`perpendicular-widget:${workspaceId}`) || "");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint = useMemo(() => `${apiBase}/api/widget/${encodeURIComponent(workspaceId)}`, [workspaceId]);

  useEffect(() => {
    fetch(`${endpoint}/config?key=${encodeURIComponent(publicKey)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as WidgetConfig & { error?: string };
        if (!response.ok) throw new Error(payload.error || "This assistant is unavailable.");
        setConfig(payload);
        setMessages([{ role: "assistant", content: payload.greeting }]);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "This assistant is unavailable."))
      .finally(() => setLoading(false));
  }, [endpoint, publicKey, workspaceId]);

  const send = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setError(null);
    setMessages((current) => [...current, { role: "user", content: message }]);
    try {
      const response = await fetch(`${endpoint}/chat`, { method: "POST", headers: { "content-type": "application/json", "x-perpendicular-widget-key": publicKey }, body: JSON.stringify({ message, sessionId, attribution: initialAttribution }) });
      const payload = await response.json().catch(() => ({})) as { message?: string; citations?: string[]; sessionId?: string; error?: string };
      if (!response.ok || !payload.message) throw new Error(payload.error || "The assistant could not respond.");
      if (payload.sessionId) {
        setSessionId(payload.sessionId);
        window.sessionStorage.setItem(`perpendicular-widget:${workspaceId}`, payload.sessionId);
      }
      setMessages((current) => [...current, { role: "assistant", content: payload.message || "", citations: payload.citations }]);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "The assistant could not respond.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main className="widget-shell widget-loading">Loading assistant…</main>;
  if (error && !config) return <main className="widget-shell widget-error">{error}</main>;
  return <main className="widget-shell">
    <header className="widget-header"><div className="widget-avatar">{config?.employee.avatar || "AI"}</div><div><strong>{config?.employee.name || "Perpendicular operator"}</strong><span>{config?.employee.title || "Workspace assistant"}</span></div><span className="widget-live-dot" /></header>
    <div className="widget-messages">{messages.map((message, index) => <div className={`widget-message ${message.role}`} key={`${message.role}-${index}`}><div>{message.content}</div>{message.citations?.length ? <small>Sources: {message.citations.join(", ")}</small> : null}</div>)}{busy ? <div className="widget-message assistant">Thinking…</div> : null}</div>
    {error ? <div className="widget-inline-error" role="alert">{error}</div> : null}
    <form className="widget-compose" onSubmit={send}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask a question…" aria-label="Ask the assistant" disabled={busy} /><button type="submit" disabled={busy || !input.trim()}>{busy ? "…" : "Send"}</button></form>
    <footer className="widget-footer">Powered by Perpendicular · grounded in workspace sources</footer>
  </main>;
}
