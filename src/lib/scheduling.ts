import type { ScheduledWork } from "@/lib/domain";

const cadenceMinutes: Record<ScheduledWork["cadence"], number> = {
  once: 0,
  "every 15m": 15,
  hourly: 60,
  daily: 1440,
  weekly: 10080,
};

export function nextScheduleAt(cadence: ScheduledWork["cadence"], from = Date.now()) {
  return new Date(from + cadenceMinutes[cadence] * 60 * 1000).toISOString();
}

function minutesInTimezone(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const weekday = parts.find((part) => part.type === "weekday")?.value.toLowerCase();
    const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
    const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    return { weekday: weekdays.findIndex((candidate) => weekday?.startsWith(candidate)), minutes: hour * 60 + minute };
  } catch {
    const day = date.getDay();
    return { weekday: day, minutes: date.getHours() * 60 + date.getMinutes() };
  }
}

function windowContains(minutes: number, start: number, end: number) {
  if (start === end) return true;
  if (start < end) return minutes >= start && minutes <= end;
  return minutes >= start || minutes <= end;
}

export function scheduleWindowAllows(schedule: ScheduledWork, timezone: string, date = new Date()) {
  const current = minutesInTimezone(date, timezone || "UTC");
  const weekdays = schedule.weekdays?.length ? schedule.weekdays : [0, 1, 2, 3, 4, 5, 6];
  if (!weekdays.includes(current.weekday)) return false;
  if (!schedule.activeHours) return true;
  const [startHour, startMinute] = schedule.activeHours.start.split(":").map(Number);
  const [endHour, endMinute] = schedule.activeHours.end.split(":").map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return true;
  return windowContains(current.minutes, startHour * 60 + startMinute, endHour * 60 + endMinute);
}

export function nextAllowedScheduleAt(schedule: ScheduledWork, timezone: string, from = Date.now()) {
  if (!schedule.activeHours && (!schedule.weekdays || schedule.weekdays.length === 7)) return nextScheduleAt(schedule.cadence, from);
  let candidate = new Date(nextScheduleAt(schedule.cadence, from));
  for (let index = 0; index < 60 * 24 * 8; index += 1) {
    if (scheduleWindowAllows(schedule, timezone, candidate)) return candidate.toISOString();
    candidate = new Date(candidate.getTime() + 15 * 60 * 1000);
  }
  return candidate.toISOString();
}

export function scheduleExecutionTask(schedule: ScheduledWork) {
  const previous = schedule.lastOutput?.trim();
  return previous
    ? `${schedule.description}\n\nPrevious run output (use it as continuation context, verify it against current workspace data):\n${previous.slice(0, 4000)}`
    : schedule.description;
}
