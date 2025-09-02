// /src/app/projects/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useRef } from "react";
import { ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Project, RosterPerson, ProjectStatus } from "@/lib/types";
import { currency, computeProjectTotals, createProject, upsertProject } from "@/lib/storage";

import { apiRepoAsync as repo } from "@/lib/repo";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [roster, setRoster] = useState<RosterPerson[]>([]);
  const [hydrated, setHydrated] = useState(false);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedProjectStatuses, setSelectedProjectStatuses] = useState<Set<ProjectStatus>>(new Set(["Test", "BD", "Active", "Completed", "Cancelled"]));
  
  // Multi-select dropdown state
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Filter toggle handlers
  function toggleProjectStatus(status: ProjectStatus, checked: boolean) {
    setSelectedProjectStatuses(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(status);
      } else {
        next.delete(status);
      }
      return next;
    });
  }

  function selectAllProjectStatuses() {
    setSelectedProjectStatuses(new Set(["Test", "BD", "Active", "Completed", "Cancelled"]));
  }

  function clearProjectStatuses() {
    setSelectedProjectStatuses(new Set());
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [ps, rs] = await Promise.all([
          repo.loadProjects(),
          repo.loadRoster(),
        ]);
        if (!mounted) return;
        setProjects(ps);
        setRoster(rs);
        setHydrated(true);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // No autosave here; we call incremental endpoints on actions

  function addProject(): void {
    setProjects((prev) => {
      const created = createProject({ name: `Project ${prev.length + 1}` });
      const next = upsertProject(created, prev);
      // Persist as create
      void repo.createProject(created);
      return next;
    });
  }

  function removeProject(id: string): void {
    if (!confirm("Delete this project?")) return;
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== id);
      void repo.deleteProject(id);
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
      void repo.createProject(copy);
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
      
      // Filter by project status
      filtered = filtered.filter(p => selectedProjectStatuses.has(p.projectStatus));
      
      // Sort by updatedAt (newest first)
      return [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
    },
    [projects, searchQuery, selectedProjectStatuses]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">
            Manage project details, timelines, and financial planning
          </p>
        </div>
        <Button type="button" onClick={addProject}>New Project</Button>
      </div>

      {/* Search and Filters - Inline */}
      <div className="rounded-xl border bg-card shadow-sm p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Input
              placeholder="Search projects by name, description, or status..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-80"
            />
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Status</span>
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-background text-sm min-w-[140px] justify-between hover:bg-muted transition-colors"
                  >
                    <span>
                      {selectedProjectStatuses.size === 5 
                        ? "All Statuses"
                        : selectedProjectStatuses.size === 0
                        ? "No Statuses"
                        : `${selectedProjectStatuses.size} selected`
                      }
                    </span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {dropdownOpen && (
                    <div className="absolute top-full left-0 mt-1 w-full bg-background border rounded-lg shadow-lg z-10 py-1">
                      <div className="px-3 py-2 border-b flex gap-2">
                        <button
                          onClick={selectAllProjectStatuses}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Select all
                        </button>
                        <span className="text-xs text-muted-foreground">•</span>
                        <button
                          onClick={clearProjectStatuses}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Clear
                        </button>
                      </div>
                      {["Test", "BD", "Active", "Completed", "Cancelled"].map((status) => {
                        const checked = selectedProjectStatuses.has(status as ProjectStatus);
                        return (
                          <label
                            key={status}
                            className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer text-sm"
                          >
                            <div className="relative flex items-center justify-center">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => toggleProjectStatus(status as ProjectStatus, e.target.checked)}
                                className="sr-only"
                              />
                              <div className={`w-4 h-4 border rounded flex items-center justify-center ${
                                checked ? 'bg-primary border-primary' : 'border-input'
                              }`}>
                                {checked && <Check className="h-3 w-3 text-primary-foreground" />}
                              </div>
                            </div>
                            {status}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <Button onClick={addProject} className="sm:ml-4">
            New Project
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-muted/30">
          <div className="text-sm text-muted-foreground">
            Showing {filteredAndSortedProjects.length} of {projects.length} projects
          </div>
        </div>

        {/* Table header */}
        <div className="grid grid-cols-12 gap-2 text-sm font-medium text-muted-foreground p-4 border-b bg-muted/30">
          <div className="col-span-2">Name</div>
          <div className="col-span-1">Status</div>
          <div className="col-span-2">Start</div>
          <div className="col-span-2 text-right">Revenue</div>
          <div className="col-span-2 text-right">All-in</div>
          <div className="col-span-1 text-right">Margin</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {/* Table rows */}
        <div className="divide-y">
          {filteredAndSortedProjects.map((p) => {
        const totals = computeProjectTotals(p, roster);
        const marginPct = (totals.revenue > 0
          ? ((totals.revenue - totals.allIn) / totals.revenue) * 100
          : 0
        ).toFixed(1);

            return (
              <div key={p.id} className="grid grid-cols-12 gap-2 items-center p-4 hover:bg-muted/50 transition-colors">
                <Link href={`/projects/${p.id}`} className="col-span-2 font-medium hover:text-primary underline-offset-4 hover:underline">
                  {p.name}
                </Link>
                <div className="col-span-1">{p.projectStatus}</div>
                <div className="col-span-2">{p.startMonthISO}</div>
                <div className="col-span-2 text-right">{currency(totals.revenue)}</div>
                <div className="col-span-2 text-right">{currency(totals.allIn)}</div>
                <div className="col-span-1 text-right">{marginPct}%</div>
                <div className="col-span-2 text-right space-x-2">
                  <Link className="text-sm font-medium hover:text-primary underline-offset-4 hover:underline" href={`/projects/${p.id}`}>Edit</Link>
                  <button className="text-sm font-medium hover:text-primary underline-offset-4 hover:underline" onClick={() => duplicateProject(p.id)}>
                    Duplicate
                  </button>
                  <button className="text-sm font-medium text-red-600 hover:text-red-800 underline-offset-4 hover:underline" onClick={() => removeProject(p.id)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
