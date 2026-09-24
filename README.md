# List App

Gasper Legal's asset, income and budget checklists (GL-A1 to GL-A6) as real,
saved records. Staff open a matter, add a list for each asset, and paste the
list's permanent URL into BusinessMap or Actionstep.

Next.js 16 (App Router) on Vercel, Supabase (Postgres, Auth, Storage). The
look is the firm's reference HTML, ported unchanged.

**Setting it up for the first time: see [SETUP.md](SETUP.md).**

## Where things are

| Path | What |
|---|---|
| `reference/Gasper_Legal_Asset_Intake_Checklists.html` | The source of truth for the forms and the house style |
| `scripts/import-templates.ts` | Parses `SHEETS` out of the reference HTML into versioned templates |
| `templates/*.v1.json` | The generated templates, one per checklist, for review |
| `supabase/migrations/` | Schema, row-level security, triggers, storage, template seed |
| `supabase/tests/` | Database tests: every RLS rule and trigger (`npm run test:db`) |
| `tests/e2e/` | Browser tests against a running app (`npm run test:e2e`) |
| `styles/checklists.css` | House CSS, verbatim from the reference |
| `proxy.ts`, `lib/auth.ts` | Session refresh, lifetime, and the server-side gate every page uses |
| `app/login`, `app/auth`, `app/account` | Sign-in, reset, invite acceptance, two-step sign-in |
| `app/(app)` | The signed-in app |

## Build order

1. Foundation: schema, RLS, login, invites, roles. **Done.**
2. Templates: import script, six templates seeded and versioned. **Done.**
3. Matters and lists: create a matter, create a list, `/l/<id>` resolves.
4. The form: render from template JSON, autosave, history.
5. Output: copy for BusinessMap, print, PDF, photos.
6. Admin: template versions, delete log.

## Rules the code keeps

- Field keys are positional (`s03_f02`, `s06_t1_r2_c1`), never label-based.
- Templates are never edited; a revision is a new row with `version + 1`,
  and Postgres refuses an in-place update.
- Every field change is a `revisions` row, written by a trigger.
- Nothing is hard-deleted. Deletes are soft, attorney/admin only, and logged.
- ASCII only in code and content.
