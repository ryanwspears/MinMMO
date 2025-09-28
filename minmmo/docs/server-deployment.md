# Server Deployment Guide

This document explains how to build, deploy, and operate the Express + PostgreSQL backend that lives in the `server/` workspace.

## Environment Variables

The API reads PostgreSQL credentials from standard environment variables. Either provide a full connection string via `DATABASE_URL` or individual values using the `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` variables. Optional tuning knobs include `DATABASE_POOL_MAX` and `DATABASE_IDLE_TIMEOUT_MS`.

## Database Migrations

The repository ships with SQL migrations in `server/migrations`. They can be applied locally or in CI/CD using the npm script:

```bash
npm run db:migrate
```

Run the script with the same environment variables that the server will use so that migrations target the correct database. The helper creates a `schema_migrations` table to ensure each migration is only applied once.

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Ensure the `DATABASE_URL` points at a reachable PostgreSQL instance.
3. Apply migrations: `npm run db:migrate`.
4. Start the API: `npm run server` (defaults to port `3001`).

The Vite front-end is configured to proxy `/api/*` requests to `http://localhost:3001`, so the UI and API can run side-by-side.

## Docker Image

A Dockerfile is available at `server/Dockerfile`. Build and run it locally with:

```bash
docker build -t minmmo-api -f server/Dockerfile .
docker run --rm -p 3001:3001 \
  -e DATABASE_URL=postgres://user:pass@host:5432/minmmo \
  minmmo-api
```

> **Tip:** Run `npm run db:migrate` (either on the host or in a one-off container) before starting the API to ensure the database schema exists.

## Portainer Deployment

1. Push the `minmmo-api` image to a registry reachable by Portainer (e.g., Docker Hub, GHCR).
2. In Portainer, create a new stack or container:
   - Set the image to the pushed tag.
   - Publish container port `3001` to your preferred host port.
   - Define environment variables for database connectivity (`DATABASE_URL` or individual `PG*` vars).
3. (Optional) Add a stack service or scheduled job that runs `npm run db:migrate` against the same image to keep schema up to date.
4. Deploy the stack. Portainer will handle starting and monitoring the container.

With the stack running, point the front-end (in Vite via `VITE_API_PROXY` or in production via reverse proxy rules) to the exposed host/port so it can communicate with the API.
