/*
  Warnings:

  - You are about to drop the column `memberIds` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `months` on the `Project` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    PRIMARY KEY ("projectId", "personId"),
    CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "RosterPerson" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Month" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "expenses" INTEGER NOT NULL,
    "revenue" INTEGER NOT NULL,
    CONSTRAINT "Month_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monthId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "allocationPct" INTEGER NOT NULL,
    CONSTRAINT "Allocation_monthId_fkey" FOREIGN KEY ("monthId") REFERENCES "Month" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Allocation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "RosterPerson" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "projectType" TEXT NOT NULL,
    "overheadPerHour" REAL NOT NULL,
    "targetMarginPct" REAL NOT NULL,
    "startMonthISO" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Project" ("description", "id", "name", "overheadPerHour", "projectType", "startMonthISO", "status", "targetMarginPct", "updatedAt") SELECT "description", "id", "name", "overheadPerHour", "projectType", "startMonthISO", "status", "targetMarginPct", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Month_projectId_index_key" ON "Month"("projectId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_monthId_personId_key" ON "Allocation"("monthId", "personId");
