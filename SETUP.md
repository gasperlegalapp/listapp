# Setting up List App

This walks through everything outside the code: Supabase (database and
sign-in), Resend (email), Vercel (hosting), and your domain. Do the steps in
order. Budget about two hours, most of it waiting on DNS.

Keep a password manager open. You will collect several secrets along the way;
none of them ever go into the repo, into email, or into chat.

---

## 0. Accounts and what they cost

| Service | Plan | Why that plan | Roughly |
|---|---|---|---|
| Supabase | **Pro** | Daily backups, session time limits, leaked-password check, 100 GB of file storage for photos (the free plan has 1 GB). The free plan has no backup you can rely on and pauses idle projects. | $25/month |
| Supabase add-on | Point-in-time recovery (optional) | Restore to any second, not just last night. Spec asks for it; it is the one real extra cost. Needs a larger compute size too. | check current pricing, ~$100+/month |
| Vercel | **Pro** | Vercel's free Hobby plan is for non-commercial use only; a law firm is commercial. | $20/user/month (you need one user) |
| Resend | Free | 3,000 emails/month, 100/day. Invites and resets only. | $0 |
| Domain | Your existing DNS host | You add a few records for `lists.gasperlegal.com` and for email. | $0 |

Use firm-owned logins (not personal), and turn on two-factor sign-in for each
of these accounts. Whoever controls these accounts controls the client data.

---

## 1. Create the Supabase project

1. Go to https://supabase.com and sign up with GitHub or a firm email.
2. Create an **organization** named `Gasper Legal`. Choose the **Pro** plan.
3. **New project**:
   - Name: `listapp`
   - Database password: click **Generate a password**, then save it in your
     password manager as "Supabase DB password". You need it in step 3.
   - Region: **East US (Ohio)**.
4. Wait a couple of minutes for it to finish provisioning.
5. Collect these three values into your password manager:
   - **Project ref**: the random string in the dashboard URL,
     `supabase.com/dashboard/project/<this part>`.
   - **Project URL**: Project Settings -> **API** (or Data API) ->
     `https://<ref>.supabase.co`.
   - **Keys**: Project Settings -> **API Keys**.
     - The **publishable** key (`sb_publishable_...`).
     - A **secret** key (`sb_secret_...`). If none exists, click
       **Create new secret key** and name it `vercel`. Use the new-style key,
       not the legacy `service_role` one: the login rate limiting below
       needs the new style.

---

## 2. Put the code on `main`

Vercel deploys from the `main` branch and the database workflow runs from it,
so the pull request with this code has to be merged first. On GitHub:
**Pull requests** -> open the List App PR -> **Merge pull request**.

(If `main` does not exist yet, ask me to create it; it is a one-time step.)

---

## 3. Let GitHub apply the database schema

The tables, security rules, and the six checklists live in
`supabase/migrations/`. A GitHub Action applies them to your Supabase
project every time they change on `main`. Nobody edits the schema by hand in
the dashboard.

1. Create a Supabase access token: https://supabase.com/dashboard/account/tokens
   -> **Generate new token** -> name it `github-actions` -> copy it.
2. In GitHub, open the `listapp` repo -> **Settings** -> **Secrets and
   variables** -> **Actions** -> **New repository secret**. Add three:
   - `SUPABASE_ACCESS_TOKEN` = the token from step 1
   - `SUPABASE_DB_PASSWORD` = the database password from section 1
   - `SUPABASE_PROJECT_ID` = the project ref from section 1
3. Go to the **Actions** tab -> **Deploy database migrations** -> **Run
   workflow** -> **Run workflow**. It first re-runs the security tests against
   a scratch database, then applies the migrations. Both jobs should go green.
4. Check it worked: in Supabase, **Table Editor** should list `cases`,
   `instances`, `templates` and the rest, and `templates` should have six rows.

---

## 4. Supabase sign-in settings

