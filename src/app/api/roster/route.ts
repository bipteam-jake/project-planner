import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { RosterPersonSchema } from "@/lib/schemas";

export async function GET() {
  try {
    const rows = await prisma.rosterPerson.findMany();
    const result = rows.map((r) => ({
      id: r.id,
      name: r.name,
      personType: r.personType as any,
      department: r.department as any,
      compMode: r.compMode ?? undefined,
      monthlySalary: r.monthlySalary ?? undefined,
      annualSalary: r.annualSalary ?? undefined,
      hourlyRate: r.hourlyRate ?? undefined,
      baseMonthlyHours: r.baseMonthlyHours,
    }));
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load roster" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const parse = z.array(RosterPersonSchema).safeParse(body);
    if (!parse.success) {
      return NextResponse.json({ error: "Invalid payload", issues: parse.error.issues }, { status: 400 });
    }
    const list = parse.data;

    await prisma.$transaction(async (tx) => {
      await tx.rosterPerson.deleteMany({});
      if (list.length > 0) {
        for (const r of list) {
          await tx.rosterPerson.create({
            data: {
              id: String(r.id),
              name: String(r.name ?? ""),
              personType: String(r.personType ?? "Contractor"),
              department: String(r.department ?? "Other"),
              compMode: r.compMode ? String(r.compMode) : null,
              monthlySalary: r.monthlySalary != null ? Number(r.monthlySalary) : null,
              annualSalary: r.annualSalary != null ? Number(r.annualSalary) : null,
              hourlyRate: r.hourlyRate != null ? Number(r.hourlyRate) : null,
              baseMonthlyHours: Number(r.baseMonthlyHours ?? 160),
            },
          });
        }
      }
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to save roster" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parse = RosterPersonSchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json({ error: "Invalid payload", issues: parse.error.issues }, { status: 400 });
    }
    const r = parse.data;
    await prisma.rosterPerson.create({
      data: {
        id: String(r.id),
        name: String(r.name ?? ""),
        personType: String(r.personType ?? "Contractor"),
        department: String(r.department ?? "Other"),
        compMode: r.compMode ? String(r.compMode) : null,
        monthlySalary: r.monthlySalary != null ? Number(r.monthlySalary) : null,
        annualSalary: r.annualSalary != null ? Number(r.annualSalary) : null,
        hourlyRate: r.hourlyRate != null ? Number(r.hourlyRate) : null,
        baseMonthlyHours: Number(r.baseMonthlyHours ?? 160),
      },
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to create person" }, { status: 500 });
  }
}
