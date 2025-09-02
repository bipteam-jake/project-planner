## Local Development

1. Install dependencies: `npm i`
2. Copy env: `cp .env.example .env` (Windows: `copy .env.example .env`)
3. Run DB migrations: `npm run db:migrate`
4. Start the app: `npm run dev`

Open http://localhost:3000 to view the app.

### Resetting the database

- Quick reset: `npm run db` (alias for `npm run db:reset`)
- Explicit reset: `npm run db:reset`
- Fresh migrate from scratch: delete `prisma/dev.db`, then `npm run db:migrate`

## Database (Prisma + SQLite)

- Env var: set `DATABASE_URL` (see `.env.example`). Defaults to `file:./dev.db` under `/prisma`.
- Local migrations: `npm run db:migrate`
- Push schema (no migration): `npm run db:push`
- Reset dev DB: `npm run db:reset`
- Inspect DB: `npx prisma studio`

### Deploy

- Ensure a persistent writable disk for the SQLite file.
- Run migrations on deploy: `npm run prisma:deploy`
- Health check endpoint: `GET /api/health` returns `{ ok: true }` when DB reachable.

### API

- Projects: `/api/projects` (GET, PUT, POST), `/api/projects/[id]` (GET, PUT, DELETE)
- Roster: `/api/roster` (GET, PUT, POST), `/api/roster/[id]` (GET, PUT, DELETE)
- All POST/PUT payloads are validated with Zod. Invalid requests return HTTP 400 with a list of issues.
