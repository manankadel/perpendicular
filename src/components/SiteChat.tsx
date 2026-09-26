"use client";

import { useState } from "react";

export default function SiteChat({ slug, workspaceId, agentName, greeting }: { slug: string; workspaceId: string; agentName: string; greeting: string }) {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState(greeting);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/site/${encodeURIComponent(slug)}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, message: text }) });
      const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "The inbound agent could not respond.");
      setReply(body.message || "The agent returned no message.");
      setMessage("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The inbound agent could not respond.");
    } finally {
      setBusy(false);
    }
  };
  return <section className="public-site-chat"><div className="public-site-chat-header"><strong>{agentName}</strong><span>grounded operator</span></div><div className="public-site-reply">{reply}</div><form onSubmit={send}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask a question…" aria-label="Ask the inbound agent" /><button className="button-primary" disabled={busy || !message.trim()}>{busy ? "Thinking…" : "Ask"}</button></form>{error ? <div className="public-site-error" role="alert">{error}</div> : null}</section>;
}
