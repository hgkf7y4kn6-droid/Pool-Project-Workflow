import { describe, expect, it } from "vitest";
import { WorkCalendar, addCalendarDays, diffCalendarDays, parseISODate, formatISODate, todayISO } from "../src/calendar";

describe("calendar", () => {
  it("round-trips ISO dates and rejects invalid ones", () => {
    expect(formatISODate(parseISODate("2026-10-05"))).toBe("2026-10-05");
    expect(() => parseISODate("2026-02-30")).toThrow();
    expect(() => parseISODate("10/05/2026")).toThrow();
  });

  it("does calendar math across month and year boundaries", () => {
    expect(addCalendarDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(diffCalendarDays("2026-02-27", "2026-03-02")).toBe(3);
  });

  it("skips weekends and holidays for working-day math", () => {
    const cal = new WorkCalendar({ holidays: ["2026-10-12"] });
    expect(cal.isWorkingDay("2026-10-10")).toBe(false); // Saturday
    expect(cal.nextWorkingDay("2026-10-10")).toBe("2026-10-13"); // Mon is a holiday
    expect(cal.addWorkingDays("2026-10-09", 1)).toBe("2026-10-13");
    expect(cal.addWorkingDays("2026-10-13", -1)).toBe("2026-10-09");
    expect(cal.workingDaysBetween("2026-10-05", "2026-10-13")).toBe(5);
    expect(cal.workingDaysBetween("2026-10-13", "2026-10-05")).toBe(-5);
    expect(cal.finishDate("2026-10-08", 3)).toBe("2026-10-13");
    expect(cal.finishDate("2026-10-08", 0)).toBe("2026-10-08");
  });

  it("supports six-day work weeks", () => {
    const cal = new WorkCalendar({ workingWeekdays: [1, 2, 3, 4, 5, 6] });
    expect(cal.addWorkingDays("2026-10-09", 1)).toBe("2026-10-10");
  });

  it("formats today in a timezone", () => {
    const now = new Date("2026-10-06T03:00:00Z");
    expect(todayISO("UTC", now)).toBe("2026-10-06");
    expect(todayISO("America/Phoenix", now)).toBe("2026-10-05");
  });
});
