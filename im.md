# Convert Synapse Meeting Intelligence to Electron Desktop App (Updated)

Transform the existing web-wrapped Electron shell into a production-grade desktop application with proper IPC architecture, static frontend export, native OS integrations, and zero browser accessibility.

**Change from previous version:** Supabase's "confirm email after sign-up" step is removed. `signUp()` now returns an active session immediately — no "check your inbox" screen, no pending-confirmation state anywhere in the app.

---

## User Review Required

> [!IMPORTANT]
> **Auth Strategy Decision**: The current app uses Supabase Auth (primary) + Firebase Auth (legacy). For the desktop app, I will:
> - Keep Supabase Auth as-is but adapt it for Electron (OAuth via popup `BrowserWindow`, token stored in `safeStorage`)
> - Remove Firebase Auth references (they appear to be vestigial — `firebase.ts` is only used in `api.ts` for `getAuthHeaders`, but `AuthContext.tsx` uses Supabase exclusively)
> - **Disable email confirmation on sign-up.** In the Supabase project (Authentication → Providers → Email), turn off "Confirm email." `supabase.auth.signUp()` will then return an active session directly — no confirmation link required. This is a dev-convenience setting, not a permanent decision: revisit before any real multi-user launch, since it means anyone can register with an email address they don't actually control.
> - If you still need Firebase Auth, let me know and I'll keep both flows.

> [!IMPORTANT]
> **Next.js Static Export Limitations**: Converting to `output: 'export'` means:
> - No server components, no `cookies()`, no Next.js middleware (`middleware.ts`)
> - Auth guards will move to the renderer (client-side routing guards via the existing `AuthContext`)
> - The dashboard layout must become a client component (it currently uses `cookies()` server-side)
> - `next/font/google` won't work with static export from `file://` — I'll load Inter via a local font file or CDN link in `<head>`

> [!WARNING]
> **SendGrid Removal**: I will delete `emailIntegration.ts` entirely, remove the `sendEmail` tool from `followUpAgent.ts`, remove `@sendgrid/mail` from backend dependencies, and strip all `SENDGRID_*` env vars from `env.ts`. The `EMAIL_SENT` audit action in types will be removed. The follow-up agent will use Jira + Slack only.
> **Note (unresolved from prior review):** this cuts a required PRD feature (autonomous email follow-ups via SendGrid) with no stated technical blocker. Confirm this is intentional before proceeding — this is separate from the email-confirmation change above and hasn't been addressed yet.

## Open Questions

> [!IMPORTANT]
> 1. **Firebase vs Supabase Auth**: Which auth provider should the desktop app use? Currently `AuthContext.tsx` uses Supabase only, while `api.ts` calls Firebase for request headers. Should I consolidate on Supabase-only?
> 2. **Docker auto-start**: Should Docker containers auto-start on app launch, or require user to click "Start" in settings? I'll default to **auto-start with configurable toggle**.
> 3. **Deep linking (`synapse://` protocol)**: Should this be included in the initial build, or deferred? I'll defer it to avoid scope creep.

---

## Proposed Changes

The work is organized into 5 phases with ~35 files to create/modify. Estimated effort: significant but structured.

---

### Phase 1: Electron Architecture Overhaul (~15 new files)

This is the core of the conversion — replacing the thin wrapper with a proper desktop app.

#### [NEW] `electron/ipc/channels.ts`
Type-safe IPC channel name registry. All channel names defined as `const` object for compile-time safety.

#### [NEW] `electron/ipc/types.ts`
Shared TypeScript interfaces for all IPC request/response payloads. Used by both main process handlers and the preload bridge.

#### [NEW] `electron/ipc/handlers/meetings.ipc.ts`
IPC handlers for meeting CRUD: `meetings:list`, `meetings:get`, `meetings:approve`. Proxies to backend HTTP API (`http://localhost:3001/api/v1/meetings`).

#### [NEW] `electron/ipc/handlers/ingest.ipc.ts`
IPC handler for `ingest:upload`. Reads file from disk (using path from native file dialog), creates a `FormData`, POSTs to backend `/api/v1/ingest`. Streams pipeline progress back via IPC push events.

#### [NEW] `electron/ipc/handlers/memory.ipc.ts`
IPC handler for `memory:search` and `memory:ask`. Proxies to backend memory endpoints.

#### [NEW] `electron/ipc/handlers/settings.ipc.ts`
IPC handlers for `settings:get`, `settings:update`, `settings:ollama-status`, `settings:ollama-pull`. Proxies to backend settings endpoints.

#### [NEW] `electron/ipc/handlers/auth.ipc.ts`
IPC handlers for auth: `auth:get-session`, `auth:sign-in`, `auth:sign-up`, `auth:sign-out`. Manages Supabase OAuth flow in a popup BrowserWindow, stores tokens via `safeStorage`. **Sign-up returns an active session immediately** — no confirmation-pending state, no polling for a confirmed-email status, since email confirmation is disabled at the Supabase project level.

