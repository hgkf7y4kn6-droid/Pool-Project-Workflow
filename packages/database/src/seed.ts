import { eq } from "drizzle-orm";
import {
  DEFAULT_INSPECTION_TEMPLATES,
  DEFAULT_STAGE_TEMPLATES,
  WorkCalendar,
  computeCompletionPct,
  planStages,
  todayISO,
} from "@pool/core";
import type { OrganizationSettings, ProjectStatus, ProjectType, Role } from "@pool/types";
import type { Database } from "./index";
import { hashPassword } from "./password";
import * as s from "./schema";

/**
 * Demo data for development, QA and sales demos: one pool company with a
 * full team, five projects at different lifecycle phases, schedules,
 * checklists, budgets, change orders, payments, inspections, messages and
 * activity.
 *
 * Every demo login uses DEMO_PASSWORD.
 */
export const DEMO_PASSWORD = "PoolDemo2026!";
export const DEMO_ORG_SLUG = "blue-lagoon-pools";

export const DEMO_USERS: { key: string; email: string; fullName: string; role: Role; rate: number }[] = [
  { key: "admin", email: "admin@bluelagoon.test", fullName: "Avery Morgan", role: "admin", rate: 0 },
  { key: "pm", email: "pm@bluelagoon.test", fullName: "Morgan Lee", role: "project_manager", rate: 5500 },
  { key: "designer", email: "designer@bluelagoon.test", fullName: "Riley Chen", role: "designer", rate: 4800 },
  { key: "super", email: "super@bluelagoon.test", fullName: "Sam Ortega", role: "field_supervisor", rate: 4200 },
  { key: "worker", email: "worker@bluelagoon.test", fullName: "Jordan Diaz", role: "field_worker", rate: 3200 },
  { key: "worker2", email: "worker2@bluelagoon.test", fullName: "Casey Brooks", role: "field_worker", rate: 3000 },
  { key: "sub", email: "sub@deserttile.test", fullName: "Pat Kim", role: "subcontractor", rate: 0 },
  { key: "client", email: "client@example.test", fullName: "Dana Whitfield", role: "client", rate: 0 },
];

export const DEFAULT_ORG_SETTINGS: OrganizationSettings = {
  budgetAlertThresholdPct: 90,
  clientCanSeeContractAmount: true,
  crewLocationSharingEnabled: false,
  weather: { rainProbabilityPct: 60, windSpeedKph: 40, minTempC: 4, maxTempC: 43 },
};

interface SeedOptions {
  /** Delete and recreate the demo organization if it already exists. */
  force?: boolean;
  today?: string;
  log?: (msg: string) => void;
}

