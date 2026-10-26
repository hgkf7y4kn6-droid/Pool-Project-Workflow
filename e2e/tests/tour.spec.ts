import { test } from "@playwright/test";
import { apiGet, apiToken, signIn } from "./helpers";

/**
 * Visual tour: screenshots of the main screens for design review.
 * Off by default; run with `TOUR=1 npx playwright test tour` → e2e/screenshots/.
 */
test.skip(!process.env.TOUR, "set TOUR=1 to capture screenshots");

async function skipTour(page: import("@playwright/test").Page) {
  const skip = page.getByRole("button", { name: "Skip" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

const out = (name: string) => `screenshots/${process.env.TOUR_PREFIX ?? ""}${name}.png`;

test("staff tour", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(800);
  await page.screenshot({ path: out("01-sign-in") });
  await signIn(page, "pm@bluelagoon.test");
  // Build with E2E_DISABLE_TOUR=0 to capture the welcome tour too.
  const next = page.getByRole("button", { name: "Next" });
  if (await next.isVisible().catch(() => false)) {
    await page.waitForTimeout(900);
    await page.screenshot({ path: out("00-welcome-tour") });
    await page.getByRole("button", { name: "Skip" }).click();
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out("02-dashboard"), fullPage: true });
  await page.goto("/projects");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out("03-projects") });
  const token = await apiToken("pm@bluelagoon.test");
  const [w] = await apiGet<{ id: string }[]>(token, "/projects?q=Whitfield");
  await page.goto(`/projects/${w!.id}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out("04-project"), fullPage: true });
  await page.goto(`/projects/${w!.id}/schedule`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out("05-schedule") });
  await page.goto("/tasks?due=all");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out("06-tasks") });
  await page.getByText("Whitfield Backyard Oasis").first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out("07-task"), fullPage: true });
  await page.goto(`/projects/${w!.id}/budget`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out("08-budget"), fullPage: true });
  await page.goto("/more");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: out("09-more") });
});

test("client tour", async ({ page }) => {
  await signIn(page, "client@example.test");
  await page.waitForTimeout(900);
  await page.screenshot({ path: out("10-client-tour") });
  await skipTour(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out("10-client-home"), fullPage: true });
});

test("desktop dashboard", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto("/");
  await page.waitForTimeout(800);
  await page.screenshot({ path: out("11-desktop-sign-in") });
  await signIn(page, "pm@bluelagoon.test");
  await skipTour(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out("12-desktop-dashboard") });
});
