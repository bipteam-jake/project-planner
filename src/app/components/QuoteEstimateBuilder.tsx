"use client";

import React, { useMemo, useState } from "react";
import { v4 as uuid } from "uuid";
import { motion } from "framer-motion";
import { Plus, Trash2, Copy, DollarSign, Users, Calculator, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  PieChart, Pie, Cell,
  LineChart, Line, ReferenceLine,
} from "recharts";

// ===================== Helpers =====================
const currency = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
const toNumber = (v: any, fallback = 0) => (isFinite(Number(v)) ? Number(v) : fallback);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

// Month helpers
function currentMonthISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // YYYY-MM
}
function labelFromISO(startISO: string, index: number) {
  const [yStr, mStr] = startISO.split("-");
  const y = Number(yStr);
  const m0 = Number(mStr) - 1; // 0..11
  const d = new Date(y, m0 + index, 1);
  return d.toLocaleString(undefined, { month: "short", year: "numeric" });
}

// ===================== Types =====================
interface MonthRow {
  id: string;
  label: string; // e.g., "Sep 2025"
  personAllocations: Record<string, number>; // personId -> allocation % (0..100)
  expenses: number; // USD
}

interface TotalsResult {
  totalHours: number;
  laborCost: number;
  overheadCost: number;
  expenses: number;
  allIn: number;
  profit: number;
  margin: number; // 0..1
}

// ===== GLOBAL ROSTER (shared across all quotes) =====
const ROSTER_KEY = "quote_estimator.roster.v2"; // stays v2

type PersonType = "Full-Time" | "Part-Time" | "Contractor" | "FT Resource" | "PT Resource";
type FTCompMode = "monthly" | "annual";

interface RosterPerson {
  id: string;
  name: string;
  personType: PersonType; // FT/PT/Contractor/FT Resource/PT Resource
  compMode?: FTCompMode; // for FT-like
  monthlySalary?: number; // FT-like mode: monthly
  annualSalary?: number; // FT-like mode: annual
  hourlyRate?: number; // hourly-like
  baseMonthlyHours: number; // e.g., 160
}

const isFullTimeLike = (t: PersonType) => t === "Full-Time" || t === "FT Resource";

function loadRoster(): RosterPerson[] {
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

function saveRoster(roster: RosterPerson[]) {
  localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
}

// ===== PER-QUOTE SAVE/LOAD (project team and plan) =====
const STORAGE_KEY = "quote_estimator.quotes.v2";

interface StoredQuoteData {
  totalRevenue: number;
  overheadPerHour: number;
  targetMarginPct: number;
  projectTeam: string[]; // roster IDs
  months: MonthRow[];
}

interface StoredQuote {
  id: string;
  name: string;
  updatedAt: number;
  data: StoredQuoteData;
}

function loadAllQuotes(): StoredQuote[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredQuote[];
  } catch {
    return [];
  }
}

function saveAllQuotes(quotes: StoredQuote[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(quotes));
}

function snapshotCurrent(
  name: string,
  data: StoredQuoteData,
  existingId?: string
): StoredQuote {
  return {
    id: existingId ?? uuid(),
    name: name || "Untitled Quote",
    updatedAt: Date.now(),
    data,
  };
}

// ===================== Pure calcs =====================
function effectiveMonthlyComp(p: RosterPerson): number {
  if (isFullTimeLike(p.personType)) {
    const mode: FTCompMode = p.compMode || "monthly";
    const monthly = mode === "annual" ? (toNumber(p.annualSalary) / 12) : toNumber(p.monthlySalary);
    return Math.max(0, monthly);
  }
  return 0; // hourly-like handled per-hour later
}

function effectiveHourlyRate(p: RosterPerson): number {
  if (isFullTimeLike(p.personType)) {
    const monthly = effectiveMonthlyComp(p);
    const baseHrs = Math.max(1, toNumber(p.baseMonthlyHours, 160));
    return monthly / baseHrs;
  }
  return toNumber(p.hourlyRate);
}

