// /src/lib/storage.ts
"use client";

import { v4 as uuid } from "uuid";

/** ===================== Types ===================== */

export type PersonType =
  | "Full-Time"
  | "FT Resource"
  | "Part-Time"
  | "PT Resource"
  | "Contractor";

export type FTCompMode = "monthly" | "annual";

export interface RosterPerson {
  id: string;
  name: string;
  personType: PersonType;
  compMode?: FTCompMode;      // FT-like only
  monthlySalary?: number;     // FT-like
  annualSalary?: number;      // FT-like
  hourlyRate?: number;        // hourly-like
  baseMonthlyHours: number;   // e.g., 160
}

export interface MonthRow {
  id: string;
  label: string;                           // derived from startMonthISO + index; read-only in UI
  personAllocations: Record<string, number>; // personId -> allocation % (0..100)
  expenses: number;                        // $ for the month
  revenue: number;                         // $ for the month (phased revenue)
}

export interface Project {
  id: string;
  name: string;
  overheadPerHour: number;   // $/hr
  targetMarginPct: number;   // 0..1
  startMonthISO: string;     // YYYY-MM
  memberIds: string[];       // references roster
  months: MonthRow[];
  updatedAt: number;
}

export interface TotalsResult {
  totalHours: number;
  laborCost: number;
  overheadCost: number;
  expenses: number;
  allIn: number;    // labor + overhead + expenses
  revenue: number;  // sum(month.revenue)
  profit: number;   // revenue - allIn
  margin: number;   // profit / revenue (0..1)
}

/** ===================== Constants & Small Helpers ===================== */

export const ROSTER_KEY = "quote_estimator.roster.v2";     // keep your v2
export const PROJECTS_KEY = "quote_estimator.projects.v1";  // new key

export const toNumber = (v: unknown, fb = 0) =>
  isFinite(Number(v as number | string)) ? Number(v) : fb;

export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

export const currency = (n: number) =>
  n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

export const percent = (n: number) => `${(n * 100).toFixed(1)}%`;

export const isFullTimeLike = (t: PersonType) =>
  t === "Full-Time" || t === "FT Resource";

export function currentMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; // YYYY-MM
}

export function labelFromISO(startISO: string, index: number) {
  const [yStr, mStr] = startISO.split("-");
  const y = Number(yStr);
  const m0 = Number(mStr) - 1; // 0..11
  const d = new Date(y, m0 + index, 1);
  return d.toLocaleString(undefined, { month: "short", year: "numeric" });
}

/** ===================== Storage (localStorage) ===================== */

