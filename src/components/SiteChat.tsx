"use client";

import { useState } from "react";

export default function SiteChat({ slug, workspaceId, agentName, greeting, initialAttribution }: { slug: string; workspaceId: string; agentName: string; greeting: string; initialAttribution?: Record<string, string> }) {
  const [message, setMessage] = useState("");
  const [sessionId, setSessionId] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem(`perpendicular-site-session:${slug}`) || "");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([{ role: "assistant", content: greeting }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/site/${encodeURIComponent(slug)}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, message: text, sessionId: sessionId || undefined, attribution: initialAttribution }) });
      const body = await response.json().catch(() => ({})) as { message?: string; sessionId?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "The inbound agent could not respond.");
      const nextSessionId = body.sessionId || sessionId;
      setSessionId(nextSessionId);
      if (nextSessionId) window.sessionStorage.setItem(`perpendicular-site-session:${slug}`, nextSessionId);
      setMessages((current) => [...current, { role: "user", content: text }, { role: "assistant", content: body.message || "The agent returned no message." }]);
      setMessage("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The inbound agent could not respond.");
    } finally {
      setBusy(false);
    }
  };
  return <section className="public-site-chat"><div className="public-site-chat-header"><strong>{agentName}</strong><span>grounded operator</span></div><div className="public-site-reply" aria-live="polite">{messages.map((entry, index) => <div className={entry.role === "assistant" ? "public-site-message" : "public-site-message visitor"} key={`${entry.role}-${index}`}><span>{entry.role === "assistant" ? agentName : "You"}</span>{entry.content}</div>)}</div><form onSubmit={send}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask a question…" aria-label="Ask the inbound agent" /><button className="button-primary" disabled={busy || !message.trim()}>{busy ? "Thinking…" : "Ask"}</button></form>{error ? <div className="public-site-error" role="alert">{error}</div> : null}</section>;
}
