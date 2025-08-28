// /src/app/personnel/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  RosterPerson,
  PersonType,
  FTCompMode,
  isFullTimeLike,
  loadRoster,
  saveRoster,
  toNumber,
} from "@/lib/storage";

export default function PersonnelPage() {
  const [roster, setRoster] = useState<RosterPerson[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"All" | PersonType>("All");
  const [hydrated, setHydrated] = useState(false);

  // Load roster on mount
  useEffect(() => {
    setRoster(loadRoster());
    setHydrated(true);
  }, []);

  // Autosave only after initial load
  useEffect(() => {
    if (hydrated) saveRoster(roster);
  }, [roster, hydrated]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roster.filter(
      (p) =>
        (q === "" || p.name.toLowerCase().includes(q)) &&
        (typeFilter === "All" || p.personType === typeFilter)
    );
  }, [roster, search, typeFilter]);

  function addPerson() {
    setRoster((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: "New Person",
        personType: "Full-Time",
        compMode: "monthly",
        monthlySalary: 8000,
        annualSalary: 0,
        hourlyRate: 0,
        baseMonthlyHours: 160,
      },
    ]);
  }

  function update(id: string, patch: Partial<RosterPerson>) {
    setRoster((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function remove(id: string) {
    if (!confirm("Remove this person from the company roster?")) return;
    setRoster((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Personnel</h1>

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
        <div className="flex-1" />
        <Button onClick={addPerson} className="gap-2">
          <Plus className="h-4 w-4" /> Add person
        </Button>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-12 gap-2 text-sm font-medium text-muted-foreground mt-2">
        <div className="col-span-3">Name</div>
        <div className="col-span-2">Type</div>
        <div className="col-span-4 text-right">Compensation</div>
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
              className="col-span-3"
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

            {/* Compensation */}
            <div className="col-span-4 flex items-center justify-end gap-2">
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
