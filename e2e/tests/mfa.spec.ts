import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PASSWORD, signIn } from "./helpers";

/** RFC 6238 code for a base32 secret, as an authenticator app would show it. */
function totp(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

// Uses the designer account so other specs keep password-only sign-in.
test("turns on two-step verification and then requires a code at sign-in", async ({ page, browser }) => {
  await signIn(page, "designer@bluelagoon.test");
  await page.goto("/settings");
  await page.getByText("Two-step verification").click();
  await page.getByRole("button", { name: "Set up two-step verification" }).click();
  const key = (await page.getByLabel(/^Setup key/).textContent())!.replace(/\s/g, "");
  await page.getByRole("textbox", { name: "6-digit code" }).fill(totp(key));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText(/Two-step verification is on\. You'll be asked/)).toBeVisible();

  const fresh = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
  await fresh.goto("/");
  await fresh.getByRole("textbox", { name: "Email" }).fill("designer@bluelagoon.test");
  await fresh.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await fresh.getByRole("button", { name: "Sign in" }).click();
  await fresh.getByRole("textbox", { name: "Code" }).fill(totp(key));
  await fresh.getByRole("button", { name: "Verify" }).click();
  await fresh.waitForURL("**/dashboard");
});
