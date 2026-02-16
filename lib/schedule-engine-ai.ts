import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  derivePredecessorsFromDependencies,
  normalizeActivityDependencies,
} from "@/lib/scheduler-dependencies";
import type { SchedulerActivity, SchedulerActivityStatus, SchedulerDependencyType } from "@/types/scheduler";

export interface ScheduleGenerationItem {
  description: string;
  quantity: number;
  unit: string;
  sectionName?: string;
  workType?: string;
}

type WorkCategoryId =
  | "site_preparation"
  | "excavation"
  | "foundation"
  | "rcc_columns"
  | "rcc_slab"
  | "masonry"
  | "plumbing_rough_in"
  | "electrical_rough_in"
  | "plaster"
  | "waterproofing"
  | "flooring"
  | "doors_windows"
  | "painting"
  | "finishing"
  | "external";

type UnitGroup = "area" | "volume" | "length" | "count" | "weight" | "lumpsum";

interface CategoryDefinition {
  id: WorkCategoryId;
  name: string;
  order: number;
  unitGroup: UnitGroup;
  productivityPerDay: number;
  minDurationDays: number;
  keywords: string[];
}

interface CategoryAggregate {
  category: CategoryDefinition;
  quantity: number;
  itemCount: number;
  sampleItems: string[];
}

interface DependencyRule {
  predecessor: WorkCategoryId;
  type: SchedulerDependencyType;
  lagDays?: number;
}

const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  {
    id: "site_preparation",
    name: "Site Preparation & Mobilization",
    order: 1,
    unitGroup: "count",
    productivityPerDay: 0.8,
    minDurationDays: 2,
    keywords: ["site clearing", "demolition", "mobilization", "layout", "barricad", "setting out", "survey"],
  },
  {
    id: "excavation",
    name: "Excavation",
    order: 2,
    unitGroup: "volume",
    productivityPerDay: 45,
    minDurationDays: 2,
    keywords: ["excavat", "earthwork", "trench", "pit", "cutting", "filling", "backfill"],
  },
  {
    id: "foundation",
    name: "Footing / Foundation",
    order: 3,
    unitGroup: "volume",
    productivityPerDay: 20,
    minDurationDays: 3,
    keywords: ["foundation", "footing", "raft", "pile cap", "plinth beam", "pcc", "rcc footing"],
  },
  {
    id: "rcc_columns",
    name: "RCC Columns & Vertical Members",
    order: 4,
    unitGroup: "volume",
    productivityPerDay: 14,
    minDurationDays: 3,
    keywords: ["column", "pedestal", "shear wall", "vertical member", "stair core"],
  },
  {
    id: "rcc_slab",
    name: "RCC Beams & Slabs",
    order: 5,
    unitGroup: "area",
    productivityPerDay: 75,
    minDurationDays: 4,
    keywords: ["slab", "beam", "lintel", "deck", "rcc roof", "sunken slab"],
  },
  {
    id: "masonry",
    name: "Masonry / Brickwork",
    order: 6,
    unitGroup: "area",
    productivityPerDay: 120,
    minDurationDays: 4,
    keywords: ["brickwork", "blockwork", "aac", "masonry", "partition wall"],
  },
  {
    id: "plumbing_rough_in",
    name: "Plumbing Rough-In",
    order: 7,
    unitGroup: "length",
    productivityPerDay: 140,
    minDurationDays: 3,
    keywords: ["plumbing", "cpvc", "upvc", "water supply", "drain", "sanitary line", "sewer"],
  },
  {
    id: "electrical_rough_in",
    name: "Electrical Rough-In",
    order: 8,
    unitGroup: "length",
    productivityPerDay: 180,
    minDurationDays: 3,
    keywords: ["electrical", "conduit", "wiring", "cable", "earthing", "switch box", "distribution board"],
  },
  {
    id: "plaster",
    name: "Plastering",
    order: 9,
    unitGroup: "area",
    productivityPerDay: 160,
    minDurationDays: 4,
    keywords: ["plaster", "render", "gypsum", "punning"],
  },
  {
    id: "waterproofing",
    name: "Waterproofing",
    order: 10,
    unitGroup: "area",
    productivityPerDay: 220,
    minDurationDays: 2,
    keywords: ["waterproof", "membrane", "damp proof", "chemical treatment"],
  },
  {
    id: "flooring",
    name: "Flooring & Tiling",
    order: 11,
    unitGroup: "area",
    productivityPerDay: 90,
    minDurationDays: 3,
    keywords: ["flooring", "tile", "vitrified", "granite", "marble", "screed", "paving tile"],
  },
  {
    id: "doors_windows",
    name: "Doors, Windows & Frames",
    order: 12,
    unitGroup: "count",
    productivityPerDay: 16,
    minDurationDays: 2,
    keywords: ["door", "window", "frame", "shutter", "aluminium", "upvc window", "glazing"],
  },
  {
    id: "painting",
    name: "Painting & Coatings",
    order: 13,
    unitGroup: "area",
    productivityPerDay: 260,
    minDurationDays: 3,
    keywords: ["paint", "primer", "putty", "distemper", "emulsion", "coating"],
  },
  {
    id: "finishing",
    name: "Final Finishing & Fixtures",
    order: 14,
    unitGroup: "count",
    productivityPerDay: 6,
    minDurationDays: 3,
    keywords: ["fixture", "sanitary fixture", "false ceiling", "joinery", "hardware", "handover", "snag"],
  },
  {
    id: "external",
    name: "External Development",
    order: 15,
    unitGroup: "area",
    productivityPerDay: 180,
    minDurationDays: 2,
    keywords: ["boundary", "landscape", "external drain", "road", "driveway", "compound", "storm water"],
  },
];

