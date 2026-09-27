"use client";

import { useEffect, useMemo, useState } from "react";

type BookingSlot = { startAt: string; endAt: string };
type BookingPageData = { title: string; description: string; durationMinutes: number; timezone: string; bookingWindowDays: number; slots: BookingSlot[] };
type BookingResult = { id: string; name: string; email: string; startAt: string; endAt: string; timezone: string; confirmationToken: string };

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || (process.env.NODE_ENV === "production" ? "https://perpendicular-api.bluebloodstudio.com" : "")).replace(/\/$/, "");

function formatSlot(slot: BookingSlot, timezone: string) {
  const date = new Date(slot.startAt);
  return {
    day: new Intl.DateTimeFormat([], { timeZone: timezone, weekday: "long", month: "short", day: "numeric" }).format(date),
    time: new Intl.DateTimeFormat([], { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(date),
  };
}

function calendarUrl(slug: string, token: string) {
  return `${apiBase}/api/book/${encodeURIComponent(slug)}/calendar?token=${encodeURIComponent(token)}`;
}

export default function BookingPage({ slug }: { slug: string }) {
  const [page, setPage] = useState<BookingPageData | null>(null);
  const [selectedStart, setSelectedStart] = useState("");
  const [form, setForm] = useState({ name: "", email: "", company: "", notes: "" });
  const [result, setResult] = useState<BookingResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const endpoint = useMemo(() => `${apiBase}/api/book/${encodeURIComponent(slug)}`, [slug]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as BookingPageData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "This booking page is unavailable.");
      setPage(payload);
      setSelectedStart(payload.slots[0]?.startAt || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This booking page is unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as BookingPageData & { error?: string };
        if (!response.ok) throw new Error(payload.error || "This booking page is unavailable.");
        if (!active) return;
        setPage(payload);
        setSelectedStart(payload.slots[0]?.startAt || "");
        setError(null);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "This booking page is unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [endpoint]);

  const groupedSlots = useMemo(() => {
    if (!page) return [] as Array<[string, BookingSlot[]]>;
    const groups = new Map<string, BookingSlot[]>();
    for (const slot of page.slots) {
      const label = formatSlot(slot, page.timezone).day;
      groups.set(label, [...(groups.get(label) || []), slot]);
    }
    return [...groups.entries()];
  }, [page]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedStart || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, startAt: selectedStart }) });
      const payload = await response.json().catch(() => ({})) as { booking?: BookingResult; error?: string };
      if (!response.ok || !payload.booking) throw new Error(payload.error || "The booking could not be created.");
      setResult(payload.booking);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The booking could not be created.");
      if (String(reason).toLowerCase().includes("booked")) void load();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!result || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmationToken: result.confirmationToken }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "The booking could not be cancelled.");
      setCancelled(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The booking could not be cancelled.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main className="booking-page"><section className="booking-card"><div className="eyebrow">Perpendicular</div><p className="booking-muted">Loading available times…</p></section></main>;
  if (error && !page) return <main className="booking-page"><section className="booking-card"><div className="eyebrow">Perpendicular</div><h1>Booking unavailable</h1><p className="booking-muted">{error}</p></section></main>;
  if (result) return <main className="booking-page"><section className="booking-card"><div className="eyebrow">Perpendicular · confirmed</div><h1>{cancelled ? "Booking cancelled" : "You’re booked."}</h1><p className="booking-muted">{cancelled ? "The time has been released for someone else." : `Your conversation is scheduled for ${new Intl.DateTimeFormat([], { dateStyle: "full", timeStyle: "short", timeZone: result.timezone }).format(new Date(result.startAt))}.`}</p>{!cancelled ? <div className="booking-confirmation"><div><span>Name</span><strong>{result.name}</strong></div><div><span>Email</span><strong>{result.email}</strong></div><div><span>Duration</span><strong>{page?.durationMinutes} minutes · {result.timezone}</strong></div></div> : null}<div className="booking-actions">{!cancelled ? <a className="button-primary" href={calendarUrl(slug, result.confirmationToken)}>Add to calendar</a> : null}{!cancelled ? <button className="button-secondary" onClick={() => void cancel()} disabled={busy}>Cancel booking</button> : null}</div>{error ? <div className="booking-error" role="alert">{error}</div> : null}</section></main>;
  return <main className="booking-page"><section className="booking-card"><div className="eyebrow">Perpendicular · open source scheduling</div><h1>{page?.title || "Book a conversation"}</h1><p className="booking-muted">{page?.description}</p><div className="booking-meta">{page?.durationMinutes} minutes · {page?.timezone} · available for the next {page?.bookingWindowDays} days</div><form className="booking-form" onSubmit={submit}><div className="booking-slots"><div className="booking-section-label">Choose a time</div>{groupedSlots.length ? groupedSlots.map(([day, slots]) => <div className="booking-day" key={day}><strong>{day}</strong><div className="booking-slot-grid">{slots.map((slot) => { const label = formatSlot(slot, page?.timezone || "UTC"); return <label className={`booking-slot ${selectedStart === slot.startAt ? "selected" : ""}`} key={slot.startAt}><input type="radio" name="startAt" value={slot.startAt} checked={selectedStart === slot.startAt} onChange={() => setSelectedStart(slot.startAt)} /><span>{label.time}</span></label>; })}</div></div>) : <div className="booking-empty">No times are available right now. Check back after the workspace adds an operator or changes its hours.</div>}</div><div className="booking-fields"><div className="field"><label htmlFor="booking-name">Name</label><input id="booking-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div><div className="field"><label htmlFor="booking-email">Email</label><input id="booking-email" required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div><div className="field"><label htmlFor="booking-company">Company <span>optional</span></label><input id="booking-company" value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} /></div><div className="field"><label htmlFor="booking-notes">What should we cover? <span>optional</span></label><textarea id="booking-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div></div><button className="button-primary" type="submit" disabled={busy || !selectedStart || !page?.slots.length}>{busy ? "Booking…" : "Confirm time"}</button></form>{error ? <div className="booking-error" role="alert">{error}</div> : null}<p className="booking-footnote">Your details stay in the workspace database. No external calendar or email provider is required.</p></section></main>;
}
