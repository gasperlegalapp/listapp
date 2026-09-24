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
| `scripts/import-templates.ts` | Parses `SHEETS` out of the reference HTML into the version 1 templates |
| `templates/*.v1.json` | The generated version 1 templates, one per checklist, for review |
| `supabase/migrations/` | Schema, row-level security, triggers, storage, template seed |
| `supabase/tests/` | Database tests: every RLS rule and trigger (`npm run test:db`) |
| `tests/unit/` | Template conversion and validation, and the PDF's static markup (`npm run test:unit`) |
| `tests/e2e/` | Browser tests against a running app (`npm run test:e2e`) |
| `styles/checklists.css` | House CSS, verbatim from the reference |
| `proxy.ts`, `lib/auth.ts` | Session refresh, lifetime, and the server-side gate every page uses |
| `app/login`, `app/auth`, `app/account` | Sign-in, reset, invite acceptance, two-step sign-in |
| `app/(app)` | The signed-in app: matters (`/`), a matter (`/cases/<id>`), a list (`/l/<id>`) |
| `components/checklist/` | The form: `sheet.tsx` renders a template version (for the form and the PDF), field-level autosave, history, photos |
| `lib/templates/` | Template types, totals, the BusinessMap summary, history labels, and `convert`/`validate`/`outline` for publishing new versions |
| `lib/pdf/` | The PDF: static markup, embedded fonts, headless Chromium |
| `app/(app)/l/[id]/pdf` | `/l/<id>/pdf`, the PDF download |
| `app/(app)/files/[id]` | `/files/<id>`, a short signed redirect to a photo or document |
| `app/(app)/admin` | Users, checklist versions (`/admin/templates`), the delete log (`/admin/deleted`) |

## Build order

1. Foundation: schema, RLS, login, invites, roles. **Done.**
2. Templates: import script, six templates seeded and versioned. **Done.**
3. Matters and lists: create a matter, create a list, `/l/<id>` resolves. **Done.**
4. The form: render from template JSON, autosave, history. **Done.**
5. Output: copy for BusinessMap, print, PDF, photos. **Done.**
6. Admin: users, template versions, delete log. **Done.**

## Changing a checklist

Admins: **Checklists** in the top bar. Edit the master checklist HTML file
(the `SHEETS`, `MATTER` and `SIGNOFF` data), upload it, read the change
outline, and publish. Each changed checklist becomes the next version. Lists
already made keep the version they were made with; new lists get the new one.
The page refuses a file that would move the Matter fields the matter record
fills, and asks for an explicit confirmation when a standing warning changes.

## Rules the code keeps

- Field keys are positional (`s03_f02`, `s06_t1_r2_c1`), never label-based.
- Templates are never edited; a revision is a new row with `version + 1`,
  and Postgres refuses an in-place update.
- Every field change is a `revisions` row, written by a trigger.
- Nothing is hard-deleted. Deletes are soft, attorney/admin only, logged, and
  can be undone from the delete log.
- Photos go from the browser straight to Storage on a one-time signed URL
  (Vercel caps request bodies at 4.5 MB); the server signs, then verifies
  and records each one. Nobody can read a file without a live attachments
  row they can see.
- ASCII only in code and content.