const DEPENDENCY_RULES: Partial<Record<WorkCategoryId, DependencyRule[]>> = {
  excavation: [{ predecessor: "site_preparation", type: "FS" }],
  foundation: [{ predecessor: "excavation", type: "FS" }],
  rcc_columns: [{ predecessor: "foundation", type: "SS", lagDays: 2 }],
  rcc_slab: [{ predecessor: "rcc_columns", type: "FS", lagDays: 1 }],
  masonry: [{ predecessor: "rcc_slab", type: "SS", lagDays: 2 }],
  plumbing_rough_in: [{ predecessor: "masonry", type: "SS", lagDays: 2 }],
  electrical_rough_in: [{ predecessor: "masonry", type: "SS", lagDays: 2 }],
  plaster: [
    { predecessor: "masonry", type: "FS", lagDays: 1 },
    { predecessor: "plumbing_rough_in", type: "FS" },
    { predecessor: "electrical_rough_in", type: "FS" },
  ],
  waterproofing: [{ predecessor: "plaster", type: "FS", lagDays: 1 }],
  flooring: [
    { predecessor: "plaster", type: "FS", lagDays: 2 },
    { predecessor: "waterproofing", type: "FS", lagDays: 1 },
  ],
  doors_windows: [{ predecessor: "masonry", type: "SS", lagDays: 2 }],
  painting: [
    { predecessor: "plaster", type: "FS", lagDays: 2 },
    { predecessor: "doors_windows", type: "FS" },
    { predecessor: "electrical_rough_in", type: "FS" },
  ],
  finishing: [
    { predecessor: "flooring", type: "FS", lagDays: 1 },
    { predecessor: "painting", type: "FS", lagDays: 1 },
    { predecessor: "plumbing_rough_in", type: "FS" },
  ],
  external: [{ predecessor: "site_preparation", type: "SS", lagDays: 5 }],
};

const DEFAULT_STATUS: SchedulerActivityStatus = "NOT_STARTED";

let geminiModel: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null = null;

function getGeminiModel() {
  if (geminiModel) return geminiModel;
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  const genAI = new GoogleGenerativeAI(apiKey);
  geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
  return geminiModel;
}

