import { derivePredecessorsFromDependencies, normalizeActivityDependencies } from "@/lib/scheduler-dependencies";
import { SchedulerActivity, SchedulerDependency, SchedulerDependencyType } from "@/types/scheduler";

type SuccessorRelation = {
  successorId: string;
  dependency: SchedulerDependency;
};

function toPositiveDuration(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 1;
  return Math.ceil(duration);
}

function toValidStartDay(startDay: number | undefined): number {
  if (typeof startDay !== "number" || !Number.isFinite(startDay) || startDay < 1) {
    return 1;
  }
  return Math.floor(startDay);
}

function earliestStartFromDependency(
  dependency: SchedulerDependency,
  predecessorStart: number,
  predecessorFinish: number,
  currentDuration: number
): number {
  const lag = dependency.lagDays ?? 0;

  switch (dependency.type) {
    case "SS":
      return predecessorStart + lag;
    case "FF":
      return predecessorFinish + lag - currentDuration + 1;
    case "SF":
      return predecessorStart + lag - currentDuration + 1;
    case "FS":
    default:
      return predecessorFinish + 1 + lag;
  }
}

function latestStartUpperBoundFromSuccessor(
  dependencyType: SchedulerDependencyType,
  lagDays: number,
  predecessorDuration: number,
  successorLateStart: number,
  successorLateFinish: number
): number {
  switch (dependencyType) {
    case "SS":
      return successorLateStart - lagDays;
    case "FF":
      return successorLateFinish - lagDays - predecessorDuration + 1;
    case "SF":
      return successorLateFinish - lagDays;
    case "FS":
    default:
      return successorLateStart - lagDays - predecessorDuration;
  }
}

function freeFloatAgainstSuccessor(
  dependency: SchedulerDependency,
  activityStart: number,
  activityFinish: number,
  successorStart: number,
  successorFinish: number
): number {
  const lag = dependency.lagDays ?? 0;

  switch (dependency.type) {
    case "SS":
      return successorStart - (activityStart + lag);
    case "FF":
      return successorFinish - (activityFinish + lag);
    case "SF":
      return successorFinish - (activityStart + lag);
    case "FS":
    default:
      return successorStart - (activityFinish + 1 + lag);
  }
}

function sequentialFallback(activities: SchedulerActivity[]): SchedulerActivity[] {
  let currentDay = 1;
  return activities.map((activity) => {
    const startDay = Math.max(currentDay, toValidStartDay(activity.manualStart));
    const duration = toPositiveDuration(activity.duration);
    const endDay = startDay + duration - 1;
    currentDay = endDay + 1;
    return {
      ...activity,
      duration,
      startDay,
      endDay,
      totalFloat: 0,
      freeFloat: 0,
      isCritical: true,
    };
  });
}

