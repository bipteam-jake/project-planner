import { NextRequest, NextResponse } from "next/server";
import type { Project } from "@/lib/storage";
import { readProjects, writeProjects } from "../store";

interface Params { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const projects = await readProjects();
  const project = projects.find((p) => p.id === params.id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(project);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const projects = await readProjects();
  const idx = projects.findIndex((p) => p.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await req.json()) as Project;
  const updated: Project = {
    ...projects[idx],
    ...body,
    id: params.id,
    updatedAt: Date.now(),
  };
  projects[idx] = updated;
  await writeProjects(projects);
  return NextResponse.json(updated);
}

export async function PATCH(req: NextRequest, ctx: Params) {
  return PUT(req, ctx);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const projects = await readProjects();
  const next = projects.filter((p) => p.id !== params.id);
  await writeProjects(next);
  return NextResponse.json({ success: true });
}
