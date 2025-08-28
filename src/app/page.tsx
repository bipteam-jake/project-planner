// /src/app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  currency,
  Project,
  RosterPerson,
  toNumber,
  effectiveHourlyRate,
} from "@/lib/storage";

// ⬇️ NEW: use the repo abstraction (can later swap to `apiRepo`)
import { localStorageRepo as repo } from "@/lib/repo";

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
  selectedPeople: Set<string> | null,
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
      const membersFiltered =
        selectedPeople && selectedPeople.size > 0
          ? members.filter((r) => selectedPeople.has(r.id))
          : members;

      let monthHours = 0;
      let monthLabor = 0;
      for (const person of membersFiltered) {
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

function buildUtilizationMatrixWithProjects(
  projects: Project[],
  roster: RosterPerson[],
  selectedPeople: Set<string> | null,
  startYm?: string,
  endYm?: string
): { months: HeatMonth[]; rows: HeatPersonRow[] } {
  // months in window
  const monthsSet = new Set<string>();
  for (const p of projects) {
    for (let i = 0; i < p.months.length; i++) {
      const ym = ymFromStartIndex(p.startMonthISO, i);
      if (inYmRange(ym, startYm || undefined, endYm || undefined)) monthsSet.add(ym);
    }
  }
  const months = Array.from(monthsSet.values()).sort();

  // people subset
  const people =
    selectedPeople && selectedPeople.size > 0
      ? roster.filter((r) => selectedPeople.has(r.id))
      : roster;

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

function UtilBadge({ util }: { util: number }) {
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
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(new Set());

  // UI state for expanded people in heatmap
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    // ⬇️ repo-backed (can later swap to API by changing the import only)
    const ps = repo.loadProjects();
    const rs = repo.loadRoster();
    setProjects(ps);
    setRoster(rs);
    setSelectedProjects(new Set(ps.map((p) => p.id))); // default: all projects
    setSelectedPeople(new Set(rs.map((r) => r.id))); // default: all people
    setHydrated(true);
  }, []);

  const filteredProjects = useMemo(() => {
    if (selectedProjects.size === 0) return [];
    return projects.filter((p) => selectedProjects.has(p.id));
  }, [projects, selectedProjects]);

  // Costs rollup (filtered)
  const rolled = useMemo(
    () =>
      buildCalendarRollupFiltered(
        filteredProjects,
        roster,
        selectedPeople,
        startYm || undefined,
        endYm || undefined
      ),
    [filteredProjects, roster, selectedPeople, startYm, endYm]
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
      buildUtilizationMatrixWithProjects(
        filteredProjects,
        roster,
        selectedPeople,
        startYm || undefined,
        endYm || undefined
      ),
    [filteredProjects, roster, selectedPeople, startYm, endYm]
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
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Filters */}
      <div className="rounded-xl border p-4 space-y-4">
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
                return (
                  <label
                    key={p.id}
                    className={`inline-flex select-none items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                      checked ? "bg-secondary" : "bg-background"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleProject(p.id, e.target.checked)}
                    />
                    <span className="truncate">{p.name}</span>
                  </label>
                );
              })}
            </div>
          )}
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
                return (
                  <label
                    key={r.id}
                    className={`inline-flex select-none items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                      checked ? "bg-secondary" : "bg-background"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => togglePerson(r.id, e.target.checked)}
                    />
                    <span className="truncate">{r.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <Tile label="Hours" value={summary.hours.toFixed(1)} />
        <Tile label="Labor cost" value={currency(summary.labor)} />
        <Tile label="Overhead cost" value={currency(summary.overhead)} />
        <Tile label="Expenses" value={currency(summary.expenses)} />
        <Tile label="All-in cost" value={currency(summary.allIn)} />
        <Tile label="Revenue" value={currency(summary.revenue)} />
        <Tile label="Margin %" value={`${(summary.margin * 100).toFixed(1)}%`} />
      </div>

      {/* Stacked Bar: monthly costs + revenue line */}
      <div className="rounded-xl border p-4">
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
      <div className="rounded-xl border p-4">
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

      {/* Utilization Heatmap (expandable per person → per project) */}
      <div className="rounded-xl border p-4 space-y-3">
        <div className="text-sm font-semibold">Utilization Heatmap</div>

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
                  gridTemplateColumns: `260px repeat(${heat.months.length}, 1fr)`,
                }}
              >
                <div className="p-2 text-xs text-muted-foreground">
                  Person / Project
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
                      title="Click to expand"
                    >
                      <div className="p-2 text-sm flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded border text-xs bg-background">
                          {isOpen ? "–" : "+"}
                        </span>
                        <span className="truncate font-medium">{person.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          Avg: {(Math.min(total.avgUtil, 1) * 100).toFixed(0)}% ·
                          Total hrs: {total.totalHours.toFixed(1)}
                        </span>
                      </div>
                      {total.cells.map((c) => (
                        <div key={c.ym} className="p-2 text-xs text-center">
                          <UtilBadge util={c.util} />
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
                            gridTemplateColumns: `260px repeat(${row.cells.length}, 1fr)`,
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
                              <UtilBadge util={c.util} />
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
