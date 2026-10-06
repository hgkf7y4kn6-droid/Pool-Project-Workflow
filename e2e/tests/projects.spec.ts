import { expect, test } from "@playwright/test";
import { apiGet, apiToken, signIn, waitForSynced } from "./helpers";

test("creates a project with client, property and a generated schedule", async ({ page }) => {
  await signIn(page, "pm@bluelagoon.test");
  await page.goto("/projects/new");
  await page.getByRole("textbox", { name: "Project name" }).fill("E2E Family Pool");
  await page.getByRole("textbox", { name: "Contract amount" }).fill("75000");
  await page.getByRole("button", { name: /Planned start/ }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("textbox", { name: "First name" }).fill("Erin");
  await page.getByRole("textbox", { name: "Last name" }).fill("Tester");
  await page.getByRole("textbox", { name: "Street address" }).fill("1 Test Lane");
  await page.getByRole("textbox", { name: "City" }).fill("Tempe");
  await page.getByRole("textbox", { name: "State" }).fill("AZ");
  await page.getByRole("textbox", { name: "ZIP" }).fill("85281");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByText("E2E Family Pool").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Erin Tester")).toBeVisible();
  await expect(page.getByText("Construction progress")).toBeVisible();
  await expect(page.getByText("Excavation").first()).toBeVisible();

  const token = await apiToken("pm@bluelagoon.test");
  const projects = await apiGet<{ id: string; plannedCompletionDate: string }[]>(token, "/projects?q=E2E");
  expect(projects).toHaveLength(1);
  expect(projects[0]!.plannedCompletionDate).toBeTruthy();
  const schedule = await apiGet<{ tasks: unknown[]; dependencies: unknown[] }>(token, `/projects/${projects[0]!.id}/schedule`);
  expect(schedule.tasks).toHaveLength(17);
  expect(schedule.dependencies).toHaveLength(16);
  await waitForSynced(page);
});

test("assigns a task that the field worker then sees", async ({ page, browser }) => {
  await signIn(page, "pm@bluelagoon.test");
  const token = await apiToken("pm@bluelagoon.test");
  const [whitfield] = await apiGet<{ id: string }[]>(token, "/projects?q=Whitfield");
  await page.goto(`/tasks/new?projectId=${whitfield!.id}`);
  await page.getByRole("textbox", { name: "Title" }).fill("E2E: clean up spoils pile");
  await page.getByRole("button", { name: /Assign to/ }).click();
  await page.getByRole("radio", { name: /Jordan Diaz/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByRole("heading", { name: "E2E: clean up spoils pile" })).toBeVisible();
  await waitForSynced(page);

  const worker = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
  await signIn(worker, "worker@bluelagoon.test");
  await worker.goto("/tasks");
  await expect(worker.getByText("E2E: clean up spoils pile")).toBeVisible({ timeout: 30_000 });
  const notes = await apiGet<{ title: string }[]>(await apiToken("worker@bluelagoon.test"), "/notifications");
  expect(notes.some((n) => n.title === "New task assigned")).toBe(true);
});
