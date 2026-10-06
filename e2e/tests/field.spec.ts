import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { apiGet, apiToken, signIn, waitForSynced } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));

async function openWhitfieldSteel(page: import("@playwright/test").Page) {
  await page.goto("/tasks?due=all");
  await waitForSynced(page);
  await page.getByRole("textbox", { name: "Search tasks" }).fill("Steel/Reinforcement");
  await page.getByText("Whitfield Backyard Oasis").first().click();
  await expect(page.getByRole("heading", { name: "Steel/Reinforcement" })).toBeVisible();
}

test("completes checklist work offline and syncs on reconnect", async ({ page, context }) => {
  await signIn(page, "super@bluelagoon.test");
  await openWhitfieldSteel(page);

  await context.setOffline(true);
  await page.getByRole("checkbox", { name: /Chairs \/ spacing verified/ }).click();
  await expect(page.getByRole("button", { name: /Offline · 1 saved on device/ })).toBeVisible();

  // Required items are still open: completion is blocked locally, same rule as the server.
  await page.getByRole("button", { name: "Complete" }).click();
  await expect(page.getByText("Finish the required checklist items first.")).toBeVisible();

  await context.setOffline(false);
  await waitForSynced(page);

  const token = await apiToken("pm@bluelagoon.test");
  const [whitfield] = await apiGet<{ id: string }[]>(token, "/projects?q=Whitfield");
  const tasks = await apiGet<{ id: string; title: string }[]>(token, `/tasks?projectId=${whitfield!.id}&q=Steel`);
  const steel = await apiGet<{ checklist: { label: string; isChecked: boolean }[] }>(token, `/tasks/${tasks.find((t) => t.title === "Steel/Reinforcement")!.id}`);
  expect(steel.checklist.find((c) => c.label === "Chairs / spacing verified")!.isChecked).toBe(true);
});

test("captures a photo on a task and uploads it with project/task context", async ({ page }) => {
  await signIn(page, "super@bluelagoon.test");
  await openWhitfieldSteel(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Photo", exact: true }).click();
  await (await chooser).setFiles(path.join(here, "fixtures", "site.jpg"));
  await page.getByRole("textbox", { name: "Caption (optional)" }).fill("Rebar tied at north wall");
  await page.getByRole("button", { name: "Save photo" }).click();
  await expect(page.getByRole("heading", { name: "Steel/Reinforcement" })).toBeVisible();
  await waitForSynced(page);

  const token = await apiToken("pm@bluelagoon.test");
  const [whitfield] = await apiGet<{ id: string }[]>(token, "/projects?q=Whitfield");
  await expect
    .poll(async () => {
      const photos = await apiGet<{ caption: string | null; uploadStatus: string; taskId: string | null; stageId: string | null }[]>(token, `/projects/${whitfield!.id}/photos`);
      const p = photos.find((x) => x.caption === "Rebar tied at north wall");
      return p ? `${p.uploadStatus}:${!!p.taskId}:${!!p.stageId}` : "missing";
    }, { timeout: 30_000 })
    .toMatch(/^(uploaded|processed):true:true$/);
});