All under **Authentication** in the Supabase dashboard. Menu names move
around occasionally; if one is not where described, use the dashboard search.

1. **Sign In / Providers** (sometimes "Providers" -> Email):
   - **Allow new users to sign up**: **off**. Accounts come only from invites.
   - Email provider: **on**.
   - **Email OTP expiration**: `86400` seconds (24 hours), so an invite sent
     in the evening still works the next morning.
   - **Minimum password length**: `12`.
   - **Prevent use of leaked passwords**: **on**.
   - **Secure password change**: **on**.
2. **Multi-Factor**: TOTP (authenticator app) **enabled**. It is on by
   default. Turning it on here does not force anyone to use it; see section 9.
3. **Sessions**: **Time-box user sessions**: `72` hours. This is a server-side
   backstop for the app's own rule (3 days with "keep me signed in", 12 hours
   without).
4. **Rate Limits** / **Attack Protection**: if you see an option to forward or
   trust the client IP address (`Sb-Forwarded-For`), turn it on. Without it,
   Supabase sees every sign-in as coming from Vercel's servers.
5. **URL Configuration**: **Site URL** = `https://lists.gasperlegal.com`
   (whatever you pick in section 6).
6. **Emails** -> **SMTP Settings**: fill in after section 5 so any email
   Supabase itself sends goes through Resend too:
   host `smtp.resend.com`, port `465`, username `resend`, password = your
   Resend API key, sender `lists@mail.gasperlegal.com`, name `Gasper Legal`.

Then **Database** -> **Backups**: confirm daily backups are listed. If you
want point-in-time recovery, enable it here (it prompts for the compute
upgrade it needs).

---

## 5. Email through Resend

The app sends invites and password resets itself through Resend, so a failed
send shows up as an error in the admin screen instead of vanishing.

1. Sign up at https://resend.com with a firm email.
2. **Domains** -> **Add Domain** -> `mail.gasperlegal.com`. Using a subdomain
   keeps this separate from your normal firm email.
3. Resend shows three or four DNS records (MX, SPF `TXT`, DKIM `TXT`). Add
   each one at your DNS host exactly as shown, then click **Verify**. It can
   take from minutes to a few hours.
4. **API Keys** -> **Create API Key** -> name `listapp`, permission
   **Sending access**, domain `mail.gasperlegal.com`. Copy it into your
   password manager.

---

## 6. Deploy on Vercel

1. Sign up at https://vercel.com **with the GitHub account that owns
   `gasperlegalapp`**. Choose **Pro**.
2. **Add New** -> **Project** -> import `gasperlegalapp/listapp`. Vercel
   detects Next.js; leave the build settings alone.
3. Before clicking Deploy, open **Environment Variables** and add, for
   **Production** and **Preview**:

   | Name | Value | Sensitive |
   |---|---|---|
   | `SUPABASE_URL` | `https://<ref>.supabase.co` | |
   | `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | |
   | `SUPABASE_SECRET_KEY` | `sb_secret_...` | yes |
   | `RESEND_API_KEY` | `re_...` | yes |
   | `EMAIL_FROM` | `Gasper Legal <lists@mail.gasperlegal.com>` | |
   | `APP_URL` | `https://lists.gasperlegal.com` | |
   | `MFA_REQUIRED` | `false` | |

4. **Deploy**. The first build takes a couple of minutes.
5. **Settings** -> **Domains** -> add `lists.gasperlegal.com`. Vercel shows a
   `CNAME` record; add it at your DNS host. Vercel issues the HTTPS
   certificate on its own once DNS resolves.
6. Functions already run in Cleveland (`vercel.json`), next to the Ohio
   database. The Node.js version is pinned to 22 in `package.json`; leave the
   project's Node setting alone.
7. Nothing to set up for PDFs: the download route brings its own headless
   Chromium. The first PDF after a quiet spell takes a few seconds longer
   while it unpacks.

From now on every merge to `main` deploys automatically.

---

## 7. Create the first admin (you)

