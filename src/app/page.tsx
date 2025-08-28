// /src/app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { Project, RosterPerson } from "@/lib/storage";
import {
  loadProjects,
  loadRoster,
  computeProjectTotals,
  calendarRollup,
  currency,
} from "@/lib/storage";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line,
} from "recharts";

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [roster, setRoster] = useState<RosterPerson[]>([]);

  // Load data once on mount
  useEffect(() => {
    setProjects(loadProjects());
    setRoster(loadRoster());
  }, []);

  // Aggregate totals across all projects
  const totals = useMemo(() => {
    return projects.reduce(
      (acc, p) => {
        const t = computeProjectTotals(p, roster);
        acc.hours += t.totalHours;
        acc.labor += t.laborCost;
        acc.overhead += t.overheadCost;
        acc.expenses += t.expenses;
        acc.allIn += t.allIn;
        acc.revenue += t.revenue;
        return acc;
      },
      { hours: 0, labor: 0, overhead: 0, expenses: 0, allIn: 0, revenue: 0 }
    );
  }, [projects, roster]);

  // Month-by-month rollup across all projects
  const buckets = useMemo(() => calendarRollup(projects, roster), [projects, roster]);

  // Cumulative series for the line chart
  const lineData = useMemo(() => {
    let cumAllIn = 0;
    let cumRevenue = 0;
    return buckets.map((b) => {
      cumAllIn += b.allIn;
      cumRevenue += b.revenue;
      return {
        label: b.label,
        CumulativeAllIn: Math.round(cumAllIn),
        CumulativeRevenue: Math.round(cumRevenue),
      };
    });
  }, [buckets]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Top tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Tile label="Projects" value={String(projects.length)} />
        <Tile label="Hours" value={totals.hours.toFixed(1)} />
        <Tile label="Labor" value={currency(totals.labor)} />
        <Tile label="Overhead" value={currency(totals.overhead)} />
        <Tile label="Expenses" value={currency(totals.expenses)} />
        <Tile label="Revenue" value={currency(totals.revenue)} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-72">
          <h2 className="font-semibold mb-2">Monthly Costs (stacked)</h2>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets}>
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip formatter={(v: unknown) => currency(Number(v))} />
              <Legend />
              <Bar dataKey="labor" name="Labor" stackId="a" fill="#3b82f6" />
              <Bar dataKey="overhead" name="Overhead" stackId="a" fill="#10b981" />
              <Bar dataKey="expenses" name="Expenses" stackId="a" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="h-72">
          <h2 className="font-semibold mb-2">Cumulative Revenue vs All-in</h2>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineData}>
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip formatter={(v: unknown) => currency(Number(v))} />
              <Legend />
              <Line type="monotone" dataKey="CumulativeRevenue" name="Revenue (cum)" dot={false} />
              <Line type="monotone" dataKey="CumulativeAllIn" name="All-in (cum)" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Tip: add projects and members, set per-month revenue/allocations in each project to see these rollups move.
      </p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border p-4 bg-background">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
