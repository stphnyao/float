# Float – Build Plan (Sep 26 – Oct 12 2026)

## 0. Overview
Float lets stable-coin merchants on **Tempo** receive a same-day cash advance (“float”) sized from their historical on-chain sales.  Repayment is an on-chain pull **capped** at *N %* (configurable) of each day’s revenue and enforced by a Tempo **access-key** with a daily spend limit restricted to stable-coin transfers.  The hackathon deliverable is a fully working **demo** that:

1. Creates / funds test wallets on Tempo test-net  
2. Has the *merchant* wallet delegate an access-key (daily cap = 20 USDC.t) to *Float*  
3. Executes an in-cap pull (should **succeed**)  
4. Executes an over-cap pull (should **fail on-chain**)  
5. Shows underwriting metrics (forecast, risk, wash-trade score) for two merchants – one clean, one fake – and declines the fake merchant.

Everything after the access-key flow is ordinary off-chain data-science Python, so **the access-key spike is the riskiest part** and is built first (folder `spike/`).

The schedule below assumes one solo developer (Stephen) but is split into **parallelisable work-streams** so additional agents can jump in at any time.  Each day’s tasks end with **acceptance criteria** ─ if the criteria fail, *tomorrow’s tasks stop until they pass*.

---

## 1. Architecture

Component | Tech | Purpose
---|---|---
Merchant Frontend | Next.js + wagmi | Shows advance offer, calls backend to request advance, displays repayment status
Float API Server | FastAPI (Python) | Serves REST endpoints for onboarding, pulls, risk scores
Data-Science Core | Python, pandas, scikit-learn | Sales forecasting, default probability, wash-trade detection
Blockchain Module | `pytempo` SDK (fallback: TypeScript + `@tempo/sdk`) | Creates access-keys, sends pulls, reads on-chain sales
Postgres | Supabase free tier | Stores merchants, advances, repayments, model outputs
Queue / Jobs | Celery (RabbitMQ on CloudAMQP free tier) | Daily cron to compute cap, schedule pulls
Infra | Docker Compose | Local dev; deploy to Fly.io if time allows

### Data Flow
1. Merchant connects wallet ↦ Frontend → API `/onboard`  
2. API reads on-chain sales ↦ Data-science → score + forecast  
3. API returns advance offer; merchant signs Tempo access-key  
4. Daily job calls chain to pull repayment; chain enforces cap.

### Repo Layout
```
/
 ├─ README.md
 ├─ PLAN.md            ← this file
 ├─ DISCLOSURE.md
 ├─ .gitignore / .env.example
 ├─ spike/             ← riskiest-piece prototype
 │   ├─ pull_test.py
 │   └─ RESULTS.md
 ├─ backend/
 │   ├─ app/ (FastAPI)
 │   ├─ models/
 │   └─ jobs/
 ├─ frontend/
 │   ├─ components/
 │   └─ pages/
 └─ infra/ (docker-compose, Fly.io, db migrations)
```

---

## 2. Day-by-Day Schedule

