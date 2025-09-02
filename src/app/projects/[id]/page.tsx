// /src/app/projects/[id]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Slider } from "@/components/ui/slider";
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
import { Project, RosterPerson, MonthRow, ProjectStatus, TotalsResult } from "@/lib/types";
import {
  upsertProject,
  labelFromISO,
  computeProjectTotals,
  computeMonthStats,
  currency,
  percent,
  clamp,
  toNumber,
  effectiveHourlyRate,
} from "@/lib/storage";

import { apiRepoAsync as repo } from "@/lib/repo";


/** Helpers for month math & colors (consistent with dashboard) */
function ymFromStartIndex(startISO: string, index: number): string {
  const [y, m] = startISO.split("-").map(Number);
  const d = new Date(y, (m - 1) + index, 1);
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

// Build rollup for a single project
function buildProjectRollup(project: Project, roster: RosterPerson[]): RollRow[] {
  const rows: RollRow[] = [];

  for (let i = 0; i < project.months.length; i++) {
    const m = project.months[i];
    const ym = ymFromStartIndex(project.startMonthISO, i);

    const members = roster.filter((r) => project.memberIds.includes(r.id));

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

    const monthOverhead = monthHours * project.overheadPerHour;
    const allIn = monthLabor + monthOverhead + m.expenses;

    rows.push({
      ym,
      label: labelFromYm(ym),
      labor: monthLabor,
      overhead: monthOverhead,
      expenses: m.expenses,
      allIn,
      revenue: m.revenue,
      hours: monthHours,
    });
  }

  return rows;
}
function colorForUtil(util: number): string {
  const pct = Math.min(util, 1.5); // cap color at 150%
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

export default function ProjectDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = (params?.id as string) || "";

  const [hydrated, setHydrated] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [roster, setRoster] = useState<RosterPerson[]>([]);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modal state for adding personnel
  const [showAddModal, setShowAddModal] = useState(false);
  const [personSearch, setPersonSearch] = useState("");
  const [tempSelected, setTempSelected] = useState<Set<string>>(new Set());

  // UI state for collapsible charts section
  const [chartsCollapsed, setChartsCollapsed] = useState(true);

  // Load once, then mark hydrated
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

  // Debounced save of the current project only
  useEffect(() => {
    if (!hydrated) return;
    const p = projects.find((x) => x.id === projectId);
    if (!p) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        await repo.upsertProject(p);
        setSaving("saved");
        setTimeout(() => setSaving("idle"), 800);
      } catch (e) {
        console.error(e);
        setSaving("idle");
      }
    }, 600);
  }, [projects, hydrated, projectId]);

  // Derive current project
  const project = useMemo(
    () => projects.find((x) => x.id === projectId) ?? null,
    [projects, projectId]
  );

  // Update helper (single source of truth)
  function updateProject(mutator: (p: Project) => Project) {
    setProjects((prev) => {
      const curr = prev.find((x) => x.id === projectId);
      if (!curr) return prev;
      const nextProj = mutator(curr);
      return upsertProject(nextProj, prev);
    });
  }

  // Current members & quick helpers
  const members = useMemo(() => {
    const ids = project?.memberIds ?? [];
    return roster.filter((r) => ids.includes(r.id));
  }, [roster, project?.memberIds]);

  const totals: TotalsResult = useMemo(() => {
    if (!project) {
      return {
        totalHours: 0, laborCost: 0, overheadCost: 0,
        expenses: 0, allIn: 0, revenue: 0, profit: 0, margin: 0,
      };
    }
    return computeProjectTotals(project, roster);
  }, [project, roster]);

  // Chart data
  const rolled = useMemo(() => {
    if (!project) return [];
    return buildProjectRollup(project, roster);
  }, [project, roster]);

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

  function addMonth() {
    updateProject((prev) => {
      const last = prev.months[prev.months.length - 1];
      const copy: MonthRow = {
        id: crypto.randomUUID(),
        label: labelFromISO(prev.startMonthISO, prev.months.length),
        personAllocations: { ...(last?.personAllocations || {}) },
        expenses: last?.expenses ?? 0,
        revenue: last?.revenue ?? 0,
      };
      return { ...prev, months: [...prev.months, copy] };
    });
  }

  function setAlloc(monthId: string, personId: string, value: number) {
    updateProject((prev) => ({
      ...prev,
      months: prev.months.map((m) =>
        m.id === monthId
          ? {
              ...m,
              personAllocations: {
                ...m.personAllocations,
                [personId]: clamp(value, 0, 100),
              },
            }
          : m
      ),
    }));
  }

  function setExpense(monthId: string, value: number) {
    updateProject((prev) => ({
      ...prev,
      months: prev.months.map((m) =>
        m.id === monthId ? { ...m, expenses: toNumber(value) } : m
      ),
    }));
  }

  function setRevenue(monthId: string, value: number) {
    updateProject((prev) => ({
      ...prev,
      months: prev.months.map((m) =>
        m.id === monthId ? { ...m, revenue: toNumber(value) } : m
      ),
    }));
  }

  // Remove a month and re-label remaining months to stay aligned with startMonthISO
  function removeMonth(monthId: string) {
    if (!confirm("Remove this month?")) return;
    updateProject((prev) => {
      const nextMonths = prev.months
        .filter((m) => m.id !== monthId)
        .map((m, i) => ({ ...m, label: labelFromISO(prev.startMonthISO, i) }));
      return { ...prev, months: nextMonths };
    });
  }

  // Remove a member from project + allocations
  function removeMember(personId: string) {
    updateProject((prev) => ({
      ...prev,
      memberIds: prev.memberIds.filter((id) => id !== personId),
      months: prev.months.map((m) => {
        const { [personId]: _drop, ...rest } = m.personAllocations;
        return { ...m, personAllocations: rest };
      }),
    }));
  }

  // Prepare and open Add Personnel modal
  function openAddPersonnel() {
    if (!project) return;
    setPersonSearch("");
    setTempSelected(new Set(project.memberIds));
    setShowAddModal(true);
  }

  // Apply selection from modal
  function applyAddPersonnel() {
    if (!project) return;
    const selectedIds = Array.from(tempSelected);
    updateProject((prev) => ({
      ...prev,
      memberIds: Array.from(new Set([...selectedIds])),
      months: prev.months.map((m) => {
        const nextAlloc = { ...m.personAllocations };
        for (const id of selectedIds) {
          if (nextAlloc[id] === undefined) nextAlloc[id] = 0;
        }
        return { ...m, personAllocations: nextAlloc };
      }),
    }));
    setShowAddModal(false);
  }

  /**
   * GLOBAL UTILIZATION MAP
   * Build personId -> (ym -> hours across ALL projects).
   * Used to show Util % (All Projects) in Monthly Plan.
   */
  const globalHoursByPersonYm = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const person of roster) {
      map[person.id] = {};
    }
    for (const p of projects) {
      for (let i = 0; i < p.months.length; i++) {
        const ym = ymFromStartIndex(p.startMonthISO, i);
        const m = p.months[i];
        for (const personId of p.memberIds) {
          const alloc = toNumber(m.personAllocations[personId] ?? 0, 0);
          if (alloc <= 0) continue;
          const person = roster.find((r) => r.id === personId);
          if (!person) continue;
          const base = toNumber(person.baseMonthlyHours, 0);
          const hours = (base * alloc) / 100;
          map[personId][ym] = (map[personId][ym] ?? 0) + hours;
        }
      }
    }
    return map;
  }, [projects, roster]);

  // Render guards
  if (!hydrated) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!project) {
    return (
      <div className="space-y-3">
        <div className="text-lg font-semibold">Project not found</div>
        <div className="text-sm text-muted-foreground">
          The project id <code>{projectId}</code> doesn’t exist locally.
        </div>
        <Button onClick={() => router.push("/projects")}>Back to Projects</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header + autosave hint */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <Input
            className="text-3xl font-bold tracking-tight border-none p-0 shadow-none focus-visible:ring-0 bg-transparent"
            value={project.name}
            onChange={(e) =>
              updateProject((p) => ({ ...p, name: e.target.value }))
            }
          />
          <p className="text-muted-foreground">
            Configure project settings, team assignments, and financial planning
          </p>
        </div>
        <div className="text-sm text-muted-foreground">Auto-saved</div>
      </div>

      {/* Project Inputs */}
      <div className="rounded-xl border bg-card shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4">Project Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="space-y-1">
          <div className="text-sm font-medium">Project Status</div>
          <select
            className="border rounded-md px-3 py-2 bg-background w-full"
            value={project.projectStatus}
            onChange={(e) =>
              updateProject((p) => ({ ...p, projectStatus: e.target.value as ProjectStatus }))
            }
          >
            <option value="Test">Test</option>
            <option value="BD">BD</option>
            <option value="Active">Active</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">Start month</div>
          <input
            type="month"
            className="border rounded-md px-3 py-2 bg-background"
            value={project.startMonthISO}
            onChange={(e) => {
              const v = e.target.value;
              updateProject((p) => ({
                ...p,
                startMonthISO: v,
                months: p.months.map((m, i) => ({
                  ...m,
                  label: labelFromISO(v, i),
                })),
              }));
            }}
          />
          <div className="text-xs text-muted-foreground">
            Month labels below are derived from this value (read-only).
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">
            Overhead per Hour ({currency(project.overheadPerHour)})
          </div>
          <Slider
            value={[project.overheadPerHour]}
            onValueChange={(v) =>
              updateProject((p) => ({ ...p, overheadPerHour: v[0] }))
            }
            min={0}
            max={50}
            step={1}
          />
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">
            Target Margin ({percent(project.targetMarginPct)})
          </div>
          <Slider
            value={[project.targetMarginPct]}
            onValueChange={(v) =>
              updateProject((p) => ({
                ...p,
                targetMarginPct: Number(v[0].toFixed(2)),
              }))
            }
            min={0}
            max={1}
            step={0.01}
          />
        </div>
        </div>
      </div>

      {/* Members — chips + Add Personnel modal trigger */}
      <div className="rounded-xl border bg-card shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Team Members</h3>
          <Button type="button" onClick={openAddPersonnel}>
            Add Personnel
          </Button>
        </div>

        {/* Current members as chips */}
        <div className="flex flex-wrap gap-2">
          {members.length === 0 && (
            <span className="text-sm text-muted-foreground">
              No members yet. Click “Add Personnel”.
            </span>
          )}
          {members.map((m) => {
            // Check if this person is inactive during any project month
            const isInactiveInProject = project?.months.some((month, idx) => {
              const monthYm = ymFromStartIndex(project.startMonthISO, idx);
              return isPersonInactiveInMonth(m, monthYm);
            });
            
            return (
              <span
                key={m.id}
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
              >
                {m.name}
                {isInactiveInProject && (
                  <span title={`${m.name} is inactive during some project months. Check monthly plan below.`}>
                    <AlertTriangle 
                      className="h-3 w-3 text-red-500" 
                    />
                  </span>
                )}
                <button
                  className="text-muted-foreground hover:text-red-600"
                  title="Remove from project"
                  onClick={() => removeMember(m.id)}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
        <Tile label="Hours" value={totals.totalHours.toFixed(1)} />
        <Tile label="Labor cost" value={currency(totals.laborCost)} />
        <Tile label="Overhead cost" value={currency(totals.overheadCost)} />
        <Tile label="Expenses" value={currency(totals.expenses)} />
        <Tile label="All-in cost" value={currency(totals.allIn)} />
        <Tile label="Revenue" value={currency(totals.revenue)} />
        <Tile 
          label="Margin" 
          value={percent(totals.margin)} 
          subValue={currency(totals.profit)}
        />
      </div>

      {/* Charts Section */}
      <div className="rounded-xl border space-y-4">
        {/* Charts Header */}
        <div 
          className="flex items-center justify-between p-4 pb-2 cursor-pointer hover:bg-muted/50"
          onClick={() => setChartsCollapsed(!chartsCollapsed)}
        >
          <h2 className="text-lg font-semibold">Charts</h2>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            {chartsCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
        
        {/* Collapsible Charts Content */}
        <div className={`px-4 pb-4 space-y-6 transition-all duration-300 ease-in-out overflow-hidden ${chartsCollapsed ? "max-h-0 opacity-0 pb-0" : "max-h-[2000px] opacity-100"}`}>
          {rolled.length > 0 ? (
            <>
              {/* Stacked Bar: monthly costs + revenue line */}
              <div>
                <div className="text-sm font-semibold mb-2">
                  Monthly Costs (Labor, Overhead, Expenses) vs Revenue
                </div>
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
              <div>
                <div className="text-sm font-semibold mb-2">
                  Cumulative Revenue vs All-in
                </div>
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
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              No data to display. Add some months and allocations to see charts.
            </div>
          )}
        </div>
      </div>

      {/* Monthly plan */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Monthly Plan</h2>
        <Button onClick={addMonth}>Add Month (copy previous)</Button>
      </div>

      <div className="space-y-3">
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 text-sm font-medium text-muted-foreground">
          <div className="col-span-3">Month</div>
          <div className="col-span-3">Person</div>
          <div className="col-span-2 text-right">Eff. $/hr</div>
          <div className="col-span-1 text-right">Alloc %</div>
          <div className="col-span-1 text-right">Util % (All Projects)</div>
          <div className="col-span-1 text-right">Hours</div>
          <div className="col-span-1 text-right">Labor $</div>
        </div>

        {project.months.map((m, idx) => {
          const monthYm = ymFromStartIndex(project.startMonthISO, idx);
          const stats = computeMonthStats(members, m, project.overheadPerHour);
          return (
            <div key={m.id} className="rounded-lg border p-3 space-y-2">
              <div className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-3 font-medium">{m.label}</div>
                <div className="col-span-8 text-right text-sm text-muted-foreground">
                  Overhead: {currency(stats.overhead)} · Expenses:{" "}
                  {currency(m.expenses)} · Revenue: {currency(m.revenue)} ·
                  Labor: {currency(stats.labor)} · All-in:{" "}
                  {currency(stats.allIn)}
                </div>
				<div className="col-span-1 flex justify-end">
					<Button
						variant="outline"
						size="sm"
						title="Remove month"
						onClick={() => removeMonth(m.id)}
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
                </div>

              {members.map((p) => {
                const alloc = m.personAllocations[p.id] ?? 0; // 0..100 on THIS project
                const hours = (toNumber(p.baseMonthlyHours, 0) * alloc) / 100;
                const eff = effectiveHourlyRate(p);
                const laborCost = hours * eff;

                // GLOBAL UTIL across all projects for this person/month
                const globalHours = globalHoursByPersonYm[p.id]?.[monthYm] ?? 0;
                const base = Math.max(1, toNumber(p.baseMonthlyHours, 0)); // avoid /0
                const globalUtil = globalHours / base; // 1.0 = 100%

                return (
                  <div key={p.id} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-3" />
                    <div className="col-span-3 flex items-center gap-2">
                      <span className="truncate">{p.name}</span>
                      {isPersonInactiveInMonth(p, monthYm) && (
                        <span title={`${p.name} is inactive as of ${p.inactiveDate}. Consider removing them from this project month.`}>
                          <AlertTriangle 
                            className="h-4 w-4 text-red-500 flex-shrink-0" 
                          />
                        </span>
                      )}
                    </div>
                    <div className="col-span-2 text-right">{currency(eff)}/hr</div>
                    <div className="col-span-1">
                      <Input
                        className="text-right"
                        type="number"
                        min={0}
                        max={100}
                        value={alloc}
                        onChange={(e) =>
                          setAlloc(m.id, p.id, toNumber(e.target.value))
                        }
                      />
                    </div>
                      {/* Global Utilization (All Projects) */}
                      <div className="col-span-1 text-right">
                        {(() => {
                          const pctDisplay = (globalUtil * 100).toFixed(0); // actual %, not clamped
                          const overBy = globalUtil > 1 ? ((globalUtil - 1) * 100).toFixed(0) : null;
                          const badgeClass = `inline-flex items-center justify-end gap-1 rounded-md px-2 py-1 ${colorForUtil(globalUtil)} text-black/80 min-w-16`;
                          return (
                            <div className={badgeClass} title={overBy ? `Over by ${overBy}%` : "Within capacity"}>
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
                        })()}
                      </div>
                    <div className="col-span-1 text-right">{hours.toFixed(1)}</div>
                    <div className="col-span-1 text-right">{currency(laborCost)}</div>
                  </div>
                );
              })}

              <div className="grid grid-cols-12 gap-2 items-center pt-2 border-t">
                <div className="col-span-9 text-right font-medium">Expenses</div>
                <div className="col-span-3">
                  <Input
                    className="text-right"
                    type="number"
                    min={0}
                    value={m.expenses}
                    onChange={(e) => setExpense(m.id, e.target.value as any)}
                  />
                </div>
                <div className="col-span-9 text-right font-medium">Revenue</div>
                <div className="col-span-3">
                  <Input
                    className="text-right"
                    type="number"
                    min={0}
                    value={m.revenue}
                    onChange={(e) => setRevenue(m.id, e.target.value as any)}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Personnel Modal */}
      {showAddModal && (
        <Modal onClose={() => setShowAddModal(false)} title="Add Personnel">
          <div className="space-y-3">
            <Input
              placeholder="Search people…"
              value={personSearch}
              onChange={(e) => setPersonSearch(e.target.value)}
            />
            <div className="max-h-72 overflow-auto rounded-md border">
              {roster
                .filter((p) =>
                  p.isActive !== false && p.name.toLowerCase().includes(personSearch.toLowerCase())
                )
                .map((p) => {
                  const checked = tempSelected.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setTempSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(p.id);
                            else next.delete(p.id);
                            return next;
                          });
                        }}
                      />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.personType}
                      </span>
                    </label>
                  );
                })}
              {roster.length === 0 && (
                <div className="p-3 text-sm text-muted-foreground">
                  No people in roster yet. Add some on the Personnel page.
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button onClick={applyAddPersonnel}>Add selected</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

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

/** Lightweight modal (no extra deps). */
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-xl border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="text-sm font-semibold">{title}</div>
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={onClose}
              aria-label="Close"
              title="Close"
            >
              ×
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}


