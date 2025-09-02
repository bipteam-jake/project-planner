// /src/app/page.tsx
"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { ChevronDown, ChevronUp, Check, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Project, ProjectStatus, RosterPerson, Department } from "@/lib/types";
import { currency, toNumber, effectiveHourlyRate } from "@/lib/storage";

// ⬇️ NEW: use the repo abstraction (can later swap to `apiRepo`)
import { apiRepoAsync as repo } from "@/lib/repo";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";

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

type RollRow = {
  ym: string;
  label: string;
  labor: number;
  overhead: number;
  expenses: number;
  allIn: number;
  revenue: number;
  hours: number;
};

// Build rollup honoring project & people filters.
// People filter impacts labor/hours/overhead; expenses/revenue are taken as-is.
function buildCalendarRollupFiltered(
  projects: Project[],
  roster: RosterPerson[],
  startYm?: string,
  endYm?: string
): RollRow[] {
  const rows = new Map<string, RollRow>(); // ym -> roll

  for (const p of projects) {
    for (let i = 0; i < p.months.length; i++) {
      const m = p.months[i];
      const ym = ymFromStartIndex(p.startMonthISO, i);
      if (!inYmRange(ym, startYm || undefined, endYm || undefined)) continue;

      if (!rows.has(ym)) {
        rows.set(ym, {
          ym,
          label: labelFromYm(ym),
          labor: 0,
          overhead: 0,
          expenses: 0,
          allIn: 0,
          revenue: 0,
          hours: 0,
        });
      }
      const row = rows.get(ym)!;

      const members = roster.filter((r) => p.memberIds.includes(r.id));

      let monthHours = 0;
      let monthLabor = 0;
      for (const person of members) {
        const alloc = toNumber(m.personAllocations[person.id] ?? 0, 0);
        if (alloc <= 0) continue;
        const base = toNumber(person.baseMonthlyHours, 0);
        const hours = (base * alloc) / 100;
        const rate = effectiveHourlyRate(person);
        monthHours += hours;
        monthLabor += hours * rate;
      }

      const monthOverhead = monthHours * p.overheadPerHour;

      row.hours += monthHours;
      row.labor += monthLabor;
      row.overhead += monthOverhead;
      row.expenses += m.expenses;
      row.revenue += m.revenue;
      row.allIn = row.labor + row.overhead + row.expenses;
    }
  }

  return Array.from(rows.values()).sort((a, b) => (a.ym < b.ym ? -1 : 1));
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

type HeatDepartmentRow = {
  department: Department;
  people: RosterPerson[];
  total: { cells: HeatCell[]; totalHours: number; avgUtil: number };
  byProject: HeatProjectRow[];
};

function buildDepartmentUtilizationMatrix(
  projects: Project[],
  roster: RosterPerson[],
  startYm?: string,
  endYm?: string
): { months: HeatMonth[]; rows: HeatDepartmentRow[] } {
  // months in window
  const monthsSet = new Set<string>();
  for (const p of projects) {
    for (let i = 0; i < p.months.length; i++) {
      const ym = ymFromStartIndex(p.startMonthISO, i);
      if (inYmRange(ym, startYm || undefined, endYm || undefined)) monthsSet.add(ym);
    }
  }
  const months = Array.from(monthsSet.values()).sort();

  // Use all roster people (no individual people filtering)
  const people = roster;

  // person->ym total, and person->project->ym
  const byPersonTotal: Record<string, Record<string, number>> = {};
  const byPersonProject: Record<string, Record<string, Record<string, number>>> =
    {};
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
      if (!monthsSet.has(ym)) continue;

      for (const personId of p.memberIds) {
        if (!(personId in byPersonTotal)) continue; // filtered out
        const person = roster.find((r) => r.id === personId);
        if (!person) continue;
        const alloc = toNumber(m.personAllocations[personId] ?? 0, 0);
        if (alloc <= 0) continue;
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

  // Group people by department
  const departmentMap = new Map<Department, RosterPerson[]>();
  for (const person of people) {
    const dept = person.department;
    if (!departmentMap.has(dept)) {
      departmentMap.set(dept, []);
    }
    departmentMap.get(dept)!.push(person);
  }

  // Build department rows
  const rows: HeatDepartmentRow[] = [];
  for (const [dept, deptPeople] of departmentMap) {
    if (deptPeople.length === 0) continue;

    // Calculate total department capacity and utilization per month
    const totalCells: HeatCell[] = months.map((ym) => {
      let totalHours = 0;
      let totalCapacity = 0;
      
      for (const person of deptPeople) {
        const personHours = byPersonTotal[person.id]?.[ym] ?? 0;
        const personCapacity = toNumber(person.baseMonthlyHours, 0);
        totalHours += personHours;
        totalCapacity += personCapacity;
      }
      
      const util = totalCapacity > 0 ? totalHours / totalCapacity : 0;
      return { ym, label: labelFromYm(ym), hours: totalHours, util };
    });

    const totalHours = totalCells.reduce((s, c) => s + c.hours, 0);
    const avgUtil = totalCells.length
      ? totalCells.reduce((s, c) => s + c.util, 0) / totalCells.length
      : 0;

    // Get projects that have people from this department
    const deptProjects = projects.filter(p => 
      p.memberIds.some(id => deptPeople.some(person => person.id === id))
    );

    // Per-project rows for this department
    const projRows: HeatProjectRow[] = deptProjects
      .map((p) => {
        const cells: HeatCell[] = months.map((ym) => {
          let projectHours = 0;
          let projectCapacity = 0;
          
          for (const person of deptPeople) {
            if (p.memberIds.includes(person.id)) {
              const personProjectHours = byPersonProject[person.id]?.[p.id]?.[ym] ?? 0;
              const personCapacity = toNumber(person.baseMonthlyHours, 0);
              projectHours += personProjectHours;
              projectCapacity += personCapacity;
            }
          }
          
          const util = projectCapacity > 0 ? projectHours / projectCapacity : 0;
          return { ym, label: labelFromYm(ym), hours: projectHours, util };
        });
        
        const th = cells.reduce((s, c) => s + c.hours, 0);
        const au = cells.length
          ? cells.reduce((s, c) => s + c.util, 0) / cells.length
          : 0;
        return { project: p, cells, totalHours: th, avgUtil: au };
      })
      .filter(row => row.totalHours > 0); // Only show projects with hours

    rows.push({ 
      department: dept, 
      people: deptPeople, 
      total: { cells: totalCells, totalHours, avgUtil }, 
      byProject: projRows 
    });
  }

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

// Helper to check if person is inactive in a given month
function isPersonInactiveInMonth(person: RosterPerson, ym: string): boolean {
  if (person.isActive !== false) return false; // Active person
  if (!person.inactiveDate) return false; // No inactive date set
  
  // Convert ym (YYYY-MM) and inactiveDate (YYYY-MM-DD) to comparable format
  const monthDate = `${ym}-01`;
  return monthDate >= person.inactiveDate;
}

function UtilBadge({ util, person, ym }: { util: number; person?: RosterPerson; ym?: string }) {
  // Check if person is inactive in this month
  const isInactive = person && ym && isPersonInactiveInMonth(person, ym);
  
  if (isInactive) {
    return (
      <div className="rounded-md px-2 py-2 bg-gray-300 text-black/80 inline-flex items-center justify-center" title="Person inactive">
        <span>N/A</span>
      </div>
    );
  }
  
  const pctDisplay = (util * 100).toFixed(0); // show real % (can exceed 100)
  const overBy = util > 1 ? ((util - 1) * 100).toFixed(0) : null;
  const cls = `rounded-md px-2 py-2 ${colorForUtil(util)} text-black/80 inline-flex items-center gap-1 justify-center`;
  return (
    <div className={cls} title={overBy ? `Over by ${overBy}%` : "Within capacity"}>
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
  );
}

/* ---------------------------------- page ---------------------------------- */

export default function DashboardPage() {
  const [hydrated, setHydrated] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [roster, setRoster] = useState<RosterPerson[]>([]);

  // Filters
  const [startYm, setStartYm] = useState<string>("");
  const [endYm, setEndYm] = useState<string>("");
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [selectedProjectStatuses, setSelectedProjectStatuses] = useState<Set<ProjectStatus>>(new Set(["Test", "BD", "Active", "Completed", "Cancelled"]));
  const [selectedDepartments, setSelectedDepartments] = useState<Set<Department>>(new Set(["C-Suite", "BD", "Marketing", "Product", "Engineering", "Ops", "Software", "Admin", "Other"]));

  // UI state for expanded departments in heatmap
  const [expanded, setExpanded] = useState<Set<Department>>(new Set());
  
  // UI state for collapsible filters section
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);

  // Dropdown states for multi-select filters
  const [projectStatusDropdownOpen, setProjectStatusDropdownOpen] = useState(false);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);

  // Search states for dropdowns
  const [projectStatusSearch, setProjectStatusSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [departmentSearch, setDepartmentSearch] = useState("");

  // Refs for dropdown click-outside handling
  const projectStatusDropdownRef = useRef<HTMLDivElement>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const departmentDropdownRef = useRef<HTMLDivElement>(null);

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
        setSelectedProjects(new Set(ps.map((p) => p.id)));
        setHydrated(true);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (projectStatusDropdownRef.current && !projectStatusDropdownRef.current.contains(event.target as Node)) {
        setProjectStatusDropdownOpen(false);
      }
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(event.target as Node)) {
        setProjectDropdownOpen(false);
      }
      if (departmentDropdownRef.current && !departmentDropdownRef.current.contains(event.target as Node)) {
        setDepartmentDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredProjects = useMemo(() => {
    if (selectedProjects.size === 0) return [];
    return projects.filter((p) => 
      selectedProjects.has(p.id) && selectedProjectStatuses.has(p.projectStatus)
    );
  }, [projects, selectedProjects, selectedProjectStatuses]);

  // Filtered lists for dropdown searches
  const filteredProjectStatusesForSearch = useMemo(() => {
    const allStatuses = ["Test", "BD", "Active", "Completed", "Cancelled"] as const;
    if (!projectStatusSearch.trim()) return allStatuses;
    const search = projectStatusSearch.toLowerCase();
    return allStatuses.filter(status => status.toLowerCase().includes(search));
  }, [projectStatusSearch]);

  const filteredProjectsForSearch = useMemo(() => {
    if (!projectSearch.trim()) return projects;
    const search = projectSearch.toLowerCase();
    return projects.filter(p => 
      p.name.toLowerCase().includes(search) || 
      p.projectStatus.toLowerCase().includes(search)
    );
  }, [projects, projectSearch]);

  const filteredDepartmentsForSearch = useMemo(() => {
    const allDepartments = ["C-Suite", "BD", "Marketing", "Product", "Engineering", "Ops", "Software", "Admin", "Other"] as const;
    if (!departmentSearch.trim()) return allDepartments;
    const search = departmentSearch.toLowerCase();
    return allDepartments.filter(dept => dept.toLowerCase().includes(search));
  }, [departmentSearch]);

  // No longer need filteredPeople since we're grouping by department

  // Costs rollup (filtered)
  const rolled = useMemo(
    () =>
      buildCalendarRollupFiltered(
        filteredProjects,
        roster,
        startYm || undefined,
        endYm || undefined
      ),
    [filteredProjects, roster, startYm, endYm]
  );

  // Summary over filtered window
  const summary = useMemo(() => {
    let labor = 0,
      overhead = 0,
      expenses = 0,
      allIn = 0,
      revenue = 0,
      hours = 0;
    for (const r of rolled) {
      labor += r.labor;
      overhead += r.overhead;
      expenses += r.expenses;
      allIn += r.allIn;
      revenue += r.revenue;
      hours += r.hours;
    }
    const profit = revenue - allIn;
    const margin = revenue > 0 ? profit / revenue : 0;
    return { labor, overhead, expenses, allIn, revenue, profit, margin, hours };
  }, [rolled]);

  // Cumulative series (for the line chart)
  const cumulative = useMemo(() => {
    let cumRev = 0;
    let cumAllIn = 0;
    return rolled.map((r) => {
      cumRev += r.revenue;
      cumAllIn += r.allIn;
      return { label: r.label, cumRevenue: cumRev, cumAllIn };
    });
  }, [rolled]);

  // Heatmap with expandable per-project rows
  const heat = useMemo(
    () =>
      buildDepartmentUtilizationMatrix(
        filteredProjects,
        roster,
        startYm || undefined,
        endYm || undefined
      ),
    [filteredProjects, roster, startYm, endYm]
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


  // Project type selection helpers
  function toggleProjectStatus(status: ProjectStatus, on: boolean) {
    setSelectedProjectStatuses((prev) => {
      const next = new Set(prev);
      if (on) next.add(status);
      else next.delete(status);
      return next;
    });
  }
  function selectAllProjectStatuses() {
    setSelectedProjectStatuses(new Set(["Test", "BD", "Active", "Completed", "Cancelled"]));
  }
  function clearProjectStatuses() {
    setSelectedProjectStatuses(new Set());
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
  function toggleExpand(department: Department) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(department)) next.delete(department);
      else next.add(department);
      return next;
    });
  }

  if (!hydrated)
    return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of project finances, utilization, and team performance
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-card shadow-sm p-4 space-y-4">
        {/* Date Range Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">Start month</label>
            <Input
              type="month"
              value={startYm}
              onChange={(e) => setStartYm(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">End month</label>
            <Input
              type="month"
              value={endYm}
              onChange={(e) => setEndYm(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>

        {/* Multi-select Dropdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Project Status */}
          <div className="relative" ref={projectStatusDropdownRef}>
            <label className="text-sm font-medium text-muted-foreground">Project Status</label>
            <button
              onClick={() => setProjectStatusDropdownOpen(!projectStatusDropdownOpen)}
              className="mt-1 flex items-center gap-2 border rounded-lg px-3 py-2 bg-background text-sm w-full justify-between hover:bg-muted transition-colors"
            >
              <span>
                {selectedProjectStatuses.size === 5 
                  ? "All Statuses"
                  : selectedProjectStatuses.size === 0
                  ? "No Statuses"
                  : `${selectedProjectStatuses.size} selected`
                }
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${projectStatusDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {projectStatusDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-full bg-background border rounded-lg shadow-lg z-10 py-1">
                <div className="px-3 py-2 border-b">
                  <div className="flex gap-2 mb-2">
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
                  <div className="relative">
                    <Search className="h-3 w-3 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search statuses..."
                      value={projectStatusSearch}
                      onChange={(e) => setProjectStatusSearch(e.target.value)}
                      className="pl-7 h-7 text-xs"
                    />
                  </div>
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {filteredProjectStatusesForSearch.map((status) => {
                    const checked = selectedProjectStatuses.has(status);
                    return (
                      <label
                        key={status}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer text-sm"
                      >
                        <div className="relative flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleProjectStatus(status, e.target.checked)}
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
              </div>
            )}
          </div>

          {/* Projects */}
          <div className="relative" ref={projectDropdownRef}>
            <label className="text-sm font-medium text-muted-foreground">Projects</label>
            <button
              onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
              className="mt-1 flex items-center gap-2 border rounded-lg px-3 py-2 bg-background text-sm w-full justify-between hover:bg-muted transition-colors"
            >
              <span>
                {projects.length === 0
                  ? "No Projects"
                  : selectedProjects.size === projects.length
                  ? "All Projects"
                  : selectedProjects.size === 0
                  ? "No Projects"
                  : `${selectedProjects.size} selected`
                }
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${projectDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {projectDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-full bg-background border rounded-lg shadow-lg z-10 py-1">
                <div className="px-3 py-2 border-b">
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={selectAllProjects}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Select all
                    </button>
                    <span className="text-xs text-muted-foreground">•</span>
                    <button
                      onClick={clearProjects}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="relative">
                    <Search className="h-3 w-3 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search projects..."
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      className="pl-7 h-7 text-xs"
                    />
                  </div>
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {projects.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No projects yet. Create one on the Projects page.
                    </div>
                  ) : (
                    filteredProjectsForSearch.map((p) => {
                      const checked = selectedProjects.has(p.id);
                      const statusMatch = selectedProjectStatuses.has(p.projectStatus);
                      return (
                        <label
                          key={p.id}
                          className={`flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer text-sm ${
                            !statusMatch ? 'opacity-50' : ''
                          }`}
                          title={!statusMatch ? `${p.projectStatus} status is not selected` : ""}
                        >
                          <div className="relative flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!statusMatch}
                              onChange={(e) => toggleProject(p.id, e.target.checked)}
                              className="sr-only"
                            />
                            <div className={`w-4 h-4 border rounded flex items-center justify-center ${
                              checked && statusMatch ? 'bg-primary border-primary' : 'border-input'
                            }`}>
                              {checked && statusMatch && <Check className="h-3 w-3 text-primary-foreground" />}
                            </div>
                          </div>
                          <span className={`truncate ${!statusMatch ? 'line-through' : ''}`}>
                            {p.name} <span className="text-xs text-muted-foreground">({p.projectStatus})</span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Departments */}
          <div className="relative" ref={departmentDropdownRef}>
            <label className="text-sm font-medium text-muted-foreground">Departments</label>
            <button
              onClick={() => setDepartmentDropdownOpen(!departmentDropdownOpen)}
              className="mt-1 flex items-center gap-2 border rounded-lg px-3 py-2 bg-background text-sm w-full justify-between hover:bg-muted transition-colors"
            >
              <span>
                {selectedDepartments.size === 9 
                  ? "All Departments"
                  : selectedDepartments.size === 0
                  ? "No Departments"
                  : `${selectedDepartments.size} selected`
                }
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${departmentDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {departmentDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-full bg-background border rounded-lg shadow-lg z-10 py-1">
                <div className="px-3 py-2 border-b">
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={selectAllDepartments}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Select all
                    </button>
                    <span className="text-xs text-muted-foreground">•</span>
                    <button
                      onClick={clearDepartments}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="relative">
                    <Search className="h-3 w-3 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search departments..."
                      value={departmentSearch}
                      onChange={(e) => setDepartmentSearch(e.target.value)}
                      className="pl-7 h-7 text-xs"
                    />
                  </div>
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {filteredDepartmentsForSearch.map((department) => {
                    const checked = selectedDepartments.has(department);
                    return (
                      <label
                        key={department}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer text-sm"
                      >
                        <div className="relative flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleDepartment(department, e.target.checked)}
                            className="sr-only"
                          />
                          <div className={`w-4 h-4 border rounded flex items-center justify-center ${
                            checked ? 'bg-primary border-primary' : 'border-input'
                          }`}>
                            {checked && <Check className="h-3 w-3 text-primary-foreground" />}
                          </div>
                        </div>
                        {department}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
        <Tile label="Hours" value={summary.hours.toFixed(1)} />
        <Tile label="Labor cost" value={currency(summary.labor)} />
        <Tile label="Overhead cost" value={currency(summary.overhead)} />
        <Tile label="Expenses" value={currency(summary.expenses)} />
        <Tile label="All-in cost" value={currency(summary.allIn)} />
        <Tile label="Revenue" value={currency(summary.revenue)} />
        <Tile 
          label="Margin" 
          value={`${(summary.margin * 100).toFixed(1)}%`}
          subValue={currency(summary.profit)}
        />
      </div>

      {/* Stacked Bar: monthly costs + revenue line */}
      <div className="rounded-xl border bg-card shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4">
          Monthly Costs vs Revenue
        </h3>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={rolled}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="expenses" stackId="a" name="Expenses" fill="#9ca3af" />
              <Bar dataKey="labor" stackId="a" name="Labor" fill="#60a5fa" />
              <Bar dataKey="overhead" stackId="a" name="Overhead" fill="#f59e0b" />
              <Line
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Cumulative: Revenue vs All-in */}
      <div className="rounded-xl border bg-card shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4">
          Cumulative Revenue vs All-in Cost
        </h3>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <LineChart
              data={rolled.map((r, idx) => ({
                label: r.label,
                cumRevenue: cumulative[idx]?.cumRevenue ?? 0,
                cumAllIn: cumulative[idx]?.cumAllIn ?? 0,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="cumRevenue"
                name="Cum. Revenue"
                stroke="#10b981"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="cumAllIn"
                name="Cum. All-in"
                stroke="#ef4444"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Utilization Heatmap (expandable per person → per project) */}
      <div className="rounded-xl border bg-card shadow-sm p-6 space-y-4">
        <h3 className="text-lg font-semibold">Department Utilization</h3>

        {heat.months.length === 0 || heat.rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No data in the selected window.
          </div>
        ) : (
          <div className="overflow-auto">
            <div className="min-w-[820px]">
              {/* header row */}
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `320px repeat(${heat.months.length}, 1fr)`,
                }}
              >
                <div className="p-2 text-xs text-muted-foreground">
                  Department / Project
                </div>
                {heat.months.map((m) => (
                  <div
                    key={m.ym}
                    className="p-2 text-xs text-center text-muted-foreground"
                  >
                    {m.label}
                  </div>
                ))}
              </div>

              {/* rows */}
              {heat.rows.map(({ department, people, total, byProject }) => {
                const isOpen = expanded.has(department);
                return (
                  <div key={department} className="border-t">
                    {/* department summary row */}
                    <div
                      className="grid items-center hover:bg-muted/40 cursor-pointer"
                      style={{
                        gridTemplateColumns: `320px repeat(${total.cells.length}, 1fr)`,
                      }}
                      onClick={() => toggleExpand(department)}
                      title="Click to expand"
                    >
                      <div className="p-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded border text-xs bg-background">
                            {isOpen ? "–" : "+"}
                          </span>
                          <span className="font-medium">{department}</span>
                        </div>
                        <div className="ml-7 text-xs text-muted-foreground mt-1">
                          {people.length} people · Avg: {(Math.min(total.avgUtil, 1) * 100).toFixed(0)}% · Total hrs: {total.totalHours.toFixed(1)}
                        </div>
                      </div>
                      {total.cells.map((c) => (
                        <div key={c.ym} className="p-2 text-xs text-center">
                          <UtilBadge util={c.util} ym={c.ym} />
                        </div>
                      ))}
                    </div>

                    {/* expanded per-project rows */}
                    {isOpen &&
                      byProject.map((row) => (
                        <div
                          key={row.project.id}
                          className="grid items-center"
                          style={{
                            gridTemplateColumns: `320px repeat(${row.cells.length}, 1fr)`,
                          }}
                        >
                          <div className="p-2 text-sm pl-10 flex items-center justify-between">
                            <span className="truncate text-muted-foreground">
                              {row.project.name}
                            </span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              Avg: {(Math.min(row.avgUtil, 1) * 100).toFixed(0)}% ·
                              Hrs: {row.totalHours.toFixed(1)}
                            </span>
                          </div>
                          {row.cells.map((c) => (
                            <div key={c.ym} className="p-2 text-xs text-center">
                              <UtilBadge util={c.util} ym={c.ym} />
                            </div>
                          ))}
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-block h-3 w-5 rounded bg-gray-200" /> 0–24%
          <span className="inline-block h-3 w-5 rounded bg-green-200" /> 25–49%
          <span className="inline-block h-3 w-5 rounded bg-green-400" /> 50–74%
          <span className="inline-block h-3 w-5 rounded bg-teal-400" /> 75–100%
          <span className="inline-block h-3 w-5 rounded bg-red-400" /> &gt; 100%
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- small presentational ----------------------------- */

function Tile({ label, value, subValue }: { label: string; value: string; subValue?: string }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-2xl font-bold tracking-tight mt-2">{value}</div>
      {subValue && (
        <div className="text-sm text-muted-foreground mt-1">{subValue}</div>
      )}
    </div>
  );
}

