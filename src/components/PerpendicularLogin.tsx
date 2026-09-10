"use client";

import { useState } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");

type LoginResponse = {
  message?: string;
  requiresMfa?: boolean;
  mfaToken?: string;
  types?: string[];
};

export default function PerpendicularLogin({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaType, setMfaType] = useState<"totp" | "backup">("totp");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = mfaToken ? "/api/auth/mfa" : "/api/auth/login";
      const payload = mfaToken ? { mfaToken, code, type: mfaType } : { email, password };
      const response = await fetch(`${apiBase}${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({})) as LoginResponse;
      if (!response.ok) throw new Error(data.message || "Sign-in failed. Check your details and try again.");
      if (data.requiresMfa && data.mfaToken) {
        setMfaToken(data.mfaToken);
        setCode("");
        return;
      }
      window.location.assign(next);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-shell"><div className="auth-orbit auth-orbit-one" /><div className="auth-orbit auth-orbit-two" /><div className="auth-frame"><div className="auth-brand"><span className="brand-mark" /><span>perpendicular<span className="brand-meta">open work system</span></span></div><section className="auth-card"><div className="eyebrow">Workspace access</div><h1>Sign in to Perpendicular</h1><p className="auth-intro">Your employees, knowledge, and work traces are waiting on the Dell.</p><a className="button-secondary auth-submit" href={`${apiBase}/api/auth/google/start?next=${encodeURIComponent(next)}`}>Continue with Google <ArrowUpRight size={14} /></a><div className="auth-divider"><span>or use your workspace account</span></div><form onSubmit={submit} className="auth-form">{mfaToken ? <><div className="auth-step"><span className="auth-step-number">2</span><div><strong>Verify your identity</strong><span>Enter the code from your authenticator app or use a backup code.</span></div></div><div className="field"><label htmlFor="mfa-code">Security code</label><input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(event) => setCode(event.target.value)} placeholder={mfaType === "totp" ? "000000" : "XXXX-XXXX"} /></div><div className="auth-methods"><button type="button" className={mfaType === "totp" ? "auth-method active" : "auth-method"} onClick={() => setMfaType("totp")}>Authenticator</button><button type="button" className={mfaType === "backup" ? "auth-method active" : "auth-method"} onClick={() => setMfaType("backup")}>Backup code</button></div></> : <><div className="auth-step"><span className="auth-step-number">1</span><div><strong>Use your workspace account</strong><span>Sign in securely without leaving Perpendicular.</span></div></div><div className="field"><label htmlFor="login-email">Email</label><input id="login-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></div><div className="field"><label htmlFor="login-password">Password</label><input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" /></div></>}{error ? <div className="auth-error" role="alert">{error}</div> : null}<button type="submit" className="button-primary auth-submit" disabled={busy}>{busy ? "Checking…" : mfaToken ? "Verify and continue" : "Sign in"}<ArrowUpRight size={14} /></button>{mfaToken ? <button type="button" className="button-quiet auth-back" onClick={() => { setMfaToken(null); setCode(""); setError(null); }}>Use a different account</button> : null}</form><div className="auth-trust"><ShieldCheck size={15} /><span>Session is encrypted, HttpOnly, and scoped to your Perpendicular workspace.</span></div></section><p className="auth-footer">Open source infrastructure · Dell runtime · Postgres persistence</p></div></main>;
}
