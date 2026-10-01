# architecture-cleaner

Entry for the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/), Coding and Agentic Engineering track. corupta is entering solo with limited hours; Claude does most of the building.

**Working idea:** an agent that restructures a legacy TypeScript repo sliced by technical type (`controllers/`, `services/`, `models/`) into a domain/feature-oriented, Clean-Architecture-style layout, without changing behavior, and proves it didn't.

## Status

Pre-planning (2026-10-01). The go decision is made; no code exists yet. Next comes a full planning session, which owns scope, architecture, requirements and timeline.

[docs/kickoff.md](docs/kickoff.md) holds the feasibility notes, hackathon facts, research, candidate ideas and open questions. It's input for planning, not a set of decisions.

## Decided at kickoff (revisable with a reason)

- Enter the Coding and Agentic Engineering track.
- TypeScript targets only for the hackathon. Revisit if the repo hunt shows good targets are mostly JS.
- Open-source repos with real test suites come first. A private, untested JS repo corupta used to maintain (Sequelize, ~100 models) comes after everything else works.

## Hard constraints

- Deadline **2026-10-30 10:00 PT**. The project must stay testable, free of charge, until judging ends on 2026-12-15.
- Runtime calls to Nebius Token Factory with at least one NVIDIA open model (Nemotron).
- Public repo with an OSS license file and a README that covers setup and highlights the Nemotron usage. Plus a public YouTube video of ≤3 min, and a demo URL or test build.
- Token Factory budget is **~$50 total**, a hard ceiling. Never expose a live endpoint that spends our key.

## Guiding principles (corupta's refactoring experience)

- **Make the bugs obvious. Then resist.** A great refactor makes existing bugs absurdly obvious; fixing them is never part of it.
- One transformation at a time, applied repo-wide, everything else left byte-identical. No rewrites from scratch, no bundled refactors.
- Bugs and smells outside the current step get written down as findings and left in their original form.

## Repo rules

- Never commit target repos here; clone them outside this tree.
- Secrets go in a gitignored `.env`; commit only `.env.example`.