1. Supabase -> **Authentication** -> **Users** -> **Add user** -> **Create new
   user**. Your email, a strong password (12+ characters), tick **Auto
   Confirm User**.
2. Supabase -> **SQL Editor** -> **New query**, paste this with your email,
   and **Run**:

   ```sql
   insert into public.profiles (id, email, full_name, role)
   select id, lower(email), 'Christopher Gasper', 'admin'
   from auth.users where email = 'you@gasperlegal.com'
   on conflict (id) do update set role = 'admin', full_name = excluded.full_name;
   ```

   It should report `1 row`. This is the only time anyone edits data by hand.
3. Open `https://lists.gasperlegal.com`, sign in, and you should see the six
   checklist cards and a **Users** link.

---

## 8. Invite staff

**Users** -> fill in name, email, role -> **Send invite**. They get an email
from `lists@mail.gasperlegal.com` with a **Set your password** button. The
link works once and expires in 24 hours; **Resend invite** sends a fresh one.

If an invite fails, the error names the reason. Almost always it is the Resend
domain not being verified yet (section 5.3).

Roles: **admin** (everything, including users and templates), **attorney**
(all matters and lists, can delete and revert), **staff** (all matters and
lists, create and edit, cannot delete).

Leavers: **Deactivate**. They are signed out and blocked, and their history
stays. Never delete users in the Supabase dashboard; the database refuses it
once they have edited anything.

---

## 9. Turning on two-step sign-in for everyone

When you are ready: Vercel -> **Settings** -> **Environment Variables** ->
set `MFA_REQUIRED` to `true` -> **Deployments** -> **Redeploy** the latest.
At their next sign-in, everyone is walked through adding an authenticator
app. Anyone can turn it on for themselves before then from their name in the
top bar. If someone loses their phone, an admin clicks **Reset 2-step** on
the Users page.

---

## 10. Before real client data goes in

- [ ] Supabase is on Pro and **Database -> Backups** shows daily backups.
- [ ] Point-in-time recovery decided (on, or consciously off).
- [ ] Two-factor sign-in on the Supabase, Vercel, Resend, GitHub and DNS
      accounts themselves.
- [ ] Data processing agreements accepted with Supabase, Vercel and Resend
      (each has one in its dashboard or legal pages). If any of this data is
      protected health information you are obliged to protect under HIPAA,
      note that Supabase signs a BAA only on its Team plan.
- [ ] Signups are off (section 4.1) and you have tried signing in with a
      wrong password five times to see the lockout.
- [ ] You have tried a password reset end to end.
- [ ] On a test matter: **Download PDF** gives the six-page GL-A1, and
      **Add photos** works from a phone.

---

## Local development (for whoever maintains the code)

```bash
npm install
cp .env.example .env.local        # fill in from `npx supabase status`
npx supabase start                # local Postgres + auth, needs Docker
npx supabase db reset             # applies supabase/migrations
npm run dev
```

Checks to run before pushing:

```bash
npm run lint && npm run typecheck && npm run build
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres npm run test:db
```

`npm run test:db` creates and drops its own `listapp_test` database. Point it
at a local server only. `npm run test:unit` needs nothing running.
`npm run test:e2e` (see the header of each file in `tests/e2e/`) drives a
real browser through sign-in, invites, lockout, MFA, the lists, PDFs, photo
uploads (it needs the Storage API, which `npx supabase start` runs),
checklist publishing and the delete log. It creates users and publishes
checklist versions, so never point it at production.

On a Mac, PDFs need a local Chrome: set `CHROMIUM_PATH` in `.env.local` (see
`.env.example`). On Linux the bundled Chromium runs as is.

---

## Changing a checklist later

**Checklists** in the top bar (admins only). Edit your master copy of
`Gasper_Legal_Asset_Intake_Checklists.html`, upload it, read what changed,
and publish. Lists already made keep their version; new lists use the new
one. Keep the file you uploaded as the new master.
