/* Display formatting — all client-side, mirrors the legacy template helpers. */

import { dayDiff } from "./time";

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return "$" + (n / 1e9).toFixed(2).replace(/\.00$/, "") + "B";
  if (abs >= 1e6) return "$" + (n / 1e6).toFixed(2).replace(/\.00$/, "") + "M";
  if (abs >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
  return "$" + Math.round(n).toLocaleString("en-US");
}

export function fmtPct(n: number | null | undefined, dp = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toFixed(dp) + "%";
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * An INSTANT, date and time, pinned to UTC.
 *
 * Org reads carry UTC instants and the freshness line has to be comparable
 * between two of them, so the zone is stated rather than left to the viewer's
 * machine. A local rendering would also make the same data read differently in
 * London and Atlanta, which is not a property a freshness claim may have.
 */
export function fmtInstant(iso: string | null | undefined): string {
  if (!iso) return "an unrecorded time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return (
    d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }) + " UTC"
  );
}

/**
 * HOW OLD THE FIGURES ON SCREEN ARE, in the fewest words that stay true.
 *
 * "22:14 UTC" while it is still the same UTC day, "22:14 UTC yesterday" for the
 * one after that, and the full instant beyond it. A banker reading a stale
 * cockpit needs the age at a glance and the exact stamp when the age starts to
 * matter, and the shortest honest form of each is a different sentence.
 *
 * Same zone doctrine as {@link fmtInstant}: a freshness claim may not read
 * differently in London and Atlanta.
 */
export function fmtAsOf(at: number | null | undefined, now: number = Date.now()): string {
  if (at == null || !Number.isFinite(at)) return "an unrecorded time";
  const iso = new Date(at).toISOString();
  const dayOf = (ms: number) => Math.floor(ms / 86_400_000);
  const days = dayOf(now) - dayOf(at);
  if (days <= 0) return fmtClock(iso);
  if (days === 1) return `${fmtClock(iso)} yesterday`;
  return fmtInstant(iso);
}

/**
 * Clock time of an instant, pinned to UTC: "14:03 UTC".
 *
 * For a freshness note sitting next to a failure ("last good data, 14:03 UTC"),
 * where the day-scale relative reading says nothing useful. Same zone doctrine
 * as {@link fmtInstant}: a freshness claim may not read differently in London
 * and Atlanta.
 */
export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return "an unrecorded time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return (
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC"
  );
}

/** Activity timestamp relative to the render clock (A30.2): "3d ago",
 *  "today", "in 2d". Falls back to the absolute date when either side is
 *  unparseable — never a fabricated interval. */
export function fmtRelative(ts: string | null | undefined, generatedAt: string | null | undefined): string {
  if (!ts) return "—";
  if (!generatedAt) return fmtDate(ts);
  const d = dayDiff(ts, generatedAt);
  if (d === null) return fmtDate(ts);
  if (d === 0) return "today";
  if (d < 0) {
    const n = Math.abs(d);
    if (n === 1) return "yesterday";
    if (n < 30) return `${n}d ago`;
    if (n < 365) return `${Math.round(n / 30)}mo ago`;
    return `${Math.round(n / 365)}y ago`;
  }
  return d === 1 ? "tomorrow" : `in ${d}d`;
}

/** Signed day count → compact "in 44d" / "12d ago" / "today". */
export function fmtDays(days: number | null | undefined): string {
  if (days === null || days === undefined || Number.isNaN(days)) return "—";
  if (days === 0) return "today";
  return days > 0 ? `in ${days}d` : `${Math.abs(days)}d ago`;
}
