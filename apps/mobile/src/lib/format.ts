import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { formatCents } from "@pool/core";

dayjs.extend(relativeTime);

export const money = (cents: number | null | undefined, currency = "USD") =>
  cents === null || cents === undefined ? "—" : formatCents(cents, currency);

export const compactMoney = (cents: number | null | undefined) => {
  if (cents === null || cents === undefined) return "—";
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (Math.abs(dollars) >= 10_000) return `$${Math.round(dollars / 1000)}k`;
  return formatCents(cents);
};

/** "Oct 9, 2026"; "—" if missing/invalid. */
export const date = (value?: string | null) => {
  if (!value) return "—";
  const d = dayjs(value);
  return d.isValid() ? d.format("MMM D, YYYY") : "—";
};

export const shortDate = (value?: string | null) => (value ? dayjs(value).format("MMM D") : "—");

export const dateTime = (value?: string | null) => (value ? dayjs(value).format("MMM D, h:mm A") : "—");

export const time = (value?: string | null) => (value ? dayjs(value).format("h:mm A") : "");

export const fromNow = (value?: string | null) => (value ? dayjs(value).fromNow() : "");

/** Activity-feed style grouping label: "Today", "Yesterday", or a date. */
export const dayLabel = (value: string) => {
  const d = dayjs(value);
  if (d.isSame(dayjs(), "day")) return "Today";
  if (d.isSame(dayjs().subtract(1, "day"), "day")) return "Yesterday";
  return d.format("dddd, MMM D");
};

export const titleCase = (value?: string | null) =>
  value ? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "";

export const initials = (name?: string | null) =>
  (name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const todayISO = () => dayjs().format("YYYY-MM-DD");
