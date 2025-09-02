// /src/app/resourcing/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Project, ProjectType, RosterPerson, Department } from "@/lib/types";
import { currency, toNumber, effectiveHourlyRate } from "@/lib/storage";

// ⬇️ NEW: use the repo abstraction (can later swap to `apiRepo`)
import { apiRepoAsync as repo } from "@/lib/repo";

/* ---------------- helpers shared by dashboard ---------------- */

function ymFromStartIndex(startISO: string, index: number): string {
  const [y, m] = startISO.split("-").map((n) => Number(n));
  const d = new Date(y, m - 1 + index, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

function labelFromYm(ym: string): string {
  const [y, m] = ym.split("-").map((n) => Number(n));
  return new Date(y, m - 1, 1).toLocaleString(undefined, {
    month: "short",
    year: "numeric",
  });
}

function inYmRange(ym: string, start?: string, end?: string) {
  if (start && ym < start) return false;
  if (end && ym > end) return false;
  return true;
}

/* --------- Utilization heatmap (expandable person → projects) --------- */

type HeatMonth = { ym: string; label: string };
type HeatCell = { ym: string; label: string; hours: number; util: number };
type HeatProjectRow = {
  project: Project;
  cells: HeatCell[];
  totalHours: number;
  avgUtil: number;
};
type HeatPersonRow = {
  person: RosterPerson;
  total: { cells: HeatCell[]; totalHours: number; avgUtil: number };
  byProject: HeatProjectRow[];
};

function buildUtilizationMatrixWithProjects(
  projects: Project[],
  roster: RosterPerson[],
  selectedPeople: Set<string> | null,
  startYm?: string,
  endYm?: string
): { months: HeatMonth[]; rows: HeatPersonRow[] } {
  if (projects.length === 0) return { months: [], rows: [] };

  // Find all unique months across all projects
  const allMonths = new Set<string>();
  for (const p of projects) {
    for (let i = 0; i < p.months.length; i++) {
      const ym = ymFromStartIndex(p.startMonthISO, i);
      if (inYmRange(ym, startYm, endYm)) {
        allMonths.add(ym);
      }
    }
  }
  const months = Array.from(allMonths).sort();

  // Filter people based on selectedPeople
  const people = selectedPeople
    ? roster.filter((r) => selectedPeople.has(r.id))
    : roster;

  // Build allocation maps
  const byPersonTotal: Record<string, Record<string, number>> = {};
  const byPersonProject: Record<string, Record<string, Record<string, number>>> = {};

  for (const person of people) {
    byPersonTotal[person.id] = {};
    byPersonProject[person.id] = {};
    for (const ym of months) {
      byPersonTotal[person.id][ym] = 0;
    }
  }

  for (const p of projects) {
    for (let i = 0; i < p.months.length; i++) {
      const m = p.months[i];
      const ym = ymFromStartIndex(p.startMonthISO, i);
      if (!months.includes(ym)) continue;

      for (const personId of p.memberIds) {
        const alloc = toNumber(m.personAllocations[personId] ?? 0, 0);
        if (alloc <= 0) continue;
        const person = people.find((r) => r.id === personId);
        if (!person) continue;
        const base = toNumber(person.baseMonthlyHours, 0);
        const hours = (base * alloc) / 100;
        byPersonTotal[personId][ym] += hours;
        if (!byPersonProject[personId][p.id])
          byPersonProject[personId][p.id] = {};
        if (!byPersonProject[personId][p.id][ym])
          byPersonProject[personId][p.id][ym] = 0;
        byPersonProject[personId][p.id][ym] += hours;
      }
    }
  }

  const rows: HeatPersonRow[] = people.map((person) => {
    const base = Math.max(1, toNumber(person.baseMonthlyHours, 0)); // avoid /0
    // total row
    const totalCells: HeatCell[] = months.map((ym) => {
      const hours = byPersonTotal[person.id]?.[ym] ?? 0;
      return { ym, label: labelFromYm(ym), hours, util: hours / base };
    });
    const totalHours = totalCells.reduce((s, c) => s + c.hours, 0);
    const avgUtil = totalCells.length
      ? totalCells.reduce((s, c) => s + c.util, 0) / totalCells.length
      : 0;

    // per-project rows
    const projRows: HeatProjectRow[] = projects
      .filter(
        (p) =>
          !!byPersonProject[person.id][p.id] &&
          Object.values(byPersonProject[person.id][p.id]).some((h) => h > 0)
      )
      .map((p) => {
        const cells: HeatCell[] = months.map((ym) => {
          const hours = byPersonProject[person.id][p.id][ym] ?? 0;
          return { ym, label: labelFromYm(ym), hours, util: hours / base };
        });
        const th = cells.reduce((s, c) => s + c.hours, 0);
        const au = cells.length
          ? cells.reduce((s, c) => s + c.util, 0) / cells.length
          : 0;
        return { project: p, cells, totalHours: th, avgUtil: au };
      });

    return { person, total: { cells: totalCells, totalHours, avgUtil }, byProject: projRows };
  });

  return {
    months: months.map((ym) => ({ ym, label: labelFromYm(ym) })),
    rows,
  };
}

/* ------------------- heatmap cell helpers (uncapped + warning) ------------------- */

function colorForUtil(util: number): string {
  const pct = Math.min(util, 1.5); // cap color for visual only
  if (pct >= 1.01) return "bg-red-400";
  if (pct >= 0.75) return "bg-teal-400";
  if (pct >= 0.5) return "bg-green-400";
  if (pct >= 0.25) return "bg-green-200";
  return "bg-gray-200";
}

function UtilBadge({ 
  util, 
  showCosts = false, 
  person, 
  hours = 0 
}: { 
  util: number; 
  showCosts?: boolean; 
  person?: RosterPerson; 
  hours?: number; 
}) {
  const pctDisplay = (util * 100).toFixed(0); // show real % (can exceed 100)
  const overBy = util > 1 ? ((util - 1) * 100).toFixed(0) : null;
  const cls = `rounded-md px-2 py-2 ${colorForUtil(util)} text-black/80 inline-flex items-center gap-1 justify-center flex-col`;
  
  const cost = showCosts && person ? effectiveHourlyRate(person) * hours : 0;
  
  return (
    <div className={cls} title={overBy ? `Over by ${overBy}%` : "Within capacity"}>
      <div className="flex items-center gap-1">
        <span>{pctDisplay}%</span>
        {overBy && (
          <span
            className="text-red-700 font-semibold"
            aria-label={`Overallocated by ${overBy}%`}
            title={`Overallocated by ${overBy}%`}
          >
            ⚠
          </span>
        )}
      </div>
      {showCosts && cost > 0 && (
        <div className="text-xs">${cost.toFixed(0)}</div>
      )}
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export default function ResourcingPage() {
  const [hydrated, setHydrated] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [roster, setRoster] = useState<RosterPerson[]>([]);

  // Filters
  const [startYm, setStartYm] = useState<string>("");
  const [endYm, setEndYm] = useState<string>("");
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(new Set());
  const [selectedProjectTypes, setSelectedProjectTypes] = useState<Set<ProjectType>>(new Set(["Test", "BD", "Active", "Completed", "Cancelled"]));
  const [selectedDepartments, setSelectedDepartments] = useState<Set<Department>>(new Set(["C-Suite", "BD", "Marketing", "Product", "Engineering", "Ops", "Software", "Admin", "Other"]));

  // UI state for expanded people in heatmap
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  
  // UI state for collapsible filters section
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  
  // UI state for showing costs in heatmap
  const [showCosts, setShowCosts] = useState(false);

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
        setSelectedProjects(new Set(ps.map((p) => p.id))); // default: all projects
        setSelectedPeople(new Set(rs.map((r) => r.id))); // default: all people
        setHydrated(true);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredProjects = useMemo(() => {
    if (selectedProjects.size === 0) return [];
    return projects.filter((p) => 
      selectedProjects.has(p.id) && selectedProjectTypes.has(p.projectType)
    );
  }, [projects, selectedProjects, selectedProjectTypes]);

  const filteredPeople = useMemo(() => {
    if (selectedPeople.size === 0) return null;
    const peopleByDepartment = roster.filter(p => selectedDepartments.has(p.department));
    return new Set(peopleByDepartment.filter(p => selectedPeople.has(p.id)).map(p => p.id));
  }, [roster, selectedPeople, selectedDepartments]);

  // Heatmap with expandable per-project rows
  const heat = useMemo(
    () =>
      buildUtilizationMatrixWithProjects(
        filteredProjects,
        roster,
        filteredPeople,
        startYm || undefined,
        endYm || undefined
      ),
    [filteredProjects, roster, filteredPeople, startYm, endYm]
  );

  // Project selection helpers
  function toggleProject(id: string, on: boolean) {
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function selectAllProjects() {
    setSelectedProjects(new Set(projects.map((p) => p.id)));
  }
  function clearProjects() {
    setSelectedProjects(new Set());
  }

  // People selection helpers
  function togglePerson(id: string, on: boolean) {
    setSelectedPeople((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function selectAllPeople() {
    setSelectedPeople(new Set(roster.map((r) => r.id)));
  }
  function clearPeople() {
    setSelectedPeople(new Set());
  }

  // Project type selection helpers
  function toggleProjectType(type: ProjectType, on: boolean) {
    setSelectedProjectTypes((prev) => {
      const next = new Set(prev);
      if (on) next.add(type);
      else next.delete(type);
      return next;
    });
  }
  function selectAllProjectTypes() {
    setSelectedProjectTypes(new Set(["Test", "BD", "Active", "Completed", "Cancelled"]));
  }
  function clearProjectTypes() {
    setSelectedProjectTypes(new Set());
  }

  // Department selection helpers
  function toggleDepartment(department: Department, on: boolean) {
    setSelectedDepartments((prev) => {
      const next = new Set(prev);
      if (on) next.add(department);
      else next.delete(department);
      return next;
    });
  }
  function selectAllDepartments() {
    setSelectedDepartments(new Set(["C-Suite", "BD", "Marketing", "Product", "Engineering", "Ops", "Software", "Admin", "Other"]));
  }
  function clearDepartments() {
    setSelectedDepartments(new Set());
  }

  // Expand/collapse
  function toggleExpand(personId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  if (!hydrated)
    return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Resourcing</h1>

      {/* Filters */}
      <div className="rounded-xl border space-y-4">
        {/* Filters Header */}
        <div 
          className="flex items-center justify-between p-4 pb-2 cursor-pointer hover:bg-muted/50"
          onClick={() => setFiltersCollapsed(!filtersCollapsed)}
        >
          <h2 className="text-lg font-semibold">Filters</h2>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            {filtersCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
        
        {/* Collapsible Filters Content */}
        <div className={`px-4 pb-4 space-y-4 transition-all duration-300 ease-in-out overflow-hidden ${filtersCollapsed ? "max-h-0 opacity-0 pb-0" : "max-h-[2000px] opacity-100"}`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="text-sm font-medium mb-1">Start month</div>
            <Input
              type="month"
              value={startYm}
              onChange={(e) => setStartYm(e.target.value)}
            />
          </div>
          <div>
            <div className="text-sm font-medium mb-1">End month</div>
            <Input
              type="month"
              value={endYm}
              onChange={(e) => setEndYm(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <Button variant="outline" onClick={selectAllProjects}>
              Select all projects
            </Button>
            <Button variant="outline" onClick={clearProjects}>
              Clear
            </Button>
          </div>
        </div>

        {/* Project Type multi-select */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Project Types</div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={selectAllProjectTypes}>
                Select all
              </Button>
              <Button variant="outline" onClick={clearProjectTypes}>
                Clear
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["Test", "BD", "Active", "Completed", "Cancelled"] as const).map((type) => {
              const checked = selectedProjectTypes.has(type);
              return (
                <label
                  key={type}
                  className={`inline-flex select-none items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                    checked ? "bg-secondary" : "bg-background"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleProjectType(type, e.target.checked)}
                  />
                  <span className="truncate">{type}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Project multi-select */}
        <div className="space-y-2">
          <div className="text-sm font-medium">Projects</div>
          {projects.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No projects yet. Create one on the Projects page.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {projects.map((p) => {
                const checked = selectedProjects.has(p.id);
                const typeMatch = selectedProjectTypes.has(p.projectType);
                const isActive = checked && typeMatch;
                return (
                  <label
                    key={p.id}
                    className={`inline-flex select-none items-center gap-2 rounded-full border px-3 py-1 text-sm transition-opacity ${
                      isActive ? "bg-secondary" : 
                      typeMatch ? "bg-background" : "bg-background opacity-40"
                    }`}
                    title={!typeMatch ? `${p.projectType} type is not selected` : ""}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!typeMatch}
                      onChange={(e) => toggleProject(p.id, e.target.checked)}
                    />
                    <span className={`truncate ${!typeMatch ? "line-through text-muted-foreground" : ""}`}>
                      {p.name} <span className="text-xs text-muted-foreground">({p.projectType})</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Department multi-select */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Departments</div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={selectAllDepartments}>
                Select all
              </Button>
              <Button variant="outline" onClick={clearDepartments}>
                Clear
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["C-Suite", "BD", "Marketing", "Product", "Engineering", "Ops", "Software", "Admin", "Other"] as const).map((department) => {
              const checked = selectedDepartments.has(department);
              return (
                <label
                  key={department}
                  className={`inline-flex select-none items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                    checked ? "bg-secondary" : "bg-background"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleDepartment(department, e.target.checked)}
                  />
                  <span className="truncate">{department}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* People multi-select */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">People</div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={selectAllPeople}>
                Select all
              </Button>
              <Button variant="outline" onClick={clearPeople}>
                Clear
              </Button>
            </div>
          </div>
          {roster.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No people yet. Add them on the Personnel page.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {roster.map((r) => {
                const checked = selectedPeople.has(r.id);
                const departmentMatch = selectedDepartments.has(r.department);
                const isActive = checked && departmentMatch;
                return (
                  <label
                    key={r.id}
                    className={`inline-flex select-none items-center gap-2 rounded-full border px-3 py-1 text-sm transition-opacity ${
                      isActive ? "bg-secondary" : 
                      departmentMatch ? "bg-background" : "bg-background opacity-40"
                    }`}
                    title={!departmentMatch ? `${r.department} department is not selected` : ""}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!departmentMatch}
                      onChange={(e) => togglePerson(r.id, e.target.checked)}
                    />
                    <span className={`truncate ${!departmentMatch ? "line-through text-muted-foreground" : ""}`}>
                      {r.name} <span className="text-xs text-muted-foreground">({r.department})</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Utilization Heatmap */}
      <div className="rounded-xl border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">
            Utilization Heatmap (Expandable by Project)
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showCosts}
                onChange={(e) => setShowCosts(e.target.checked)}
                className="rounded"
              />
              Show Costs
            </label>
            <div className="text-xs text-muted-foreground">
              Click person names to expand/collapse project details
            </div>
          </div>
        </div>

        {heat.months.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No data to display. Adjust your filters or add projects/people.
          </div>
        ) : (
          <>
            {/* Header Row */}
            <div
              className="grid gap-2 items-center"
              style={{
                gridTemplateColumns: `260px repeat(${heat.months.length}, 1fr)`,
              }}
            >
              <div className="text-sm font-medium">Person / Project</div>
              {heat.months.map((month) => (
                <div key={month.ym} className="text-xs text-center font-medium">
                  {month.label}
                </div>
              ))}
            </div>

            {/* Data Rows */}
            <div className="space-y-2">
              {heat.rows.map(({ person, total, byProject }) => {
                const isOpen = expanded.has(person.id);
                return (
                  <div key={person.id} className="border-t">
                    {/* person summary row */}
                    <div
                      className="grid items-center hover:bg-muted/40 cursor-pointer"
                      style={{
                        gridTemplateColumns: `260px repeat(${total.cells.length}, 1fr)`,
                      }}
                      onClick={() => toggleExpand(person.id)}
                    >
                      <div className="flex items-center gap-2">
                        <span className={isOpen ? "rotate-90" : ""}>▶</span>
                        <span className="font-medium truncate">{person.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({person.department})
                        </span>
                      </div>
                      {total.cells.map((cell) => (
                        <div key={cell.ym} className="flex justify-center">
                          <UtilBadge 
                            util={cell.util} 
                            showCosts={showCosts} 
                            person={person} 
                            hours={cell.hours} 
                          />
                        </div>
                      ))}
                    </div>

                    {/* per-project rows */}
                    {isOpen &&
                      byProject.map(({ project, cells }) => (
                        <div
                          key={project.id}
                          className="grid items-center bg-muted/20"
                          style={{
                            gridTemplateColumns: `260px repeat(${cells.length}, 1fr)`,
                          }}
                        >
                          <div className="pl-8 text-sm truncate" title={project.name}>
                            └ <Link href={`/projects/${project.id}`} className="underline underline-offset-2 hover:text-blue-600">{project.name}</Link> ({project.projectType})
                          </div>
                          {cells.map((cell) => {
                            const cost = showCosts && person ? effectiveHourlyRate(person) * cell.hours : 0;
                            return (
                              <div key={cell.ym} className="flex justify-center">
                                <div className="text-xs flex flex-col items-center">
                                  <div>{cell.hours.toFixed(1)}h</div>
                                  {showCosts && cost > 0 && (
                                    <div className="text-muted-foreground">${cost.toFixed(0)}</div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>

            {/* Monthly Cost Totals Row */}
            {showCosts && (
              <div className="border-t pt-2">
                <div
                  className="grid items-center bg-muted/30 rounded p-2"
                  style={{
                    gridTemplateColumns: `260px repeat(${heat.months.length}, 1fr)`,
                  }}
                >
                  <div className="text-sm font-semibold">Monthly Totals</div>
                  {heat.months.map((month) => {
                    // Calculate total cost for this month across all people and projects
                    let monthlyTotal = 0;
                    
                    heat.rows.forEach(({ person, byProject }) => {
                      byProject.forEach(({ cells }) => {
                        const cell = cells.find(c => c.ym === month.ym);
                        if (cell) {
                          monthlyTotal += effectiveHourlyRate(person) * cell.hours;
                        }
                      });
                    });
                    
                    return (
                      <div key={month.ym} className="flex justify-center">
                        <div className="text-sm font-semibold text-blue-600">
                          ${monthlyTotal.toFixed(0)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground pt-4 border-t">
              <span>Legend:</span>
              <span className="inline-block h-3 w-5 rounded bg-gray-200" /> 0–24%
              <span className="inline-block h-3 w-5 rounded bg-green-200" /> 25–49%
              <span className="inline-block h-3 w-5 rounded bg-green-400" /> 50–74%
              <span className="inline-block h-3 w-5 rounded bg-teal-400" /> 75–100%
              <span className="inline-block h-3 w-5 rounded bg-red-400" /> &gt; 100%
            </div>
          </>
        )}
      </div>
    </div>
  );
}

