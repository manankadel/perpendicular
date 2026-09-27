import type { BookingSettings, MeetingBooking } from "@/lib/domain";

const DEFAULT_TIMEZONE = "UTC";
const DEFAULT_DURATION_MINUTES = 30;
const DEFAULT_BUFFER_MINUTES = 10;
const DEFAULT_WINDOW_DAYS = 14;

function safeTimeZone(value: unknown, fallback = DEFAULT_TIMEZONE) {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return fallback;
  }
}

function normalizeTime(value: unknown, fallback: string) {
  const candidate = typeof value === "string" ? value.trim() : "";
  const match = /^(\d{2}):(\d{2})$/.exec(candidate);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? candidate : fallback;
}

export function slugifyBooking(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72);
}

export function defaultBookingSettings(timezone = DEFAULT_TIMEZONE): BookingSettings {
  return {
    id: "booking-default",
    enabled: false,
    slug: "meet",
    title: "Book a conversation",
    description: "Choose a time that works. The workspace will assign the next available operator.",
    durationMinutes: DEFAULT_DURATION_MINUTES,
    bufferMinutes: DEFAULT_BUFFER_MINUTES,
    timezone: safeTimeZone(timezone),
    bookingWindowDays: DEFAULT_WINDOW_DAYS,
    availability: { weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
    hostEmployeeIds: [],
    roundRobinCursor: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

export function normalizeBookingSettings(value: unknown, fallbackTimezone = DEFAULT_TIMEZONE): BookingSettings | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<BookingSettings>;
  const base = defaultBookingSettings(fallbackTimezone);
  const slug = slugifyBooking(typeof input.slug === "string" ? input.slug : "");
  if (!slug) return null;
  const durationMinutes = [15, 20, 30, 45, 60, 90, 120].includes(Number(input.durationMinutes)) ? Number(input.durationMinutes) : base.durationMinutes;
  const bufferMinutes = [0, 5, 10, 15, 20, 30].includes(Number(input.bufferMinutes)) ? Number(input.bufferMinutes) : base.bufferMinutes;
  const weekdays = Array.isArray(input.availability?.weekdays)
    ? [...new Set(input.availability.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
    : base.availability.weekdays;
  const start = normalizeTime(input.availability?.start, base.availability.start);
  const end = normalizeTime(input.availability?.end, base.availability.end);
  const startMinutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
  const endMinutes = Number(end.slice(0, 2)) * 60 + Number(end.slice(3));
  const availability = endMinutes > startMinutes && weekdays.length ? { weekdays, start, end } : base.availability;
  const createdAt = typeof input.createdAt === "string" ? input.createdAt : base.createdAt;
  const updatedAt = typeof input.updatedAt === "string" ? input.updatedAt : createdAt;
  return {
    ...base,
    ...input,
    id: typeof input.id === "string" && input.id.trim() ? input.id : base.id,
    enabled: input.enabled !== false,
    slug,
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 140) : base.title,
    description: typeof input.description === "string" ? input.description.trim().slice(0, 1000) : base.description,
    durationMinutes,
    bufferMinutes,
    timezone: safeTimeZone(input.timezone, base.timezone),
    bookingWindowDays: Number.isInteger(input.bookingWindowDays) ? Math.min(60, Math.max(1, input.bookingWindowDays as number)) : base.bookingWindowDays,
    availability,
    hostEmployeeIds: Array.isArray(input.hostEmployeeIds) ? [...new Set(input.hostEmployeeIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim()))].slice(0, 20) : [],
    roundRobinCursor: Number.isInteger(input.roundRobinCursor) && (input.roundRobinCursor as number) >= 0 ? input.roundRobinCursor as number : 0,
    createdAt,
    updatedAt,
  };
}

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function dateParts(date: Date, timezone: string): DateParts {
  const values = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => Number(values.find((part) => part.type === type)?.value || 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const first = dateParts(new Date(wallClock), timezone);
  const firstAsUtc = Date.UTC(first.year, first.month - 1, first.day, first.hour, first.minute, first.second);
  const firstCandidate = wallClock - (firstAsUtc - wallClock);
  const second = dateParts(new Date(firstCandidate), timezone);
  const secondAsUtc = Date.UTC(second.year, second.month - 1, second.day, second.hour, second.minute, second.second);
  return new Date(firstCandidate - (secondAsUtc - wallClock));
}

function bookingOverlaps(candidateStart: number, candidateEnd: number, booking: MeetingBooking, bufferMinutes: number) {
  if (booking.status !== "confirmed") return false;
  const buffer = bufferMinutes * 60_000;
  const bookedStart = new Date(booking.startAt).getTime();
  const bookedEnd = new Date(booking.endAt).getTime();
  return bookedStart < candidateEnd + buffer && bookedEnd > candidateStart - buffer;
}

export type BookingSlot = {
  startAt: string;
  endAt: string;
  availableHostIds: string[];
};

export function availableBookingSlots(settings: BookingSettings, bookings: MeetingBooking[], from = Date.now()): BookingSlot[] {
  if (!settings.enabled || settings.hostEmployeeIds.length === 0) return [];
  const timezone = safeTimeZone(settings.timezone);
  const today = dateParts(new Date(from), timezone);
  const slots: BookingSlot[] = [];
  const duration = settings.durationMinutes * 60_000;
  const stepMinutes = settings.durationMinutes + settings.bufferMinutes;
  const startMinute = Number(settings.availability.start.slice(0, 2)) * 60 + Number(settings.availability.start.slice(3));
  const endMinute = Number(settings.availability.end.slice(0, 2)) * 60 + Number(settings.availability.end.slice(3));
  const earliest = from + 15 * 60_000;
  for (let dayOffset = 0; dayOffset <= settings.bookingWindowDays; dayOffset += 1) {
    const calendar = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset));
    if (!settings.availability.weekdays.includes(calendar.getUTCDay())) continue;
    for (let minute = startMinute; minute + settings.durationMinutes <= endMinute; minute += stepMinutes) {
      const start = zonedTimeToUtc(calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, calendar.getUTCDate(), Math.floor(minute / 60), minute % 60, timezone);
      const end = new Date(start.getTime() + duration);
      if (start.getTime() < earliest) continue;
      const availableHostIds = settings.hostEmployeeIds.filter((hostId) => !bookings.some((booking) => booking.hostEmployeeId === hostId && bookingOverlaps(start.getTime(), end.getTime(), booking, settings.bufferMinutes)));
      if (availableHostIds.length) slots.push({ startAt: start.toISOString(), endAt: end.toISOString(), availableHostIds });
    }
  }
  return slots;
}

export function chooseRoundRobinHost(settings: BookingSettings, availableHostIds: string[]) {
  if (!availableHostIds.length) return null;
  for (let offset = 0; offset < settings.hostEmployeeIds.length; offset += 1) {
    const index = (settings.roundRobinCursor + offset) % settings.hostEmployeeIds.length;
    const candidate = settings.hostEmployeeIds[index];
    if (availableHostIds.includes(candidate)) return candidate;
  }
  return availableHostIds[0] || null;
}

export function bookingSlotForStart(settings: BookingSettings, bookings: MeetingBooking[], startAt: string, from = Date.now()) {
  return availableBookingSlots(settings, bookings, from).find((slot) => slot.startAt === startAt) || null;
}

export function bookingEmailIsValid(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.length <= 320;
}
