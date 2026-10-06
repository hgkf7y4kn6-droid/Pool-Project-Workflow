import type { ChecklistTemplateItem, InspectionTemplateItem } from "@pool/types";

export interface DefaultStageTemplate {
  key: string;
  name: string;
  defaultDurationDays: number;
  isMilestone: boolean;
  /** Relative weight used for the overall completion percentage. */
  weight: number;
  weatherSensitive: boolean;
  /** Visible on the client timeline by default. */
  clientVisible: boolean;
  checklist: ChecklistTemplateItem[];
}

/**
 * The default 17-stage pool construction lifecycle. Organizations copy these
 * into their own `stage_templates` and may rename, reorder, add or remove
 * stages; projects snapshot the template at creation time.
 */
export const DEFAULT_STAGE_TEMPLATES: DefaultStageTemplate[] = [
  {
    key: "contract",
    name: "Contract",
    defaultDurationDays: 2,
    isMilestone: true,
    weight: 1,
    weatherSensitive: false,
    clientVisible: true,
    checklist: [
      { label: "Contract signed by client", required: true },
      { label: "Deposit received", required: true },
      { label: "Scope and inclusions reviewed with client", required: false },
    ],
  },
  {
    key: "design",
    name: "Design",
    defaultDurationDays: 10,
    isMilestone: false,
    weight: 3,
    weatherSensitive: false,
    clientVisible: true,
    checklist: [
      { label: "Site measurements captured", required: true },
      { label: "Design drafted", required: true },
      { label: "3D rendering shared with client", required: false },
      { label: "Client design approval", required: true },
    ],
  },
  {
    key: "permits",
    name: "Permits",
    defaultDurationDays: 15,
    isMilestone: false,
    weight: 2,
    weatherSensitive: false,
    clientVisible: true,
    checklist: [
      { label: "Engineering plans stamped", required: true },
      { label: "Permit application submitted", required: true },
      { label: "HOA approval (if applicable)", required: false },
      { label: "Permit issued and posted on site", required: true },
    ],
  },
  {
    key: "excavation",
    name: "Excavation",
    defaultDurationDays: 3,
    isMilestone: false,
    weight: 8,
    weatherSensitive: true,
    clientVisible: true,
    checklist: [
      { label: "Utilities located and marked (811)", required: true },
      { label: "Pool layout painted and approved", required: true },
      { label: "Access path protected", required: false },
      { label: "Excavation to design depth verified", required: true, requiresPhoto: true },
      { label: "Spoils hauled", required: false },
    ],
  },
  {
    key: "plumbing",
    name: "Plumbing",
    defaultDurationDays: 3,
    isMilestone: false,
    weight: 7,
    weatherSensitive: true,
    clientVisible: true,
    checklist: [
      { label: "Main drains set", required: true },
      { label: "Returns and skimmers plumbed", required: true },
      { label: "Lines pressure tested", required: true, requiresPhoto: true },
    ],
  },
  {
    key: "electrical",
    name: "Electrical",
    defaultDurationDays: 2,
    isMilestone: false,
    weight: 5,
    weatherSensitive: true,
    clientVisible: true,
    checklist: [
      { label: "Bonding grid installed", required: true, requiresPhoto: true },
      { label: "Conduit runs complete", required: true },
      { label: "Light niches set", required: false },
    ],
  },
  {
    key: "steel",
    name: "Steel/Reinforcement",
    defaultDurationDays: 3,
    isMilestone: false,
    weight: 6,
    weatherSensitive: true,
    clientVisible: true,
    checklist: [
      { label: "Rebar placed per engineering", required: true, requiresPhoto: true },
      { label: "Chairs / spacing verified", required: true },
      { label: "Pre-gunite inspection passed", required: true },
    ],
  },
  {
    key: "gunite",
    name: "Gunite/Shotcrete",
    defaultDurationDays: 2,
    isMilestone: false,
    weight: 10,
    weatherSensitive: true,
    clientVisible: true,
    checklist: [
      { label: "Shell shot to design thickness", required: true, requiresPhoto: true },
      { label: "Cure watering schedule given to client", required: true },
    ],
  },
  {
    key: "tile",
    name: "Tile",
    defaultDurationDays: 3,
    isMilestone: false,
    weight: 6,
    weatherSensitive: true,
    clientVisible: true,
    checklist: [
      { label: "Waterline tile set", required: true, requiresPhoto: true },
      { label: "Step markers installed", required: false },
    ],
  },
  {
    key: "coping",
    name: "Coping",
    defaultDurationDays: 3,
    isMilestone: false,
    weight: 6,
    weatherSensitive: true,
    clientVisible: true,
    checklist: [{ label: "Coping set and grouted", required: true, requiresPhoto: true }],
  },
  {
    key: "decking",
    name: "Decking",
    defaultDurationDays: 5,
    isMilestone: false,
    weight: 10,
    weatherSensitive: true,
    clientVisible: true,
    checklist: [
      { label: "Deck forms and slope verified", required: true },
      { label: "Expansion joints placed", required: true },
      { label: "Deck poured / pavers set", required: true, requiresPhoto: true },
    ],
  },
  {
    key: "equipment",
    name: "Equipment",
    defaultDurationDays: 2,
    isMilestone: false,
    weight: 7,
    weatherSensitive: false,
    clientVisible: true,
    checklist: [
      { label: "Equipment pad prepared", required: true },
      { label: "Pump installed", required: true },
      { label: "Filter installed", required: true },
      { label: "Heater installed", required: false },
      { label: "Plumbing connected", required: true },
      { label: "Electrical connected", required: true },
      { label: "Valves installed", required: true },
      { label: "System pressure tested", required: true },
      { label: "Photos captured", required: true, requiresPhoto: true },
      { label: "Supervisor approval", required: true },
    ],
  },
  {
    key: "interior_finish",
    name: "Interior Finish",
    defaultDurationDays: 2,
    isMilestone: false,
    weight: 8,
    weatherSensitive: true,
    clientVisible: true,
    checklist: [
      { label: "Surface prepped and acid washed", required: true },
      { label: "Plaster / pebble applied", required: true, requiresPhoto: true },
      { label: "Fill started immediately", required: true },
    ],
  },
  {
    key: "startup",
    name: "Startup",
    defaultDurationDays: 5,
    isMilestone: false,
    weight: 4,
    weatherSensitive: false,
    clientVisible: true,
    checklist: [
      { label: "Water chemistry balanced", required: true },
      { label: "Equipment programmed", required: true },
      { label: "Brushing schedule completed", required: true },
    ],
  },
  {
    key: "inspection",
    name: "Inspection",
    defaultDurationDays: 1,
    isMilestone: true,
    weight: 2,
    weatherSensitive: false,
    clientVisible: true,
    checklist: [
      { label: "Final inspection scheduled", required: true },
      { label: "Barrier / safety requirements verified", required: true },
      { label: "Final inspection passed", required: true },
    ],
  },
  {
    key: "walkthrough",
    name: "Client Walkthrough",
    defaultDurationDays: 1,
    isMilestone: true,
    weight: 2,
    weatherSensitive: false,
    clientVisible: true,
    checklist: [
      { label: "Pool school / equipment orientation", required: true },
      { label: "Punch list captured", required: true },
      { label: "Client walkthrough sign-off", required: true },
    ],
  },
  {
    key: "completion",
    name: "Completion",
    defaultDurationDays: 1,
    isMilestone: true,
    weight: 1,
    weatherSensitive: false,
    clientVisible: true,
    checklist: [
      { label: "Final payment received", required: true },
      { label: "Warranty documents delivered", required: true },
      { label: "Site cleaned", required: true },
    ],
  },
];

