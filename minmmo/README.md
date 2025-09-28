## MMO Browser Game

The repository includes a browser-based admin CMS for editing gameplay data. Follow the [Admin Portal Guide](docs/admin-portal-guide.md) for detailed instructions on launching the tool, understanding each tab, and troubleshooting validation issues.

### Backend API

The `server/` workspace hosts an Express API that persists config and save data to PostgreSQL.

1. Set the required environment variables (at minimum `DATABASE_URL` or individual `PG*` variables).
2. Apply database migrations:

   ```bash
   npm run db:migrate
   ```

3. Start the API locally:

   ```bash
   npm run server
   ```

   The server listens on `http://localhost:3001` by default and exposes REST endpoints under `/api` for configs, accounts, characters, and merchants.

During development, Vite proxies any request that starts with `/api` to the backend. If you need to point the front-end at a remote API, set `VITE_API_PROXY` before starting Vite.

Deployment guidance (including Docker and Portainer usage) is available in [docs/server-deployment.md](docs/server-deployment.md).