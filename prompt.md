Build Synapse as a production-grade Electron desktop application: a local-AI meeting
intelligence agent with a Supabase-backed cloud data layer, proper IPC architecture,
static frontend export, native OS integration, and zero browser accessibility (no
window ever navigates to a live localhost/browser URL from the renderer).

============================================================
PRODUCT THEME (must stay visible across every screen)
============================================================
Synapse doesn't just summarize meetings — it remembers across meetings via vector
memory, and it refuses to let any AI-drafted commitment (task, deadline, assignee)
reach a real system (Jira/Slack/email) until it's been checked against the actual
transcript. Memory earns it the right to have context; validation earns it the right
to act. Every screen should make both of these visible, not just the summary output.

============================================================
APP SHELL — ELECTRON ARCHITECTURE
============================================================
- Electron main process manages: splash window → backend health check → main window
  → tray/menu/shortcuts → auto-updater. No `fetch()`/`axios`/WebSocket calls are ever
  made directly from the renderer — everything routes through a typed IPC bridge.
- `electron/ipc/channels.ts` — a const registry of every IPC channel name for
  compile-time safety, shared between main and preload.
- `electron/ipc/types.ts` — shared TS interfaces for every IPC request/response.
- `electron/ipc/handlers/` — one handler module per domain: meetings, ingest, memory,
  settings, auth, system (Ollama/Docker/health). Each proxies to the local backend API
  or Supabase as appropriate; ingest and pipeline-progress push updates back to the
  renderer via IPC events, not polling.
- `electron/preload.ts` exposes a single structured `window.synapse` API:
  `synapse.meetings.*`, `synapse.ingest.*`, `synapse.memory.*`, `synapse.settings.*`,
  `synapse.system.*`, `synapse.auth.*`, `synapse.native.*` (file dialog, notifications,
  reveal-in-explorer).
- `electron/services/backend-manager.ts` — forks/manages the Node backend process,
  health-check polling with backoff.
- `electron/services/tray.ts` and `native-notifications.ts` — system tray with quick
  actions (Quick Upload, Recent Meetings, Show/Hide, Quit), and OS-native notifications
  on pipeline completion / items needing review.
- `electron/windows/main-window.ts` + `splash-window.ts` — frameless main window
  (min 1024×768, background `#0B0F14`), small splash window shown during startup that
  closes once the main window is ready.
- Custom title bar (`frontend/src/components/layout/TitleBar.tsx`) — app icon, "Synapse"
  title, drag region (`-webkit-app-region: drag`), min/max/close buttons matching theme.
- Keyboard shortcuts: Ctrl+N (new upload), Ctrl+F (focus memory search), Ctrl+, (settings),
  Ctrl+Q (quit). Standard application menu: File / Edit / View / Window / Help.
- Auto-updater via `electron-updater`, checks on launch.
- Use relative paths (`electron/...`, `frontend/src/...`, `backend/src/...`) everywhere
  in code, comments, and generated docs — never hardcode a developer's local absolute
  filesystem path anywhere in the shipped app or its documentation.

============================================================
FRONTEND CONVERSION — STATIC EXPORT
============================================================
- Next.js with `output: 'export'`, `images: { unoptimized: true }`,
  `trailingSlash: true`. No server components, no `cookies()`, no middleware — auth
  guards move entirely to the renderer via a client-side `useAuth()` hook and redirect.
