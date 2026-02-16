import {
  SchedulerActivity,
  SchedulerDependency,
  SchedulerDependencyType,
} from "@/types/scheduler";

const DEPENDENCY_TYPES: SchedulerDependencyType[] = ["FS", "SS", "FF", "SF"];

function isDependencyType(value: unknown): value is SchedulerDependencyType {
  return typeof value === "string" && DEPENDENCY_TYPES.includes(value as SchedulerDependencyType);
}

function toLagDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value);
}

export function normalizeActivityDependencies(
  activity: Pick<SchedulerActivity, "dependencies" | "predecessors">
): SchedulerDependency[] {
  const seen = new Set<string>();
  const normalized: SchedulerDependency[] = [];

  const append = (dep: SchedulerDependency) => {
    if (!dep.activityId) return;
    const key = `${dep.activityId}|${dep.type}|${dep.lagDays ?? 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(dep);
  };

  if (Array.isArray(activity.dependencies)) {
    activity.dependencies.forEach((dep) => {
      if (!dep || typeof dep.activityId !== "string") return;
      const activityId = dep.activityId.trim();
      if (!activityId) return;
      append({
        activityId,
        type: isDependencyType(dep.type) ? dep.type : "FS",
        lagDays: toLagDays(dep.lagDays),
      });
    });
  }

  if (Array.isArray(activity.predecessors)) {
    activity.predecessors.forEach((predId) => {
      if (typeof predId !== "string") return;
      const activityId = predId.trim();
      if (!activityId) return;
      append({
        activityId,
        type: "FS",
        lagDays: 0,
      });
    });
  }

  return normalized;
}

export function derivePredecessorsFromDependencies(
  dependencies: SchedulerDependency[] | undefined
): string[] {
  if (!Array.isArray(dependencies)) {
    return [];
  }
  return Array.from(
    new Set(
      dependencies
        .map((dep) => dep.activityId?.trim())
        .filter((id): id is string => Boolean(id))
    )
  );
}