Date | Milestones & Tasks | Acceptance Criteria
---|---|---
**Sat Sep 26** | • Write PLAN.md, DISCLOSURE.md, update README  
• Spike: get pytempo SDK talking to Tempo test-net, fund 2 wallets via faucet, hard-code keys in `.env`  | PLAN.md committed; `spike/RESULTS.md` shows funded wallets & network ping
**Sun Sep 27** | • Implement access-key creation in Python  
• Test in-cap & over-cap pull; record tx hashes  | RESULTS.md says **PASS** with explorer links
**Mon Sep 28** | BACKSTOP: If access-key flow blocked → switch to TS SDK or manual contract calls; update risks section  | Over-cap rejection reproduced in any language
**Tue Sep 29** | Start FastAPI skeleton; endpoints `/onboard`, `/advance`, `/repayments`  | `docker compose up backend` returns 200 OK on `/healthz`
**Wed Sep 30** | Data pipelines: pull on-chain sales into Postgres (subgraph or RPC)  | At least 30 days of sample data for test merchant stored
**Thu Oct 1** | Underwriting model v1 (simple ARIMA + logistic)  | API returns advance size & risk score
**Fri Oct 2** | Next.js frontend skeleton w/ wallet connect  | Home page loads, wallet connect pops up
**Sat Oct 3** | Integrate offer & signature flow (Tempo access-key)  | Test merchant signs key from frontend
**Sun Oct 4** | Daily job to pull repayment & store TX result  | Manual run successfully records repayment
**Mon Oct 5** | Wash-trade detection heuristic implemented  | Fake merchant declined with reason list
**Tue Oct 6** | Polish demo flow, seed DB with example merchants  | One-click script boots full demo locally
**Wed Oct 7** | Record rough screencast of demo, start pitch deck  | Draft videos in `artifacts/`
**Thu Oct 8** | Write GTM, team background, logo, past-work disclosure  | All submission docs exist in `/submission/`
**Fri Oct 9** | Final video recording & editing  | Final mp4 under 3 min
**Sat Oct 10** | Internal freeze / contingency day  | All acceptance tests green
**Sun Oct 11** | Publish weekly update on Colosseum Discord  | Link added to PLAN.md
**Mon Oct 12** | Submit on Devpost & Tempo form before 11:59 pm  | Confirmation emails saved

---

## 3. Parallelisable Work-Streams
1. **Blockchain / Access-Key** – `spike/`, later `backend/blockchain.py`
2. **Data-Science** – forecasting, risk, wash-trade
3. **Backend API** – FastAPI, Postgres models, Celery jobs
4. **Frontend** – Next.js components & flows
5. **Dev Ops** – Docker, Fly.io deploy, CI (GitHub Actions)
6. **Submission Assets** – videos, deck, docs

---

## 4. Demo Script ( ≤ 3 min )
1. Intro slide: *“Float – instant cash for stable-coin merchants”*
2. Show merchant dashboard: yesterday’s sales = 500 USDC.t → advance offer 350 USDC.t (70 %)
3. Merchant clicks “Get Cash”, wallet pops up to sign access-key (daily cap 20)
4. Terminal tail shows blockchain tx link
5. Trigger two repayment pulls: 15 USDC.t (succeeds), 30 USDC.t (rejected – red text shows on-chain error)
6. Switch to fake merchant; attempt onboarding → **Declined** with wash-trade score 0.12 (threshold 0.6)
7. Closing slide + GTM + ask for votes

---

## 5. Submission Checklist (from rules)
- [ ] **Pitch video** 2–3 min (problem, solution, market, team)
- [ ] **Demo video** ≤ 3 min (walkthrough above)
- [ ] **GTM section** in Devpost
- [ ] **Team background** (solo; include affiliations)
- [ ] **Logo** 512×512 png
- [ ] **Past-work disclosure** (none – new code only)
- [ ] **Weekly updates**: at least 2 posts in Discord / CommonRoom
- [ ] **Public GitHub repo** under MIT

---

## 6. Key Risks & Fallbacks
1. **Tempo access-key daily-limit feature hidden / buggy**  
   • Fallback A: Use TypeScript `@tempo/sdk`;  
   • Fallback B: Hard-code a on-chain allowance contract wrapper;  
   • Fallback C: **Switch to idea #2 – Zcash “Shielded Books”**, keep data-science pieces.
2. **Faucet down / no test USDC.t**  
   • Seed via dev ops contact; else mint a dummy ERC-20 fork.
3. **Data-science accuracy weak**  
   • Keep models simple; scoring only has to demo differences.
4. **Time** (solo builder)  
   • Parallelisable streams let Cursor agents assist.

---

## 7. Tempo Docs & Resources Used
- Tempo developer portal: <https://docs.tempo.xyz>
- Access-Key guide: <https://docs.tempo.xyz/access-keys>
- Test-net faucet: <https://faucet.tempo.xyz>
- Explorer: <https://explorer.test.tempo.xyz>
- Python SDK: <https://github.com/tempo-network/pytempo> *(if merged)*

---

*Last updated: 2026-09-26 by Cursor Cloud Agent.*
