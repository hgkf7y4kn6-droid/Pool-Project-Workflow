import type { PermitStatus } from "@pool/types";

/** Stored status plus "expired", which is derived from `expiresOn` rather than stored. */
export type EffectivePermitStatus = PermitStatus | "expired";

export interface PermitDates {
  status: PermitStatus;
  submittedOn: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  finaledOn: string | null;
}

/** An issued permit whose expiry date has passed is expired; a finaled one never is. */
export function effectivePermitStatus(p: Pick<PermitDates, "status" | "expiresOn">, today: string): EffectivePermitStatus {
  if (p.status === "issued" && p.expiresOn && p.expiresOn < today) return "expired";
  return p.status;
}

/** Whether the permit currently authorizes work (issued and unexpired, or finaled). */
export function permitAuthorizesWork(p: Pick<PermitDates, "status" | "expiresOn">, today: string): boolean {
  const s = effectivePermitStatus(p, today);
  return s === "issued" || s === "finaled";
}

/**
 * Fill the date that goes with a status when it's missing: submitted on,
 * issued on, finaled on. Reaching a later status also implies the earlier
 * dates exist, but those are left to the user rather than invented.
 */
export function stampPermitDates<T extends PermitDates>(p: T, today: string): T {
  const out = { ...p };
  if (p.status === "submitted" && !out.submittedOn) out.submittedOn = today;
  if ((p.status === "issued" || p.status === "finaled") && !out.issuedOn) out.issuedOn = today;
  if (p.status === "finaled" && !out.finaledOn) out.finaledOn = today;
  return out;
}

/** Date-order problems that make a permit record inconsistent, or null. */
export function permitDateProblem(p: PermitDates): string | null {
  if (p.submittedOn && p.issuedOn && p.issuedOn < p.submittedOn) return "Issued date can't be before the submitted date";
  if (p.issuedOn && p.expiresOn && p.expiresOn < p.issuedOn) return "Expiry date can't be before the issued date";
  if (p.issuedOn && p.finaledOn && p.finaledOn < p.issuedOn) return "Finaled date can't be before the issued date";
  if (p.finaledOn && p.status !== "finaled") return "Only a finaled permit can have a finaled date";
  return null;
}

/**
 * Whether a project's permits clear the permit gate. Withdrawn permits are
 * ignored; every other permit on the project must authorize work, so a
 * rejected or expired permit keeps the gate closed until it's withdrawn or
 * replaced. `none` means there are no permit records to judge by.
 */
export function permitGate<T extends Pick<PermitDates, "status" | "expiresOn">>(
  permits: T[],
  today: string,
): { state: "issued" | "pending" | "none"; blocking: T[] } {
  const considered = permits.filter((p) => p.status !== "withdrawn");
  if (!considered.length) return { state: "none", blocking: [] };
  const blocking = considered.filter((p) => !permitAuthorizesWork(p, today));
  return { state: blocking.length ? "pending" : "issued", blocking };
}
