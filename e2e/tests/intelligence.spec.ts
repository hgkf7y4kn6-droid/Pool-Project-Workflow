import { expect, test } from "@playwright/test";
import { apiGet, apiToken, signIn } from "./helpers";

/*
 * Project intelligence in the real web app against the real API (rules
 * provider, no LLM): briefing on the project hub, readiness, alert actions,
 * and a homeowner message drafted, approved and posted.
 * SHOTS=1 saves screenshots to e2e/screenshots/intelligence-*.png.
 */

const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `screenshots/intelligence-${name}.png`, fullPage: true });
};

async function whitfieldId() {
  const token = await apiToken("pm@bluelagoon.test");
  const [whitfield] = await apiGet<{ id: string }[]>(token, "/projects?q=Whitfield");
  return { token, id: whitfield!.id };
}

test("briefing, readiness and alert actions for the project manager", async ({ page }) => {
  const { id } = await whitfieldId();
  await signIn(page, "pm@bluelagoon.test");

  // Dashboard surfaces urgent items across projects.
  await expect(page.getByRole("button", { name: /^Alerts/ })).toBeVisible();
  await shot(page, "01-dashboard");

  await page.goto(`/projects/${id}`);
  await expect(page.getByText("Project briefing")).toBeVisible({ timeout: 30_000 });
  await shot(page, "02-project-hub");
  await page.getByRole("link", { name: "Open project intelligence" }).click();
  await expect(page.getByRole("heading", { name: "Intelligence" })).toBeVisible();
  await expect(page.getByText(/Next milestone/)).toBeVisible();
  await shot(page, "03-briefing");

  await page.getByRole("button", { name: /^Readiness/ }).click();
  await expect(page.getByText("Each item is checked against project records.", { exact: false })).toBeVisible();
  await expect(page.getByText("Prerequisite work")).toBeVisible();
  await shot(page, "04-readiness");

  await page.getByRole("button", { name: /^Alerts \(/ }).click();
  const first = page.getByRole("button", { name: /^(Critical|High|Medium|Low): / }).first();
  await expect(first).toBeVisible();
  await shot(page, "05-alerts");
  await first.click();
  await expect(page.getByText("What we see")).toBeVisible();
  await expect(page.getByText("Evidence from project records")).toBeVisible();
  await shot(page, "06-alert-detail");
  const ack = page.getByRole("button", { name: "Acknowledge" });
  if (await ack.isVisible()) {
    await ack.click();
    await expect(page.getByText("Acknowledged", { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText(/^detected/).first()).toBeVisible();
});

test("drafts a homeowner update from verified facts and posts it on approval", async ({ page }) => {
  const { id, token } = await whitfieldId();
  await signIn(page, "pm@bluelagoon.test");
  await page.goto(`/projects/${id}/communications`);
  await expect(page.getByRole("heading", { name: "Messages to send" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Write draft" }).click();
  await expect(page.getByRole("heading", { name: "Review message" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Facts this message may use")).toBeVisible();
  await shot(page, "07-draft");
  await page.getByRole("button", { name: "Approve & post to client portal" }).click();
  await expect(page.getByText(/and posted to the client thread/)).toBeVisible();
  await shot(page, "07b-posted");

  const messages = await apiGet<{ body: string; visibility: string }[]>(token, `/projects/${id}/messages?threadKey=client`);
  expect(messages.some((m) => m.visibility === "client" && m.body.includes("Weekly progress update"))).toBe(true);
});

test("operations dashboard and alert center filters", async ({ page }) => {
  await signIn(page, "pm@bluelagoon.test");
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Critical & high").first()).toBeVisible();
  await shot(page, "08-operations");
  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "Alert center" })).toBeVisible();
  await page.getByRole("button", { name: "Dismissed" }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await shot(page, "09-alert-center");
});

test("the homeowner never sees project intelligence", async ({ page }) => {
  await signIn(page, "client@example.test");
  await page.goto("/alerts");
  await expect(page.getByText(/permission|not available|need a connection/i).first()).toBeVisible({ timeout: 30_000 });
});
