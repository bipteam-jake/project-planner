// src/lib/repo.ts
import { Project, RosterPerson, ProjectType, Department } from "@/lib/storage";

/**
 * Stable keys. Update these ONLY if you also migrate existing data.
 * These should match whatever your app originally used.
 */
const PROJECTS_KEY = "bip_projects_v1";
const ROSTER_KEY   = "bip_roster_v1";

/** Optional: legacy keys we’ll look for and migrate once. */
const LEGACY_KEYS = [
  "projects",
  "roster",
  "bip_projects",
  "bip_roster",
] as const;

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

/** One-time migration from any legacy key that has data. */
function migrateIfNeeded() {
  // If both new keys exist, nothing to do.
  const haveNewProjects = !!localStorage.getItem(PROJECTS_KEY);
  const haveNewRoster   = !!localStorage.getItem(ROSTER_KEY);
  if (haveNewProjects && haveNewRoster) return;

  // Try to find legacy payloads
  let migrated = false;

  if (!haveNewProjects) {
    for (const k of LEGACY_KEYS) {
      const data = k.includes("project") ? readJSON<Project[]>(k) : null;
      if (data && Array.isArray(data) && data.length >= 0) {
        writeJSON(PROJECTS_KEY, data);
        migrated = true;
        break;
      }
    }
  }

  if (!haveNewRoster) {
    for (const k of LEGACY_KEYS) {
      const data = k.includes("roster") ? readJSON<RosterPerson[]>(k) : null;
      if (data && Array.isArray(data) && data.length >= 0) {
        writeJSON(ROSTER_KEY, data);
        migrated = true;
        break;
      }
    }
  }

  if (migrated) {
    // Optional: mark a simple schema version you can extend later
    localStorage.setItem("bip_schema_version", "1");
  }
}

export interface Repo {
  loadProjects(): Project[];
  saveProjects(p: Project[]): void;
  loadRoster(): RosterPerson[];
  saveRoster(r: RosterPerson[]): void;
}

export const localStorageRepo: Repo = {
  loadProjects(): Project[] {
    migrateIfNeeded();
    const projects = readJSON<Project[]>(PROJECTS_KEY) ?? [];
    
    // Migrate projects that don't have projectType field
    let needsMigration = false;
    const migratedProjects = projects.map(project => {
      // Check if projectType is missing or invalid
      if (!project.projectType || typeof project.projectType !== 'string') {
        needsMigration = true;
        return { ...project, projectType: 'Active' as ProjectType };
      }
      return project;
    });
    
    // If we migrated any projects, save them back
    if (needsMigration) {
      console.log('Migrating projects to add projectType field');
      writeJSON(PROJECTS_KEY, migratedProjects);
    }
    
    return migratedProjects;
  },
  saveProjects(p: Project[]): void {
    writeJSON(PROJECTS_KEY, p);
  },
  loadRoster(): RosterPerson[] {
    migrateIfNeeded();
    const roster = readJSON<RosterPerson[]>(ROSTER_KEY) ?? [];
    
    // Migrate roster that don't have department field
    let needsMigration = false;
    const migratedRoster = roster.map(person => {
      // Check if department is missing or invalid
      if (!person.department || typeof person.department !== 'string') {
        needsMigration = true;
        return { ...person, department: 'Other' as Department };
      }
      return person;
    });
    
    // If we migrated any people, save them back
    if (needsMigration) {
      console.log('Migrating roster to add department field');
      writeJSON(ROSTER_KEY, migratedRoster);
    }
    
    return migratedRoster;
  },
  saveRoster(r: RosterPerson[]): void {
    writeJSON(ROSTER_KEY, r);
  },
};