function normalizeText(value: string | undefined): string {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function unitGroupFromUnit(unit: string): UnitGroup {
  const u = normalizeText(unit);
  if (!u) return "count";
  if (u.includes("m3") || u.includes("cum") || u.includes("cubic") || u === "cft" || u === "ft3") return "volume";
  if (u.includes("m2") || u.includes("sqm") || u.includes("sqft") || u.includes("ft2") || u.includes("square"))
    return "area";
  if (u.includes("mtr") || u === "m" || u.includes("rm") || u.includes("rft") || u.includes("ft")) return "length";
  if (u.includes("kg") || u.includes("ton")) return "weight";
  if (u.includes("ls") || u.includes("lump") || u.includes("job")) return "lumpsum";
  return "count";
}

function convertQuantity(quantity: number, fromUnit: string, toGroup: UnitGroup): number {
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  if (qty === 0) return 0;
  const unit = normalizeText(fromUnit);
  const fromGroup = unitGroupFromUnit(fromUnit);

  if (fromGroup === toGroup) return qty;

  if (toGroup === "area") {
    if (unit.includes("sqft") || unit.includes("ft2")) return qty * 0.092903;
    if (unit.includes("m2") || unit.includes("sqm")) return qty;
    if (fromGroup === "count") return qty * 3.5;
    if (fromGroup === "length") return qty * 0.3;
  }

  if (toGroup === "volume") {
    if (unit === "cft" || unit === "ft3") return qty * 0.0283168;
    if (unit.includes("cum") || unit.includes("m3") || unit.includes("cubic")) return qty;
    if (fromGroup === "area") return qty * 0.08;
    if (fromGroup === "count") return qty * 0.12;
  }

  if (toGroup === "length") {
    if (unit.includes("rft") || unit.includes("ft")) return qty * 0.3048;
    if (unit.includes("mtr") || unit === "m" || unit.includes("rm")) return qty;
    if (fromGroup === "count") return qty * 1.4;
  }

  if (toGroup === "weight") {
    if (unit.includes("kg")) return qty / 1000;
    if (unit.includes("ton")) return qty;
  }

  if (toGroup === "count") {
    if (fromGroup === "lumpsum") return 1;
    if (fromGroup === "area") return Math.max(1, qty / 12);
    if (fromGroup === "volume") return Math.max(1, qty / 3);
  }

  if (toGroup === "lumpsum") {
    return 1;
  }

  return qty;
}

function classifyItem(item: ScheduleGenerationItem): CategoryDefinition | null {
  const haystack = `${item.sectionName || ""} ${item.workType || ""} ${item.description || ""}`.toLowerCase();
  for (const category of CATEGORY_DEFINITIONS) {
    if (category.keywords.some((keyword) => haystack.includes(keyword))) {
      return category;
    }
  }
  return null;
}

function estimateDurationDays(category: CategoryDefinition, quantity: number, itemCount: number): number {
  const safeQuantity = Math.max(quantity, 1);
  const crewScale = Math.min(2.3, 1 + Math.log10(safeQuantity + 1) / 2.5);
  const availabilityFactor = 0.85;
  const itemComplexityFactor = Math.min(1.4, 1 + itemCount / 35);
  const effectiveProductivity =
    category.productivityPerDay * crewScale * availabilityFactor * itemComplexityFactor;
  const duration = Math.ceil(safeQuantity / Math.max(effectiveProductivity, 0.1));
  return Math.max(category.minDurationDays, duration);
}

function buildDeterministicSchedule(items: ScheduleGenerationItem[]): SchedulerActivity[] {
  const aggregates = new Map<WorkCategoryId, CategoryAggregate>();

  items.forEach((item) => {
    const category = classifyItem(item);
    if (!category) return;

    const qty = convertQuantity(item.quantity, item.unit, category.unitGroup);
    const current = aggregates.get(category.id);
    if (!current) {
      aggregates.set(category.id, {
        category,
        quantity: Math.max(qty, 0),
        itemCount: 1,
        sampleItems: [item.description].filter(Boolean).slice(0, 3),
      });
      return;
    }
    current.quantity += Math.max(qty, 0);
    current.itemCount += 1;
    if (current.sampleItems.length < 3 && item.description) {
      current.sampleItems.push(item.description);
    }
  });

  let selectedCategories = Array.from(aggregates.values()).sort(
    (a, b) => a.category.order - b.category.order
  );

  if (selectedCategories.length === 0) {
    const fallbackDuration = Math.max(3, Math.ceil(items.length / 3));
    return [
      {
        id: "A1",
        name: "BOQ Scope Consolidation",
        duration: fallbackDuration,
        predecessors: [],
        dependencies: [],
        status: DEFAULT_STATUS,
        notes: "Unable to classify BOQ lines by work type; created a consolidated scope activity.",
      },
    ];
  }

  const includesGroundwork = selectedCategories.some(
    (entry) => entry.category.id === "excavation" || entry.category.id === "foundation"
  );
  const hasSitePrep = selectedCategories.some((entry) => entry.category.id === "site_preparation");
  if (includesGroundwork && !hasSitePrep) {
    const sitePrepCategory = CATEGORY_DEFINITIONS.find((category) => category.id === "site_preparation");
    if (sitePrepCategory) {
      selectedCategories = [
        {
          category: sitePrepCategory,
          quantity: 1,
          itemCount: 1,
          sampleItems: ["Auto-inserted mobilization before civil works"],
        },
        ...selectedCategories,
      ];
    }
  }

  const activities: SchedulerActivity[] = selectedCategories.map((entry, idx) => {
    const duration = estimateDurationDays(entry.category, entry.quantity, entry.itemCount);
    const unitLabel = entry.category.unitGroup === "count" ? "tasks" : entry.category.unitGroup;
    return {
      id: `A${idx + 1}`,
      name: entry.category.name,
      duration,
      predecessors: [],
      dependencies: [],
      status: DEFAULT_STATUS,
      notes: `Derived from ${entry.itemCount} BOQ line item(s), ~${entry.quantity.toFixed(
        2
      )} ${unitLabel}. Sample: ${entry.sampleItems.join("; ")}`,
    };
  });

  const activityIdByCategory = new Map<WorkCategoryId, string>();
  selectedCategories.forEach((entry, idx) => {
    activityIdByCategory.set(entry.category.id, `A${idx + 1}`);
  });

  activities.forEach((activity, idx) => {
    const categoryId = selectedCategories[idx]?.category.id;
    if (!categoryId) return;

    const deps = DEPENDENCY_RULES[categoryId] || [];
    const dependencies = deps
      .map((rule) => {
        const predecessorId = activityIdByCategory.get(rule.predecessor);
        if (!predecessorId || predecessorId === activity.id) return null;
        return {
          activityId: predecessorId,
          type: rule.type,
          lagDays: rule.lagDays ?? 0,
        };
      })
      .filter((dep): dep is NonNullable<typeof dep> => Boolean(dep));

    if (dependencies.length === 0 && idx > 0) {
      dependencies.push({
        activityId: activities[idx - 1].id,
        type: "FS",
        lagDays: 0,
      });
    }

    activity.dependencies = normalizeActivityDependencies({
      dependencies,
      predecessors: [],
    });
    activity.predecessors = derivePredecessorsFromDependencies(activity.dependencies);
  });

  return activities;
}

function stripJsonMarkdown(text: string): string {
  return text.replace(/```json|```/gi, "").trim();
}

function parseActivitiesFromText(text: string): unknown {
  const cleaned = stripJsonMarkdown(text);
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);

  if (arrayMatch) {
    return JSON.parse(arrayMatch[0]);
  }
  if (objectMatch) {
    const parsed = JSON.parse(objectMatch[0]);
    if (Array.isArray(parsed.activities)) return parsed.activities;
    return parsed;
  }

  throw new Error("No valid JSON payload found in AI response.");
}

