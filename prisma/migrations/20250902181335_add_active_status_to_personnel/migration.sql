-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RosterPerson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "personType" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "compMode" TEXT,
    "monthlySalary" INTEGER,
    "annualSalary" INTEGER,
    "hourlyRate" REAL,
    "baseMonthlyHours" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "inactiveDate" TEXT
);
INSERT INTO "new_RosterPerson" ("annualSalary", "baseMonthlyHours", "compMode", "department", "hourlyRate", "id", "monthlySalary", "name", "personType") SELECT "annualSalary", "baseMonthlyHours", "compMode", "department", "hourlyRate", "id", "monthlySalary", "name", "personType" FROM "RosterPerson";
DROP TABLE "RosterPerson";
ALTER TABLE "new_RosterPerson" RENAME TO "RosterPerson";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