- Root and dashboard layouts become client components; `next/font/google` is replaced
  with a locally bundled font file or `<link>` tag (won't resolve from `file://`).
- Every component that currently calls `fetch('http://localhost:3001/...')` or uses
  `socket.io-client` is rewired to the equivalent `window.synapse.*` IPC call —
  upload/progress, memory search, settings, Ollama status, action-item approval, etc.
- File uploads use a native file dialog (`window.synapse.native.openFileDialog()`),
  sending a file path over IPC rather than a browser `File` object; drag-and-drop
  remains as a secondary option.

============================================================
AUTHENTICATION & AUTHORIZATION — SUPABASE AUTH
============================================================
- Supabase Auth only (no Firebase — remove any vestigial Firebase references entirely).
- Email/password + OAuth (Google, GitHub). OAuth flows through a popup `BrowserWindow`
  in the main process; session tokens are stored via Electron's `safeStorage`, never
  in renderer-accessible storage.
- Email confirmation on sign-up is DISABLED (Supabase project: Authentication →
  Providers → Email → turn off "Confirm email"). `signUp()` returns an active session
  immediately — no "check your inbox" screen, no pending-confirmation state anywhere
  in the UI. Treat this as a dev-convenience setting to revisit before any real
  multi-user launch, not a permanent decision.
- Introduce a `workspaces`/`teams` table so meetings and action items are scoped per
  team. Map the three original PRD stakeholder types (Project Manager, Engineering
  Lead, Executive) to real roles stored per workspace membership.
- Enforce those roles with Postgres Row Level Security — e.g. Executives see a
  cross-project rollup/risk view, Project Managers see full detail only on projects
  they belong to. This is the actual RBAC mechanism; don't duplicate the logic
  client-side or in the Node backend.

============================================================
DATABASE — SUPABASE POSTGRES + PGVECTOR
============================================================
- Supabase Postgres is the single source of truth for all relational data (Meetings,
  Action Items — with full validation history: draft, flag reason, refinement, final
  validated state, never discarded — Decisions, Blockers), plus vector embeddings for
  cross-meeting memory via the `pgvector` extension. One managed database covers what
  the original PRD split across PostgreSQL + Qdrant.
- Raw audio/video recordings stay on local disk, not uploaded to Supabase — only
  transcript text, extracted structured data, and embeddings sync to the cloud. State
  this split explicitly to the user in Settings.
- If offline: local processing (transcription, extraction, local validation) still
  runs and queues results locally; sync to Supabase automatically once reconnected.
  Never block processing purely because Supabase is unreachable.
- Explicit "Export my data" / "Delete this meeting" actions in Settings, covering both
  the local recording and its synced Supabase records.

============================================================
AI / ML LAYER — OLLAMA (LOCAL)
============================================================
- LLM: Ollama running locally. Default model: qwen2.5:14b (32K context, ~9GB, runs on
  16GB RAM) — strong at structured JSON extraction and instruction-following, which is
  the core job here. Same `ollama pull` command works unchanged on a cloud GPU host
  later if this ever needs to scale beyond one machine. Offer qwen2.5-1m:14b (same
  size, ~986K context) as an alternate for unusually long transcripts or multi-meeting
  context-stuffing, switchable in Settings.
- Build the LLM/transcription connection as a provider abstraction from day one (not
  hardcoded Ollama calls scattered through the codebase), so a user can later swap in
  a different local model or a cloud model without a rewrite.
- Transcription: local/offline via faster-whisper (or whisper.cpp as a lighter option).
- First-launch onboarding must detect whether Ollama is installed/running and the
  default model is pulled; if not, walk the user through installing/pulling it with a
  real screen and progress state — never a silent background check or a crash.

============================================================
VALIDATION GATE — THE MANDATORY SAFETY LAYER
============================================================
The original PRD used Enkrypt AI (cloud-only, no local equivalent). Build two modes:
1. DEFAULT — Local Dual-Model Cross-Check: after the primary model drafts an action
   item, a separate local call (same qwen2.5:14b with an adversarial prompt, or a
   second model like phi-4) checks the draft against the literal transcript and either
   confirms it or produces a specific, human-readable objection ("Priya did not
   confirm this date"). This is what "Validated" vs. "Flagged" means locally.
2. OPTIONAL — Cloud Enhanced Mode: if the user opts in and has internet, route the
   same check through Enkrypt AI's real API as a stronger second opinion. Never the
   default; the app must be fully correct without it.
Nothing reaches Jira/Slack/email until it has a "Validated" status from one of these
two paths. This is non-negotiable — do not weaken it while adapting to local infra.

============================================================
ALL ORIGINAL PRD FEATURES — KEPT IN FULL
============================================================
1. Ingestion — drag-drop or native file picker for a local recording. Async pipeline
   with real per-stage status (Transcribing → Extracting → Cross-referencing memory →
   Validating), since local inference is slower than a cloud API.
2. Intelligence Orchestration — Mastra + LangChain.js coordinate the pipeline exactly
   as originally specified: extract Decisions, Action Items (assignee + deadline),
   Risks/Blockers, cross-meeting dependencies. Runs as the Node backend the Electron
   main process manages via backend-manager.
3. Cross-Meeting Memory — query the vector store (pgvector) before each analysis,
   index new insights back in after.
4. Commitment Validation — see the Validation Gate section above.
5. Autonomous Follow-ups — Jira ticket creation, Slack notifications, AND email
   follow-ups (SendGrid). Keep the email tool (`emailIntegration.ts`) and the
   `sendEmail` tool registration in the follow-up agent — do not remove this without an
   explicit, stated technical reason, since it's a required feature from the original
   PRD. Track dispatch state (external ticket ID + timestamp) before marking an item
   "dispatched," to avoid duplicate-filing on retry/crash.
6. Centralized Dashboard — real-time view of project progress, risks, and follow-up
   status, running inside the Electron shell.

============================================================
CORE INTERACTIVE FEATURES — REQUIRED, NOT OPTIONAL
============================================================
- Clearance Rail — every action item, everywhere it appears, shows its validation
  journey: Extracted → Validated (or → Flagged → Refined → Validated) → Dispatched.
  This is the app's signature visual element.
- Commitment Court — the flagged-item review screen: claimed action item, exact
  transcript snippet it was checked against, and the validator's objection in plain
  language. User acts as judge: Approve / Edit / Reject.
- The Trust Meter — a per-workspace/per-project gauge tracking how often flagged items
  turned out to be real catches vs. false alarms, visibly raising the autonomy level
  (how much can auto-dispatch without review) as trust is earned. Should actually gate
  behavior, not just display a number.
- Blocker Web — a force-directed graph (D3) of cross-meeting dependencies from the
  vector memory. Nodes pulse/redden the longer a blocker persists unresolved. Clicking
  a node opens the originating transcript snippet.
- Ask Synapse — a conversational query bar over the memory store: a plain-language
  question returns a synthesized answer with clickable citations back to the exact
  meeting and timestamp. Works fully offline against the local LLM + local memory.
- Replay Mode — scrubbable transcript/audio playback where dragging the playhead
  live-updates a side panel showing extraction happening in real time.

============================================================
DESIGN SYSTEM
============================================================
Ink-navy background (#0B0F14), warm off-white text (#EDEAE3). Three status colors,
reserved exclusively for validation state — validated-green (#3FB68B), flagged-amber
(#E0A93E), risk-red (#D8583B) — never used decoratively elsewhere. No purple-gradient
AI-SaaS look, no glassmorphism. Grotesque sans (Inter/IBM Plex Sans) for UI, monospace
(IBM Plex Mono/JetBrains Mono) for timestamps, IDs, and transcript excerpts. Flat
panels, not floating glass. Left-rail navigation, not a top nav. Motion limited to
meaningful state transitions (a Clearance Rail node filling in on approval) — no
ambient decoration.

============================================================
NON-FUNCTIONAL REQUIREMENTS
============================================================
- AI processing is fully offline-capable; Supabase connectivity is only required for
  login, sync, and external dispatch. Queue-and-sync on reconnect, never hard-block.
- Onboarding must handle: Ollama not installed, model not pulled, insufficient
  RAM/VRAM, whisper model not downloaded, Supabase sign-in/session state — each with a
  clear in-app fix path.
- Explicit local resource indicator (RAM/CPU load) during processing.
- Data portability: full export and full delete across both local recordings and
  synced Supabase records, exposed directly in the UI.
- Type safety end-to-end (TypeScript) across the Electron main process, preload,
  frontend, and backend — zero-error `tsc` builds are a release gate.
- Verification includes: DevTools Network tab shows zero HTTP requests from the
  renderer (confirming the IPC boundary is real, not just partial), and manual
  confirmation that sign-up signs a user in immediately with no confirmation email.