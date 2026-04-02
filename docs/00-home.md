# ArenaPlay — Documentation Home

> A live multiplayer trivia game show platform built entirely on PubNub.
> Two goals: working MVP demo + SA-level knowledge depth for the PubNub Principal SA interview.

---

## Quick Navigation

| # | Document | What's in it |
|---|---------|-------------|
| [01](01-project-overview.md) | Project Overview | What ArenaPlay is, why it was built |
| [02](02-business-context.md) | Business Context | The real problem, monetization angles, enterprise parallels |
| [03](03-system-architecture.md) | System Architecture | Mermaid diagrams, component breakdown |
| [04](04-pubnub-integration.md) | PubNub Integration | How PubNub is used, what breaks without it |
| [05](05-channel-taxonomy.md) | Channel Taxonomy | Every channel, who publishes, who subscribes |
| [06](06-event-model.md) | Event Model | Every event type with full payload schemas |
| [07](07-auth-strategy.md) | Auth & PAM Strategy | Token grant flow, host vs player tokens |
| [08](08-presence-strategy.md) | Presence Strategy | Why native presence fails at 10K, counter pattern |
| [09](09-persistence-catchup.md) | Persistence & Catch-up | Which channels store history, reconnect flow |
| [10](10-functions-design.md) | PubNub Functions | All 4 functions, design rationale, call budget |
| [11](11-scaling-analysis.md) | Scaling Analysis | Transaction math, 10K → 100K → 1M |
| [12](12-backend-responsibilities.md) | Backend | What FastAPI owns vs PubNub |
| [13](13-frontend-responsibilities.md) | Frontend | UUID persistence, batching, reconnect logic |
| [14](14-implementation-status.md) | Implementation Status | Feature checklist |
| [15](15-qa-strategy.md) | QA Strategy | Test matrix, edge cases |
| [16](16-test-results.md) | Test Results | Execution results |
| [17](17-observability.md) | Observability | How to debug in production |
| [18](18-antipatterns.md) | Anti-Patterns | The 7 things that will get you fired |
| **[19](19-interview-prep.md)** | **SA Interview Prep** | **The briefing doc. Read this before the interview.** |
| [20](20-decision-log.md) | Decision Log | Every architectural choice and why |
| [21](21-open-questions.md) | Open Questions | Unknowns and risks |
| [22](22-skill-usage.md) | Skill Usage | Which Claude skill built what |

---

## Project Status

| Lane | Status |
|------|--------|
| A — Architecture | ✅ Complete |
| B — Backend (FastAPI + Python SDK) | 🔄 In progress |
| C — Frontend (React + JS SDK) | 🔄 In progress |
| D — Code Review | ⏳ Pending B+C |
| E — QA Planning | ⏳ Pending |
| F — Test Execution | ⏳ Pending |
| G — Documentation | 🔄 In progress |

---

## How to Run (Local)

```bash
# Backend
cd arenaplay/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd arenaplay/frontend
npm install
npm run dev        # → http://localhost:5173

# Open two browser windows:
# Window 1: Create a game (host view)
# Window 2: Join with the 6-char code (player view)
```

Keys are loaded from `/Users/adi/PycharmProjects/PubNubProjects/.env` (backend) and `frontend/.env` (frontend).
