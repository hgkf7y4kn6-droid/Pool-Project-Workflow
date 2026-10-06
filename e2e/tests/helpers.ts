import { expect, type Page } from "@playwright/test";

export const PASSWORD = "PoolDemo2026!";
export const API = "http://localhost:4000";

export async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  // First sync fills the on-device database.
  await expect(page.getByRole("button", { name: /Sync status: Synced/ }).first()).toBeVisible({ timeout: 30_000 });
}

export async function apiToken(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  return ((await res.json()) as { data: { tokens: { accessToken: string } } }).data.tokens.accessToken;
}

export async function apiGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return ((await res.json()) as { data: T }).data;
}

export async function waitForSynced(page: Page) {
  await expect(page.getByRole("button", { name: /Sync status: Synced/ }).first()).toBeVisible({ timeout: 30_000 });
}

/** Draw a signature once the bottom sheet has finished sliding in. */
export async function drawSignature(page: Page) {
  const pad = page.getByLabel("Signature area. Sign with your finger.");
  let box = await pad.boundingBox();
  await expect
    .poll(async () => {
      const next = await pad.boundingBox();
      const settled = !!next && !!box && next.y === box.y;
      box = next;
      return settled;
    })
    .toBe(true);
  const { x, y } = box!;
  await page.mouse.move(x + 30, y + 100);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) await page.mouse.move(x + 30 + i * 12, y + 100 + Math.sin(i / 2) * 30, { steps: 2 });
  await page.mouse.up();
}
