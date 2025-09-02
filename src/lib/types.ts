// Shared types usable on both client and server

export type PersonType =
  | "Full-Time"
  | "FT Resource"
  | "Part-Time"
  | "PT Resource"
  | "Contractor";

export type FTCompMode = "monthly" | "annual";

export type ProjectType =
  | "Test"
  | "BD"
  | "Active"
  | "Completed"
  | "Cancelled";

export type Department =
  | "C-Suite"
  | "BD"
  | "Marketing"
  | "Product"
  | "Engineering"
  | "Ops"
  | "Software"
  | "Admin"
  | "Other";

export interface RosterPerson {
  id: string;
  name: string;
  personType: PersonType;
  department: Department;
  compMode?: FTCompMode;
  monthlySalary?: number;
  annualSalary?: number;
  hourlyRate?: number;
  baseMonthlyHours: number;
}

export interface MonthRow {
  id: string;
  label: string;
  personAllocations: Record<string, number>;
  expenses: number;
  revenue: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  projectType: ProjectType;
  overheadPerHour: number;
  targetMarginPct: number;
  startMonthISO: string;
  memberIds: string[];
  months: MonthRow[];
  updatedAt: number;
}

export interface TotalsResult {
  totalHours: number;
  laborCost: number;
  overheadCost: number;
  expenses: number;
  allIn: number;
  revenue: number;
  profit: number;
  margin: number;
}

