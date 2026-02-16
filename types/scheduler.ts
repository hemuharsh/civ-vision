export type SchedulerDependencyType = "FS" | "SS" | "FF" | "SF";

export interface SchedulerDependency {
    activityId: string; // predecessor activity id
    type: SchedulerDependencyType;
    lagDays?: number;
}

export type SchedulerActivityStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export interface SchedulerActivity {
    id: string;
    name: string;
    duration: number; // in days
    predecessors: string[]; // Legacy predecessor IDs (treated as FS links)
    dependencies?: SchedulerDependency[]; // Preferred dependency representation

    // Calculated fields
    startDay?: number;
    endDay?: number;
    status: SchedulerActivityStatus;
    isCritical?: boolean;
    totalFloat?: number;
    freeFloat?: number;

    // For visualization
    row?: number;

    // Optional fields for enhanced functionality
    notes?: string;
    color?: string;
    manualStart?: number; // User-defined start day override
}
