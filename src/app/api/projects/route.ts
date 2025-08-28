import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import type { Project } from "@/lib/storage";
import { readProjects, writeProjects } from "./store";

export async function GET() {
  const projects = await readProjects();
  return NextResponse.json(projects);
}

export async function POST(req: NextRequest) {
  const projects = await readProjects();
  const body = (await req.json()) as Project;
  const project: Project = {
    ...body,
    id: body.id ?? randomUUID(),
    updatedAt: Date.now(),
  };
  const next = [project, ...projects];
  await writeProjects(next);
  return NextResponse.json(project, { status: 201 });
}
