-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "projectType" TEXT NOT NULL,
    "overheadPerHour" REAL NOT NULL,
    "targetMarginPct" REAL NOT NULL,
    "startMonthISO" TEXT NOT NULL,
    "memberIds" JSONB NOT NULL,
    "months" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RosterPerson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "personType" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "compMode" TEXT,
    "monthlySalary" INTEGER,
    "annualSalary" INTEGER,
    "hourlyRate" REAL,
    "baseMonthlyHours" INTEGER NOT NULL
);