export function computeMonthStats(people: RosterPerson[], month: MonthRow, overheadPerHour: number) {
  let monthHours = 0;
  let monthLabor = 0;

  Object.entries(month.personAllocations).forEach(([pid, allocPct]) => {
    const person = people.find((p) => p.id === pid);
    if (!person) return;
    const hours = (person.baseMonthlyHours || 0) * (allocPct || 0) / 100;

    const effHr = effectiveHourlyRate(person);
    const labor = effHr * hours;

    monthHours += hours;
    monthLabor += labor;
  });

  const monthOverhead = overheadPerHour * monthHours;
  const monthAllIn = monthLabor + monthOverhead + (month.expenses || 0);
  return { monthHours, monthLabor, monthOverhead, monthAllIn };
}

export function computeTotals(
  people: RosterPerson[],
  months: MonthRow[],
  overheadPerHour: number,
  totalRevenue: number
): TotalsResult {
  let totalHours = 0;
  let laborCost = 0;
  let overheadCost = 0;
  let expenses = 0;

  months.forEach((m) => {
    const { monthHours, monthLabor, monthOverhead } = computeMonthStats(people, m, overheadPerHour);
    totalHours += monthHours;
    laborCost += monthLabor;
    overheadCost += monthOverhead;
    expenses += m.expenses || 0;
  });

  const allIn = laborCost + overheadCost + expenses;
  const profit = totalRevenue - allIn;
  const margin = totalRevenue > 0 ? profit / totalRevenue : 0;
  return { totalHours, laborCost, overheadCost, expenses, allIn, profit, margin };
}