#### [NEW] `electron/ipc/handlers/system.ipc.ts`
IPC handlers for `system:health`, `system:docker-status`, `system:docker-start`, `system:docker-stop`. Health checks the backend and Docker containers.

#### [NEW] `electron/ipc/index.ts`
Registers all IPC handlers from the handlers directory.

#### [NEW] `electron/services/backend-manager.ts`
`BackendManager` class: starts the backend as a `child_process.fork()` in dev, or as a subprocess from bundled resources in production. Implements health check polling with exponential backoff.

#### [NEW] `electron/services/docker-manager.ts`
`DockerManager` class: checks Docker installation, gets container status via `docker ps`, starts/stops containers via `docker-compose up -d` / `docker-compose down`. Reports container health.

#### [NEW] `electron/services/tray.ts`
System tray manager: creates tray icon with context menu (Quick Upload, Recent Meetings, Show/Hide, Quit). Updates tray tooltip with pipeline status.

#### [NEW] `electron/services/native-notifications.ts`
Wrapper around Electron's `Notification` API. Fires desktop notifications on pipeline completion, action items needing approval, etc.

#### [NEW] `electron/windows/main-window.ts`
Factory function to create the main `BrowserWindow`. Frameless with custom title bar region, min size 1024×768, loads from `file://` (static export) or `app://` protocol. Dark background `#0B0F14`.

#### [NEW] `electron/windows/splash-window.ts`
Creates a small splash/loading window shown during startup. Displays Synapse logo + animated progress. Receives status updates from backend-manager. Closes when main window is ready.

#### [NEW] `electron/utils/paths.ts`
Path resolution utilities: `getProjectRoot()`, `getBackendPath()`, `getFrontendPath()`, `getDockerComposePath()`. Handles dev vs packaged mode via `app.isPackaged` and `process.resourcesPath`.

#### [NEW] `electron/utils/platform.ts`
OS-specific helpers: process killing (Windows `taskkill` vs Unix signals), path separators, platform detection.

#### [MODIFY] `electron/main.ts`
Complete rewrite. New flow:
1. Show splash window
2. Start Docker containers (if auto-start enabled)
3. Fork backend process
4. Wait for backend health check
5. Create main window (loads static frontend from disk)
6. Register global shortcuts, menu bar, system tray
7. Close splash, show main window
8. Set up auto-updater

#### [MODIFY] `electron/preload.ts`
Replace generic `send/on` with structured, typed `window.synapse` API:
- `synapse.meetings.*` — meeting CRUD
- `synapse.ingest.*` — upload + progress
- `synapse.memory.*` — semantic search
- `synapse.settings.*` — settings management
- `synapse.system.*` — health, Docker status
- `synapse.auth.*` — sign in/up/out (no confirmation step)
- `synapse.native.*` — file dialog, notifications, show in explorer

---

### Phase 2: Frontend Conversion (~12 files to modify)

Convert Next.js from SSR/server components to static export, and replace all HTTP/WebSocket calls with IPC.

#### [MODIFY] `frontend/next.config.mjs`
Add `output: 'export'`, configure `images: { unoptimized: true }`, set `trailingSlash: true` for file:// compatibility.

#### [MODIFY] `frontend/src/app/layout.tsx` (root)
Convert to client component. Remove server-side `Metadata` export (use `<head>` instead). Move `<AuthProvider>` inside `<body>`. Add Inter font via `<link>` tag instead of `next/font/google`. Add custom title bar component at top of body.

#### [MODIFY] `frontend/src/app/(dashboard)/layout.tsx` (dashboard)
Convert from server component to client component. Remove `cookies()` import. Auth guard moves to client-side check via `useAuth()` hook with redirect.

#### [DELETE] `frontend/src/middleware.ts`
Next.js middleware is incompatible with static export. Auth routing will be handled client-side in the `AuthProvider`.

#### [MODIFY] `frontend/src/lib/api.ts`
Replace all `axios`/`fetch` HTTP calls with `window.synapse.*` IPC calls. The entire `api` object gets rewired. Remove axios dependency from renderer.

#### [MODIFY] `frontend/src/context/AuthContext.tsx`
Replace Supabase client-side auth with IPC calls to `window.synapse.auth.*`. Token storage moves to main process (safeStorage). Remove cookie-based workspace management (use IPC-backed store). **No "pending confirmation" state or "check your email" screen** — sign-up resolves to a signed-in session in one step, same code path as sign-in.

#### [MODIFY] `frontend/src/components/pipeline/PipelineStatus.tsx`
Replace `socket.io-client` WebSocket with `window.synapse.ingest.onProgress()` IPC subscription. Remove `socket.io-client` import.

#### [MODIFY] `frontend/src/components/upload/UploadSection.tsx`
Add "Browse Files" button that calls `window.synapse.native.openFileDialog()`. Keep drag-and-drop as secondary option. File path (not File object) is sent via IPC for ingest.

#### [MODIFY] `frontend/src/components/DashboardLayoutClient.tsx`
Replace `fetch('http://localhost:3001/...')` with `window.synapse.settings.ollamaStatus()` IPC call.

