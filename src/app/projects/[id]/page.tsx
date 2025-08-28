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
  loadProjects,
  saveProjects,
  loadRoster,
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

export default function ProjectDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params?.id as string;

  const [projects, setProjects] = useState<Project[]>([]);
  const [roster, setRoster] = useState<RosterPerson[]>([]);
  const [project, setProject] = useState<Project | null>(null);

  // Load all data once
  useEffect(() => {
    setProjects(loadProjects());
    setRoster(loadRoster());
  }, []);

  // Pick current project
  useEffect(() => {
    const p = projects.find((x) => x.id === projectId);
    if (p) setProject(p);
  }, [projects, projectId]);

  // AUTOSAVE on any project change
  useEffect(() => {
    if (!project) return;
    const next = upsertProject(project, projects);
    setProjects(next);
    saveProjects(next);
  }, [project]);

  if (!project) {
    return (
      <div className="text-sm text-muted-foreground">
        Project not found.{" "}
        <button className="underline" onClick={() => router.push("/projects")}>
          Back to Projects
        </button>
      </div>
    );
  }

  const members = useMemo(
    () => roster.filter((r) => project.memberIds.includes(r.id)),
    [roster, project.memberIds]
  );
  const totals = useMemo(
    () => computeProjectTotals(project, roster),
    [project, roster]
  );

  function addMonth() {
    setProject((prev) => {
      if (!prev) return prev;
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
    setProject((prev) =>
      prev
        ? {
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
          }
        : prev
    );
  }

  function setExpense(monthId: string, value: number) {
    setProject((prev) =>
      prev
        ? {
            ...prev,
            months: prev.months.map((m) =>
              m.id === monthId ? { ...m, expenses: toNumber(value) } : m
            ),
          }
        : prev
    );
  }

  function setRevenue(monthId: string, value: number) {
    setProject((prev) =>
      prev
        ? {
            ...prev,
            months: prev.months.map((m) =>
              m.id === monthId ? { ...m, revenue: toNumber(value) } : m
            ),
          }
        : prev
    );
  }

  function toggleMember(person: RosterPerson, on: boolean) {
    setProject((prev) =>
      prev
        ? {
            ...prev,
            memberIds: on
              ? Array.from(new Set([...prev.memberIds, person.id]))
              : prev.memberIds.filter((id) => id !== person.id),
            months: prev.months.map((m) => {
              if (on) {
                return {
                  ...m,
                  personAllocations: {
                    ...m.personAllocations,
                    [person.id]: m.personAllocations[person.id] ?? 0,
                  },
                };
              }
              // remove allocations for this person
              const { [person.id]: _drop, ...rest } = m.personAllocations;
              return { ...m, personAllocations: rest };
            }),
          }
        : prev
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + autosave hint */}
      <div className="flex items-center gap-3">
        <Input
          className="text-xl font-semibold"
          value={project.name}
          onChange={(e) => setProject({ ...project, name: e.target.value })}
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
              setProject({
                ...project,
                startMonthISO: v,
                // relabel months to be read-only sequence
                months: project.months.map((m, i) => ({
                  ...m,
                  label: labelFromISO(v, i),
                })),
              });
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
              setProject({ ...project, overheadPerHour: v[0] })
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
              setProject({
                ...project,
                targetMarginPct: Number(v[0].toFixed(2)),
              })
            }
            min={0}
            max={1}
            step={0.01}
          />
        </div>
      </div>

      {/* Members */}
      <div className="space-y-2">
        <div className="text-sm font-medium">Members</div>
        <div className="grid grid-cols-12 gap-2 text-sm font-medium text-muted-foreground">
          <div className="col-span-6">Person</div>
          <div className="col-span-2 text-right">Base Hrs</div>
          <div className="col-span-2 text-right">Eff. $/hr</div>
          <div className="col-span-2 text-right">In Project</div>
        </div>
        {roster.map((r) => {
          const inProject = project.memberIds.includes(r.id);
          return (
            <div key={r.id} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-6 truncate">{r.name}</div>
              <div className="col-span-2 text-right">{r.baseMonthlyHours}</div>
              <div className="col-span-2 text-right">
                {currency(effectiveHourlyRate(r))}/hr
              </div>
              <div className="col-span-2 text-right">
                <input
                  type="checkbox"
                  checked={inProject}
                  onChange={(e) => toggleMember(r, e.target.checked)}
                />
              </div>
            </div>
          );
        })}
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
          <div className="col-span-2 text-right">Alloc %</div>
          <div className="col-span-2 text-right">Hours</div>
        </div>

        {project.months.map((m) => {
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
                const alloc = m.personAllocations[p.id] ?? 0; // 0..100
                const hours = (toNumber(p.baseMonthlyHours, 0) * alloc) / 100;
                const eff = effectiveHourlyRate(p);
                return (
                  <div key={p.id} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-3" />
                    <div className="col-span-3 truncate">{p.name}</div>
                    <div className="col-span-2 text-right">{currency(eff)}/hr</div>
                    <div className="col-span-2">
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
                    <div className="col-span-2 text-right">
                      {hours.toFixed(1)}
                    </div>
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
