"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, Plus, Trash2, Users, GripVertical } from "lucide-react";
import { apiRepoAsync as repo } from "@/lib/repo";
import { Project, RosterPerson } from "@/lib/types";
import { computeProjectTotals, currency, percent } from "@/lib/storage";
// Tailwind utility merger isn't exported globally; inline a minimal cn helper
function cnBase(...cls: Array<string | undefined | false | null>) {
  return cls.filter(Boolean).join(" ");
}

function ProjectSummaryCards({ project, roster }: { project: Project; roster: RosterPerson[] }) {
  const totals = computeProjectTotals(project, roster);
  
  // Dynamic margin colors based on percentage
  const getMarginStyles = (margin: number) => {
    const marginPercent = margin * 100;
    if (marginPercent < 0) {
      return {
        bg: "bg-red-50",
        border: "border-red-200",
        textLabel: "text-red-600",
        textValue: "text-red-800"
      };
    } else if (marginPercent < 10) {
      return {
        bg: "bg-yellow-50",
        border: "border-yellow-200",
        textLabel: "text-yellow-600",
        textValue: "text-yellow-800"
      };
    } else if (marginPercent < 30) {
      return {
        bg: "bg-green-100",
        border: "border-green-300",
        textLabel: "text-green-600",
        textValue: "text-green-800"
      };
    } else {
      return {
        bg: "bg-green-200",
        border: "border-green-400",
        textLabel: "text-green-700",
        textValue: "text-green-900"
      };
    }
  };
  
  const marginStyles = getMarginStyles(totals.margin);
  
  return (
    <div className="flex gap-1 mt-1 flex-wrap">
      <div className="bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 text-xs min-w-0">
        <div className="text-blue-600 font-medium text-xs leading-tight">Revenue</div>
        <div className="text-blue-800 font-semibold text-xs leading-tight">{currency(totals.revenue)}</div>
      </div>
      <div className="bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5 text-xs min-w-0">
        <div className="text-orange-600 font-medium text-xs leading-tight">All-in</div>
        <div className="text-orange-800 font-semibold text-xs leading-tight">{currency(totals.allIn)}</div>
      </div>
      <div className={`${marginStyles.bg} border ${marginStyles.border} rounded px-1.5 py-0.5 text-xs min-w-0`}>
        <div className={`${marginStyles.textLabel} font-medium text-xs leading-tight`}>Margin</div>
        <div className={`${marginStyles.textValue} font-semibold text-xs leading-tight`}>{percent(totals.margin)}</div>
      </div>
    </div>
  );
}

type TodoItem = {
  id: string;
  text: string;
  dueDate?: string;
  assignees: string[]; // person ids
  done: boolean;
};

type ProjectRow = {
  projectId: string;
  bdNeeded: boolean;
  bdNotes?: string;
  todos: TodoItem[];
};

type WeekState = Record<string, ProjectRow>; // projectId -> row

const uid = () => crypto.randomUUID();

function iso(date?: Date) {
  return date ? date.toISOString().slice(0, 10) : undefined;
}
function startOfWeek(d: Date) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Monday=0
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date;
}
function addDays(d: Date, days: number) {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}

