import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Project } from "@/lib/types";
import { z } from "zod";
import { ProjectSchema } from "@/lib/schemas";

export async function GET() {
  try {
    const rows = await prisma.project.findMany({
      include: {
        members: true,
        months: { include: { allocations: true } },
      },
    });
    const result: Project[] = rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      projectType: p.projectType as any,
      overheadPerHour: p.overheadPerHour,
      targetMarginPct: p.targetMarginPct,
      startMonthISO: p.startMonthISO,
      memberIds: p.members.map((m) => m.personId),
      months: p.months
        .sort((a, b) => a.index - b.index)
        .map((m) => ({
          id: m.id,
          label: m.label,
          expenses: m.expenses,
          revenue: m.revenue,
          personAllocations: Object.fromEntries(
            m.allocations.map((a) => [a.personId, a.allocationPct])
          ),
        })),
      updatedAt: p.updatedAt ? new Date(p.updatedAt).getTime() : Date.now(),
    }));
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const parse = z.array(ProjectSchema).safeParse(body);
    if (!parse.success) {
      return NextResponse.json({ error: "Invalid payload", issues: parse.error.issues }, { status: 400 });
    }
    const projects = parse.data as Project[];

    await prisma.$transaction(async (tx) => {
      // Replace all projects and their relations
      await tx.allocation.deleteMany({});
      await tx.month.deleteMany({});
      await tx.projectMember.deleteMany({});
      await tx.project.deleteMany({});

      for (const p of projects) {
        await tx.project.create({
          data: {
            id: p.id,
            name: p.name ?? "",
            description: p.description ?? "",
            status: p.status ?? "",
            projectType: p.projectType ?? "Active",
            overheadPerHour: Number(p.overheadPerHour ?? 0),
            targetMarginPct: Number(p.targetMarginPct ?? 0),
            startMonthISO: p.startMonthISO ?? "",
            // relations created below
          },
        });

        // Members
        if (Array.isArray(p.memberIds)) {
          for (const personId of p.memberIds) {
            await tx.projectMember.create({
              data: { projectId: p.id, personId },
            });
          }
        }

        // Months with allocations
        for (let idx = 0; idx < p.months.length; idx++) {
          const m = p.months[idx];
          await tx.month.create({
            data: {
              id: m.id,
              projectId: p.id,
              index: idx,
              label: m.label ?? `M${idx + 1}`,
              expenses: Number(m.expenses ?? 0),
              revenue: Number(m.revenue ?? 0),
            },
          });
          if (m.personAllocations) {
            for (const [personId, allocation] of Object.entries(
              m.personAllocations
            )) {
              await tx.allocation.create({
                data: {
                  id: `${m.id}:${personId}`,
                  monthId: m.id,
                  personId,
                  allocationPct: Number(allocation ?? 0),
                },
              });
            }
          }
        }
      }
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to save projects" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parse = ProjectSchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json({ error: "Invalid payload", issues: parse.error.issues }, { status: 400 });
    }
    const p = parse.data as Project;

    await prisma.$transaction(async (tx) => {
      await tx.project.create({
        data: {
          id: p.id,
          name: p.name ?? "",
          description: p.description ?? "",
          status: p.status ?? "",
          projectType: p.projectType ?? "Active",
          overheadPerHour: Number(p.overheadPerHour ?? 0),
          targetMarginPct: Number(p.targetMarginPct ?? 0),
          startMonthISO: p.startMonthISO ?? "",
        },
      });
      if (Array.isArray(p.memberIds)) {
        for (const personId of p.memberIds) {
          await tx.projectMember.create({ data: { projectId: p.id, personId } });
        }
      }
      for (let idx = 0; idx < p.months.length; idx++) {
        const m = p.months[idx];
        await tx.month.create({
          data: {
            id: m.id,
            projectId: p.id,
            index: idx,
            label: m.label ?? `M${idx + 1}`,
            expenses: Number(m.expenses ?? 0),
            revenue: Number(m.revenue ?? 0),
          },
        });
        if (m.personAllocations) {
          for (const [personId, allocation] of Object.entries(m.personAllocations)) {
            await tx.allocation.create({
              data: {
                id: `${m.id}:${personId}`,
                monthId: m.id,
                personId,
                allocationPct: Number(allocation ?? 0),
              },
            });
          }
        }
      }
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
