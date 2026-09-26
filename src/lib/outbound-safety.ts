export type OutboundSafetySettings = {
  dailySendLimit: number;
  timezone: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  skipWeekends: boolean;
  suppressedDomains: string[];
  updatedAt: string;
};

export type OutboundSafetyDecision =
  | { allowed: true; localDate: string }
  | { allowed: false; code: "suppressed_email" | "suppressed_domain" | "weekend" | "outside_window"; reason: string; localDate: string };

const DEFAULTS: Omit<OutboundSafetySettings, "updatedAt"> = {
  dailySendLimit: 100,
  timezone: "UTC",
  sendWindowStart: "00:00",
  sendWindowEnd: "23:59",
  skipWeekends: false,
  suppressedDomains: [],
};

function isValidTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^@+/, "").replace(/^\.+/, "");
}

export function defaultOutboundSafetySettings(updatedAt = new Date().toISOString()): OutboundSafetySettings {
  return { ...DEFAULTS, suppressedDomains: [], updatedAt };
}

export function normalizeOutboundSafetySettings(value: Partial<OutboundSafetySettings> | null | undefined, updatedAt = new Date().toISOString()): OutboundSafetySettings {
  const limit = Number(value?.dailySendLimit);
  const timezone = typeof value?.timezone === "string" && isValidTimezone(value.timezone) ? value.timezone : DEFAULTS.timezone;
  const sendWindowStart = typeof value?.sendWindowStart === "string" && isValidTime(value.sendWindowStart) ? value.sendWindowStart : DEFAULTS.sendWindowStart;
  const sendWindowEnd = typeof value?.sendWindowEnd === "string" && isValidTime(value.sendWindowEnd) ? value.sendWindowEnd : DEFAULTS.sendWindowEnd;
  const suppressedDomains = Array.isArray(value?.suppressedDomains)
    ? [...new Set(value.suppressedDomains.filter((domain): domain is string => typeof domain === "string").map(normalizeDomain).filter(Boolean))]
    : [];
  return {
    dailySendLimit: Number.isFinite(limit) ? Math.min(10000, Math.max(1, Math.floor(limit))) : DEFAULTS.dailySendLimit,
    timezone,
    sendWindowStart,
    sendWindowEnd,
    skipWeekends: value?.skipWeekends === true,
    suppressedDomains,
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : updatedAt,
  };
}

export function validateOutboundSafetySettings(value: Partial<OutboundSafetySettings>) {
  const limit = Number(value.dailySendLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) return { error: "Daily send limit must be a whole number between 1 and 10,000." as const };
  if (typeof value.timezone !== "string" || !isValidTimezone(value.timezone)) return { error: "Choose a valid IANA timezone." as const };
  if (typeof value.sendWindowStart !== "string" || !isValidTime(value.sendWindowStart)) return { error: "Send window start must use HH:MM format." as const };
  if (typeof value.sendWindowEnd !== "string" || !isValidTime(value.sendWindowEnd)) return { error: "Send window end must use HH:MM format." as const };
  if (value.sendWindowStart >= value.sendWindowEnd) return { error: "Send window end must be later than its start on the same day." as const };
  const domains = Array.isArray(value.suppressedDomains) ? value.suppressedDomains : [];
  if (domains.some((domain) => typeof domain !== "string" || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(normalizeDomain(domain)))) return { error: "Suppressed domains must look like example.com." as const };
  return { settings: normalizeOutboundSafetySettings({ ...value, updatedAt: new Date().toISOString() }) };
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const hour = Number(read("hour")) % 24;
  return { year: Number(read("year")), month: Number(read("month")), day: Number(read("day")), weekday: read("weekday"), hour, minute: Number(read("minute")), second: Number(read("second")) };
}

export function localDateKey(date: Date, timezone: string) {
  const parts = localParts(date, timezone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

export function startOfLocalDay(date: Date, timezone: string) {
  const parts = localParts(date, timezone);
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offset = wallClock - date.getTime();
  const firstGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - offset);
  const corrected = localParts(firstGuess, timezone);
  const correctedWallClock = Date.UTC(corrected.year, corrected.month - 1, corrected.day, corrected.hour, corrected.minute, corrected.second);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - (correctedWallClock - firstGuess.getTime()));
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function outboundSafetyDecision(args: { settings: OutboundSafetySettings; email: string; now?: Date }): OutboundSafetyDecision {
  const settings = normalizeOutboundSafetySettings(args.settings);
  const now = args.now || new Date();
  const email = normalizeEmail(args.email);
  const domain = email.split("@")[1] || "";
  const localDate = localDateKey(now, settings.timezone);
  if (!email.includes("@")) return { allowed: false, code: "suppressed_email", reason: "The recipient address is invalid and cannot be sent.", localDate };
  if (settings.suppressedDomains.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) return { allowed: false, code: "suppressed_domain", reason: `The ${domain} domain is suppressed for this workspace.`, localDate };
  if (settings.skipWeekends && ["Sat", "Sun"].includes(localParts(now, settings.timezone).weekday)) return { allowed: false, code: "weekend", reason: "Weekend sending is disabled for this workspace.", localDate };
  const currentMinutes = localParts(now, settings.timezone).hour * 60 + localParts(now, settings.timezone).minute;
  if (currentMinutes < minutes(settings.sendWindowStart) || currentMinutes >= minutes(settings.sendWindowEnd)) return { allowed: false, code: "outside_window", reason: `Sending is allowed from ${settings.sendWindowStart} to ${settings.sendWindowEnd} (${settings.timezone}).`, localDate };
  return { allowed: true, localDate };
}
