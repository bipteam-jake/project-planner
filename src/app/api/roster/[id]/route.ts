import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { RosterPersonSchema } from "@/lib/schemas";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const r = await prisma.rosterPerson.findUnique({ where: { id } });
    if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(r, { status: 200 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load person" }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = RosterPersonSchema.safeParse(body);
    if (!parsed.success || parsed.data.id !== id) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const r = parsed.data;
    await prisma.rosterPerson.update({
      where: { id },
      data: {
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
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to update person" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.rosterPerson.delete({ where: { id } });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to delete person" }, { status: 500 });
  }
}
