import { expect, test } from "@playwright/test";
import { PASSWORD, signIn } from "./helpers";

test("rejects a wrong password with a clear message", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email" }).fill("pm@bluelagoon.test");
  await page.getByRole("textbox", { name: "Password" }).fill("wrong-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
});

test("project manager signs in and sees the company dashboard", async ({ page }) => {
  await signIn(page, "pm@bluelagoon.test");
  await expect(page.getByRole("heading", { name: "Active projects" })).toBeVisible();
  await expect(page.getByText("Today's schedule")).toBeVisible();
  await expect(page.getByText("Whitfield Backyard Oasis").first()).toBeVisible();
  void PASSWORD;
});