export async function seed(db: Database, options: SeedOptions = {}): Promise<{ organizationId: string } | null> {
  const log = options.log ?? (() => undefined);
  const existing = await db.query.organizations.findFirst({ where: eq(s.organizations.slug, DEMO_ORG_SLUG) });
  if (existing && !options.force) {
    log(`Demo organization already exists (${existing.id}); pass --force to recreate it.`);
    return null;
  }

  const tz = "America/Phoenix";
  const today = options.today ?? todayISO(tz);
  const calendar = new WorkCalendar();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  return db.transaction(async (tx) => {
    if (existing) {
      // Users and projects cascade from the organization.
      await tx.delete(s.organizations).where(eq(s.organizations.id, existing.id));
    }

    const [org] = await tx
      .insert(s.organizations)
      .values({ name: "Blue Lagoon Pools", slug: DEMO_ORG_SLUG, timezone: tz, currency: "USD", settings: DEFAULT_ORG_SETTINGS })
      .returning();
    const orgId = org!.id;

    // --- Clients & properties ------------------------------------------------
    const clientDefs = [
      {
        key: "whitfield",
        firstName: "Dana",
        lastName: "Whitfield",
        email: "client@example.test",
        phone: "(480) 555-0141",
        address: { line1: "4821 E Desert Willow Rd", city: "Phoenix", region: "AZ", postalCode: "85044", country: "US" },
        lat: 33.3236,
        lng: -111.9877,
      },
      {
        key: "ortiz",
        firstName: "Marcus",
        lastName: "Ortiz",
        email: "marcus.ortiz@example.test",
        phone: "(602) 555-0178",
        address: { line1: "1290 W Palo Verde Dr", city: "Chandler", region: "AZ", postalCode: "85224", country: "US" },
        lat: 33.3062,
        lng: -111.8413,
      },
      {
        key: "shah",
        firstName: "Priya",
        lastName: "Shah",
        email: "priya.shah@example.test",
        phone: "(480) 555-0102",
        address: { line1: "7755 N Saguaro Vista", city: "Scottsdale", region: "AZ", postalCode: "85258", country: "US" },
        lat: 33.5531,
        lng: -111.8996,
      },
      {
        key: "becker",
        firstName: "Tom",
        lastName: "Becker",
        email: "tom.becker@example.test",
        phone: "(623) 555-0190",
        address: { line1: "302 S Mesquite Ln", city: "Gilbert", region: "AZ", postalCode: "85233", country: "US" },
        lat: 33.3528,
        lng: -111.789,
      },
      {
        key: "garcia",
        firstName: "Luis",
        lastName: "Garcia",
        email: "luis.garcia@example.test",
        phone: "(480) 555-0133",
        address: { line1: "9910 E Ironwood Ct", city: "Mesa", region: "AZ", postalCode: "85212", country: "US" },
        lat: 33.3796,
        lng: -111.6457,
      },
    ];
    const clientIds: Record<string, string> = {};
    const propertyIds: Record<string, string> = {};
    for (const c of clientDefs) {
      const [client] = await tx
        .insert(s.clients)
        .values({
          organizationId: orgId,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          phone: c.phone,
          preferredContact: "phone",
          mailingAddress: c.address,
        })
        .returning();
      clientIds[c.key] = client!.id;
      const [property] = await tx
        .insert(s.properties)
        .values({
          organizationId: orgId,
          clientId: client!.id,
          address: c.address,
          city: c.address.city,
          latitude: c.lat,
          longitude: c.lng,
          lotWidthFt: 80,
          lotDepthFt: 120,
          lotAreaSqft: 9600,
          existingStructures: "Single-story home, covered patio (12×30 ft), detached shed in NE corner.",
          existingLandscaping: "Desert landscaping with two mature palo verde trees along the east wall.",
          utilityLocations: [
            { kind: "gas", description: "Gas meter on west side of house; line runs along west wall." },
            { kind: "electric", description: "Main panel on north wall next to the patio door." },
            { kind: "irrigation", description: "Drip zone valves near the shed." },
          ],
          accessRestrictions: "Side yard access via RV gate on east side. HOA requires work hours 7am–5pm.",
          gateWidthIn: 120,
          gateNotes: "RV gate (10 ft). Remove block wall section if larger equipment needed.",
          equipmentLocation: "Behind the shed, NE corner, 5 ft from the property line.",
          hoaName: "Desert Willow Estates HOA",
          siteNotes: "Dog in yard — coordinate with homeowner before arriving.",
        })
        .returning();
      propertyIds[c.key] = property!.id;
    }

    // --- Users & teams ---------------------------------------------------------
    const userIds: Record<string, string> = {};
    for (const u of DEMO_USERS) {
      const [user] = await tx
        .insert(s.users)
        .values({
          organizationId: orgId,
          email: u.email,
          fullName: u.fullName,
          role: u.role,
          passwordHash,
          defaultHourlyCostCents: u.rate,
          clientId: u.role === "client" ? clientIds.whitfield : null,
          phone: "(480) 555-01" + String(10 + DEMO_USERS.indexOf(u)),
        })
        .returning();
      userIds[u.key] = user!.id;
    }
    const [crew] = await tx
      .insert(s.teams)
      .values({ organizationId: orgId, name: "Crew A", kind: "crew", leadUserId: userIds.super })
      .returning();
    await tx.insert(s.teamMembers).values(
      ["super", "worker", "worker2"].map((k) => ({ teamId: crew!.id, userId: userIds[k]! })),
    );
    const [office] = await tx.insert(s.teams).values({ organizationId: orgId, name: "Office", kind: "office" }).returning();
    await tx.insert(s.teamMembers).values(["admin", "pm"].map((k) => ({ teamId: office!.id, userId: userIds[k]! })));

    // --- Templates ---------------------------------------------------------------
    const templates = await tx
      .insert(s.stageTemplates)
      .values(
        DEFAULT_STAGE_TEMPLATES.map((t, i) => ({
          organizationId: orgId,
          key: t.key,
          name: t.name,
          sortOrder: i,
          defaultDurationDays: t.defaultDurationDays,
          isMilestone: t.isMilestone,
          weatherSensitive: t.weatherSensitive,
          checklist: t.checklist,
        })),
      )
      .returning();
    const inspectionTemplates = await tx
      .insert(s.inspectionTemplates)
      .values(DEFAULT_INSPECTION_TEMPLATES.map((t) => ({ organizationId: orgId, ...t })))
      .returning();

    // --- Vendors & materials --------------------------------------------------------
    const vendorRows = await tx
      .insert(s.vendors)
      .values([
        { organizationId: orgId, name: "Valley Pool Supply", kind: "supplier" as const, trade: "Equipment & plumbing", phone: "(602) 555-0110", latitude: 33.4152, longitude: -111.8315 },
        { organizationId: orgId, name: "Desert Tile Pros", kind: "subcontractor" as const, trade: "Tile & coping", phone: "(480) 555-0122", contactName: "Pat Kim", portalUserId: userIds.sub },
        { organizationId: orgId, name: "Sonoran Gunite", kind: "subcontractor" as const, trade: "Gunite / shotcrete", phone: "(623) 555-0155" },
        { organizationId: orgId, name: "Copper State Rentals", kind: "rental" as const, trade: "Excavators & skid steers", phone: "(602) 555-0177" },
      ])
      .returning();
    const vendor = Object.fromEntries(vendorRows.map((v) => [v.name, v.id]));
    const materialRows = await tx
      .insert(s.materials)
      .values([
        { organizationId: orgId, sku: "PMP-VS-27", name: "Variable-speed pump 2.7 HP", category: "Equipment", unit: "ea", unitCostCents: 1_349_00, preferredVendorId: vendor["Valley Pool Supply"] },
        { organizationId: orgId, sku: "FLT-CRT-520", name: "Cartridge filter 520 sq ft", category: "Equipment", unit: "ea", unitCostCents: 899_00, preferredVendorId: vendor["Valley Pool Supply"] },
        { organizationId: orgId, sku: "HTR-HP-140", name: "Heat pump 140k BTU", category: "Equipment", unit: "ea", unitCostCents: 4_150_00, preferredVendorId: vendor["Valley Pool Supply"] },
        { organizationId: orgId, sku: "PVC-2-SCH40", name: "2\" Schedule 40 PVC", category: "Plumbing", unit: "ft", unitCostCents: 2_35, preferredVendorId: vendor["Valley Pool Supply"] },
        { organizationId: orgId, sku: "RBR-4", name: "#4 rebar", category: "Steel", unit: "ft", unitCostCents: 85 },
        { organizationId: orgId, sku: "TIL-GLS-6", name: "6×6 glass waterline tile", category: "Tile", unit: "sqft", unitCostCents: 18_50 },
        { organizationId: orgId, sku: "CPG-TRV-12", name: "Travertine coping 12\"", category: "Coping", unit: "lf", unitCostCents: 22_00 },
        { organizationId: orgId, sku: "PLS-PBL-MID", name: "Pebble finish – Midnight", category: "Finish", unit: "bag", unitCostCents: 64_00 },
      ])
      .returning();
    const material = Object.fromEntries(materialRows.map((m) => [m.sku!, m]));

    // --- Projects --------------------------------------------------------------------
    interface ProjectDef {
      key: string;
      number: string;
      name: string;
      status: ProjectStatus;
      type: ProjectType;
      contract: number;
      estimate: number;
      /** Working days from today to the planned start (negative = already started). */
      startOffset: number;
      /** Stages with sortOrder < this are completed, this one is in progress. */
      progressStage: number;
      description: string;
    }
    const defs: ProjectDef[] = [
      {
        key: "whitfield",
        number: "BLP-2026-014",
        name: "Whitfield Backyard Oasis",
        status: "construction",
        type: "new_construction",
        contract: 96_500_00,
        estimate: 71_200_00,
        startOffset: -34,
        progressStage: 6,
        description: "32×16 ft freeform pool with attached spa, travertine deck, sun shelf and LED lighting.",
      },
      {
        key: "ortiz",
        number: "BLP-2026-017",
        name: "Ortiz Pool Renovation",
        status: "procurement",
        type: "renovation",
        contract: 48_900_00,
        estimate: 35_400_00,
        startOffset: -13,
        progressStage: 3,
        description: "Resurface, new waterline tile and coping, equipment replacement and deck refinishing.",
      },
      {
        key: "shah",
        number: "BLP-2026-019",
        name: "Shah Spa Addition",
        status: "design",
        type: "spa",
        contract: 38_000_00,
        estimate: 27_100_00,
        startOffset: -4,
        progressStage: 1,
        description: "Raised 8×8 ft spa with spillway into the existing pool and stacked-stone veneer.",
      },
      {
        key: "becker",
        number: "BLP-2026-006",
        name: "Becker Equipment Upgrade",
        status: "completed",
        type: "equipment_upgrade",
        contract: 12_400_00,
        estimate: 8_900_00,
        startOffset: -70,
        progressStage: 99,
        description: "Replace single-speed pump and DE filter with variable-speed pump and cartridge filter.",
      },
      {
        key: "garcia",
        number: "BLP-2026-022",
        name: "Garcia Lap Pool",
        status: "lead",
        type: "new_construction",
        contract: 0,
        estimate: 0,
        startOffset: 30,
        progressStage: -1,
        description: "Homeowner requested a 50 ft lap lane along the north fence. Site visit scheduled.",
      },
    ];

    const stageTemplatesForPlan = templates.map((t) => ({
      key: t.key,
      name: t.name,
      sortOrder: t.sortOrder,
      defaultDurationDays: t.defaultDurationDays,
      isMilestone: t.isMilestone,
      weatherSensitive: t.weatherSensitive,
      checklist: t.checklist,
    }));
    // Small/renovation projects skip new-construction stages.
    const stageKeysFor = (type: ProjectType) =>
      type === "equipment_upgrade"
        ? ["contract", "equipment", "startup", "walkthrough", "completion"]
        : type === "renovation"
          ? ["contract", "design", "permits", "tile", "coping", "decking", "equipment", "interior_finish", "startup", "inspection", "walkthrough", "completion"]
          : stageTemplatesForPlan.map((t) => t.key);

    const projectIds: Record<string, string> = {};
    const stageTaskIds: Record<string, Record<string, string>> = {};
    const actorName = (k: string) => DEMO_USERS.find((u) => u.key === k)!.fullName;

    for (const def of defs) {
      const start = calendar.addWorkingDays(today, def.startOffset);
      const keys = stageKeysFor(def.type);
      const { stages, completionDate } = planStages(
        stageTemplatesForPlan.filter((t) => keys.includes(t.key)),
        start,
        calendar,
      );
      const completed = def.status === "completed";
      const [project] = await tx
        .insert(s.projects)
        .values({
          organizationId: orgId,
          number: def.number,
          name: def.name,
          clientId: clientIds[def.key]!,
          propertyId: propertyIds[def.key]!,
          projectManagerId: userIds.pm,
          crewTeamId: def.status === "lead" ? null : crew!.id,
          status: def.status,
          type: def.type,
          description: def.description,
          contractAmountCents: def.contract,
          estimatedCostCents: def.estimate,
          plannedStartDate: def.status === "lead" ? null : start,
          plannedCompletionDate: def.status === "lead" ? null : completionDate,
          projectedCompletionDate:
            def.key === "whitfield" ? calendar.addWorkingDays(completionDate, 2) : def.status === "lead" ? null : completionDate,
          actualStartDate: def.startOffset < 0 ? start : null,
          actualCompletionDate: completed ? completionDate : null,
          createdBy: userIds.pm,
          updatedBy: userIds.pm,
        })
        .returning();
      const projectId = project!.id;
      projectIds[def.key] = projectId;

      const members: { userId: string; role: Role }[] = [
        { userId: userIds.pm!, role: "project_manager" },
        { userId: userIds.designer!, role: "designer" },
      ];
      if (def.status !== "lead") {
        members.push(
          { userId: userIds.super!, role: "field_supervisor" },
          { userId: userIds.worker!, role: "field_worker" },
          { userId: userIds.worker2!, role: "field_worker" },
        );
      }
      if (def.key === "whitfield") members.push({ userId: userIds.sub!, role: "subcontractor" });
      await tx.insert(s.projectMembers).values(members.map((m) => ({ projectId, ...m, addedBy: userIds.pm })));

      if (def.status === "lead") {
        await tx.insert(s.activityLogs).values({
          organizationId: orgId,
          projectId,
          actorId: userIds.pm,
          actorName: actorName("pm"),
          action: "project.created",
          entityType: "project",
          entityId: projectId,
          summary: `${actorName("pm")} created lead ${def.name}`,
        });
        continue;
      }

      // Stages + one stage task each, chained FS, with template checklists.
      stageTaskIds[def.key] = {};
      let previousTaskId: string | null = null;
      const stageStatuses: { key: string; status: "completed" | "in_progress" | "not_started" }[] = [];
      for (const [i, st] of stages.entries()) {
        const status = i < def.progressStage ? "completed" : i === def.progressStage ? "in_progress" : "not_started";
        stageStatuses.push({ key: st.key, status });
        const [stage] = await tx
          .insert(s.projectStages)
          .values({
            projectId,
            key: st.key,
            name: st.name,
            sortOrder: i,
            status,
            isMilestone: st.isMilestone,
            plannedStartDate: st.plannedStartDate,
            plannedEndDate: st.plannedEndDate,
            actualStartDate: status !== "not_started" ? st.plannedStartDate : null,
            actualEndDate: status === "completed" ? st.plannedEndDate : null,
          })
          .returning();
        const isWhitfieldSteel = def.key === "whitfield" && st.key === "steel";
        const assignee =
          st.key === "tile" || st.key === "coping" ? userIds.sub : ["design"].includes(st.key) ? userIds.designer : ["contract", "permits"].includes(st.key) ? userIds.pm : userIds.super;
        const [task] = await tx
          .insert(s.tasks)
          .values({
            projectId,
            stageId: stage!.id,
            title: st.name,
            description: `${st.name} for ${def.name}.`,
            status: status === "completed" ? "done" : status === "in_progress" ? "in_progress" : "todo",
            priority: isWhitfieldSteel ? "high" : "normal",
            assigneeId: assignee,
            crewTeamId: crew!.id,
            isMilestone: st.isMilestone,
            plannedStartDate: st.plannedStartDate,
            plannedEndDate: st.plannedEndDate,
            actualStartDate: status !== "not_started" ? st.plannedStartDate : null,
            actualEndDate: status === "completed" ? st.plannedEndDate : null,
            durationDays: st.durationDays,
            estimatedHours: st.durationDays * 16,
            actualHours: status === "completed" ? st.durationDays * 17 : status === "in_progress" ? 10 : 0,
            weatherSensitive: st.weatherSensitive,
            dueDate: st.plannedEndDate,
            completedAt: status === "completed" ? `${st.plannedEndDate}T23:00:00Z` : null,
            completedBy: status === "completed" ? userIds.super : null,
            createdBy: userIds.pm,
          })
          .returning();
        stageTaskIds[def.key]![st.key] = task!.id;
        if (st.checklist.length) {
          await tx.insert(s.checklistItems).values(
            st.checklist.map((item, n) => ({
              taskId: task!.id,
              projectId,
              label: item.label,
              required: item.required,
              requiresPhoto: !!item.requiresPhoto,
              sortOrder: n,
              isChecked: status === "completed" || (status === "in_progress" && n === 0),
              checkedAt: status === "completed" ? `${st.plannedEndDate}T22:00:00Z` : null,
              checkedBy: status === "completed" ? userIds.super : null,
            })),
          );
        }
        if (previousTaskId) {
          await tx.insert(s.taskDependencies).values({ projectId, predecessorId: previousTaskId, successorId: task!.id, type: "FS" });
        }
        previousTaskId = task!.id;
      }
      await tx
        .update(s.projects)
        .set({ completionPct: completed ? 100 : computeCompletionPct(stageStatuses) })
        .where(eq(s.projects.id, projectId));

      // Budget
      const [budget] = await tx.insert(s.budgets).values({ projectId, contingencyPct: 5 }).returning();
      const ratio = def.estimate / 71_200_00;
      const lines: { category: (typeof s.budgetCategoryEnum.enumValues)[number]; description: string; amount: number }[] = [
        { category: "labor", description: "Crew labor", amount: 16_500_00 },
        { category: "materials", description: "Steel, plumbing, electrical materials", amount: 14_800_00 },
        { category: "equipment", description: "Pool equipment package", amount: 9_400_00 },
        { category: "subcontractor", description: "Gunite, tile, coping and finish subs", amount: 24_200_00 },
        { category: "permits", description: "Permits, engineering and inspections", amount: 2_300_00 },
        { category: "overhead", description: "Dumpsters, rentals and site protection", amount: 4_000_00 },
      ];
      await tx.insert(s.budgetItems).values(
        lines.map((l) => {
          const cents = Math.round(l.amount * ratio);
          return { budgetId: budget!.id, projectId, category: l.category, description: l.description, quantity: 1, unitCostCents: cents, estimatedCents: cents };
        }),
      );

      // Payment schedule: 10% deposit, 30% at gunite, 30% at decking, 30% at completion.
      const payPlan: [string, number, string][] = [
        ["Deposit (10%)", 0.1, "contract"],
        ["Shell complete (30%)", 0.3, "gunite"],
        ["Deck complete (30%)", 0.3, "decking"],
        ["Final payment (30%)", 0.3, "completion"],
      ];
      for (const [label, pct, stageKey] of payPlan) {
        const stage = stages.find((x) => x.key === stageKey);
        const idx = stages.findIndex((x) => x.key === stageKey);
        const paid = completed || (idx >= 0 && idx < def.progressStage);
        await tx.insert(s.payments).values({
          projectId,
          label,
          amountCents: Math.round(def.contract * pct),
          dueDate: stage?.plannedEndDate ?? completionDate,
          status: paid ? "paid" : idx === def.progressStage ? "invoiced" : "scheduled",
          paidAt: paid ? `${stage?.plannedEndDate ?? completionDate}T18:00:00Z` : null,
          method: paid ? "ACH" : null,
        });
      }

      await tx.insert(s.activityLogs).values({
        organizationId: orgId,
        projectId,
        actorId: userIds.pm,
        actorName: actorName("pm"),
        action: "project.created",
        entityType: "project",
        entityId: projectId,
        summary: `${actorName("pm")} created ${def.name}`,
        clientVisible: true,
        createdAt: `${start}T15:00:00Z`,
      });
    }

    // --- Whitfield details: the showcase project ------------------------------------
    const w = projectIds.whitfield!;
    const wTasks = stageTaskIds.whitfield!;
    const steelTask = wTasks.steel!;
    // Labor & expenses on completed work.
    const laborRows = [];
    for (let d = 1; d <= 12; d++) {
      const workDate = calendar.addWorkingDays(today, -d * 2);
      laborRows.push(
        { projectId: w, taskId: wTasks.excavation, userId: userIds.worker!, workDate, hours: 8, hourlyCostCents: 3200, createdBy: userIds.worker },
        { projectId: w, taskId: wTasks.plumbing, userId: userIds.worker2!, workDate, hours: 7.5, hourlyCostCents: 3000, createdBy: userIds.worker2 },
      );
    }
    laborRows.push({ projectId: w, taskId: steelTask, userId: userIds.super!, workDate: today, hours: 4, hourlyCostCents: 4200, createdBy: userIds.super, notes: "Steel layout and tie-in" });
    await tx.insert(s.laborEntries).values(laborRows);
    await tx.insert(s.expenses).values([
      { projectId: w, category: "equipment", vendorId: vendor["Copper State Rentals"], description: "Excavator rental (3 days)", amountCents: 2_850_00, incurredOn: calendar.addWorkingDays(today, -20), createdBy: userIds.super },
      { projectId: w, category: "materials", vendorId: vendor["Valley Pool Supply"], description: "Plumbing fittings and PVC", amountCents: 3_120_45, incurredOn: calendar.addWorkingDays(today, -14), createdBy: userIds.super },
      { projectId: w, category: "permits", description: "City of Phoenix pool permit", amountCents: 1_480_00, incurredOn: calendar.addWorkingDays(today, -28), createdBy: userIds.pm },
      { projectId: w, category: "overhead", description: "Dumpster haul-off", amountCents: 690_00, incurredOn: calendar.addWorkingDays(today, -18), createdBy: userIds.pm },
      { projectId: w, category: "materials", description: "#4 rebar delivery", amountCents: 4_310_00, incurredOn: calendar.addWorkingDays(today, -2), createdBy: userIds.super },
    ]);
    await tx.insert(s.materialUsage).values([
      { projectId: w, materialId: material["PVC-2-SCH40"]!.id, taskId: wTasks.plumbing, quantityPlanned: 420, quantityUsed: 395, unitCostCents: 2_35, status: "installed" as const },
      { projectId: w, materialId: material["RBR-4"]!.id, taskId: steelTask, quantityPlanned: 1800, quantityUsed: 900, unitCostCents: 85, status: "delivered" as const },
      { projectId: w, materialId: material["PMP-VS-27"]!.id, taskId: wTasks.equipment, quantityPlanned: 1, quantityUsed: 0, unitCostCents: 1_349_00, status: "ordered" as const, orderedAt: today },
      { projectId: w, materialId: material["FLT-CRT-520"]!.id, taskId: wTasks.equipment, quantityPlanned: 1, quantityUsed: 0, unitCostCents: 899_00, status: "ordered" as const, orderedAt: today },
      { projectId: w, materialId: material["TIL-GLS-6"]!.id, taskId: wTasks.tile, quantityPlanned: 110, quantityUsed: 0, unitCostCents: 18_50, status: "planned" as const },
    ]);

    // A field task with a problem report for today.
    const [problemTask] = await tx
      .insert(s.tasks)
      .values({
        projectId: w,
        stageId: null,
        title: "Relocate irrigation line at deep end",
        description: "Drip line found 18\" below grade crossing the deep end footprint.",
        status: "blocked",
        priority: "urgent",
        assigneeId: userIds.worker,
        plannedStartDate: today,
        plannedEndDate: today,
        durationDays: 1,
        dueDate: today,
        createdBy: userIds.super,
      })
      .returning();
    await tx.insert(s.taskNotes).values({
      taskId: problemTask!.id,
      projectId: w,
      body: "Line is live — need homeowner to shut off the irrigation controller before we cut it.",
      isProblem: true,
      createdBy: userIds.worker,
    });
    // Overdue punch task
    await tx.insert(s.tasks).values({
      projectId: w,
      title: "Submit steel inspection request",
      status: "todo",
      priority: "high",
      assigneeId: userIds.pm,
      plannedStartDate: calendar.addWorkingDays(today, -2),
      plannedEndDate: calendar.addWorkingDays(today, -2),
      dueDate: calendar.addWorkingDays(today, -1),
      durationDays: 1,
      createdBy: userIds.super,
    });

    // Change orders: one approved, one awaiting the client.
    const [co1] = await tx
      .insert(s.changeOrders)
      .values({
        projectId: w,
        number: 1,
        title: "Add spa jets (6) and air blower",
        description: "Add six hydrotherapy jets and an air blower to the attached spa.",
        reason: "Client request during design review.",
        status: "approved",
        costCents: 2_150_00,
        priceCents: 3_400_00,
        laborHoursImpact: 10,
        materialImpact: "6 jet bodies, 2\" plumbing, 1 HP blower",
        scheduleImpactDays: 1,
        submittedAt: `${calendar.addWorkingDays(today, -25)}T16:00:00Z`,
        decidedAt: `${calendar.addWorkingDays(today, -24)}T19:30:00Z`,
        decidedBy: userIds.client,
        signatureName: "Dana Whitfield",
        createdBy: userIds.pm,
      })
      .returning();
    const [co2] = await tx
      .insert(s.changeOrders)
      .values({
        projectId: w,
        number: 2,
        title: "Upgrade to color LED lighting package",
        description: "Replace two white LED fixtures with three color-changing LEDs and add app-controlled automation.",
        reason: "Client request after seeing a neighbor's pool.",
        status: "client_review",
        costCents: 1_380_00,
        priceCents: 2_290_00,
        laborHoursImpact: 4,
        materialImpact: "3 color LED fixtures, automation module",
        scheduleImpactDays: 0,
        submittedAt: `${calendar.addWorkingDays(today, -1)}T17:00:00Z`,
        createdBy: userIds.pm,
      })
      .returning();
    await tx.insert(s.approvals).values({
      projectId: w,
      subjectType: "change_order",
      subjectId: co2!.id,
      title: "Change Order #2: Color LED lighting package",
      description: "Please review and sign to approve the lighting upgrade ($2,290.00).",
      requestedFrom: userIds.client,
      dueDate: calendar.addWorkingDays(today, 3),
      createdBy: userIds.pm,
    });

    // Inspection scheduled before gunite.
    const preGunite = inspectionTemplates.find((t) => t.inspectionType === "pre_gunite")!;
    await tx.insert(s.inspections).values({
      projectId: w,
      templateId: preGunite.id,
      inspectionType: preGunite.inspectionType,
      inspectorName: "City of Phoenix – Inspection Services",
      inspectorOrg: "City of Phoenix",
      scheduledFor: calendar.addWorkingDays(today, 2),
      result: "pending",
      items: preGunite.items.map((i) => ({ key: i.key, label: i.label, result: "pending" as const })),
      createdBy: userIds.pm,
    });

    // Measurements captured on site.
    const measuredAt = `${calendar.addWorkingDays(today, -30)}T17:10:00Z`;
    await tx.insert(s.measurements).values([
      { projectId: w, propertyId: propertyIds.whitfield, category: "pool", label: "Pool length", value: 32, unit: "ft", measuredAt, createdBy: userIds.designer },
      { projectId: w, propertyId: propertyIds.whitfield, category: "pool", label: "Pool width", value: 16, unit: "ft", measuredAt, createdBy: userIds.designer },
      { projectId: w, propertyId: propertyIds.whitfield, category: "depth", label: "Depth profile", value: 6, unit: "ft", measuredAt, createdBy: userIds.designer, geometry: { type: "profile", stations: [ { distance: 0, depth: 3.5 }, { distance: 12, depth: 4 }, { distance: 22, depth: 6 }, { distance: 32, depth: 5.5 } ] } },
      { projectId: w, propertyId: propertyIds.whitfield, category: "deck", label: "Deck area", value: 640, unit: "sqft", measuredAt, createdBy: userIds.designer },
      { projectId: w, propertyId: propertyIds.whitfield, category: "elevation", label: "Bond beam elevation vs. patio slab", value: -2, unit: "in", measuredAt, createdBy: userIds.super },
      { projectId: w, propertyId: propertyIds.whitfield, category: "property", label: "Setback to rear wall", value: 7.5, unit: "ft", measuredAt, createdBy: userIds.designer, geometry: { type: "line", points: [[0, 0], [7.5, 0]] } },
    ]);

    // Messages (client thread + internal crew thread).
    const msg = (authorKey: string, body: string, visibility: "internal" | "client", hoursAgo: number) => ({
      projectId: w,
      authorId: userIds[authorKey]!,
      body,
      visibility,
      threadKey: visibility === "client" ? "client" : "crew",
      createdAt: new Date(Date.parse(`${today}T20:00:00Z`) - hoursAgo * 3_600_000).toISOString(),
    });
    await tx.insert(s.messages).values([
      msg("pm", "Hi Dana — steel is going in this week. We'll schedule the city inspection as soon as it's tied off.", "client", 30),
      msg("client", "Great, thank you! Will the crew need the side gate open on Thursday?", "client", 26),
      msg("pm", "Yes please, from 7am. I've also sent the lighting change order for your review.", "client", 25),
      msg("super", "Irrigation line in the deep end footprint. Waiting on homeowner to shut it off.", "internal", 3),
      msg("pm", "Called Dana — controller is off as of 1pm. Go ahead.", "internal", 2),
    ]);

    // Shah: design project
    const [design] = await tx
      .insert(s.designProjects)
      .values({
        projectId: projectIds.shah!,
        provider: "manual",
        title: "Raised spa concept A",
        status: "in_review",
        summary: {
          poolShape: "Square spa with spillway",
          lengthFt: 8,
          widthFt: 8,
          shallowDepthFt: 3,
          deepDepthFt: 3.5,
          surfaceAreaSqft: 64,
          volumeGallons: 1450,
          features: ["18\" raised wall", "Sheer spillway", "Stacked-stone veneer", "Color LED"],
          equipment: [{ name: "Heat pump 140k BTU", location: "Existing equipment pad" }],
        },
        createdBy: userIds.designer,
      })
      .returning();
    await tx.insert(s.designModels).values({
      designProjectId: design!.id,
      kind: "model_3d",
      title: "Parametric preview",
      format: "parametric",
      createdBy: userIds.designer,
    });
    await tx.insert(s.approvals).values({
      projectId: projectIds.shah!,
      subjectType: "design",
      subjectId: design!.id,
      title: "Approve spa design concept A",
      requestedFrom: null,
      dueDate: calendar.addWorkingDays(today, 5),
      createdBy: userIds.designer,
    });

    // Becker: completed with a passed final inspection.
    const finalTpl = inspectionTemplates.find((t) => t.inspectionType === "final")!;
    await tx.insert(s.inspections).values({
      projectId: projectIds.becker!,
      templateId: finalTpl.id,
      inspectionType: "final",
      inspectorName: "Gilbert Building Safety",
      inspectedAt: `${calendar.addWorkingDays(today, -40)}T16:00:00Z`,
      result: "pass",
      items: finalTpl.items.map((i) => ({ key: i.key, label: i.label, result: "pass" as const })),
      createdBy: userIds.super,
    });

    // Recent activity on the showcase project.
    const activity: [string, (typeof s.activityActionEnum.enumValues)[number], string, string, boolean, number][] = [
      ["super", "task.completed", "task", "Sam Ortega completed Electrical", true, 50],
      ["worker", "photo.uploaded", "photo", "Jordan Diaz uploaded 8 progress photos", true, 28],
      ["client", "change_order.status_changed", "change_order", "Dana Whitfield approved Change Order #1", true, 400],
      ["pm", "change_order.created", "change_order", "Morgan Lee sent Change Order #2 for client review", true, 24],
      ["pm", "schedule.shifted", "project", "Project schedule moved 2 days due to weather", true, 22],
      ["worker", "task.problem_reported", "task", "Jordan Diaz reported a problem: irrigation line in deep end", false, 3],
    ];
    await tx.insert(s.activityLogs).values(
      activity.map(([actor, action, entityType, summary, clientVisible, hoursAgo]) => ({
        organizationId: orgId,
        projectId: w,
        actorId: userIds[actor],
        actorName: actorName(actor),
        action,
        entityType,
        entityId: entityType === "change_order" ? (action === "change_order.created" ? co2!.id : co1!.id) : null,
        summary,
        clientVisible,
        createdAt: new Date(Date.parse(`${today}T20:00:00Z`) - hoursAgo * 3_600_000).toISOString(),
      })),
    );

    // Notifications for the project manager.
    await tx.insert(s.notifications).values([
      {
        organizationId: orgId,
        userId: userIds.pm!,
        projectId: w,
        type: "task_overdue",
        title: "Task overdue",
        body: "Submit steel inspection request was due yesterday.",
        data: { projectId: w },
      },
      {
        organizationId: orgId,
        userId: userIds.pm!,
        projectId: w,
        type: "message_received",
        title: "New message from Dana Whitfield",
        body: "Will the crew need the side gate open on Thursday?",
        data: { projectId: w },
      },
    ]);

    log(`Seeded demo organization ${orgId}. Log in as ${DEMO_USERS[1]!.email} / ${DEMO_PASSWORD}`);
    return { organizationId: orgId };
  });
}
