import { describe, expect, it } from "vitest";
import { effectivePermitStatus, permitAuthorizesWork, permitDateProblem, permitGate, stampPermitDates, type PermitDates } from "../src";

const TODAY = "2026-06-01";
const blank: PermitDates = { status: "draft", submittedOn: null, issuedOn: null, expiresOn: null, finaledOn: null };

describe("permit status", () => {
  it("derives expired from the expiry date only for issued permits", () => {
    expect(effectivePermitStatus({ status: "issued", expiresOn: "2026-05-31" }, TODAY)).toBe("expired");
    expect(effectivePermitStatus({ status: "issued", expiresOn: TODAY }, TODAY)).toBe("issued");
    expect(effectivePermitStatus({ status: "issued", expiresOn: null }, TODAY)).toBe("issued");
    expect(effectivePermitStatus({ status: "finaled", expiresOn: "2026-01-01" }, TODAY)).toBe("finaled");
    expect(effectivePermitStatus({ status: "submitted", expiresOn: "2026-01-01" }, TODAY)).toBe("submitted");
  });

  it("authorizes work only when issued and current, or finaled", () => {
    expect(permitAuthorizesWork({ status: "issued", expiresOn: null }, TODAY)).toBe(true);
    expect(permitAuthorizesWork({ status: "finaled", expiresOn: null }, TODAY)).toBe(true);
    expect(permitAuthorizesWork({ status: "issued", expiresOn: "2026-05-01" }, TODAY)).toBe(false);
    for (const status of ["draft", "submitted", "revisions_requested", "rejected", "withdrawn"] as const) {
      expect(permitAuthorizesWork({ status, expiresOn: null }, TODAY)).toBe(false);
    }
  });
});

describe("stampPermitDates", () => {
  it("fills the date that goes with the status and keeps dates already set", () => {
    expect(stampPermitDates({ ...blank, status: "submitted" }, TODAY).submittedOn).toBe(TODAY);
    expect(stampPermitDates({ ...blank, status: "issued", issuedOn: "2026-05-20" }, TODAY).issuedOn).toBe("2026-05-20");
    const finaled = stampPermitDates({ ...blank, status: "finaled" }, TODAY);
    expect([finaled.issuedOn, finaled.finaledOn]).toEqual([TODAY, TODAY]);
    // Earlier dates aren't invented for later statuses.
    expect(stampPermitDates({ ...blank, status: "issued" }, TODAY).submittedOn).toBeNull();
  });
});

describe("permitDateProblem", () => {
  it("rejects out-of-order dates", () => {
    expect(permitDateProblem({ ...blank, status: "issued", submittedOn: "2026-05-10", issuedOn: "2026-05-01" })).toMatch(/before the submitted/);
    expect(permitDateProblem({ ...blank, status: "issued", issuedOn: "2026-05-10", expiresOn: "2026-05-01" })).toMatch(/Expiry/);
    expect(permitDateProblem({ ...blank, status: "finaled", issuedOn: "2026-05-10", finaledOn: "2026-05-01" })).toMatch(/Finaled/);
    expect(permitDateProblem({ ...blank, status: "issued", issuedOn: "2026-05-10", finaledOn: "2026-06-01" })).toMatch(/Only a finaled/);
    expect(permitDateProblem({ ...blank, status: "issued", submittedOn: "2026-05-01", issuedOn: "2026-05-10", expiresOn: "2026-11-10" })).toBeNull();
  });
});

describe("permitGate", () => {
  it("is none without records other than withdrawn ones", () => {
    expect(permitGate([], TODAY).state).toBe("none");
    expect(permitGate([{ status: "withdrawn", expiresOn: null }], TODAY).state).toBe("none");
  });

  it("needs every considered permit to authorize work", () => {
    const issued = { status: "issued" as const, expiresOn: null };
    const pending = { status: "submitted" as const, expiresOn: null };
    expect(permitGate([issued, { status: "withdrawn", expiresOn: null }], TODAY)).toEqual({ state: "issued", blocking: [] });
    expect(permitGate([issued, pending], TODAY)).toEqual({ state: "pending", blocking: [pending] });
  });
});
