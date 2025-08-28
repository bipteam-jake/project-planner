// /src/app/projects/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Project,
  RosterPerson,
  MonthRow,
  upsertProject,
  labelFromISO,
  computeProjectTotals,
  computeMonthStats,
  currency,
  percent,
  clamp,
  toNumber,
  effectiveHourlyRate,
  TotalsResult,
} from "@/lib/storage";

import { localStorageRepo as repo } from "@/lib/repo";


/** Helpers for month math & colors (consistent with dashboard) */
function ymFromStartIndex(startISO: string, index: number): string {
  const [y, m] = startISO.split("-").map(Number);
  const d = new Date(y, (m - 1) + index, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}
function colorForUtil(util: number): string {
  const pct = Math.min(util, 1.5); // cap color at 150%
  if (pct >= 1.01) return "bg-red-400";
  if (pct >= 0.75) return "bg-teal-400";
  if (pct >= 0.5) return "bg-green-400";
  if (pct >= 0.25) return "bg-green-200";
  return "bg-gray-200";
}

export default function ProjectDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = (params?.id as string) || "";

  const [hydrated, setHydrated] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [roster, setRoster] = useState<RosterPerson[]>([]);

  // Modal state for adding personnel
  const [showAddModal, setShowAddModal] = useState(false);
  const [personSearch, setPersonSearch] = useState("");
  const [tempSelected, setTempSelected] = useState<Set<string>>(new Set());

  // Load once, then mark hydrated
  useEffect(() => {
    setProjects(repo.loadProjects());
    setRoster(repo.loadRoster());
    setHydrated(true);
  }, []);

  // Autosave projects (guarded)
  useEffect(() => {
    if (hydrated) repo.saveProjects(projects);
  }, [projects, hydrated]);

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
    <div className="space-y-6">
      {/* Header + autosave hint */}
      <div className="flex items-center gap-3">
        <Input
          className="text-xl font-semibold"
          value={project.name}
          onChange={(e) =>
            updateProject((p) => ({ ...p, name: e.target.value }))
          }
        />
        <div className="ml-auto text-sm text-muted-foreground">Auto-saved</div>
      </div>

      {/* Project Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

      {/* Members — chips + Add Personnel modal trigger */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Members</div>
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
          {members.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
            >
              {m.name}
              <button
                className="text-muted-foreground hover:text-red-600"
                title="Remove from project"
                onClick={() => removeMember(m.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <Tile label="Hours" value={totals.totalHours.toFixed(1)} />
        <Tile label="Labor cost" value={currency(totals.laborCost)} />
        <Tile label="Overhead cost" value={currency(totals.overheadCost)} />
        <Tile label="Expenses" value={currency(totals.expenses)} />
        <Tile label="All-in cost" value={currency(totals.allIn)} />
        <Tile label="Revenue" value={currency(totals.revenue)} />
        <Tile label="Margin %" value={percent(totals.margin)} />
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
                <div className="col-span-9 text-right text-sm text-muted-foreground">
                  Overhead: {currency(stats.overhead)} · Expenses:{" "}
                  {currency(m.expenses)} · Revenue: {currency(m.revenue)} ·
                  Labor: {currency(stats.labor)} · All-in:{" "}
                  {currency(stats.allIn)}
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
                    <div className="col-span-3 truncate">{p.name}</div>
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
                  p.name.toLowerCase().includes(personSearch.toLowerCase())
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

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border p-4 bg-background">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
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
