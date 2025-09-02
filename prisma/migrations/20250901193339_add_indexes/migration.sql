-- CreateIndex
CREATE INDEX "Allocation_monthId_idx" ON "Allocation"("monthId");

-- CreateIndex
CREATE INDEX "Allocation_personId_idx" ON "Allocation"("personId");

-- CreateIndex
CREATE INDEX "Month_projectId_idx" ON "Month"("projectId");

-- CreateIndex
CREATE INDEX "ProjectMember_personId_idx" ON "ProjectMember"("personId");
