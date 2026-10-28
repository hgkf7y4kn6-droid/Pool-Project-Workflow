import { describe, expect, it } from "vitest";
import { redactUrl, requestSerializer } from "../src/lib/log";

describe("log redaction", () => {
  it("removes credentials from query strings", () => {
    expect(redactUrl("/realtime?token=abc.def.ghi")).toBe("/realtime?token=[redacted]");
    expect(redactUrl("/storage/local/k?exp=1&sig=deadbeef&dl=1")).toBe("/storage/local/k?exp=1&sig=[redacted]&dl=1");
    expect(redactUrl("/projects?q=pool")).toBe("/projects?q=pool");
  });

  it("serializes a request without the token", () => {
    const out = requestSerializer({ method: "GET", url: "/realtime?token=secret", ip: "1.2.3.4" });
    expect(JSON.stringify(out)).not.toContain("secret");
    expect(out.remoteAddress).toBe("1.2.3.4");
  });
});