#### [MODIFY] `frontend/src/components/OnboardingWizard.tsx`
Replace all `fetch('http://localhost:3001/...')` calls with IPC equivalents.

#### [MODIFY] `frontend/src/components/layout/TopBar.tsx`
Add custom title bar controls (minimize, maximize, close) in the header area. Add `-webkit-app-region: drag` for window dragging.

#### [MODIFY] `frontend/src/components/layout/Sidebar.tsx`
Replace `next/link` with client-side routing (or keep if Next.js static export supports it — it does with `<Link>` and hash routing). Add Docker status indicator at bottom.

#### [NEW] `frontend/src/components/layout/TitleBar.tsx`
Custom frameless title bar component: app icon, title "Synapse", drag region, min/max/close buttons styled to match `#0B0F14` theme.

#### [NEW] `frontend/src/types/electron.d.ts`
TypeScript declaration file for `window.synapse` API exposed by preload script. Enables type-safe IPC calls from renderer.

#### Files with hardcoded `localhost:3001` to fix:
- `frontend/src/components/memory/MemoryExplorer.tsx` — `memory:ask` IPC
- `frontend/src/app/(dashboard)/dashboard/court/page.tsx` — action item approval IPC

---

### Phase 3: Backend Cleanup (~5 files to modify)

#### [DELETE] `backend/src/mastra/tools/emailIntegration.ts`
Remove entire SendGrid email tool.

#### [MODIFY] `backend/src/mastra/agents/followUpAgent.ts`
Remove `sendEmail` tool import and registration. Update agent instructions to use Jira + Slack only.

#### [MODIFY] `backend/src/mastra/workflows/meetingPipeline.ts`
Remove `sendEmailTool` import. Update step 7 description.

#### [MODIFY] `backend/src/config/env.ts`
Remove `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME` from schema.

#### [MODIFY] `backend/src/api/settings.ts`
Remove `autoEmailEnabled` and `notificationEmails` from settings schema/defaults.

#### [MODIFY] `backend/package.json`
Remove `@sendgrid/mail` from dependencies.

#### [MODIFY] `backend/src/types/index.ts`
Remove `EMAIL_SENT` from `AuditAction` type.

---

### Phase 4: Root Configuration & Build (~3 files to modify)

#### [MODIFY] `package.json` (root)
- Add dependencies: `electron-updater`, `electron-serve`, `electron-store`
- Add devDependencies: `electron-builder`, `wait-on`
- Add `electron-builder` config (`build` key) for Windows NSIS + portable targets
- Add scripts: `electron:dev`, `electron:build`, `build:static`

#### [MODIFY] `tsconfig.electron.json`
Add `resolveJsonModule: true`, `declaration: true`. Ensure `include` covers all new `electron/**/*` files.

#### [NEW] `assets/icon.ico`
Placeholder application icon (will use a generated icon).

#### [MODIFY] `.env`
Remove any `SENDGRID_*` variables.

---

### Phase 5: Desktop-Specific Features (~3 new files)

#### [NEW] `electron/services/auto-updater.ts`
`electron-updater` integration. Checks for updates on launch, notifies user, and applies updates.

#### [NEW] `frontend/src/components/splash/SplashScreen.tsx`
Splash screen UI: Synapse logo with animated gradient, status text ("Starting services...", "Connecting to database...", "Ready!"), progress bar.

#### Keyboard shortcuts (registered in `main.ts`):
- `Ctrl+N` → New upload (navigate to /upload)
- `Ctrl+F` → Focus memory search
- `Ctrl+,` → Open settings
- `Ctrl+Q` → Quit app

#### Application menu (registered in `main.ts`):
Standard Electron menu: File (New Upload, Quit), Edit (Undo, Redo, Cut, Copy, Paste), View (Reload, DevTools), Window (Minimize, Close), Help (About).

---

## Verification Plan

### Automated Tests
```bash
# TypeScript compilation (zero errors required)
npx tsc -p tsconfig.electron.json --noEmit
cd frontend && npx tsc --noEmit
cd backend && npx tsc --noEmit

# Static export builds successfully
cd frontend && npx next build

# Backend builds successfully
cd backend && npm run build
```

### Manual Verification
1. **App Launch**: Run `npm run electron:dev` → splash screen appears → transitions to dashboard
2. **IPC Communication**: Upload page uses native file dialog, pipeline progress updates via IPC
3. **No localhost in renderer**: DevTools Network tab shows zero HTTP requests from renderer
4. **System Tray**: Right-click tray icon → context menu appears
5. **Keyboard Shortcuts**: `Ctrl+N` opens upload page
6. **Docker Management**: Settings page shows Docker container status
7. **Native Notifications**: Pipeline completion triggers OS notification
8. **Frameless Window**: Custom title bar with minimize/maximize/close buttons works
9. **Packaging**: `npm run electron:build` produces a Windows `.exe` installer in `release/`
10. **Sign-up flow**: Registering a new account signs the user in immediately — no confirmation email is sent, no "check your inbox" screen appears anywhere in the flow.