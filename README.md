# TaskSpace

TaskSpace is a full-stack web application built with Node.js, Express and SQLite. It combines task management with additional workspace tools for media, community interaction, stock analysis and other productivity features.

## Features

TaskSpace includes the following modules:

- **User accounts:** Registration, login and authenticated sessions.
- **Task management:** Create, update, complete, search and organize tasks.
- **Media library:** Upload and manage supported media and document files.
- **Forum:** Community discussions and social features.
- **Private messaging:** Communication between registered users.
- **Stock analysis:** Market information, company fundamentals, technical indicators and watchlists.
- **Stock alerts:** Stock-related alert functionality.
- **Shop:** A shop module.
- **YouTube watcher:** A module for monitoring YouTube content.
- **Technical analysis:** Additional stock-analysis tools.
- **Assistant interface:** A visual assistant widget. AI response integration is not currently included.

Feature availability may depend on configuration and external service availability.

## Technology

- Node.js 24
- Express 5
- SQLite
- better-sqlite3
- express-session
- bcryptjs
- Helmet
- Finnhub API
- yahoo-finance2

## Requirements

- Node.js 24 or compatible supported version.
- npm.
- Windows, Linux or macOS.
- A modern web browser.
- Internet access for features that use external services.

The project has been developed and tested with Node.js 24.

## Installation

### 1. Obtain the source code

Extract the TaskSpace source-code package into a folder.

Open PowerShell or a terminal in that folder.

### 2. Install dependencies

Recommended installation:

```bash
npm ci
```

This installs dependencies using the versions recorded in `package-lock.json`.

If you are developing the project and need to update dependencies, you can use:

```bash
npm install
```

### 3. Configure environment variables

Create your local environment file.

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
```

Generate a secure random session secret:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Copy the generated value into the `SESSION_SECRET` setting in `.env`.

Example configuration:

```env
NODE_ENV=development
PORT=3000
SESSION_SECRET=replace-with-your-generated-secret
FINNHUB_API_KEY=your-finnhub-api-key
```

The session secret must be unique and at least 32 characters long.

The Finnhub API key is optional for general application startup but required for features that depend on Finnhub data.

Never publish `.env` or share its secrets.

### 4. Start TaskSpace

Run:

```bash
npm start
```

Open the application in your browser:

http://localhost:3000

To stop the server, press `Ctrl+C` in the terminal.

## Development

To start the application in watch mode:

```bash
npm run dev
```

## Tests

Run the automated test suite:

```bash
npm test
```

The tests cover backend functionality and security-related behavior, including health checks, authentication, task operations, user isolation and session persistence.

## Database

TaskSpace uses SQLite through better-sqlite3.

The default database location is:

```text
data/taskspace.db
```

The database and required tables are created automatically when the application initializes.

### Session storage

TaskSpace uses a custom SQLite-backed session store through express-session.

Login sessions are stored in the `sessions` table in the same SQLite database as the application data. Authenticated sessions can survive application server restarts.

To preserve existing sessions across restarts:

- Keep the same SQLite database file.
- Keep the same `SESSION_SECRET`.
- Ensure the session cookie has not expired.
- Keep the database on persistent storage.

Changing `SESSION_SECRET` invalidates existing login sessions. Users will need to log in again.

The session store is designed for a single application instance. Multi-instance deployments require additional architectural review and appropriate shared-session and database infrastructure.

### Database backups

Stop the application before making a manual database backup.

Copy the database to a secure backup location. Keep backups private and do not include personal database files in a public source-code release.

## External services

Some features depend on external data providers.

- **Finnhub:** Requires an API key for supported stock-market data.
- **Yahoo Finance:** The project uses the yahoo-finance2 package for certain market-data functionality.

External services may have their own usage limits, availability restrictions and terms.

Operators should obtain and configure their own credentials where required and review the applicable provider terms.

TaskSpace does not include third-party API credentials.

## Security and deployment

The project includes authentication, password hashing, authenticated routes, security headers and request-size limits.

Before deploying a purchased copy to a public production environment, the operator should review and configure:

- HTTPS and secure production cookies.
- Persistent storage for the SQLite database, including the `sessions` table.
- Rate limiting and abuse protection.
- Database backup and recovery procedures.
- File-upload security and storage limits.
- Environment secrets and server permissions.
- External API terms and credentials.

The deployment operator remains responsible for configuring HTTPS, protecting secrets, maintaining persistent storage and testing backup recovery.

## Project structure

The source-code package should contain the application source, frontend files, tests and package configuration.

```text
taskspace/
├── public/
├── src/
├── test/
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
```

The following are generated or locally configured files and should not be included in a public source-code package:

- `.env`
- `data/` and personal SQLite databases
- `node_modules/`
- Backups and temporary files
- Private API credentials
- Personal uploads and user data

The application creates its database and required runtime data when initialized.

## Source-code ownership and third-party components

TaskSpace contains open-source dependencies and integrations with external services.

Before redistribution or commercial deployment, review the licenses of included dependencies, third-party components and any bundled assets.

Do not redistribute private user data, API credentials, environment secrets or personal database files.

## Support and customization

TaskSpace can be extended with additional modules, integrations, security improvements and interface enhancements.

Deployment, hosting, maintenance and external service costs are separate considerations for the operator.