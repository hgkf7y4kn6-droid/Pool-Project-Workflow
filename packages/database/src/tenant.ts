import { eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "./index";
import * as s from "./schema";

/**
 * Permanently delete an organization and all of its data. Project-scoped rows
 * go first (they reference catalog rows such as materials, users and clients
 * that are protected by non-cascading foreign keys during normal operation),
 * then the organization itself cascades to the rest.
 */
export async function deleteOrganization(db: DbOrTx, organizationId: string): Promise<void> {
  const projectIds = (await db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.organizationId, organizationId))).map((p) => p.id);
  if (projectIds.length) {
    await db.delete(s.materialUsage).where(inArray(s.materialUsage.projectId, projectIds));
    await db.delete(s.laborEntries).where(inArray(s.laborEntries.projectId, projectIds));
    await db.delete(s.messages).where(inArray(s.messages.projectId, projectIds));
    await db.delete(s.projects).where(inArray(s.projects.id, projectIds));
  }
  await db.delete(s.organizations).where(eq(s.organizations.id, organizationId));
}
