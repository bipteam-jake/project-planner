-- CreateTable
CREATE TABLE "ProjectWeek" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "bdNeeded" BOOLEAN NOT NULL DEFAULT false,
    "bdNotes" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ProjectWeek_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Todo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectWeekId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "dueDate" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Todo_projectWeekId_fkey" FOREIGN KEY ("projectWeekId") REFERENCES "ProjectWeek" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TodoAssignee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "todoId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    CONSTRAINT "TodoAssignee_todoId_fkey" FOREIGN KEY ("todoId") REFERENCES "Todo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TodoAssignee_personId_fkey" FOREIGN KEY ("personId") REFERENCES "RosterPerson" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectWeekOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekKey" TEXT NOT NULL,
    "order" JSONB NOT NULL
);

-- CreateIndex
CREATE INDEX "ProjectWeek_weekKey_idx" ON "ProjectWeek"("weekKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWeek_projectId_weekKey_key" ON "ProjectWeek"("projectId", "weekKey");

-- CreateIndex
CREATE INDEX "TodoAssignee_personId_idx" ON "TodoAssignee"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "TodoAssignee_todoId_personId_key" ON "TodoAssignee"("todoId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWeekOrder_weekKey_key" ON "ProjectWeekOrder"("weekKey");
