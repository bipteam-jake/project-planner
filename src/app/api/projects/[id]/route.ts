import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Project } from "@/lib/types";
import { ProjectSchema } from "@/lib/schemas";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const p = await prisma.project.findUnique({
      where: { id },
      include: { months: { include: { allocations: true } }, members: true },
    });
    if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const result: Project = {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      projectStatus: p.projectStatus as any,
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
    };
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load project" }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = ProjectSchema.safeParse(body);
    if (!parsed.success || parsed.data.id !== id) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const p = parsed.data as Project;

    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id },
        data: {
          name: p.name ?? "",
          description: p.description ?? "",
          status: p.status ?? "",
          projectStatus: p.projectStatus ?? "Active",
          overheadPerHour: Number(p.overheadPerHour ?? 0),
          targetMarginPct: Number(p.targetMarginPct ?? 0),
          startMonthISO: p.startMonthISO ?? "",
        },
      });

      // Replace members
      await tx.projectMember.deleteMany({ where: { projectId: id } });
      if (Array.isArray(p.memberIds)) {
        for (const personId of p.memberIds) {
          await tx.projectMember.create({ data: { projectId: id, personId } });
        }
      }

      // Replace months and allocations
      await tx.allocation.deleteMany({ where: { month: { projectId: id } } });
      await tx.month.deleteMany({ where: { projectId: id } });

      for (let idx = 0; idx < p.months.length; idx++) {
        const m = p.months[idx];
        await tx.month.create({
          data: {
            id: m.id,
            projectId: id,
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

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.project.delete({ where: { id } });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
