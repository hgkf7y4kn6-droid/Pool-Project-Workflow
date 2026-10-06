import { expect, test } from "@playwright/test";
import { apiGet, apiToken, drawSignature, signIn } from "./helpers";

test("client sees only their project and signs a change order", async ({ page }) => {
  await signIn(page, "client@example.test");
  await expect(page.getByText("Whitfield Backyard Oasis").first()).toBeVisible();
  await expect(page.getByText("Needs your approval")).toBeVisible();
  // Internal navigation is not offered to clients.
  await expect(page.getByRole("tab", { name: "Projects" })).toHaveCount(0);

  await page.goto("/approvals");
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  await drawSignature(page);
  await page.getByRole("button", { name: "Sign and approve" }).click();
  await expect(page.getByText(/Nothing waiting for a decision/)).toBeVisible();

  const token = await apiToken("pm@bluelagoon.test");
  const [whitfield] = await apiGet<{ id: string }[]>(token, "/projects?q=Whitfield");
  const cos = await apiGet<{ number: number; status: string; signatureName: string | null }[]>(token, `/projects/${whitfield!.id}/change-orders`);
  expect(cos.find((c) => c.number === 2)).toMatchObject({ status: "approved", signatureName: "Dana Whitfield" });
});
