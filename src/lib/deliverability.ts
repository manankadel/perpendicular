import { resolveMx, resolveTxt } from "node:dns/promises";

export type DeliverabilityStatus = "pass" | "warning" | "missing" | "error";

export type DeliverabilityCheck = {
  id: string;
  domain: string;
  dkimSelector: string | null;
  checkedAt: string;
  mx: { status: DeliverabilityStatus; detail: string; values: string[] };
  spf: { status: DeliverabilityStatus; detail: string; values: string[] };
  dmarc: { status: DeliverabilityStatus; detail: string; values: string[] };
  dkim: { status: DeliverabilityStatus; detail: string; values: string[] };
};

const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function normalizeDeliverabilityDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
}

function statusForTxt(values: string[], prefix: string, label: string) {
  const matches = values.filter((value) => value.toLowerCase().startsWith(prefix.toLowerCase()));
  if (matches.length) return { status: "pass" as const, detail: `${label} record found.`, values: matches.slice(0, 4) };
  return { status: "missing" as const, detail: `No ${label} record was found.`, values: [] };
}

async function withTimeout<T>(promise: Promise<T>, fallback: T) {
  return await Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), 4000)),
  ]);
}

export async function checkDomainDeliverability(input: { domain: string; dkimSelector?: string | null; id: string; now?: string }): Promise<DeliverabilityCheck> {
  const domain = normalizeDeliverabilityDomain(input.domain);
  if (!domainPattern.test(domain)) throw new Error("Enter a valid domain such as example.com.");
  const dkimSelector = input.dkimSelector?.trim().replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80) || null;
  const [mxRecords, rootTxt, dmarcTxt, dkimTxt] = await Promise.all([
    withTimeout(resolveMx(domain), []),
    withTimeout(resolveTxt(domain), []),
    withTimeout(resolveTxt(`_dmarc.${domain}`), []),
    dkimSelector ? withTimeout(resolveTxt(`${dkimSelector}._domainkey.${domain}`), []) : Promise.resolve([] as string[][]),
  ]);
  const txt = rootTxt.flat();
  const mxValues = mxRecords.map((record) => `${record.exchange} (${record.priority})`).slice(0, 10);
  const mx = mxValues.length
    ? { status: "pass" as const, detail: "Mail exchanger records found.", values: mxValues }
    : { status: "missing" as const, detail: "No MX record was found; mailbox delivery may fail.", values: [] };
  const spf = statusForTxt(txt, "v=spf1", "SPF");
  const dmarc = statusForTxt(dmarcTxt.flat(), "v=dmarc1", "DMARC");
  const dkim = dkimSelector
    ? statusForTxt(dkimTxt.flat(), "v=dkim1", "DKIM")
    : { status: "warning" as const, detail: "Add the selector published by your mailbox provider to verify DKIM.", values: [] };
  return { id: input.id, domain, dkimSelector, checkedAt: input.now || new Date().toISOString(), mx, spf, dmarc, dkim };
}

export function looksLikeBounce(input: { from: string; subject: string; bodyText: string }) {
  const sender = input.from.toLowerCase();
  const text = `${input.subject}\n${input.bodyText}`.toLowerCase();
  return /mailer-daemon|postmaster/.test(sender) || /delivery status notification|delivery failed|undeliverable|mail delivery subsystem|returned mail/.test(text);
}

export function bouncedAddresses(input: { subject: string; bodyText: string }) {
  const matches = `${input.subject}\n${input.bodyText}`.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) || [];
  return [...new Set(matches.map((value) => value.toLowerCase()))].filter((value) => !/mailer-daemon|postmaster/.test(value));
}