export const DEFAULT_INSPECTION_TEMPLATES: { name: string; inspectionType: string; items: InspectionTemplateItem[] }[] = [
  {
    name: "Pre-Gunite Inspection",
    inspectionType: "pre_gunite",
    items: [
      { key: "steel_spacing", label: "Rebar spacing per plan", required: true },
      { key: "steel_clearance", label: "Steel clearance from earth", required: true },
      { key: "bonding", label: "Equipotential bonding complete", required: true },
      { key: "plumbing_pressure", label: "Plumbing under pressure", required: true },
      { key: "setbacks", label: "Setbacks match approved plan", required: true },
    ],
  },
  {
    name: "Pre-Deck Inspection",
    inspectionType: "pre_deck",
    items: [
      { key: "deck_bonding", label: "Perimeter bonding installed", required: true },
      { key: "forms", label: "Forms and slope verified", required: true },
      { key: "drains", label: "Deck drains placed", required: false },
    ],
  },
  {
    name: "Final Inspection",
    inspectionType: "final",
    items: [
      { key: "barrier", label: "Barrier / fence compliant", required: true },
      { key: "alarms", label: "Door / gate alarms operational", required: true },
      { key: "gfci", label: "GFCI protection verified", required: true },
      { key: "drain_covers", label: "VGB-compliant drain covers", required: true },
      { key: "equipment_labels", label: "Equipment labeled", required: false },
    ],
  },
];

export function stageWeight(key: string): number {
  return DEFAULT_STAGE_TEMPLATES.find((s) => s.key === key)?.weight ?? 3;
}
