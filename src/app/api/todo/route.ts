import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const TodoSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
  dueDate: z.string().optional(),
  done: z.boolean().default(false),
  assignees: z.array(z.string()).default([]),
});

const RowSchema = z.object({
  projectId: z.string(),
  bdNeeded: z.boolean().default(false),
  bdNotes: z.string().default(""),
  todos: z.array(TodoSchema),
});

const PayloadSchema = z.object({
  weekKey: z.string().min(10),
  rows: z.array(RowSchema),
  order: z.array(z.string()).optional(),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const weekKey = searchParams.get("weekKey") || "";
  if (!weekKey) return NextResponse.json({ error: "weekKey required" }, { status: 400 });
  try {
    const weeks = await prisma.projectWeek.findMany({
      where: { weekKey },
      include: { todos: { include: { assignees: true } } },
    });
    const orderRow = await prisma.projectWeekOrder.findUnique({ where: { weekKey } });
    // If no usable order for this week, try latest non-empty order at or before this week (forward inheritance)
    let latestOrder: string[] | null = null;
    const current = (orderRow?.order as unknown as string[]) ?? null;
    if (current && current.length > 0) {
      latestOrder = current;
    } else {
      const prior = await prisma.projectWeekOrder.findFirst({
        where: { weekKey: { lt: weekKey } },
        orderBy: { weekKey: "desc" },
      });
      const priorArr = (prior?.order as unknown as string[]) ?? null;
      latestOrder = priorArr && priorArr.length > 0 ? priorArr : null;
    }

    const rows = weeks.map((w) => ({
      projectId: w.projectId,
      bdNeeded: w.bdNeeded,
      bdNotes: w.bdNotes,
      todos: w.todos.map((t) => ({
        id: t.id,
        text: t.text,
        dueDate: t.dueDate ?? undefined,
        done: t.done,
        assignees: t.assignees.map((a) => a.personId),
      })),
    }));

    return NextResponse.json({ weekKey, order: latestOrder ?? null, rows }, { status: 200 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load week" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const parsed = PayloadSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
    const { weekKey, rows, order } = parsed.data;

    await prisma.$transaction(async (tx) => {
      // Upsert rows and replace todos for each
      for (const r of rows) {
        const pw = await tx.projectWeek.upsert({
          where: { projectId_weekKey: { projectId: r.projectId, weekKey } },
          update: { bdNeeded: r.bdNeeded, bdNotes: r.bdNotes },
          create: {
            id: `${r.projectId}:${weekKey}`,
            projectId: r.projectId,
            weekKey,
            bdNeeded: r.bdNeeded,
            bdNotes: r.bdNotes ?? "",
          },
        });
        await tx.todoAssignee.deleteMany({ where: { todo: { projectWeekId: pw.id } } });
        await tx.todo.deleteMany({ where: { projectWeekId: pw.id } });
        for (const t of r.todos) {
          const todo = await tx.todo.create({
            data: {
              id: t.id ?? `${pw.id}:${Math.random().toString(36).slice(2, 9)}`,
              projectWeekId: pw.id,
              text: t.text,
              dueDate: t.dueDate ?? null,
              done: !!t.done,
            },
          });
          if (t.assignees?.length) {
            for (const personId of t.assignees) {
              await tx.todoAssignee.create({ data: { id: `${todo.id}:${personId}`, todoId: todo.id, personId } });
            }
          }
        }
      }
      if (order && Array.isArray(order) && order.length > 0) {
        await tx.projectWeekOrder.upsert({
          where: { weekKey },
          update: { order },
          create: { id: `order:${weekKey}`, weekKey, order },
        });
      }
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to save week" }, { status: 500 });
  }
}