function sanitizeActivities(raw: unknown, fallback: SchedulerActivity[]): SchedulerActivity[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return fallback;
  }

  const draft = raw.map((entry, idx) => {
    const record = entry as Partial<SchedulerActivity>;
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `A${idx + 1}`;
    const duration =
      typeof record.duration === "number" && Number.isFinite(record.duration) && record.duration > 0
        ? Math.ceil(record.duration)
        : fallback[idx]?.duration || 3;
    const name =
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : fallback[idx]?.name || `Activity ${idx + 1}`;
    const status: SchedulerActivityStatus =
      record.status === "IN_PROGRESS" || record.status === "COMPLETED"
        ? record.status
        : DEFAULT_STATUS;

    const dependencies = normalizeActivityDependencies({
      dependencies: record.dependencies,
      predecessors: Array.isArray(record.predecessors) ? record.predecessors : [],
    }).filter((dependency) => dependency.activityId !== id);

    return {
      id,
      name,
      duration,
      dependencies,
      predecessors: derivePredecessorsFromDependencies(dependencies),
      status,
      notes: typeof record.notes === "string" ? record.notes : undefined,
    } satisfies SchedulerActivity;
  });

  const validIds = new Set(draft.map((activity) => activity.id));
  draft.forEach((activity) => {
    const filtered = (activity.dependencies || []).filter((dependency) => validIds.has(dependency.activityId));
    activity.dependencies = filtered;
    activity.predecessors = derivePredecessorsFromDependencies(filtered);
  });

  return draft;
}