export function calculateSchedule(activities: SchedulerActivity[]): SchedulerActivity[] {
  if (!Array.isArray(activities) || activities.length === 0) {
    return [];
  }

  const normalizedActivities = activities.map((activity) => {
    const dependencies = normalizeActivityDependencies(activity).filter(
      (dep) => dep.activityId !== activity.id
    );
    return {
      ...activity,
      duration: toPositiveDuration(activity.duration),
      predecessors: derivePredecessorsFromDependencies(dependencies),
      dependencies,
      startDay: undefined,
      endDay: undefined,
      isCritical: false,
      totalFloat: 0,
      freeFloat: 0,
    };
  });

  const activityMap = new Map<string, SchedulerActivity>();
  normalizedActivities.forEach((activity) => {
    activityMap.set(activity.id, activity);
  });

  const inDegree = new Map<string, number>();
  const successors = new Map<string, SuccessorRelation[]>();

  normalizedActivities.forEach((activity) => {
    inDegree.set(activity.id, 0);
    successors.set(activity.id, []);
  });

  normalizedActivities.forEach((activity) => {
    activity.dependencies?.forEach((dependency) => {
      if (!activityMap.has(dependency.activityId)) {
        return;
      }
      successors.get(dependency.activityId)?.push({
        successorId: activity.id,
        dependency,
      });
      inDegree.set(activity.id, (inDegree.get(activity.id) || 0) + 1);
    });
  });

  const queue: string[] = [];
  const sortedOrder: string[] = [];

  inDegree.forEach((count, id) => {
    if (count === 0) {
      queue.push(id);
    }
  });

  while (queue.length > 0) {
    const current = queue.shift()!;
    sortedOrder.push(current);

    successors.get(current)?.forEach((relation) => {
      const nextCount = (inDegree.get(relation.successorId) || 0) - 1;
      inDegree.set(relation.successorId, nextCount);
      if (nextCount === 0) {
        queue.push(relation.successorId);
      }
    });
  }

  if (sortedOrder.length !== normalizedActivities.length) {
    console.error("Cycle detected in activity dependency graph. Falling back to sequential schedule.");
    return sequentialFallback(normalizedActivities);
  }

  const earlyStart = new Map<string, number>();
  const earlyFinish = new Map<string, number>();

  sortedOrder.forEach((id) => {
    const activity = activityMap.get(id);
    if (!activity) return;

    let start = toValidStartDay(activity.manualStart);
    activity.dependencies?.forEach((dependency) => {
      const predecessorStart = earlyStart.get(dependency.activityId);
      const predecessorFinish = earlyFinish.get(dependency.activityId);
      if (typeof predecessorStart !== "number" || typeof predecessorFinish !== "number") {
        return;
      }
      const constrainedStart = earliestStartFromDependency(
        dependency,
        predecessorStart,
        predecessorFinish,
        activity.duration
      );
      start = Math.max(start, constrainedStart);
    });

    const finish = start + activity.duration - 1;
    earlyStart.set(id, start);
    earlyFinish.set(id, finish);
  });

  const projectDuration = Math.max(1, ...Array.from(earlyFinish.values()));
  const lateStart = new Map<string, number>();
  const lateFinish = new Map<string, number>();

  [...sortedOrder].reverse().forEach((id) => {
    const activity = activityMap.get(id);
    if (!activity) return;

    let latestStart = projectDuration - activity.duration + 1;
    const activitySuccessors = successors.get(id) || [];

    activitySuccessors.forEach((relation) => {
      const successorLateStart = lateStart.get(relation.successorId);
      const successorLateFinish = lateFinish.get(relation.successorId);
      if (typeof successorLateStart !== "number" || typeof successorLateFinish !== "number") {
        return;
      }
      const upperBound = latestStartUpperBoundFromSuccessor(
        relation.dependency.type,
        relation.dependency.lagDays ?? 0,
        activity.duration,
        successorLateStart,
        successorLateFinish
      );
      latestStart = Math.min(latestStart, upperBound);
    });

    latestStart = Math.max(1, latestStart);
    const latestFinish = latestStart + activity.duration - 1;

    lateStart.set(id, latestStart);
    lateFinish.set(id, latestFinish);
  });

  return normalizedActivities
    .map((activity) => {
      const startDay = earlyStart.get(activity.id) ?? 1;
      const endDay = earlyFinish.get(activity.id) ?? activity.duration;
      const ls = lateStart.get(activity.id) ?? startDay;
      const totalFloat = ls - startDay;

      let freeFloat = totalFloat;
      const activitySuccessors = successors.get(activity.id) || [];
      if (activitySuccessors.length > 0) {
        freeFloat = Math.min(
          ...activitySuccessors
            .map((relation) => {
              const successorStart = earlyStart.get(relation.successorId);
              const successorFinish = earlyFinish.get(relation.successorId);
              if (typeof successorStart !== "number" || typeof successorFinish !== "number") {
                return Number.POSITIVE_INFINITY;
              }
              return freeFloatAgainstSuccessor(
                relation.dependency,
                startDay,
                endDay,
                successorStart,
                successorFinish
              );
            })
            .filter(Number.isFinite)
        );
        if (!Number.isFinite(freeFloat)) {
          freeFloat = totalFloat;
        }
      }

      return {
        ...activity,
        startDay,
        endDay,
        totalFloat,
        freeFloat,
        isCritical: totalFloat === 0,
      };
    })
    .sort((a, b) => (a.startDay || 0) - (b.startDay || 0));
}