export default function TodoPage() {
  const [hydrated, setHydrated] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [roster, setRoster] = useState<RosterPerson[]>([]);
  const [filter, setFilter] = useState("");
  const [peopleFilter, setPeopleFilter] = useState<string[]>([]);
  const [toast, setToast] = useState<{ type: "success" | "info" | "error"; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const weekKey = iso(weekStart)!;
  const [weekState, setWeekState] = useState<WeekState>({});
  const [order, setOrder] = useState<string[]>([]);

  // load projects, roster
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [ps, rs] = await Promise.all([repo.loadProjects(), repo.loadRoster()]);
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
  // load week from API
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/todo?weekKey=${encodeURIComponent(weekKey)}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load todo week");
        const data = await res.json();
        if (cancelled) return;
        const map: WeekState = {};
        for (const r of (data.rows ?? []) as any[]) {
          map[r.projectId] = {
            projectId: r.projectId,
            bdNeeded: !!r.bdNeeded,
            bdNotes: r.bdNotes ?? "",
            todos: (r.todos ?? []).map((t: any) => ({ id: t.id, text: t.text, dueDate: t.dueDate ?? undefined, done: !!t.done, assignees: t.assignees ?? [] })),
          };
        }
        setWeekState(map);
        setOrder((data.order as string[] | null) ?? []);
      } catch (e) {
        console.error(e);
        setWeekState({});
        setOrder([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekKey]);

  // Debounced save to API
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function normalizePayloadFrom(state: WeekState, ord: string[]) {
    const rows = projects.map((p) => {
      const r = state[p.id] ?? { projectId: p.id, bdNeeded: false, bdNotes: "", todos: [] };
      return {
        projectId: p.id,
        bdNeeded: !!r.bdNeeded,
        bdNotes: r.bdNotes ?? "",
        todos: (r.todos ?? []).map((t) => ({ id: t.id, text: t.text, dueDate: t.dueDate ?? undefined, done: !!t.done, assignees: t.assignees ?? [] })),
      };
    });
    return { weekKey, rows, order: ord };
  }
  const normalizePayload = () => normalizePayloadFrom(weekState, order);
  function scheduleSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const payload = normalizePayload();
    saveTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/todo", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to save week");
        // small saved toast
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ type: "info", message: "Saved" });
        toastTimer.current = setTimeout(() => setToast(null), 1000);
      } catch (e) {
        console.error(e);
      }
    }, 600);
  }

  async function saveImmediate(nextState: WeekState, nextOrder: string[] = order) {
    try {
      const payload = normalizePayloadFrom(nextState, nextOrder);
      const res = await fetch("/api/todo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save week");
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ type: "info", message: "Saved" });
      toastTimer.current = setTimeout(() => setToast(null), 1000);
    } catch (e) {
      console.error(e);
    }
  }

  async function flushPendingSave() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      await saveImmediate(weekState, order);
    }
  }

  // Flush on week change and unmount
  useEffect(() => {
    return () => {
      void flushPendingSave();
    };
  }, [weekKey]);
  useEffect(() => {
    return () => {
      void flushPendingSave();
    };
  }, []);

  const peopleById = useMemo(() => {
    const map: Record<string, RosterPerson> = {};
    roster.forEach((p) => (map[p.id] = p));
    return map;
  }, [roster]);

  const rows = useMemo(() => {
    // Derive a row for every project; merge with stored state
    const projRows: ProjectRow[] = projects.map((p) => {
      const existing = weekState[p.id];
      return (
        existing ?? {
          projectId: p.id,
          bdNeeded: false,
          bdNotes: "",
          todos: [],
        }
      );
    });
    const pos: Record<string, number> = {};
    order.forEach((id, i) => (pos[id] = i));
    const ordered = [...projRows].sort((a, b) => {
      const ai = pos[a.projectId];
      const bi = pos[b.projectId];
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      const an = projects.find((p) => p.id === a.projectId)?.name ?? "";
      const bn = projects.find((p) => p.id === b.projectId)?.name ?? "";
      return an.localeCompare(bn);
    });
    // People filter: include project if any todo has an assignee in selection
    const selected = new Set(peopleFilter);
    const filteredByPeople = peopleFilter.length
      ? ordered.filter((r) => (r.todos ?? []).some((t) => (t.assignees ?? []).some((id) => selected.has(id))))
      : ordered;

    const f = filter.trim().toLowerCase();
    if (!f) return filteredByPeople;
    return filteredByPeople.filter((r) => {
      const proj = projects.find((p) => p.id === r.projectId);
      const name = proj?.name ?? "";
      const inName = name.toLowerCase().includes(f);
      const inNotes = (r.bdNotes ?? "").toLowerCase().includes(f);
      const inTodos = r.todos.some((t) =>
        t.text.toLowerCase().includes(f) ||
        t.assignees.some((id) => (peopleById[id]?.name ?? "").toLowerCase().includes(f))
      );
      return inName || inNotes || inTodos;
    });
  }, [projects, weekState, filter, peopleFilter, peopleById, weekKey, order]);

  function patchRow(projectId: string, patch: Partial<ProjectRow>) {
    setWeekState((prev) => {
      const next = { ...prev, [projectId]: { ...(prev[projectId] ?? { projectId, bdNeeded: false, bdNotes: "", todos: [] }), ...patch } };
      scheduleSave();
      return next;
    });
  }

  function replaceRow(next: ProjectRow) {
    setWeekState((prev) => {
      const n = { ...prev, [next.projectId]: next };
      scheduleSave();
      return n;
    });
  }

  function addTodo(projectId: string) {
    const row = weekState[projectId] ?? { projectId, bdNeeded: false, bdNotes: "", todos: [] };
    const next: ProjectRow = { ...row, todos: [...row.todos, { id: uid(), text: "", dueDate: undefined, assignees: [], done: false }] };
    replaceRow(next);
  }

  async function fetchWeekState(key: string): Promise<WeekState> {
    try {
      const res = await fetch(`/api/todo?weekKey=${encodeURIComponent(key)}`, { cache: "no-store" });
      if (!res.ok) return {};
      const data = await res.json();
      const map: WeekState = {};
      for (const r of (data.rows ?? []) as any[]) {
        map[r.projectId] = {
          projectId: r.projectId,
          bdNeeded: !!r.bdNeeded,
          bdNotes: r.bdNotes ?? "",
          todos: (r.todos ?? []).map((t: any) => ({ id: t.id, text: t.text, dueDate: t.dueDate ?? undefined, done: !!t.done, assignees: t.assignees ?? [] })),
        };
      }
      return map;
    } catch {
      return {};
    }
  }

  function copyUnfinishedFromPrevWeek() {
    const prevKey = iso(addDays(weekStart, -7))!;
    (async () => {
      const prev = await fetchWeekState(prevKey);
      let changed = false;
      let copiedCount = 0;
      const nextState: WeekState = { ...weekState };
      for (const p of projects) {
        const prevRow = prev[p.id];
        if (!prevRow) continue;
        const pending = prevRow.todos.filter((t) => !t.done && t.text.trim() !== "");
        if (!pending.length) continue;
        const currRow: ProjectRow = nextState[p.id] ?? { projectId: p.id, bdNeeded: false, bdNotes: "", todos: [] };
        const keyOf = (t: TodoItem) => `${t.text.trim().toLowerCase()}|${t.dueDate ?? ""}|${[...(t.assignees ?? [])].sort().join(",")}`;
        const existingKeys = new Set(currRow.todos.map(keyOf));
        const newOnes = pending
          .map((t) => ({ id: crypto.randomUUID(), text: t.text, dueDate: t.dueDate, assignees: t.assignees ?? [], done: false }))
          .filter((t) => !existingKeys.has(keyOf(t)));
        if (newOnes.length) {
          nextState[p.id] = { ...currRow, todos: [...currRow.todos, ...newOnes] };
          copiedCount += newOnes.length;
          changed = true;
        }
      }
      if (changed) {
        setWeekState(nextState);
        scheduleSave();
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ type: "success", message: `Copied ${copiedCount} task${copiedCount === 1 ? "" : "s"} from last week` });
        toastTimer.current = setTimeout(() => setToast(null), 2000);
      } else {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ type: "info", message: "No new unfinished tasks to copy" });
        toastTimer.current = setTimeout(() => setToast(null), 2000);
      }
    })();
  }

  function resetOrderAlpha() {
    const alpha = [...projects]
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((p) => p.id);
    setOrder(alpha);
    scheduleSave();
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type: "info", message: "Order reset to alphabetical" });
    toastTimer.current = setTimeout(() => setToast(null), 1500);
  }

  // Drag & Drop project ordering
  const dragProjectId = useRef<string | null>(null);
  function onRowDragStart(e: React.DragEvent, projectId: string) {
    dragProjectId.current = projectId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", projectId);
  }
  function onRowDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }
  function onRowDrop(e: React.DragEvent, overProjectId: string) {
    e.preventDefault();
    const fromId = e.dataTransfer.getData("text/plain") || dragProjectId.current;
    if (!fromId || fromId === overProjectId) return;
    const currentOrder = rows.map((r) => r.projectId);
    const fromIdx = currentOrder.indexOf(fromId);
    const toIdx = currentOrder.indexOf(overProjectId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...currentOrder];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    // ensure all project ids included
    projects.forEach((p) => {
      if (!next.includes(p.id)) next.push(p.id);
    });
    setOrder(next);
    scheduleSave();
    dragProjectId.current = null;
  }

  function formatWeekRange(start: Date) {
    const end = addDays(start, 6);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    const sameYear = start.getFullYear() === end.getFullYear();
    const fmt = new Intl.DateTimeFormat(undefined, sameYear ? opts : { ...opts, year: "numeric" });
    return `${fmt.format(start)} – ${fmt.format(end)}`;
  }

  // Simple member multi-select with search
  function AssigneeMulti({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      const onDoc = (e: MouseEvent) => {
        if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
      };
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }, []);

    const filtered = roster.filter((p) => p.isActive !== false && p.name.toLowerCase().includes(q.toLowerCase()));

    const handleToggle = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen((o) => !o);
    };

    return (
      <div className="relative" ref={ref}>
        <button 
          type="button" 
          className="border rounded-md px-3 py-2 w-full text-left flex items-center justify-between bg-background hover:bg-muted/50 transition-colors" 
          onClick={handleToggle}
        >
          <span className="truncate">{value.length ? `${value.length} selected` : "Assign"}</span>
          <Users className="h-4 w-4 opacity-70 flex-shrink-0" />
        </button>
        {open && (
          <div className="absolute z-50 mt-1 min-w-80 w-full max-w-md right-0 rounded-md border bg-card p-3 shadow-lg">
            <Input placeholder="Search people..." value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
            <div className="max-h-60 overflow-auto space-y-1">
              {filtered.length === 0 ? (
                <div className="px-2 py-2 text-sm text-muted-foreground">No people found</div>
              ) : (
                filtered.map((p) => {
                  const checked = value.includes(p.id);
                  return (
                    <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const on = e.target.checked;
                          if (on) onChange([...value, p.id]);
                          else onChange(value.filter((id) => id !== p.id));
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="truncate">{p.name}</span>
                    </label>
                  );
                })
              )}
            </div>
            {value.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3 pt-2 border-t">
                {value.map((id) => (
                  <span key={id} className="text-xs border rounded-full px-2 py-1 bg-secondary">
                    {peopleById[id]?.name ?? id}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (!hydrated) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <Card className="w-full">
        <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 w-full">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-3xl font-bold tracking-tight">Project To‑Dos</CardTitle>
            <p className="text-muted-foreground">Weekly board keyed to Monday. Uses your Projects and Personnel.</p>
          </div>
          <div className="flex items-center gap-2 ml-0 md:ml-auto w-full md:w-auto">
            <Button variant="outline" size="icon" onClick={() => setWeekStart((d) => addDays(startOfWeek(d), -7))} aria-label="Previous week"><ChevronLeft className="h-4 w-4"/></Button>
            <div className="text-sm px-2 whitespace-nowrap">Week of {new Date(weekKey + "T00:00:00").toLocaleDateString()} <span className="text-muted-foreground">({formatWeekRange(new Date(weekKey + "T00:00:00"))})</span></div>
            <Button variant="outline" size="icon" onClick={() => setWeekStart((d) => addDays(startOfWeek(d), 7))} aria-label="Next week"><ChevronRight className="h-4 w-4"/></Button>
            <Button variant="secondary" onClick={() => setWeekStart(startOfWeek(new Date()))}>This Week</Button>
            <Button variant="outline" onClick={copyUnfinishedFromPrevWeek}>Copy unfinished from last week</Button>
            <Button variant="outline" onClick={resetOrderAlpha}>Reset order</Button>
          </div>
          {/* moved search + people filter to its own row below */}
        </CardHeader>
      </Card>

      {/* Search + People Filter row */}
      <Card className="w-full">
        <div className="p-4 flex flex-col md:flex-row items-stretch md:items-center gap-4 w-full">
          <Input
            placeholder="Search projects, tasks, notes..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="md:w-80"
          />
          <PeopleFilterMulti roster={roster} selected={peopleFilter} onChange={setPeopleFilter} />
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 w-full">
        <HeaderCell className="md:col-span-2">Project</HeaderCell>
        <HeaderCell className="md:col-span-3">BD</HeaderCell>
        <HeaderCell className="md:col-span-7">To‑Dos</HeaderCell>
      </div>

      <div className="space-y-3 mt-2 w-full">
        {rows.map((row) => {
          const proj = projects.find((p) => p.id === row.projectId);
          if (!proj) return null;
          return (
            <Card
              key={row.projectId}
              className="hover:shadow-md transition-shadow w-full"
              draggable
              onDragStart={(e) => onRowDragStart(e, row.projectId)}
              onDragOver={onRowDragOver}
              onDrop={(e) => onRowDrop(e, row.projectId)}
            >
              <CardContent className="pt-6 w-full overflow-visible">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start w-full">
                  {/* Project Name (not editable) */}
                  <div className="md:col-span-2 col-span-12 space-y-2 min-w-0 w-full">
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                      <Link href={`/projects/${proj.id}`} className="font-medium underline underline-offset-2 truncate">{proj.name}</Link>
                    </div>
                    <div className="text-xs text-muted-foreground font-medium">{proj.projectStatus}</div>
                    <ProjectSummaryCards project={proj} roster={roster} />
                  </div>

                  {/* BD */}
                  <div className="md:col-span-3 col-span-12 min-w-0 w-full">
                    <div className="space-y-2 w-full">
                      <div className="flex items-center gap-2">
                        <input id={`bd-${row.projectId}`} type="checkbox" checked={row.bdNeeded} onChange={(e) => patchRow(row.projectId, { bdNeeded: e.target.checked })} />
                        <Label htmlFor={`bd-${row.projectId}`}>BD work needed</Label>
                      </div>
                      {row.bdNeeded && (
                        <textarea
                          placeholder="Add BD context..."
                          value={row.bdNotes ?? ""}
                          onChange={(e) => patchRow(row.projectId, { bdNotes: e.target.value })}
                          rows={3}
                          className="w-full whitespace-pre-wrap break-words resize-y border rounded-md px-3 py-2 bg-background"
                        />
                      )}
                    </div>
                  </div>

                  {/* Todos */}
                  <div className="md:col-span-7 col-span-12 min-w-0 w-full flex-1">
                    <div className="space-y-3 w-full">
                      {row.todos.map((t) => (
                        <div key={t.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center rounded-xl border p-2 w-full">
                          <div className="md:col-span-6 col-span-12 flex items-start gap-2 min-w-0 w-full">
                            <input type="checkbox" checked={t.done} onChange={(e) => replaceRow({ ...row, todos: row.todos.map((x) => (x.id === t.id ? { ...x, done: e.target.checked } : x)) })} />
                            <textarea
                              placeholder="Task title"
                              value={t.text}
                              onChange={(e) => replaceRow({ ...row, todos: row.todos.map((x) => (x.id === t.id ? { ...x, text: e.target.value } : x)) })}
                              rows={2}
                              className="w-full whitespace-pre-wrap break-words resize-y border rounded-md px-3 py-2 bg-background"
                            />
                          </div>
                          <div className="md:col-span-3 col-span-12 min-w-0 w-full">
                            <AssigneeMulti
                              value={t.assignees}
                              onChange={(ids) => replaceRow({ ...row, todos: row.todos.map((x) => (x.id === t.id ? { ...x, assignees: ids } : x)) })}
                            />
                            {t.assignees.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1 text-xs">
                                {t.assignees.map((id) => (
                                  <span key={id} className="border rounded-full px-2 py-0.5 bg-secondary">
                                    {peopleById[id]?.name ?? id}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="md:col-span-3 col-span-12 min-w-0 w-full">
                            <Input type="date" value={t.dueDate ?? ""} onChange={(e) => replaceRow({ ...row, todos: row.todos.map((x) => (x.id === t.id ? { ...x, dueDate: e.target.value || undefined } : x)) })} />
                          </div>
                          <div className="md:col-span-1 col-span-12 flex md:justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Delete task"
                              onClick={() => {
                                const next: ProjectRow = { ...row, todos: row.todos.filter((x) => x.id !== t.id) };
                                const nextState: WeekState = { ...weekState, [row.projectId]: next };
                                setWeekState(nextState);
                                void saveImmediate(nextState);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      <Button onClick={() => addTodo(row.projectId)} variant="secondary" size="sm" className="w-full">
                        <Plus className="mr-2 h-4 w-4" /> Add task
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {rows.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">No projects found. Create projects on the Projects page.</CardContent>
          </Card>
        )}
      </div>
      {/* toast */}
      {toast && (
        <div
          className={
            "fixed bottom-4 right-4 z-50 rounded-md border px-3 py-2 shadow bg-card text-sm " +
            (toast.type === "success"
              ? "text-green-700 border-green-300"
              : toast.type === "info"
              ? "text-foreground border-border"
              : "text-red-700 border-red-300")
          }
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

function HeaderCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cnBase("text-xs uppercase tracking-wide text-muted-foreground px-2", className)}>{children}</div>;
}

function PeopleFilterMulti({ roster, selected, onChange }: { roster: RosterPerson[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as any)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const filtered = roster.filter((p) => p.isActive !== false && p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="border rounded-md px-3 py-2 w-full text-left flex items-center justify-between bg-background md:w-80" onClick={() => setOpen((o) => !o)}>
        <span className="truncate">{selected.length ? `${selected.length} person${selected.length === 1 ? "" : "s"}` : "Filter by person"}</span>
        <Users className="h-4 w-4 opacity-70" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-[28rem] max-w-[calc(100vw-2rem)] rounded-md border bg-card p-2 shadow">
          <Input placeholder="Search people..." value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />
          <div className="max-h-60 overflow-auto space-y-1">
            {filtered.map((p) => {
              const checked = selected.includes(p.id);
              return (
                <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const on = e.target.checked;
                      if (on) onChange([...selected, p.id]);
                      else onChange(selected.filter((id) => id !== p.id));
                    }}
                  />
                  <span className="truncate">{p.name}</span>
                </label>
              );
            })}
            {filtered.length === 0 && <div className="px-2 py-1 text-sm text-muted-foreground">No matches</div>}
          </div>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {selected.map((id) => (
                <span key={id} className="text-xs border rounded-full px-2 py-1 bg-secondary">
                  {roster.find((r) => r.id === id)?.name ?? id}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}





