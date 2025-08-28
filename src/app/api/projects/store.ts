import { promises as fs } from "fs";
import path from "path";
import type { Project } from "@/lib/storage";

const dataFile = path.join(process.cwd(), "data", "projects.json");

export async function readProjects(): Promise<Project[]> {
  try {
    const content = await fs.readFile(dataFile, "utf8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function writeProjects(projects: Project[]): Promise<void> {
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(projects, null, 2));
}
