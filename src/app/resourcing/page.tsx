// /src/app/resourcing/page.tsx
"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Check, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Project, ProjectStatus, RosterPerson, Department } from "@/lib/types";
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

  // Helper function to check if person should be visible in the table
  function shouldShowPerson(person: RosterPerson, personMonths: string[]): boolean {
    // Check if person has any utilization in the visible months
    const hasUtilization = personMonths.some(ym => {
      const hours = byPersonTotal[person.id]?.[ym] ?? 0;
      return hours > 0;
    });
    
    // Check if person is active in any of the visible months
    const hasActiveMonths = personMonths.some(ym => {
      return !isPersonInactiveInMonth(person, ym);
    });
    
    // Show person if they have utilization OR if they're active in any visible month
    return hasUtilization || hasActiveMonths;
  }

  // Filter rows to only show people who should be visible
  const visibleRows = rows.filter(({ person }) => shouldShowPerson(person, months));

  return {
    months: months.map((ym) => ({ ym, label: labelFromYm(ym) })),
    rows: visibleRows,
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

function UtilBadge({ 
  util, 
  showCosts = false, 
  person, 
  hours = 0,
  ym 
}: { 
  util: number; 
  showCosts?: boolean; 
  person?: RosterPerson; 
  hours?: number;
  ym?: string;
}) {
  // Check if person is inactive in this month
  const isInactive = person && ym && isPersonInactiveInMonth(person, ym);
  // Check if person is inactive but has utilization (warning condition)
  const isInactiveWithUtil = person && person.isActive === false && util > 0;
  
  if (isInactive) {
    // Show warning if inactive person has utilization
    if (isInactiveWithUtil) {
      return (
        <div className="rounded-md px-2 py-2 bg-orange-400 text-black/80 inline-flex items-center justify-center gap-1" 
             title={`WARNING: ${person.name} is inactive but has ${(util * 100).toFixed(0)}% utilization. Check project assignments.`}>
          <span>⚠</span>
          <span>N/A</span>
        </div>
      );
    }
    
    return (
      <div className="rounded-md px-2 py-2 bg-gray-300 text-black/80 inline-flex items-center justify-center" title="Person inactive">
        <span>N/A</span>
      </div>
    );
  }
  
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
  const [selectedProjectStatuses, setSelectedProjectStatuses] = useState<Set<ProjectStatus>>(new Set(["Test", "BD", "Active", "Completed", "Cancelled"]));
  const [selectedDepartments, setSelectedDepartments] = useState<Set<Department>>(new Set(["C-Suite", "BD", "Marketing", "Product", "Engineering", "Ops", "Software", "Admin", "Other"]));

  // UI state for expanded people in heatmap
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  
  // UI state for collapsible filters section
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  // Month window (paginate up to 12 months visible)
  const [monthOffset, setMonthOffset] = useState(0);
  const MAX_WINDOW = 12;
  
  // UI state for showing costs in heatmap
  const [showCosts, setShowCosts] = useState(false);

  // Dropdown states for multi-select filters
  const [projectStatusDropdownOpen, setProjectStatusDropdownOpen] = useState(false);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);
  const [peopleDropdownOpen, setPeopleDropdownOpen] = useState(false);

  // Search states for dropdowns
  const [projectStatusSearch, setProjectStatusSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [departmentSearch, setDepartmentSearch] = useState("");
  const [peopleSearch, setPeopleSearch] = useState("");

  // Refs for dropdown click-outside handling
  const projectStatusDropdownRef = useRef<HTMLDivElement>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const departmentDropdownRef = useRef<HTMLDivElement>(null);
  const peopleDropdownRef = useRef<HTMLDivElement>(null);

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
      if (peopleDropdownRef.current && !peopleDropdownRef.current.contains(event.target as Node)) {
        setPeopleDropdownOpen(false);
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

  const filteredPeople = useMemo(() => {
    if (selectedPeople.size === 0) return null;
    const peopleByDepartment = roster.filter(p => selectedDepartments.has(p.department));
    return new Set(peopleByDepartment.filter(p => selectedPeople.has(p.id)).map(p => p.id));
  }, [roster, selectedPeople, selectedDepartments]);

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

  const filteredPeopleForSearch = useMemo(() => {
    if (!peopleSearch.trim()) return roster;
    const search = peopleSearch.toLowerCase();
    return roster.filter(p => 
      p.name.toLowerCase().includes(search) || 
      p.department.toLowerCase().includes(search)
    );
  }, [roster, peopleSearch]);

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

  // Visible months window and navigation
  const allMonths = heat.months;
  const maxOffset = Math.max(0, allMonths.length - MAX_WINDOW);
  const safeOffset = Math.min(Math.max(0, monthOffset), maxOffset);
  const windowMonths = allMonths.slice(safeOffset, safeOffset + MAX_WINDOW);
  const canPrevMonth = safeOffset > 0;
  const canNextMonth = safeOffset < maxOffset;
  const monthsUsed = windowMonths.length ? windowMonths : heat.months;

  // Filter heat rows based on what's actually visible in the window
  const visibleHeatRows = useMemo(() => {
    return heat.rows.filter(({ person, total }) => {
      const visibleMonthYms = monthsUsed.map(m => m.ym);
      
      // Check if person has any utilization in visible months
      const hasUtilizationInWindow = total.cells.some(cell => 
        visibleMonthYms.includes(cell.ym) && cell.hours > 0
      );
      
      // Check if person is active in any visible months
      const hasActiveMonthsInWindow = visibleMonthYms.some(ym => 
        !isPersonInactiveInMonth(person, ym)
      );
      
      return hasUtilizationInWindow || hasActiveMonthsInWindow;
    });
  }, [heat.rows, monthsUsed]);

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
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Resourcing</h1>
        <p className="text-muted-foreground">
          Track team utilization, project allocations, and resource planning
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

          {/* People */}
          <div className="relative" ref={peopleDropdownRef}>
            <label className="text-sm font-medium text-muted-foreground">People</label>
            <button
              onClick={() => setPeopleDropdownOpen(!peopleDropdownOpen)}
              className="mt-1 flex items-center gap-2 border rounded-lg px-3 py-2 bg-background text-sm w-full justify-between hover:bg-muted transition-colors"
            >
              <span>
                {roster.length === 0
                  ? "No People"
                  : selectedPeople.size === roster.length
                  ? "All People"
                  : selectedPeople.size === 0
                  ? "No People"
                  : `${selectedPeople.size} selected`
                }
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${peopleDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {peopleDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-full bg-background border rounded-lg shadow-lg z-10 py-1">
                <div className="px-3 py-2 border-b">
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={selectAllPeople}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Select all
                    </button>
                    <span className="text-xs text-muted-foreground">•</span>
                    <button
                      onClick={clearPeople}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="relative">
                    <Search className="h-3 w-3 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search people..."
                      value={peopleSearch}
                      onChange={(e) => setPeopleSearch(e.target.value)}
                      className="pl-7 h-7 text-xs"
                    />
                  </div>
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {roster.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No people yet. Add them on the Personnel page.
                    </div>
                  ) : (
                    filteredPeopleForSearch.map((r) => {
                      const checked = selectedPeople.has(r.id);
                      const departmentMatch = selectedDepartments.has(r.department);
                      return (
                        <label
                          key={r.id}
                          className={`flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer text-sm ${
                            !departmentMatch ? 'opacity-50' : ''
                          }`}
                          title={!departmentMatch ? `${r.department} department is not selected` : ""}
                        >
                          <div className="relative flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!departmentMatch}
                              onChange={(e) => togglePerson(r.id, e.target.checked)}
                              className="sr-only"
                            />
                            <div className={`w-4 h-4 border rounded flex items-center justify-center ${
                              checked && departmentMatch ? 'bg-primary border-primary' : 'border-input'
                            }`}>
                              {checked && departmentMatch && <Check className="h-3 w-3 text-primary-foreground" />}
                            </div>
                          </div>
                          <span className={`truncate ${!departmentMatch ? 'line-through' : ''}`}>
                            {r.name} <span className="text-xs text-muted-foreground">({r.department})</span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Utilization Heatmap */}
      <div className="rounded-xl border bg-card shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h3 className="text-lg font-semibold">
              Utilization Heatmap
            </h3>
            <div className="flex items-center gap-2 text-sm">
              <Button variant="outline" size="icon" onClick={() => setMonthOffset((o) => Math.max(0, o - 1))} disabled={!(allMonths.length > MAX_WINDOW && canPrevMonth)} aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-[12ch] text-center">
                {windowMonths.length ? `${windowMonths[0].label} – ${windowMonths[windowMonths.length - 1].label}` : ""}
              </div>
              <Button variant="outline" size="icon" onClick={() => setMonthOffset((o) => Math.min(maxOffset, o + 1))} disabled={!(allMonths.length > MAX_WINDOW && canNextMonth)} aria-label="Next month">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
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

        {heat.months.length === 0 || visibleHeatRows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {heat.months.length === 0 
              ? "No data to display. Adjust your filters or add projects/people."
              : "No people have utilization or are active in the displayed time period. Use the month navigation or adjust filters to see more data."
            }
          </div>
        ) : (
          <>
            {/* Header Row */}
            <div
              className="grid gap-2 items-center"
              style={{
                gridTemplateColumns: `260px repeat(${(windowMonths.length ? windowMonths : heat.months).length}, 1fr)`,
              }}
            >
              <div className="text-sm font-medium">Person / Project</div>
              {(windowMonths.length ? windowMonths : heat.months).map((month) => (
                <div key={month.ym} className="text-xs text-center font-medium">
                  {month.label}
                </div>
              ))}
            </div>

            {/* Data Rows */}
            <div className="space-y-2">
              {visibleHeatRows.map(({ person, total, byProject }) => {
                const isOpen = expanded.has(person.id);
                return (
                  <div key={person.id} className="border-t">
                    {/* person summary row */}
                    <div
                      className="grid items-center hover:bg-muted/40 cursor-pointer"
                      style={{ gridTemplateColumns: `260px repeat(${(windowMonths.length ? windowMonths : heat.months).length}, 1fr)` }}
                      onClick={() => toggleExpand(person.id)}
                    >
                      <div className="flex items-center gap-2">
                        <span className={isOpen ? "rotate-90" : ""}>▶</span>
                        <span className="font-medium truncate">{person.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({person.department})
                        </span>
                      </div>
                      {(windowMonths.length ? windowMonths : heat.months).map((m) => {
                        const found = total.cells.find((c) => c.ym === m.ym);
                        const hours = found?.hours ?? 0;
                        const util = found?.util ?? 0;
                        return (
                          <div key={m.ym} className="flex justify-center">
                            <UtilBadge util={util} showCosts={showCosts} person={person} hours={hours} ym={m.ym} />
                          </div>
                        );
                      })}
                    </div>

                    {/* per-project rows */}
                    {isOpen &&
                      byProject.map(({ project, cells }) => (
                        <div
                          key={project.id}
                          className="grid items-center bg-muted/20"
                          style={{ gridTemplateColumns: `260px repeat(${(windowMonths.length ? windowMonths : heat.months).length}, 1fr)` }}
                        >
                          <div className="pl-8 text-sm truncate" title={project.name}>
                            └ <Link href={`/projects/${project.id}`} className="underline underline-offset-2 hover:text-blue-600">{project.name}</Link> ({project.projectStatus})
                          </div>
                          {(windowMonths.length ? windowMonths : heat.months).map((m) => {
                            const cell = cells.find((c) => c.ym === m.ym);
                            const hours = cell?.hours ?? 0;
                            const base = Math.max(1, toNumber(person.baseMonthlyHours, 0));
                            const utilPct = ((hours / base) * 100).toFixed(0);
                            const cost = showCosts && person ? effectiveHourlyRate(person) * hours : 0;
                            const isInactive = isPersonInactiveInMonth(person, m.ym);
                            const isInactiveWithUtil = person.isActive === false && hours > 0;
                            
                            return (
                              <div key={m.ym} className="flex justify-center">
                                {isInactive ? (
                                  isInactiveWithUtil ? (
                                    <div className="text-xs flex flex-col items-center text-orange-600 bg-orange-50 px-1 rounded">
                                      <div className="flex items-center gap-1">
                                        <span>⚠</span>
                                        <span>N/A</span>
                                      </div>
                                      <div className="text-orange-500">{hours.toFixed(1)}h</div>
                                    </div>
                                  ) : (
                                    <div className="text-xs flex flex-col items-center text-muted-foreground">
                                      <div>N/A</div>
                                    </div>
                                  )
                                ) : (
                                  <div className="text-xs flex flex-col items-center">
                                    <div>{hours.toFixed(1)}h ({utilPct}%)</div>
                                    {showCosts && cost > 0 && (
                                      <div className="text-muted-foreground">${cost.toFixed(0)}</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>

            {/* Summary Rows */}
            <div className="border-t pt-2 space-y-2">
              {/* Total Hours Summary Row */}
              <div
                className="grid items-center bg-blue-50 rounded p-2"
                style={{ gridTemplateColumns: `260px repeat(${(windowMonths.length ? windowMonths : heat.months).length}, 1fr)` }}
              >
                <div className="text-sm font-semibold text-blue-800">Total Hours</div>
                {(windowMonths.length ? windowMonths : heat.months).map((month) => {
                  // Calculate total hours for this month across all people
                  let monthlyHours = 0;
                  
                  visibleHeatRows.forEach(({ person, total }) => {
                    // Skip inactive people for totals in future months
                    if (isPersonInactiveInMonth(person, month.ym)) {
                      return;
                    }
                    const cell = total.cells.find(c => c.ym === month.ym);
                    if (cell) {
                      monthlyHours += cell.hours;
                    }
                  });
                  
                  return (
                    <div key={month.ym} className="flex justify-center">
                      <div className="text-sm font-semibold text-blue-800">
                        {monthlyHours.toFixed(0)}h
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Average Utilization Summary Row */}
              <div
                className="grid items-center bg-green-50 rounded p-2"
                style={{ gridTemplateColumns: `260px repeat(${(windowMonths.length ? windowMonths : heat.months).length}, 1fr)` }}
              >
                <div className="text-sm font-semibold text-green-800">Average Utilization</div>
                {(windowMonths.length ? windowMonths : heat.months).map((month) => {
                  // Calculate average utilization for this month across all active people
                  let totalUtil = 0;
                  let activeCount = 0;
                  
                  visibleHeatRows.forEach(({ person, total }) => {
                    // Skip inactive people for averages in future months
                    if (isPersonInactiveInMonth(person, month.ym)) {
                      return;
                    }
                    const cell = total.cells.find(c => c.ym === month.ym);
                    if (cell) {
                      totalUtil += cell.util;
                      activeCount++;
                    }
                  });
                  
                  const avgUtil = activeCount > 0 ? totalUtil / activeCount : 0;
                  
                  return (
                    <div key={month.ym} className="flex justify-center">
                      <div className="text-sm font-semibold text-green-800">
                        {(avgUtil * 100).toFixed(0)}%
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Monthly Cost Totals Row */}
              {showCosts && (
                <div
                  className="grid items-center bg-muted/30 rounded p-2"
                  style={{ gridTemplateColumns: `260px repeat(${(windowMonths.length ? windowMonths : heat.months).length}, 1fr)` }}
                >
                  <div className="text-sm font-semibold">Monthly Costs</div>
                  {(windowMonths.length ? windowMonths : heat.months).map((month) => {
                    // Calculate total cost for this month across all people and projects
                    let monthlyTotal = 0;
                    
                    visibleHeatRows.forEach(({ person, byProject }) => {
                      // Skip inactive people for monthly totals in future months
                      if (isPersonInactiveInMonth(person, month.ym)) {
                        return;
                      }
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
              )}
            </div>

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

