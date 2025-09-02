// /src/app/personnel/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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
  useEffect(() => {
    if (!hydrated) return;
    setSaving("saving");
    const t = setTimeout(async () => {
      try {
        await repo.saveRoster(roster);
        setSaving("saved");
        setTimeout(() => setSaving("idle"), 800);
      } catch (e) {
        console.error(e);
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
    };
    setRoster((prev) => [...prev, newPerson]);
    void repo.createPerson(newPerson);
  }

  function update(id: string, patch: Partial<RosterPerson>) {
    setRoster((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      const person = next.find((r) => r.id === id);
      if (person) {
        void repo.upsertPerson(person);
      }
      return next;
    });
  }

  function remove(id: string) {
    if (!confirm("Remove this person from the company roster?")) return;
    setRoster((prev) => prev.filter((r) => r.id !== id));
    void repo.deletePerson(id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Personnel</h1>
        <div className="text-xs text-muted-foreground h-5 flex items-center">
          {saving === "saving" && <span>Saving…</span>}
          {saving === "saved" && <span>Saved</span>}
        </div>
      </div>

      {/* Search + filter + add */}
      <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
        <Input
          placeholder="Search people by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="md:w-1/2"
        />
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Type</span>
          <select
            className="border rounded-md px-2 py-2 bg-background"
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
          <span className="text-sm text-muted-foreground">Department</span>
          <select
            className="border rounded-md px-2 py-2 bg-background"
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
        <div className="flex-1" />
        <Button onClick={addPerson} className="gap-2">
          <Plus className="h-4 w-4" /> Add person
        </Button>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-12 gap-2 text-sm font-medium text-muted-foreground mt-2">
        <div className="col-span-2">Name</div>
        <div className="col-span-2">Type</div>
        <div className="col-span-2">Department</div>
        <div className="col-span-3 text-right">Compensation</div>
        <div className="col-span-2 text-right">Base Monthly Hours</div>
        <div className="col-span-1 text-right">Actions</div>
      </div>

      {/* Rows */}
      {filtered.map((p) => {
        const fullLike = isFullTimeLike(p.personType);
        return (
          <div key={p.id} className="grid grid-cols-12 gap-2 items-center">
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

      <p className="text-xs text-muted-foreground">
        The roster is global and shared across all projects. Add people here once
        and reuse them across projects.
      </p>
    </div>
  );
}
