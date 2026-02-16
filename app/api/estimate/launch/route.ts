import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { generateScheduleFromBOQ } from "@/lib/schedule-engine-ai";
import { calculateSchedule } from "@/lib/scheduler-engine";
import {
  derivePredecessorsFromDependencies,
  normalizeActivityDependencies,
} from "@/lib/scheduler-dependencies";
import type { SchedulerActivity } from "@/types/scheduler";

type MarketRangeLike = {
  low?: { total_inr?: number };
  medium?: { total_inr?: number };
  premium?: { total_inr?: number };
};

const launchSchema = z.object({
  estimationId: z.string().min(1),
  projectName: z.string().min(3).max(140),
  clientName: z.string().min(2).max(100),
  clientEmail: z.string().email().optional(),
  address: z.string().min(4).max(240),
  type: z.string().max(80).optional(),
  startDate: z.string().optional(),
  budgetMode: z.enum(["lean", "balanced", "premium"]).default("balanced"),
});

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function resolveBudgetBase(
  grandTotal: number,
  marketRange: unknown,
  budgetMode: "lean" | "balanced" | "premium"
): number {
  const safeGrandTotal = Number.isFinite(grandTotal) && grandTotal > 0 ? grandTotal : 0;
  const range = (marketRange || {}) as MarketRangeLike;
  const low = range.low?.total_inr;
  const medium = range.medium?.total_inr;
  const premium = range.premium?.total_inr;

  if (budgetMode === "lean" && typeof low === "number" && low > 0) return low;
  if (budgetMode === "premium" && typeof premium === "number" && premium > 0) return premium;
  if (typeof medium === "number" && medium > 0) return medium;
  return safeGrandTotal;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole("ENGINEER");
    const body = await req.json();
    const parsed = launchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      estimationId,
      projectName,
      clientName,
      clientEmail,
      address,
      type,
      startDate,
      budgetMode,
    } = parsed.data;

    const estimation = await prisma.estimation.findUnique({
      where: { id: estimationId },
      include: {
        sections: {
          include: { items: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!estimation) {
      return NextResponse.json({ error: "Estimation not found" }, { status: 404 });
    }

    if (estimation.sections.length === 0) {
      return NextResponse.json(
        { error: "Estimation has no BOQ sections. Upload and analyze a file first." },
        { status: 400 }
      );
    }

    const boqItems = estimation.sections.flatMap((section) =>
      section.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        sectionName: section.sectionName,
        workType: section.sectionName,
      }))
    );

    const aiActivities = await generateScheduleFromBOQ(boqItems);
    const normalizedActivities: SchedulerActivity[] = aiActivities.map((item, index) => {
      const dependencies = normalizeActivityDependencies({
        dependencies: item.dependencies,
        predecessors: Array.isArray(item.predecessors) ? item.predecessors : [],
      });

      return {
        id: item.id?.trim() || `A${index + 1}`,
        name: item.name || `Activity ${index + 1}`,
        duration: Number.isFinite(item.duration) && item.duration > 0 ? Math.ceil(item.duration) : 5,
        dependencies,
        predecessors: derivePredecessorsFromDependencies(dependencies),
        status: "NOT_STARTED",
        notes: item.notes,
      };
    });

    const scheduledActivities = calculateSchedule(normalizedActivities);
    const projectDurationDays = Math.max(
      30,
      ...scheduledActivities.map((a) => a.endDay || a.duration || 0)
    );

    const parsedStartDate = startDate ? new Date(startDate) : new Date();
    const projectStartDate = Number.isNaN(parsedStartDate.getTime())
      ? new Date()
      : parsedStartDate;
    const projectEndDate = addDays(projectStartDate, projectDurationDays);

    const budgetBase = resolveBudgetBase(
      estimation.grandTotal,
      estimation.marketRange,
      budgetMode
    );
    const contingencyPercent = budgetMode === "lean" ? 5 : budgetMode === "premium" ? 15 : 10;
    const contingencyAmount = Math.round((budgetBase * contingencyPercent) / 100);
    const totalBudget = Math.round(budgetBase + contingencyAmount);

    const created = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: projectName,
          clientName,
          clientEmail: clientEmail?.trim().toLowerCase() || null,
          address,
          status: "On Track",
          progress: 0,
          budget: totalBudget,
          spent: 0,
          startDate: projectStartDate,
          endDate: projectEndDate,
          type: type?.trim() || "Residential",
          area: estimation.builtUpArea || null,
          phase: "Planning",
          userId: user.id,
          timelineItems: {
            create: scheduledActivities.map((activity) => {
              const start = addDays(projectStartDate, Math.max((activity.startDay || 1) - 1, 0));
              const end = addDays(projectStartDate, Math.max((activity.endDay || activity.duration || 1) - 1, 0));
              return {
                title: activity.name,
                description: activity.notes || "Generated from AI BOQ schedule",
                startDate: start,
                endDate: end,
                status: "Upcoming",
              };
            }),
          },
          budgetItems: {
            create: estimation.sections.map((section) => ({
              name: section.sectionName,
              budget: Math.round(section.subtotalInr),
              spent: 0,
              status: "Not started",
            })),
          },
        },
      });

      await tx.estimation.update({
        where: { id: estimation.id },
        data: { projectId: project.id },
      });

      await tx.activityLog.create({
        data: {
          action: "CREATED_PROJECT",
          details: `launched project from estimation ${estimation.fileName}`,
          userId: user.id,
          projectId: project.id,
          metadata: {
            estimationId: estimation.id,
            budgetMode,
            contingencyPercent,
            generatedActivities: scheduledActivities.length,
          },
        },
      });

      return project;
    });

    return NextResponse.json({
      success: true,
      projectId: created.id,
      projectName: created.name,
      budget: created.budget,
      startDate: created.startDate,
      endDate: created.endDate,
      schedule: scheduledActivities,
      summary: {
        totalActivities: scheduledActivities.length,
        projectDurationDays,
        contingencyPercent,
        contingencyAmount,
      },
    });
  } catch (error) {
    const err = error as Error & { message?: string };
    if (err.message === "Not authenticated") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Error launching project from estimation:", error);
    return NextResponse.json(
      { error: "Failed to launch project", details: err.message },
      { status: 500 }
    );
  }
}