// ===================== Component =====================
export default function QuoteEstimateBuilder() {
  // Global inputs
  const [totalRevenue, setTotalRevenue] = useState<number>(0);
  const [overheadPerHour, setOverheadPerHour] = useState<number>(15);
  const [targetMarginPct, setTargetMarginPct] = useState<number>(0.35);

  // Global roster (shared across quotes)
  const [roster, setRoster] = useState<RosterPerson[]>([]);

  // Per-quote project team (IDs from roster)
  const [projectTeam, setProjectTeam] = useState<string[]>([]);

  // Roster search/filter
  const [rosterSearch, setRosterSearch] = useState<string>("");
  const [rosterTypeFilter, setRosterTypeFilter] = useState<"All" | PersonType>("All");

  // Start month for plan (YYYY-MM)
  const [startMonthISO, setStartMonthISO] = useState<string>(currentMonthISO());

  // Months (per quote)
  const [months, setMonths] = useState<MonthRow[]>(() => [{
    id: uuid(),
    label: labelFromISO(currentMonthISO(), 0),
    personAllocations: {},
    expenses: 0,
  }]);

  // Save/load state
  const [projectName, setProjectName] = useState<string>("Untitled Quote");
  const [currentQuoteId, setCurrentQuoteId] = useState<string | undefined>(undefined);
  const [allQuotes, setAllQuotes] = useState<StoredQuote[]>([]);

  // Init
  React.useEffect(() => {
    setAllQuotes(loadAllQuotes());
    const r = loadRoster();
    const migrated = (r.length ? r : [
      { id: uuid(), name: "Project Manager", personType: "Full-Time", compMode: "monthly", monthlySalary: 9167, baseMonthlyHours: 160 },
    ]).map((p: any) => ({
      id: p.id ?? uuid(),
      name: p.name ?? "Unnamed",
      personType: (p.personType as PersonType) ?? "Full-Time",
      compMode: (p.compMode as FTCompMode) ?? "monthly",
      monthlySalary: toNumber(p.monthlySalary, 0),
      annualSalary: toNumber(p.annualSalary, 0),
      hourlyRate: toNumber(p.hourlyRate, 0),
      baseMonthlyHours: toNumber(p.baseMonthlyHours, 160),
    })) as RosterPerson[];
    setRoster(migrated);
    saveRoster(migrated);
  }, []);

  // When startMonth changes, relabel all months sequentially
  React.useEffect(() => {
    setMonths((prev) => prev.map((m, idx) => ({ ...m, label: labelFromISO(startMonthISO, idx) })));
  }, [startMonthISO]);

  // Derived: people assigned to this quote
  const projectPeople = useMemo(() => {
    const set = new Set(projectTeam);
    return roster.filter((p) => set.has(p.id));
  }, [roster, projectTeam]);

  // Filtered roster for UI
  const filteredRoster = useMemo(() => {
    const q = rosterSearch.trim().toLowerCase();
    return roster.filter((p) => {
      const matchesText = q === "" || p.name.toLowerCase().includes(q);
      const matchesType = rosterTypeFilter === "All" || p.personType === rosterTypeFilter;
      return matchesText && matchesType;
    });
  }, [roster, rosterSearch, rosterTypeFilter]);

  // Normalize month allocations to include all project people
  const normalizedMonths = useMemo(() => {
    return months.map((m) => {
      const personAllocations = { ...m.personAllocations };
      projectPeople.forEach((p) => {
        if (!(p.id in personAllocations)) personAllocations[p.id] = 0;
      });
      return { ...m, personAllocations } as MonthRow;
    });
  }, [months, projectPeople]);

  // Totals & charts
  const totals = useMemo(() => {
    return computeTotals(projectPeople, normalizedMonths, overheadPerHour, totalRevenue);
  }, [projectPeople, normalizedMonths, overheadPerHour, totalRevenue]);

  const monthlyChart = useMemo(() => {
    let running = 0;
    return normalizedMonths.map((m) => {
      const s = computeMonthStats(projectPeople, m, overheadPerHour);
      running += s.monthAllIn;
      return {
        label: m.label,
        Labor: Math.round(s.monthLabor),
        Overhead: Math.round(s.monthOverhead),
        Expenses: Math.round(m.expenses || 0),
        AllIn: Math.round(s.monthAllIn),
        CumulativeAllIn: Math.round(running),
      };
    });
  }, [normalizedMonths, projectPeople, overheadPerHour]);

  const costBreakdown = useMemo(
    () => [
      { name: "Labor", value: Math.max(0, Math.round(totals.laborCost)) },
      { name: "Overhead", value: Math.max(0, Math.round(totals.overheadCost)) },
      { name: "Expenses", value: Math.max(0, Math.round(totals.expenses)) },
    ],
    [totals.laborCost, totals.overheadCost, totals.expenses]
  );

  const revenueNeededForTarget = useMemo(() => {
    const t = targetMarginPct;
    if (t >= 1) return Infinity;
    return totals.allIn / (1 - t);
  }, [totals.allIn, targetMarginPct]);

  // ---- Save/Load helpers inside component ----
  function collectCurrentData(): StoredQuoteData {
    return {
      totalRevenue,
      overheadPerHour,
      targetMarginPct,
      projectTeam,
      months,
    };
  }

  function persist(quotes: StoredQuote[]) {
    setAllQuotes(quotes);
    saveAllQuotes(quotes);
  }

  function newQuote() {
    setProjectName("Untitled Quote");
    setCurrentQuoteId(undefined);
    setProjectTeam([]);
    setMonths([
      {
        id: uuid(),
        label: labelFromISO(startMonthISO, 0),
        personAllocations: {},
        expenses: 0,
      },
    ]);
    setTotalRevenue(0);
    setOverheadPerHour(15);
    setTargetMarginPct(0.35);
  }

  function saveQuote() {
    const data = collectCurrentData();
    if (currentQuoteId) {
      const updated = snapshotCurrent(projectName, data, currentQuoteId);
      const next = allQuotes.map((q) => (q.id === currentQuoteId ? updated : q));
      persist(next);
    } else {
      const created = snapshotCurrent(projectName, data);
      persist([created, ...allQuotes]);
      setCurrentQuoteId(created.id);
    }
  }

  function saveQuoteAs() {
    const name = prompt("Save As — enter a name for this quote:", projectName || "Untitled Quote");
    if (name === null) return;
    const data = collectCurrentData();
    const created = snapshotCurrent(name.trim() || "Untitled Quote", data);
    persist([created, ...allQuotes]);
    setProjectName(created.name);
    setCurrentQuoteId(created.id);
  }

  function loadQuote(id: string) {
    const found = allQuotes.find((q) => q.id === id);
    if (!found) return;
    setProjectName(found.name);
    setCurrentQuoteId(found.id);
    setTotalRevenue(found.data.totalRevenue);
    setOverheadPerHour(found.data.overheadPerHour);
    setTargetMarginPct(found.data.targetMarginPct);
    setProjectTeam(found.data.projectTeam || []);
    setMonths(found.data.months);
  }

  function deleteQuote(id?: string) {
    const targetId = id ?? currentQuoteId;
    if (!targetId) return;
    const found = allQuotes.find((q) => q.id === targetId);
    if (!found) return;
    if (!window.confirm(`Delete "${found.name}"? This cannot be undone.`)) return;
    const next = allQuotes.filter((q) => q.id !== targetId);
    persist(next);
    if (currentQuoteId === targetId) newQuote();
  }

  function duplicateQuote() {
    const name = `${projectName || "Untitled Quote"} (Copy)`;
    const created = snapshotCurrent(name, collectCurrentData());
    persist([created, ...allQuotes]);
    setProjectName(created.name);
    setCurrentQuoteId(created.id);
  }

  // ---- Roster actions ----
  function addRosterPerson() {
    const p: RosterPerson = {
      id: uuid(),
      name: "New Person",
      personType: "Full-Time",
      compMode: "monthly",
      monthlySalary: 8000,
      annualSalary: 0,
      hourlyRate: 0,
      baseMonthlyHours: 160,
    };
    // Append to bottom
    const next = [...roster, p];
    setRoster(next);
    saveRoster(next);
  }

  function updateRosterPerson(id: string, patch: Partial<RosterPerson>) {
    const next = roster.map((r) => (r.id === id ? { ...r, ...patch } : r));
    setRoster(next);
    saveRoster(next);
  }

  function removeRosterPerson(id: string) {
    if (!window.confirm("Remove this person from the company roster? They will also be removed from any project team.")) return;
    const next = roster.filter((r) => r.id !== id);
    setRoster(next);
    saveRoster(next);
    setProjectTeam((prev) => prev.filter((pid) => pid !== id));
    setMonths((prev) =>
      prev.map((m) => {
        const { [id]: _drop, ...rest } = m.personAllocations;
        return { ...m, personAllocations: rest };
      })
    );
  }

  function toggleOnProject(id: string, on: boolean) {
    setProjectTeam((prev) => {
      const s = new Set(prev);
      if (on) s.add(id);
      else s.delete(id);
      return Array.from(s);
    });
  }

  // ---- Month actions ----
  function addMonth() {
    setMonths((prev) => {
      const copy: MonthRow = {
        id: uuid(),
        label: labelFromISO(startMonthISO, prev.length),
        personAllocations: { ...(prev[prev.length - 1]?.personAllocations || {}) },
        expenses: prev[prev.length - 1]?.expenses ?? 0,
      };
      return [...prev, copy];
    });
  }

  function updateMonthLabel(id: string, label: string) {
    setMonths((prev) => prev.map((m) => (m.id === id ? { ...m, label } : m)));
  }

  function setPersonAllocation(monthId: string, personId: string, allocPct: number) {
    const clampedPct = clamp(allocPct, 0, 100);
    setMonths((prev) =>
      prev.map((m) => (m.id === monthId ? { ...m, personAllocations: { ...m.personAllocations, [personId]: clampedPct } } : m))
    );
  }

  function setMonthExpense(monthId: string, value: number) {
    setMonths((prev) => prev.map((m) => (m.id === monthId ? { ...m, expenses: value } : m)));
  }

  // ---- UI ----
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6 space-y-6">
      <motion.h1 initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-3xl md:text-4xl font-bold tracking-tight">
        Quote & Estimate Builder
      </motion.h1>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="personnel">Personnel</TabsTrigger>
          <TabsTrigger value="plan">Monthly Plan</TabsTrigger>
        </TabsList>

        {/* ====================== OVERVIEW ====================== */}
        <TabsContent value="overview" className="space-y-6">
          {/* Section 0: Project / Save & Load */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl">Project</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-end">
              <div className="space-y-2">
                <Label>Quote Name</Label>
                <Input placeholder="Untitled Quote" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
                <div className="text-xs text-muted-foreground">{currentQuoteId ? "Saved quote" : "New (unsaved) quote"}</div>
              </div>

              <div className="space-y-2">
                <Label>Load Existing</Label>
                <div className="flex gap-2">
                  <select
                    className="w-full border rounded-md px-3 py-2 bg-background"
                    value={currentQuoteId ?? ""}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      loadQuote(id);
                    }}
                  >
                    <option value="" disabled>
                      Select a saved quote...
                    </option>
                    {allQuotes.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name} — {new Date(q.updatedAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                  <Button variant="ghost" onClick={() => currentQuoteId && loadQuote(currentQuoteId)}>Reload</Button>
                </div>
                <div className="text-xs text-muted-foreground">Choose from your locally saved quotes.</div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={saveQuote}>Save</Button>
                <Button variant="secondary" onClick={saveQuoteAs}>Save As…</Button>
                <Button variant="outline" onClick={duplicateQuote}>Duplicate</Button>
                <Button variant="outline" onClick={newQuote}>New</Button>
                <Button variant="destructive" onClick={() => deleteQuote()}>Delete</Button>
              </div>
            </CardContent>
          </Card>

          {/* Section 1: Inputs */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-xl"><Calculator className="h-5 w-5" /> Project Inputs</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label>Total Revenue</Label>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground"><DollarSign className="h-4 w-4" /></span>
                  <Input type="number" min={0} value={totalRevenue} onChange={(e) => setTotalRevenue(toNumber(e.target.value))} placeholder="e.g., 250000" />
                </div>
                <p className="text-xs text-muted-foreground">Your quoted/expected project revenue.</p>
              </div>

              <div className="space-y-2">
                <Label>Overhead per Hour ({currency(overheadPerHour)})</Label>
                <Slider value={[overheadPerHour]} onValueChange={(v) => setOverheadPerHour(v[0])} min={0} max={50} step={1} />
                <p className="text-xs text-muted-foreground">Covers tools, rent, admin, etc. Applied to total hours.</p>
              </div>

              <div className="space-y-2">
                <Label>Target Margin ({percent(targetMarginPct)})</Label>
                <Slider value={[targetMarginPct]} onValueChange={(v) => setTargetMarginPct(Number(v[0].toFixed(2)))} min={0} max={1} step={0.01} />
                <p className="text-xs text-muted-foreground">Use to see revenue needed to hit your goal.</p>
              </div>
            </CardContent>
          </Card>

          {/* Section 2: Summary */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-xl">Project Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                <SummaryTile label="Hours" value={totals.totalHours.toFixed(1)} />
                <SummaryTile label="Labor cost" value={currency(totals.laborCost)} />
                <SummaryTile label="Overhead cost" value={currency(totals.overheadCost)} />
                <SummaryTile label="Expenses" value={currency(totals.expenses)} />
                <SummaryTile label="All-in cost" value={currency(totals.allIn)} />
                <SummaryTile label="Profit $" value={currency(totals.profit)} />
                <SummaryTile label="Margin %" value={percent(totals.margin)} />
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="p-3 rounded-xl bg-muted/40">
                  <div className="font-medium">Revenue needed for target</div>
                  <div className="text-2xl font-semibold">{isFinite(revenueNeededForTarget) ? currency(revenueNeededForTarget) : "—"}</div>
                  <div className="text-muted-foreground mt-1">Based on current costs & target margin.</div>
                </div>
                <div className="p-3 rounded-xl bg-muted/40">
                  <div className="font-medium">Delta to target</div>
                  <div className={`text-2xl font-semibold ${totalRevenue >= revenueNeededForTarget ? "text-green-600" : "text-amber-600"}`}>
                    {isFinite(revenueNeededForTarget) ? currency(totalRevenue - revenueNeededForTarget) : "—"}
                  </div>
                  <div className="text-muted-foreground mt-1">Positive means you exceed the target.</div>
                </div>
                <div className="p-3 rounded-xl bg-muted/40">
                  <div className="font-medium">Blended hourly cost</div>
                  <div className="text-2xl font-semibold">{totals.totalHours > 0 ? currency(totals.allIn / totals.totalHours) : "—"}</div>
                  <div className="text-muted-foreground mt-1">All-in cost divided by total hours.</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Visuals */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-xl">Visuals</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyChart}>
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip formatter={(v: any) => currency(Number(v))} />
                      <Legend />
                      <Bar dataKey="Labor" stackId="cost" fill="#3b82f6" />
                      <Bar dataKey="Overhead" stackId="cost" fill="#10b981" />
                      <Bar dataKey="Expenses" stackId="cost" fill="#f59e0b" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip formatter={(v: any) => currency(Number(v))} />
                      <Legend />
                      <Pie data={costBreakdown} dataKey="value" nameKey="name" outerRadius={90} label={({ percent: p }) => `${Math.round((p || 0) * 100)}%`} labelLine={false}>
                        {costBreakdown.map((_, i) => (
                          <Cell key={`cell-${i}`} fill={["#3b82f6", "#10b981", "#f59e0b"][i % 3]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthlyChart}>
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip formatter={(v: any) => currency(Number(v))} />
                    <Legend />
                    <ReferenceLine y={totalRevenue} label="Total Revenue" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="CumulativeAllIn" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="text-xs text-muted-foreground">Tip: To hit your target margin, aim for revenue of {isFinite(revenueNeededForTarget) ? currency(revenueNeededForTarget) : "—"}.</div>
        </TabsContent>

        {/* ====================== PERSONNEL (ROSTER) ====================== */}
        <TabsContent value="personnel" className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-xl"><Users className="h-5 w-5" /> Company Roster</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {/* Search & Type Filter */}
              <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
                <div className="flex items-center gap-2 w-full md:w-1/2">
                  <Input placeholder="Search people by name…" value={rosterSearch} onChange={(e) => setRosterSearch(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Type</span>
                  <select
                    className="border rounded-md px-2 py-2 bg-background"
                    value={rosterTypeFilter}
                    onChange={(e) => setRosterTypeFilter(e.target.value as any)}
                  >
                    <option value="All">All</option>
                    <option>Full-Time</option>
                    <option>FT Resource</option>
                    <option>Part-Time</option>
                    <option>PT Resource</option>
                    <option>Contractor</option>
                  </select>
                </div>
                <div className="flex-1" />
                <div className="flex justify-end">
                  <Button onClick={addRosterPerson} className="gap-2"><Plus className="h-4 w-4" /> Add person to roster</Button>
                </div>
              </div>

              <div className="grid grid-cols-12 gap-2 text-sm font-medium text-muted-foreground mt-2">
                <div className="col-span-2">Name</div>
                <div className="col-span-2">Type</div>
                <div className="col-span-4 text-right">Compensation</div>
                <div className="col-span-2 text-right">Base Monthly Hours</div>
                <div className="col-span-1 text-center">In Project?</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>

              {filteredRoster.map((p) => {
                const onProject = projectTeam.includes(p.id);
                const fullLike = isFullTimeLike(p.personType);
                return (
                  <div key={p.id} className="grid grid-cols-12 gap-2 items-center">
                    {/* Name */}
                    <Input className="col-span-2" value={p.name} onChange={(e) => updateRosterPerson(p.id, { name: e.target.value })} />

                    {/* Type dropdown */}
                    <div className="col-span-2">
                      <select
                        className="w-full border rounded-md px-2 py-2 bg-background"
                        value={p.personType}
                        onChange={(e) => {
                          const nextType = e.target.value as PersonType;
                          const patch: Partial<RosterPerson> = { personType: nextType };
                          if (isFullTimeLike(nextType)) {
                            patch.compMode = p.compMode || "monthly";
                            patch.hourlyRate = 0;
                            patch.monthlySalary = p.monthlySalary ?? 8000;
                          } else {
                            patch.compMode = undefined;
                            patch.annualSalary = 0;
                            patch.monthlySalary = 0;
                            patch.hourlyRate = p.hourlyRate ?? 50;
                          }
                          updateRosterPerson(p.id, patch);
                        }}
                      >
                        <option>Full-Time</option>
                        <option>FT Resource</option>
                        <option>Part-Time</option>
                        <option>PT Resource</option>
                        <option>Contractor</option>
                      </select>
                    </div>

                    {/* Compensation column */}
                    <div className="col-span-4 flex items-center justify-end gap-2">
                      {fullLike ? (
                        <>
                          <select
                            className="border rounded-md px-2 py-2 bg-background"
                            value={p.compMode || "monthly"}
                            onChange={(e) => updateRosterPerson(p.id, { compMode: e.target.value as FTCompMode })}
                          >
                            <option value="monthly">Monthly</option>
                            <option value="annual">Annual</option>
                          </select>
                          {(p.compMode || "monthly") === "monthly" ? (
                            <Input className="w-36 text-right" type="number" min={0} value={p.monthlySalary ?? 0} onChange={(e) => updateRosterPerson(p.id, { monthlySalary: toNumber(e.target.value) })} placeholder="Monthly $" />
                          ) : (
                            <Input className="w-36 text-right" type="number" min={0} value={p.annualSalary ?? 0} onChange={(e) => updateRosterPerson(p.id, { annualSalary: toNumber(e.target.value) })} placeholder="Annual $" />
                          )}
                        </>
                      ) : (
                        <>
                          <span className="text-sm text-muted-foreground">Hourly</span>
                          <Input className="w-32 text-right" type="number" min={0} value={p.hourlyRate ?? 0} onChange={(e) => updateRosterPerson(p.id, { hourlyRate: toNumber(e.target.value) })} placeholder="$ / hr" />
                        </>
                      )}
                    </div>

                    {/* Base hours */}
                    <Input className="col-span-2 text-right" type="number" min={0} value={p.baseMonthlyHours} onChange={(e) => updateRosterPerson(p.id, { baseMonthlyHours: toNumber(e.target.value) })} />

                    {/* In Project? */}
                    <div className="col-span-1 text-center">
                      <input type="checkbox" checked={onProject} onChange={(e) => toggleOnProject(p.id, e.target.checked)} />
                    </div>

                    {/* Actions */}
                    <div className="col-span-1 flex justify-end">
                      <Button variant="ghost" size="icon" onClick={() => removeRosterPerson(p.id)} title="Remove from roster"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                );
              })}

              <p className="text-xs text-muted-foreground">The roster is global and shared across all quotes. Use the checkbox to include/exclude people from this quote’s project team.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ====================== MONTHLY PLAN ====================== */}
        <TabsContent value="plan" className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="pb-2 flex flex-col gap-2">
              <CardTitle className="flex items-center gap-2 text-xl"><CalendarPlus className="h-5 w-5" /> Monthly Plan</CardTitle>
              {/* Start month picker */}
              <div className="flex items-center gap-3 text-sm">
                <Label className="whitespace-nowrap">Start month</Label>
                <input
                  type="month"
                  className="border rounded-md px-3 py-2 bg-background"
                  value={startMonthISO}
                  onChange={(e) => setStartMonthISO(e.target.value)}
                />
                <div className="ml-auto">
                  <Button onClick={addMonth} className="gap-2"><Copy className="h-4 w-4" /> Add Month (copy previous)</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ScrollArea className="w-full">
                <div className="space-y-4">
                  {normalizedMonths.map((m) => {
                    const { monthHours, monthLabor, monthOverhead, monthAllIn } = computeMonthStats(projectPeople, m, overheadPerHour);
                    return (
                      <Card key={m.id} className="border-muted">
                        <CardHeader className="pb-2 flex-row items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Input value={m.label} onChange={(e) => updateMonthLabel(m.id, e.target.value)} className="font-semibold max-w-[200px]" />
                          </div>
                          <div className="text-sm text-muted-foreground">All-in: {currency(monthAllIn)}</div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="grid grid-cols-12 gap-2 text-sm font-medium text-muted-foreground">
                            <div className="col-span-4">Person</div>
                            <div className="col-span-2 text-right">Eff. Hourly</div>
                            <div className="col-span-2 text-right">Alloc %</div>
                            <div className="col-span-2 text-right">Hours</div>
                            <div className="col-span-2 text-right">Labor $</div>
                          </div>

                          {projectPeople.map((p) => {
                            const alloc = m.personAllocations[p.id] ?? 0; // 0..100
                            const hours = (p.baseMonthlyHours || 0) * (alloc || 0) / 100;

                            const effHr = effectiveHourlyRate(p);
                            const labor = effHr * hours;

                            return (
                              <div key={p.id} className="grid grid-cols-12 gap-2 items-center">
                                <div className="col-span-4 truncate">{p.name}</div>
                                <div className="col-span-2 text-right">{currency(effHr)}/hr</div>
                                <div className="col-span-2">
                                  <Input className="text-right" type="number" min={0} max={100} value={alloc} onChange={(e) => setPersonAllocation(m.id, p.id, toNumber(e.target.value))} />
                                </div>
                                <div className="col-span-2 text-right">{hours.toFixed(1)}</div>
                                <div className="col-span-2 text-right">{currency(labor)}</div>
                              </div>
                            );
                          })}

                          <div className="grid grid-cols-12 gap-2 items-center pt-2 border-t">
                            <div className="col-span-9 text-right font-medium">Overhead ({currency(overheadPerHour)} × {monthHours.toFixed(1)} hrs)</div>
                            <div className="col-span-3 text-right">{currency(monthOverhead)}</div>
                          </div>

                          <div className="grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-9 text-right font-medium">Expenses</div>
                            <div className="col-span-3">
                              <Input className="text-right" type="number" min={0} value={m.expenses} onChange={(e) => setMonthExpense(m.id, toNumber(e.target.value))} />
                            </div>
                          </div>

                          <div className="grid grid-cols-12 gap-2 items-center text-sm text-muted-foreground">
                            <div className="col-span-9 text-right">Month hours</div>
                            <div className="col-span-3 text-right">{monthHours.toFixed(1)}</div>
                            <div className="col-span-9 text-right">Labor subtotal</div>
                            <div className="col-span-3 text-right">{currency(monthLabor)}</div>
                            <div className="col-span-9 text-right">All-in total</div>
                            <div className="col-span-3 text-right font-medium">{currency(monthAllIn)}</div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border p-4 bg-background">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
