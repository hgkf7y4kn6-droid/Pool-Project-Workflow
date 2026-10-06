import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { ACTIVE_PROJECT_STATUSES, UPCOMING_PROJECT_STATUSES } from "@pool/types";
import type {
  ActivityLog,
  ChangeOrder,
  ChecklistItem,
  DocumentRecord,
  Inspection,
  Measurement,
  Message,
  Photo,
  Project,
  ProjectStage,
  Task,
  TaskDependency,
  TaskNote,
} from "@pool/types";
import { useLocalQuery } from "@/hooks/use-local-query";
import { api } from "@/lib/api";
import { getRecord, listRecords } from "@/lib/db/records";
import { todayISO } from "@/lib/format";

/*
 * Field data hooks read from the on-device database, so they work offline
 * and update live as sync pulls changes or the user edits something.
 */

export type LocalProject = Project & { clientName?: string; propertyAddress?: string; city?: string; location?: { latitude: number; longitude: number } | null };
export type LocalPhoto = Photo & { localUri?: string | null };

const notDeleted = "json_extract(data, '$.deletedAt') IS NULL";

interface LocalClient { id: string; firstName: string; lastName: string; phone?: string | null; email?: string | null }
interface LocalProperty { id: string; address: { line1: string; city: string; region: string; postalCode: string }; location: { latitude: number; longitude: number } | null }

/** Join client name + address onto pulled project rows (capture once, show everywhere). */
async function enrich(projects: LocalProject[]): Promise<LocalProject[]> {
  if (!projects.length) return projects;
  const clients = new Map((await listRecords<LocalClient>("client")).map((c) => [c.id, c]));
  const properties = new Map((await listRecords<LocalProperty>("property")).map((p) => [p.id, p]));
  return projects.map((p) => {
    const c = clients.get(p.clientId);
    const prop = properties.get(p.propertyId);
    return {
      ...p,
      clientName: p.clientName ?? (c ? `${c.firstName} ${c.lastName}` : undefined),
      propertyAddress: p.propertyAddress ?? (prop ? `${prop.address.line1}, ${prop.address.city}, ${prop.address.region}` : undefined),
      city: p.city ?? prop?.address.city,
      location: p.location ?? prop?.location ?? null,
    };
  });
}

export function useProjects(scope: "all" | "active" | "upcoming" | "completed" | "archived" = "all", search = "") {
  return useLocalQuery(
    async () => {
      const all = await enrich(await listRecords<LocalProject>("project", { order: "desc" }));
      const q = search.trim().toLowerCase();
      return all
        .filter((p) => {
          if (scope === "archived") return !!p.archivedAt;
          if (p.archivedAt) return false;
          if (scope === "active") return ACTIVE_PROJECT_STATUSES.includes(p.status);
          if (scope === "upcoming") return UPCOMING_PROJECT_STATUSES.includes(p.status);
          if (scope === "completed") return p.status === "completed" || p.status === "warranty";
          return true;
        })
        .filter((p) => !q || [p.name, p.number, p.clientName, p.propertyAddress].some((v) => v?.toLowerCase().includes(q)));
    },
    [scope, search],
    ["project", "client", "property"],
  );
}

export function useProject(id: string | undefined) {
  return useLocalQuery(
    async () => {
      const p = id ? await getRecord<LocalProject>("project", id) : null;
      return p ? (await enrich([p]))[0]! : null;
    },
    [id],
    ["project", "client", "property"],
  );
}

export function useStages(projectId: string | undefined) {
  return useLocalQuery(
    () => (projectId ? listRecords<ProjectStage>("stage", { projectId, where: notDeleted }) : Promise.resolve([])),
    [projectId],
    ["stage"],
  );
}

export interface TaskFilter {
  projectId?: string;
  assigneeId?: string;
  due?: "today" | "overdue" | "upcoming" | "open" | "all";
  status?: Task["status"];
  search?: string;
}

