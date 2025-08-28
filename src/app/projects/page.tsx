// /src/app/projects/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Project, RosterPerson } from "@/lib/storage";
import {
  currency,
  computeProjectTotals,
  createProject,
  loadProjects,
  loadRoster,
  saveProjects,
} from "@/lib/storage";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [roster, setRoster] = useState<RosterPerson[]>([]);

  useEffect(() => {
    setProjects(loadProjects());
    setRoster(loadRoster());
  }, []);

  // Autosave whenever the array changes (create/duplicate/delete)
  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  function addProject(): void {
    setProjects((prev) => [createProject({ name: `Project ${prev.length + 1}` }), ...prev]);
  }

  function removeProject(id: string): void {
    if (!confirm("Delete this project?")) return;
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }

  function duplicateProject(id: string): void {
    setProjects((prev) => {
      const found = prev.find((p) => p.id === id);
      if (!found) return prev;
      const copy: Project = {
        ...found,
        id: crypto.randomUUID(),
        name: `${found.name} (Copy)`,
        updatedAt: Date.now(),
      };
      return [copy, ...prev];
    });
  }

  // (Optional) sort by last updated desc for nicer UX
  const sortedProjects = useMemo<Project[]>(
    () => [...projects].sort((a, b) => b.updatedAt - a.updatedAt),
    [projects]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Button onClick={addProject}>New Project</Button>
      </div>

      <div className="grid grid-cols-12 gap-2 text-sm font-medium text-muted-foreground">
        <div className="col-span-3">Name / Description / Status</div>
        <div className="col-span-2">Start</div>
        <div className="col-span-2 text-right">Revenue</div>
        <div className="col-span-2 text-right">All-in</div>
        <div className="col-span-1 text-right">Margin</div>
        <div className="col-span-2 text-right">Actions</div>
      </div>

      {sortedProjects.map((p) => {
        const totals = computeProjectTotals(p, roster);
        return (
          <div key={p.id} className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-3">
              <Link
                href={`/projects/${p.id}`}
                className="underline underline-offset-2"
              >
                {p.name}
              </Link>
              <div className="text-xs text-muted-foreground truncate">
                {p.description}
              </div>
              <div className="text-xs text-muted-foreground">{p.status}</div>
            </div>
            <div className="col-span-2">{p.startMonthISO}</div>
            <div className="col-span-2 text-right">{currency(totals.revenue)}</div>
            <div className="col-span-2 text-right">{currency(totals.allIn)}</div>
            <div className="col-span-1 text-right">
              {((totals.revenue > 0 ? (totals.revenue - totals.allIn) / totals.revenue : 0) * 100).toFixed(1)}%
            </div>
            <div className="col-span-2 text-right space-x-2">
              <Link className="text-sm underline" href={`/projects/${p.id}`}>
                Edit
              </Link>
              <button
                className="text-sm underline"
                onClick={() => duplicateProject(p.id)}
              >
                Duplicate
              </button>
              <button
                className="text-sm text-red-600 underline"
                onClick={() => removeProject(p.id)}
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
