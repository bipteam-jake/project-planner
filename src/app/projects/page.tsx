// /src/app/projects/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Project, RosterPerson, ProjectType } from "@/lib/storage";
import {
  currency,
  computeProjectTotals,
  createProject,

  saveProjects,
  upsertProject,
} from "@/lib/storage";

import { localStorageRepo as repo } from "@/lib/repo";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [roster, setRoster] = useState<RosterPerson[]>([]);
  const [hydrated, setHydrated] = useState(false);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedProjectTypes, setSelectedProjectTypes] = useState<Set<ProjectType>>(new Set(["Test", "BD", "Active", "Completed", "Cancelled"]));
  // Collapsible filters UI state (collapsed by default for parity with others)
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  
  // Filter toggle handlers
  function toggleProjectType(type: ProjectType, checked: boolean) {
    setSelectedProjectTypes(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(type);
      } else {
        next.delete(type);
      }
      return next;
    });
  }

  function selectAllProjectTypes() {
    setSelectedProjectTypes(new Set(["Test", "BD", "Active", "Completed", "Cancelled"]));
  }

  function clearProjectTypes() {
    setSelectedProjectTypes(new Set());
  }

  useEffect(() => {
    setProjects(repo.loadProjects());
    setRoster(repo.loadRoster());
    setHydrated(true);
  }, []);

  // Autosave only after initial load
  useEffect(() => {
    if (hydrated) repo.saveProjects(projects);
  }, [projects, hydrated]);

  function addProject(): void {
    setProjects((prev) => {
      const created = createProject({ name: `Project ${prev.length + 1}` });
      const next = upsertProject(created, prev);
      // Immediate persist so /projects/[id] can see it even if navigated ASAP
      saveProjects(next);
      return next;
    });
  }

  function removeProject(id: string): void {
    if (!confirm("Delete this project?")) return;
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== id);
      saveProjects(next);
      return next;
    });
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
      const next = upsertProject(copy, prev);
      saveProjects(next);
      return next;
    });
  }

  const filteredAndSortedProjects = useMemo<Project[]>(
    () => {
      let filtered = projects;
      
      // Filter by search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        filtered = filtered.filter(p => 
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.status.toLowerCase().includes(query)
        );
      }
      
      // Filter by project type
      filtered = filtered.filter(p => selectedProjectTypes.has(p.projectType));
      
      // Sort by updatedAt (newest first)
      return [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
    },
    [projects, searchQuery, selectedProjectTypes]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Button type="button" onClick={addProject}>New Project</Button>
      </div>

      {/* Search and Filters (collapsible) */}
      <div className="rounded-xl border space-y-4">
        {/* Header */}
        <div
          className="flex items-center justify-between p-4 pb-2 cursor-pointer hover:bg-muted/50"
          onClick={() => setFiltersCollapsed(!filtersCollapsed)}
        >
          <h2 className="text-lg font-semibold">Filters</h2>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label={filtersCollapsed ? "Expand filters" : "Collapse filters"}>
            {filtersCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>

        {/* Collapsible content */}
        <div className={`px-4 pb-4 space-y-4 transition-all duration-300 ease-in-out overflow-hidden ${filtersCollapsed ? "max-h-0 opacity-0 pb-0" : "max-h-[2000px] opacity-100"}`}>
          {/* Search */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Search Projects</label>
            <Input
              type="text"
              placeholder="Search by name, description, or status..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-md"
            />
          </div>

          {/* Project Type Filter */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Project Types</label>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAllProjectTypes}>Select all</Button>
                <Button variant="outline" size="sm" onClick={clearProjectTypes}>Clear</Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {["Test", "BD", "Active", "Completed", "Cancelled"].map((type) => {
                const checked = selectedProjectTypes.has(type as ProjectType);
                return (
                  <label
                    key={type}
                    className={`inline-flex select-none items-center gap-2 rounded-full border px-3 py-1 text-sm cursor-pointer transition-colors ${
                      checked ? "bg-secondary border-secondary-foreground" : "bg-background hover:bg-muted"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleProjectType(type as ProjectType, e.target.checked)}
                      className="sr-only"
                    />
                    {type}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-muted-foreground">
          Showing {filteredAndSortedProjects.length} of {projects.length} projects
        </div>
      </div>

      <div className="grid grid-cols-12 gap-2 text-sm font-medium text-muted-foreground">
        <div className="col-span-2">Name</div>
        <div className="col-span-1">Type</div>
        <div className="col-span-2">Start</div>
        <div className="col-span-2 text-right">Revenue</div>
        <div className="col-span-2 text-right">All-in</div>
        <div className="col-span-1 text-right">Margin</div>
        <div className="col-span-2 text-right">Actions</div>
      </div>

      {filteredAndSortedProjects.map((p) => {
        const totals = computeProjectTotals(p, roster);
        const marginPct = (totals.revenue > 0
          ? ((totals.revenue - totals.allIn) / totals.revenue) * 100
          : 0
        ).toFixed(1);

        return (
          <div key={p.id} className="grid grid-cols-12 gap-2 items-center">
            <Link href={`/projects/${p.id}`} className="col-span-2 underline underline-offset-2">
              {p.name}
            </Link>
            <div className="col-span-1">{p.projectType}</div>
            <div className="col-span-2">{p.startMonthISO}</div>
            <div className="col-span-2 text-right">{currency(totals.revenue)}</div>
            <div className="col-span-2 text-right">{currency(totals.allIn)}</div>
            <div className="col-span-1 text-right">{marginPct}%</div>
            <div className="col-span-2 text-right space-x-2">
              <Link className="text-sm underline" href={`/projects/${p.id}`}>Edit</Link>
              <button className="text-sm underline" onClick={() => duplicateProject(p.id)}>
                Duplicate
              </button>
              <button className="text-sm text-red-600 underline" onClick={() => removeProject(p.id)}>
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
