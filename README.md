# Home & Nutri Hub

A shared web app for two people (Irene & Akbar): weekly meal planning, recipes, a grocery list, a pantry tracker, and an expense tracker with customizable categories. No login — everything is saved to a shared Supabase project and visible to both profiles at once.

## Stack

- React + Vite, Tailwind CSS v4
- Supabase (Postgres) as the data store — no Supabase Auth, no per-user accounts
- React Router for navigation

## Setup

1. Copy `.env.example` to `.env` and fill in the Supabase URL/anon key.
2. Run the database migration once: open the Supabase Dashboard → SQL Editor and run `supabase/schema.sql`.
3. `npm install`
4. `npm run dev`

## Deployment (GitHub Pages)

Pushing to `main` builds and publishes the site automatically via `.github/workflows/deploy.yml`. One-time setup in the GitHub repo:

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Settings → Secrets and variables → Actions → add repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values as your local `.env`).

The site is served from a subpath (`/NUTRIHUB/`), so routing uses `HashRouter` and `vite.config.js` sets `base: '/NUTRIHUB/'` — keep both in sync if the repo is ever renamed.

## Structure

- `src/pages/` — one file per section (Planner, Profiles, Recipes, Grocery, Expenses, Pantry)
- `src/hooks/` — data-fetching/CRUD hooks per Supabase table
- `src/components/` — layout shell and small reusable UI primitives
- `supabase/schema.sql` — the full database schema