function buildAIPrompt(items: ScheduleGenerationItem[], seedActivities: SchedulerActivity[]): string {
  const limitedItems = items.slice(0, 80);
  const boqContext = limitedItems
    .map((item) => `- ${item.description} | Qty: ${item.quantity} ${item.unit}${item.sectionName ? ` | Section: ${item.sectionName}` : ""}`)
    .join("\n");

  const seedContext = seedActivities
    .map(
      (activity) =>
        `- ${activity.id} ${activity.name} | duration=${activity.duration}d | predecessors=${
          activity.predecessors.join(",") || "none"
        }`
    )
    .join("\n");

  return `
You are a senior construction planner. Convert BOQ intelligence into an executable schedule.

Use these scheduling rules:
1. Activity sequence must follow practical construction logic.
2. Compute duration from quantity and realistic productivity assumptions (not fixed template durations).
3. Use dependency types: FS, SS, FF, SF with lagDays when useful.
4. Allow parallel work where practical (e.g., rough-ins in parallel after masonry starts).
5. Keep schedule practical for site execution and resource availability.
6. Return 6-20 activities.

BOQ line items:
${boqContext}

Draft schedule from deterministic engine:
${seedContext}

Return JSON only (array of activities):
[
  {
    "id": "A1",
    "name": "Excavation",
    "duration": 5,
    "dependencies": [
      { "activityId": "A0", "type": "FS", "lagDays": 0 }
    ],
    "status": "NOT_STARTED",
    "notes": "brief assumptions"
  }
]
`;
}

async function refineWithAI(
  items: ScheduleGenerationItem[],
  deterministicSchedule: SchedulerActivity[]
): Promise<SchedulerActivity[]> {
  const model = getGeminiModel();
  if (!model) {
    return deterministicSchedule;
  }

  try {
    const prompt = buildAIPrompt(items, deterministicSchedule);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    const parsed = parseActivitiesFromText(text);
    const sanitized = sanitizeActivities(parsed, deterministicSchedule);
    return sanitized.length > 0 ? sanitized : deterministicSchedule;
  } catch (error) {
    console.error("AI schedule refinement failed. Falling back to deterministic schedule.", error);
    return deterministicSchedule;
  }
}

export async function generateScheduleFromBOQ(items: ScheduleGenerationItem[]): Promise<SchedulerActivity[]> {
  const safeItems = (items || []).filter(
    (item) =>
      item &&
      typeof item.description === "string" &&
      item.description.trim().length > 0 &&
      typeof item.quantity === "number" &&
      Number.isFinite(item.quantity)
  );

  const deterministicSchedule = buildDeterministicSchedule(safeItems);
  const aiSchedule = await refineWithAI(safeItems, deterministicSchedule);
  return sanitizeActivities(aiSchedule, deterministicSchedule);
}
