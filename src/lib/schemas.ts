import { z } from "zod";

export const PersonTypeSchema = z.enum([
  "Full-Time",
  "FT Resource",
  "Part-Time",
  "PT Resource",
  "Contractor",
]);

export const DepartmentSchema = z.enum([
  "C-Suite",
  "BD",
  "Marketing",
  "Product",
  "Engineering",
  "Ops",
  "Software",
  "Admin",
  "Other",
]);

export const FTCompModeSchema = z.enum(["monthly", "annual"]);

export const ProjectStatusSchema = z.enum([
  "Test",
  "BD",
  "Active",
  "Completed",
  "Cancelled",
]);

export const RosterPersonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  personType: PersonTypeSchema,
  department: DepartmentSchema,
  compMode: FTCompModeSchema.optional(),
  monthlySalary: z.number().int().optional(),
  annualSalary: z.number().int().optional(),
  hourlyRate: z.number().optional(),
  baseMonthlyHours: z.number().int().nonnegative(),
  isActive: z.boolean().default(true),
  inactiveDate: z.string().optional(),
});

export const MonthRowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  personAllocations: z.record(z.string(), z.number()),
  expenses: z.number(),
  revenue: z.number(),
});

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  status: z.string().default(""),
  projectStatus: ProjectStatusSchema,
  overheadPerHour: z.number(),
  targetMarginPct: z.number(),
  startMonthISO: z.string().min(1),
  memberIds: z.array(z.string()),
  months: z.array(MonthRowSchema),
  updatedAt: z.number().optional(),
});

export type ProjectInput = z.infer<typeof ProjectSchema>;
export type RosterPersonInput = z.infer<typeof RosterPersonSchema>;

