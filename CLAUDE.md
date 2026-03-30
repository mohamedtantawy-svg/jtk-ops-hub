# Claude Code — Project Guidelines

## Tech Stack (non-negotiable)

| Layer     | Technology          |
|-----------|---------------------|
| Framework | **Next.js** (App Router) |
| Database  | **PostgreSQL** only  |
| ORM       | **Sequelize** only   |
| Language  | **TypeScript** (strict) |

Do not introduce alternative frameworks, databases, or ORMs. If a library conflicts with this stack, find a compatible one or raise it with the team.

---

## Code Style

- Prefer explicit types — avoid `any`; use `unknown` and narrow it
- Keep functions small and single-purpose
- No dead code, commented-out blocks, or unused imports
- Use `async/await` over raw Promise chains
- Avoid over-engineering: no abstractions for one-time use, no premature generalization

---

## Security

- Never hardcode secrets, tokens, or credentials — use environment variables
- Validate all external input at API boundaries (user input, webhooks, query params)
- Sanitize before interpolating into queries — never build raw SQL strings
- Do not log sensitive data (tokens, passwords, PII)
- Keep dependencies up to date; flag known-vulnerable packages

---

## Sequelize Patterns

- Use **migrations** for all schema changes — never `sync({ force: true })` in production
- Define models with explicit column types and constraints
- Use transactions for multi-step writes
- Use `findOne` / `findAll` with explicit `where`, never rely on implicit filtering
- Associations must be declared in both directions

```ts
// correct
await User.findOne({ where: { id, organizationId } });

// wrong — missing scope
await User.findByPk(id);
```

---

## Next.js Patterns

- Use the **App Router** (`app/` directory) — no Pages Router additions
- API routes live in `app/api/` and must always validate the session first
- Use `getServerSession` for auth — never trust client-passed user IDs
- Prefer server components; use `"use client"` only when interactivity is required
- Do not fetch data in client components if it can be done server-side

---

## Git Workflow

- Use **Conventional Commits**: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`
- One logical change per commit — do not bundle unrelated changes
- Never commit directly to `main` or `dev` — open a pull request
- Never skip pre-commit hooks (`--no-verify`)
- Never force-push to shared branches

---

## Error Handling

- API routes must return structured JSON errors with appropriate HTTP status codes
- Do not swallow errors silently — log them with enough context to debug
- Use try/catch around all external calls (GitHub API, DB, third-party services)
- Surface partial failures in the response rather than masking them

## What NOT to do

- Do not add features beyond what was asked
- Do not refactor surrounding code unless it directly blocks the task
- Do not add docstrings or comments to code you did not change
- Do not create helper utilities for one-off operations
- Do not add backwards-compatibility shims for removed code