export function loadRoster(): RosterPerson[] {
  try {
    const raw = localStorage.getItem(ROSTER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RosterPerson[];
  } catch {
    return [];
  }
}

export function saveRoster(r: RosterPerson[]) {
  localStorage.setItem(ROSTER_KEY, JSON.stringify(r));
}

/**
 * Project persistence via API
 */
export async function fetchProjects(): Promise<Project[]> {
  try {
    const res = await fetch("/api/projects", { cache: "no-store" });
    if (!res.ok) throw new Error("failed");
    return (await res.json()) as Project[];
  } catch {
    return [];
  }
}

export async function fetchProject(id: string): Promise<Project | null> {
  try {
    const res = await fetch(`/api/projects/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Project;
  } catch {
    return null;
  }
}

export async function createProjectRemote(p: Project): Promise<Project> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  if (!res.ok) throw new Error("Failed to create project");
  return (await res.json()) as Project;
}

export async function updateProjectRemote(p: Project): Promise<Project> {
  const res = await fetch(`/api/projects/${p.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  if (!res.ok) throw new Error("Failed to update project");
  return (await res.json()) as Project;
}

export async function deleteProjectRemote(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete project");
}

/** ===================== Project CRUD ===================== */

export function createProject(partial?: Partial<Project>): Project {
  const start = partial?.startMonthISO ?? currentMonthISO();
  const proj: Project = {
    id: uuid(),
    name: partial?.name ?? "New Project",
    overheadPerHour: partial?.overheadPerHour ?? 15,
    targetMarginPct: partial?.targetMarginPct ?? 0.35,
    startMonthISO: start,
    memberIds: partial?.memberIds ?? [],
    months:
      partial?.months ??
      [
        {
          id: uuid(),
          label: labelFromISO(start, 0),
          personAllocations: {},
          expenses: 0,
          revenue: 0,
        },
      ],
    updatedAt: Date.now(),
  };
  return proj;
}

export function upsertProject(p: Project, projects: Project[]): Project[] {
  const stamped = { ...p, updatedAt: Date.now() };
  const idx = projects.findIndex((x) => x.id === p.id);
  if (idx === -1) return [stamped, ...projects];
  const next = [...projects];
  next[idx] = stamped;
  return next;
}

/** ===================== Compensation & Math ===================== */

export function effectiveMonthlyComp(person: RosterPerson): number {
  if (isFullTimeLike(person.personType)) {
    const mode = person.compMode ?? "monthly";
    const monthly =
      mode === "annual"
        ? toNumber(person.annualSalary) / 12
        : toNumber(person.monthlySalary);
    return Math.max(0, monthly);
  }
  return 0;
}

export function effectiveHourlyRate(person: RosterPerson): number {
  if (isFullTimeLike(person.personType)) {
    const monthly = effectiveMonthlyComp(person);
    const base = Math.max(1, toNumber(person.baseMonthlyHours, 160));
    return monthly / base;
  }
  return toNumber(person.hourlyRate);
}

/**
 * Compute a single month's stats for a given project month row, using the roster people provided.
 */
export function computeMonthStats(
  people: RosterPerson[],
  month: MonthRow,
  overheadPerHour: number
): {
  hours: number;
  labor: number;
  overhead: number;
  expenses: number;
  allIn: number;
  revenue: number;
} {
  let hours = 0;
  let labor = 0;

  for (const [pid, alloc] of Object.entries(month.personAllocations)) {
    const p = people.find((x) => x.id === pid);
    if (!p) continue;
    const h = toNumber(p.baseMonthlyHours, 0) * toNumber(alloc, 0) / 100;
    const rate = effectiveHourlyRate(p);
    hours += h;
    labor += rate * h;
  }

  const overhead = overheadPerHour * hours;
  const expenses = toNumber(month.expenses, 0);
  const revenue = toNumber(month.revenue, 0);
  const allIn = labor + overhead + expenses;

  return { hours, labor, overhead, expenses, allIn, revenue };
}

/**
 * Compute totals for an entire project given the global roster.
 */
export function computeProjectTotals(
  project: Project,
  roster: RosterPerson[]
): TotalsResult {
  const people = roster.filter((r) => project.memberIds.includes(r.id));
  let totalHours = 0,
    laborCost = 0,
    overheadCost = 0,
    expenses = 0,
    revenue = 0;

  project.months.forEach((m) => {
    const s = computeMonthStats(people, m, project.overheadPerHour);
    totalHours += s.hours;
    laborCost += s.labor;
    overheadCost += s.overhead;
    expenses += s.expenses;
    revenue += s.revenue;
  });

  const allIn = laborCost + overheadCost + expenses;
  const profit = revenue - allIn;
  const margin = revenue > 0 ? profit / revenue : 0;

  return {
    totalHours,
    laborCost,
    overheadCost,
    expenses,
    allIn,
    revenue,
    profit,
    margin,
  };
}

/** ===================== Dashboard Rollup ===================== */

export interface CalendarBucket {
  ym: string;    // YYYY-MM
  label: string; // "Sep 2025"
  labor: number;
  overhead: number;
  expenses: number;
  allIn: number;
  revenue: number;
  hours: number;
}

/**
 * Roll up all projects onto a continuous YYYY-MM calendar axis.
 */
export function calendarRollup(
  projects: Project[],
  roster: RosterPerson[]
): CalendarBucket[] {
  if (projects.length === 0) return [];

  // Find earliest start & longest duration
  const minStart = projects.reduce(
    (min, p) => (p.startMonthISO < min ? p.startMonthISO : min),
    projects[0].startMonthISO
  );
  const maxLen = Math.max(...projects.map((p) => p.months.length));

  // Build buckets from minStart forward (pad a bit)
  const buckets: CalendarBucket[] = [];
  const [yStr, mStr] = minStart.split("-");
  const base = new Date(Number(yStr), Number(mStr) - 1, 1);

  for (let i = 0; i < maxLen + 24; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.push({
      ym,
      label: d.toLocaleString(undefined, { month: "short", year: "numeric" }),
      labor: 0,
      overhead: 0,
      expenses: 0,
      allIn: 0,
      revenue: 0,
      hours: 0,
    });
  }

  const index = new Map(buckets.map((b, i) => [b.ym, i] as const));

  for (const proj of projects) {
    const people = roster.filter((r) => proj.memberIds.includes(r.id));
    const [pyStr, pmStr] = proj.startMonthISO.split("-");
    const pBase = new Date(Number(pyStr), Number(pmStr) - 1, 1);

    proj.months.forEach((m, idx) => {
      const d = new Date(pBase.getFullYear(), pBase.getMonth() + idx, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bIdx = index.get(ym);
      if (bIdx == null) return;

      const s = computeMonthStats(people, m, proj.overheadPerHour);
      const b = buckets[bIdx];
      b.hours += s.hours;
      b.labor += s.labor;
      b.overhead += s.overhead;
      b.expenses += s.expenses;
      b.revenue += s.revenue;
      b.allIn = b.labor + b.overhead + b.expenses;
    });
  }

  // Trim trailing empty buckets
  while (
    buckets.length &&
    buckets[buckets.length - 1].labor === 0 &&
    buckets[buckets.length - 1].revenue === 0
  ) {
    buckets.pop();
  }

  return buckets;
}