export function useTasks(filter: TaskFilter) {
  return useLocalQuery(
    async () => {
      const today = todayISO();
      const rows = await listRecords<Task>("task", { projectId: filter.projectId, where: notDeleted });
      const q = filter.search?.trim().toLowerCase();
      return rows.filter((t) => {
        if (filter.assigneeId && t.assigneeId !== filter.assigneeId) return false;
        if (filter.status && t.status !== filter.status) return false;
        if (q && !t.title.toLowerCase().includes(q)) return false;
        const open = t.status !== "done" && t.status !== "cancelled";
        switch (filter.due) {
          case "today":
            return open && !!t.plannedStartDate && t.plannedStartDate <= today && (t.plannedEndDate ?? t.plannedStartDate) >= today;
          case "overdue":
            return open && !!(t.dueDate ?? t.plannedEndDate) && (t.dueDate ?? t.plannedEndDate)! < today;
          case "upcoming":
            return open && !!t.plannedStartDate && t.plannedStartDate > today;
          case "open":
            return open;
          default:
            return true;
        }
      });
    },
    [filter.projectId, filter.assigneeId, filter.due, filter.status, filter.search],
    ["task"],
  );
}

export function useTask(id: string | undefined) {
  return useLocalQuery(() => (id ? getRecord<Task>("task", id) : Promise.resolve(null)), [id], ["task"]);
}

export function useChecklist(taskId: string | undefined) {
  return useLocalQuery(
    () => (taskId ? listRecords<ChecklistItem>("checklist_item", { parentId: taskId, where: notDeleted }) : Promise.resolve([])),
    [taskId],
    ["checklist_item"],
  );
}

export function useTaskNotes(taskId: string | undefined) {
  return useLocalQuery(
    () => (taskId ? listRecords<TaskNote>("task_note", { parentId: taskId, where: notDeleted, order: "desc" }) : Promise.resolve([])),
    [taskId],
    ["task_note"],
  );
}

export function useDependencies(projectId: string | undefined) {
  return useLocalQuery(
    () => (projectId ? listRecords<TaskDependency>("task_dependency", { projectId, where: notDeleted }) : Promise.resolve([])),
    [projectId],
    ["task_dependency"],
  );
}

export function usePhotos(filter: { projectId?: string; taskId?: string; limit?: number }) {
  return useLocalQuery(
    () =>
      listRecords<LocalPhoto>("photo", {
        projectId: filter.projectId,
        parentId: filter.taskId,
        where: notDeleted,
        order: "desc",
        limit: filter.limit,
      }),
    [filter.projectId, filter.taskId, filter.limit],
    ["photo"],
  );
}

export function useMeasurements(projectId: string | undefined) {
  return useLocalQuery(
    () => (projectId ? listRecords<Measurement>("measurement", { projectId, where: notDeleted }) : Promise.resolve([])),
    [projectId],
    ["measurement"],
  );
}

export function useInspections(projectId: string | undefined) {
  return useLocalQuery(
    () => (projectId ? listRecords<Inspection>("inspection", { projectId, where: notDeleted, order: "desc" }) : Promise.resolve([])),
    [projectId],
    ["inspection"],
  );
}

export function useInspection(id: string | undefined) {
  return useLocalQuery(() => (id ? getRecord<Inspection>("inspection", id) : Promise.resolve(null)), [id], ["inspection"]);
}

export function useMessages(projectId: string | undefined, threadKey?: string) {
  return useLocalQuery(
    () => (projectId ? listRecords<Message>("message", { projectId, parentId: threadKey, where: notDeleted }) : Promise.resolve([])),
    [projectId, threadKey],
    ["message"],
  );
}

export function useActivity(projectId?: string, limit = 50) {
  return useLocalQuery(() => listRecords<ActivityLog>("activity", { projectId, order: "desc", limit }), [projectId, limit], ["activity"]);
}

export function useLocalChangeOrders(projectId: string | undefined) {
  return useLocalQuery(
    () => (projectId ? listRecords<ChangeOrder>("change_order", { projectId, order: "desc" }) : Promise.resolve([])),
    [projectId],
    ["change_order"],
  );
}

export function useLocalDocuments(projectId?: string) {
  return useLocalQuery(() => listRecords<DocumentRecord>("document", { projectId, where: notDeleted }), [projectId], ["document"]);
}

/** Online-only data via the API (cached by React Query). */
export function useApi<T>(key: unknown[], path: string | null, query?: Record<string, string | number | boolean | undefined>, options?: Partial<UseQueryOptions<T>>) {
  return useQuery<T>({
    queryKey: [...key, query],
    queryFn: () => api.get<T>(path!, query),
    enabled: !!path,
    ...options,
  });
}
