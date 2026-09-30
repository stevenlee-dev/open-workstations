# Open Workstations

[简体中文](README.md)

Open Workstations is a small, self-hosted application for shared lab seats. Rooms, seat positions, seat categories, and term dates live in a JSON configuration file, so each organization can adapt the map to its own space.

The project was started and is maintained by [@stevenlee-dev](https://github.com/stevenlee-dev). This repository contains a standalone, generic implementation with sample rooms only. It does not contain accounts, application records, or layouts from any operating lab.

## Included in 0.1.0

- Responsive room map driven by `config/site.example.json`.
- Flexible seats with a configurable day limit, rotating seats capped at the end of the selected month, and fixed seats tied to configured terms.
- Local applicant accounts, written applications, optional attachments, and an administrator review queue.
- Multiple pending applications for the same seat. Approval checks overlapping allocations inside a SQLite transaction.
- Session cookies, CSRF checks, password hashing, access-controlled attachments, tests, and a Docker example.

This release is a foundation for adaptation. It does not include institutional single sign-on, SMS verification, email reminders, virus scanning, or an in-browser layout editor. Add an appropriate identity provider and operational controls before using it for real applications.

## Run locally

Node.js 24.15+ is required.

```bash
npm ci
cp .env.example .env
npm run build
npm start
```

Open `http://localhost:4312`. The sample configuration allows self-registration for local testing. To create an administrator, set a temporary `ADMIN_PASSWORD` environment variable (at least 12 characters), run `npm run admin:create -- reviewer "Example Manager"`, and remove the variable afterward. Do not put the password in shell arguments or Git files.

For development, run `npm start` and `npm run dev` in separate terminals, then open `http://localhost:5173`.

Start with [configuration](docs/configuration.md), [deployment](docs/deployment.md), and [architecture](docs/architecture.md). Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [MIT](LICENSE).
