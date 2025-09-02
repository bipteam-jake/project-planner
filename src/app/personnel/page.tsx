// /src/app/personnel/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RosterPerson, PersonType, Department, FTCompMode } from "@/lib/types";
import { isFullTimeLike, toNumber } from "@/lib/storage";

import { apiRepoAsync as repo } from "@/lib/repo";


export default function PersonnelPage() {
  const [roster, setRoster] = useState<RosterPerson[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"All" | PersonType>("All");
  const [departmentFilter, setDepartmentFilter] = useState<"All" | Department>("All");
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");

  // Load roster on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const rs = await repo.loadRoster();
        if (!mounted) return;
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

  // Autosave only after initial load
  // Debounced autosave (bulk) for roster edits to reduce network chatter
  const rowSaveAt = useRef<number>(0);
  useEffect(() => {
    if (!hydrated) return;
    setSaving("saving");
    const t = setTimeout(async () => {
      // If a row-level save happened very recently, skip this bulk autosave to avoid races
      if (Date.now() - rowSaveAt.current < 500) {
        setSaving("idle");
        return;
      }
      try {
        await repo.saveRoster(roster);
        setSaving("saved");
        setTimeout(() => setSaving("idle"), 800);
      } catch (e) {
        // Swallow transient errors; row-level saves keep DB consistent
        console.warn("Autosave roster failed (non-fatal)", e);
        setSaving("idle");
      }
    }, 600);
    return () => clearTimeout(t);
  }, [roster, hydrated]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roster.filter(
      (p) =>
        (q === "" || p.name.toLowerCase().includes(q)) &&
        (typeFilter === "All" || p.personType === typeFilter) &&
        (departmentFilter === "All" || p.department === departmentFilter)
    );
  }, [roster, search, typeFilter, departmentFilter]);

  function addPerson() {
    const newPerson: RosterPerson = {
      id: crypto.randomUUID(),
      name: "New Person",
      personType: "Full-Time",
      department: "Other",
      compMode: "monthly",
      monthlySalary: 8000,
      annualSalary: 0,
      hourlyRate: 0,
      baseMonthlyHours: 160,
      isActive: true,
    };
    setRoster((prev) => [...prev, newPerson]);
    void repo.createPerson(newPerson).then(() => {
      rowSaveAt.current = Date.now();
    });
  }

  function update(id: string, patch: Partial<RosterPerson>) {
    setRoster((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      const person = next.find((r) => r.id === id);
      if (person) {
        void repo.upsertPerson(person).then(() => {
          rowSaveAt.current = Date.now();
        });
      }
      return next;
    });
  }

  function remove(id: string) {
    if (!confirm("Remove this person from the company roster?")) return;
    setRoster((prev) => prev.filter((r) => r.id !== id));
    void repo.deletePerson(id).then(() => {
      rowSaveAt.current = Date.now();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Personnel</h1>
          <p className="text-muted-foreground">
            Manage your team roster, roles, and compensation
          </p>
        </div>
        <div className="text-sm text-muted-foreground flex items-center">
          {saving === "saving" && <span>Saving…</span>}
          {saving === "saved" && <span className="text-green-600">Saved</span>}
        </div>
      </div>

      {/* Search + filter + add */}
      <div className="rounded-xl border bg-card shadow-sm p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Input
              placeholder="Search people by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-80"
            />
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Type</span>
                <select
                  className="border rounded-lg px-3 py-2 bg-background text-sm"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as any)}
                >
                  <option value="All">All</option>
                  <option>Full-Time</option>
                  <option>FT Resource</option>
                  <option>Part-Time</option>
                  <option>PT Resource</option>
                  <option>Contractor</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Department</span>
                <select
                  className="border rounded-lg px-3 py-2 bg-background text-sm"
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value as "All" | Department)}
                >
                  <option value="All">All</option>
                  <option value="C-Suite">C-Suite</option>
                  <option value="BD">BD</option>
                  <option value="Marketing">Marketing</option>
                  <option value="Product">Product</option>
                  <option value="Engineering">Engineering</option>
                  <option value="Ops">Ops</option>
                  <option value="Software">Software</option>
                  <option value="Admin">Admin</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
          </div>
          <Button onClick={addPerson} className="gap-2 sm:ml-4">
            <Plus className="h-4 w-4" /> Add person
          </Button>
        </div>
      </div>

      {/* Personnel Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-13 gap-2 text-sm font-medium text-muted-foreground p-4 border-b bg-muted/30">
          <div className="col-span-2">Name</div>
          <div className="col-span-2">Type</div>
          <div className="col-span-2">Department</div>
          <div className="col-span-3 text-right">Compensation</div>
          <div className="col-span-2 text-right">Base Monthly Hours</div>
          <div className="col-span-1 text-center">Status</div>
          <div className="col-span-1 text-right">Actions</div>
        </div>

        {/* Table rows */}
        <div className="divide-y">
          {filtered.map((p) => {
            const fullLike = isFullTimeLike(p.personType);
            return (
              <div key={p.id} className={`grid grid-cols-13 gap-2 items-center p-4 hover:bg-muted/50 transition-colors ${p.isActive === false ? 'opacity-60' : ''}`}>
            {/* Name */}
            <Input
              className="col-span-2"
              value={p.name}
              onChange={(e) => update(p.id, { name: e.target.value })}
            />

            {/* Type */}
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
                  update(p.id, patch);
                }}
              >
                <option>Full-Time</option>
                <option>FT Resource</option>
                <option>Part-Time</option>
                <option>PT Resource</option>
                <option>Contractor</option>
              </select>
            </div>

            {/* Department */}
            <div className="col-span-2">
              <select
                className="w-full border rounded-md px-2 py-2 bg-background"
                value={p.department}
                onChange={(e) => update(p.id, { department: e.target.value as Department })}
              >
                <option value="C-Suite">C-Suite</option>
                <option value="BD">BD</option>
                <option value="Marketing">Marketing</option>
                <option value="Product">Product</option>
                <option value="Engineering">Engineering</option>
                <option value="Ops">Ops</option>
                <option value="Software">Software</option>
                <option value="Admin">Admin</option>
                <option value="Other">Other</option>
              </select>
            </div>

            {/* Compensation */}
            <div className="col-span-3 flex items-center justify-end gap-2">
              {fullLike ? (
                <>
                  <select
                    className="border rounded-md px-2 py-2 bg-background"
                    value={p.compMode || "monthly"}
                    onChange={(e) =>
                      update(p.id, { compMode: e.target.value as FTCompMode })
                    }
                  >
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                  </select>
                  {(p.compMode || "monthly") === "monthly" ? (
                    <Input
                      className="w-36 text-right"
                      type="number"
                      min={0}
                      value={p.monthlySalary ?? 0}
                      onChange={(e) =>
                        update(p.id, { monthlySalary: toNumber(e.target.value) })
                      }
                      placeholder="Monthly $"
                    />
                  ) : (
                    <Input
                      className="w-36 text-right"
                      type="number"
                      min={0}
                      value={p.annualSalary ?? 0}
                      onChange={(e) =>
                        update(p.id, { annualSalary: toNumber(e.target.value) })
                      }
                      placeholder="Annual $"
                    />
                  )}
                </>
              ) : (
                <>
                  <span className="text-sm text-muted-foreground">Hourly</span>
                  <Input
                    className="w-32 text-right"
                    type="number"
                    min={0}
                    value={p.hourlyRate ?? 0}
                    onChange={(e) =>
                      update(p.id, { hourlyRate: toNumber(e.target.value) })
                    }
                    placeholder="$ / hr"
                  />
                </>
              )}
            </div>

            {/* Base monthly hours */}
            <Input
              className="col-span-2 text-right"
              type="number"
              min={0}
              value={p.baseMonthlyHours}
              onChange={(e) =>
                update(p.id, { baseMonthlyHours: toNumber(e.target.value) })
              }
            />

            {/* Active Status / Inactive Date */}
            <div className="col-span-1 flex justify-center items-center gap-1 min-w-0">
              {p.isActive !== false ? (
                // Show checkbox when active
                <input
                  type="checkbox"
                  checked={true}
                  onChange={(e) => {
                    if (!e.target.checked) {
                      // When deactivating, set inactive date to today
                      const patch: Partial<RosterPerson> = {
                        isActive: false,
                        inactiveDate: new Date().toISOString().split('T')[0],
                      };
                      update(p.id, patch);
                    }
                  }}
                  className="rounded"
                  title="Click to deactivate person"
                />
              ) : (
                // Show date picker and reactivate button when inactive
                <>
                  <Input
                    type="date"
                    value={p.inactiveDate || new Date().toISOString().split('T')[0]}
                    onChange={(e) => {
                      const newDate = e.target.value;
                      const patch: Partial<RosterPerson> = {
                        isActive: false,
                        inactiveDate: newDate,
                      };
                      update(p.id, patch);
                    }}
                    className="w-24 text-xs px-1"
                    title="Inactive since this date"
                  />
                  <button
                    onClick={() => {
                      const patch: Partial<RosterPerson> = {
                        isActive: true,
                        inactiveDate: undefined,
                      };
                      update(p.id, patch);
                    }}
                    className="text-xs text-green-600 hover:text-green-800 px-0.5 py-0.5 rounded border border-green-300 hover:border-green-400 bg-green-50 hover:bg-green-100 flex-shrink-0"
                    title="Reactivate person"
                  >
                    ↻
                  </button>
                </>
              )}
            </div>

            {/* Actions */}
            <div className="col-span-1 flex justify-end">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove(p.id)}
                title="Remove"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-sm text-muted-foreground text-center p-4 bg-muted/30 rounded-lg">
        The roster is global and shared across all projects. Add people here once
        and reuse them across projects.
      </p>
    </div>
  );
}
