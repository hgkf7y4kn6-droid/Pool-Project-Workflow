/**
 * Working-day calendar arithmetic on ISO calendar dates (YYYY-MM-DD).
 *
 * All math is done in UTC on whole days so results never drift with the
 * device timezone or daylight-saving changes.
 */

const DAY_MS = 86_400_000;

export function parseISODate(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid ISO date: ${date}`);
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const check = new Date(ms);
  if (check.getUTCDate() !== Number(d)) throw new Error(`Invalid ISO date: ${date}`);
  return Math.floor(ms / DAY_MS);
}

export function formatISODate(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

export function addCalendarDays(date: string, days: number): string {
  return formatISODate(parseISODate(date) + days);
}

export function diffCalendarDays(from: string, to: string): number {
  return parseISODate(to) - parseISODate(from);
}

/** Today's calendar date in the given IANA timezone (defaults to UTC). */
export function todayISO(timeZone = "UTC", now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export interface WorkCalendarOptions {
  /** Working weekdays, 0 = Sunday … 6 = Saturday. Default Mon–Fri. */
  workingWeekdays?: number[];
  /** Non-working dates (holidays, company shutdowns). */
  holidays?: string[];
}

/**
 * Maps calendar dates to a dense "working-day index" so schedule math becomes
 * integer arithmetic. Index 0 is the first working day on/after the anchor.
 */
export class WorkCalendar {
  private readonly weekdays: Set<number>;
  private readonly holidays: Set<number>;

  constructor(options: WorkCalendarOptions = {}) {
    this.weekdays = new Set(options.workingWeekdays ?? [1, 2, 3, 4, 5]);
    if (this.weekdays.size === 0) throw new Error("A work calendar needs at least one working weekday");
    this.holidays = new Set((options.holidays ?? []).map(parseISODate));
  }

  isWorkingDay(date: string | number): boolean {
    const day = typeof date === "number" ? date : parseISODate(date);
    // 1970-01-01 (day 0) was a Thursday (4).
    const weekday = (((day + 4) % 7) + 7) % 7;
    return this.weekdays.has(weekday) && !this.holidays.has(day);
  }

  /** The date itself if it is a working day, otherwise the next working day. */
  nextWorkingDay(date: string): string {
    let day = parseISODate(date);
    while (!this.isWorkingDay(day)) day += 1;
    return formatISODate(day);
  }

  /** Move by `n` working days (negative moves backwards). Input is normalized forward first. */
  addWorkingDays(date: string, n: number): string {
    let day = parseISODate(this.nextWorkingDay(date));
    const step = n >= 0 ? 1 : -1;
    let remaining = Math.abs(n);
    while (remaining > 0) {
      day += step;
      if (this.isWorkingDay(day)) remaining -= 1;
    }
    return formatISODate(day);
  }

  /**
   * Signed count of working days from `from` to `to` (exclusive of `from`,
   * inclusive of `to`). Same working day → 0.
   */
  workingDaysBetween(from: string, to: string): number {
    const a = parseISODate(this.nextWorkingDay(from));
    const b = parseISODate(this.nextWorkingDay(to));
    if (a === b) return 0;
    const [lo, hi, sign] = a < b ? [a, b, 1] : [b, a, -1];
    let count = 0;
    for (let day = lo + 1; day <= hi; day += 1) if (this.isWorkingDay(day)) count += 1;
    return count * sign;
  }

  /** Finish date of work that starts on `start` and lasts `durationDays` working days. */
  finishDate(start: string, durationDays: number): string {
    return this.addWorkingDays(start, Math.max(durationDays - 1, 0));
  }
}
