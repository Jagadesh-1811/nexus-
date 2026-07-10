export { };

// Preload Bridge API definition interface
declare global {
  interface Window {
    synapse: {
      meetings: {
        list: () => Promise<any[]>;
        get: (id: string) => Promise<any>;
        approve: (id: string, updates: any) => Promise<{ success: boolean }>;
      };
      ingest: {
        upload: (filePath: string) => Promise<{ success: boolean }>;
        uploadBuffer: (buffer: ArrayBuffer) => Promise<any>;
        onProgress: (callback: (event: any, progress: any) => void) => () => void;
        onAutocapStart: (callback: (event: any, data: any) => void) => () => void;
        onAutocapStop: (callback: (event: any) => void) => () => void;
      };
      memory: {
        search: (query: string) => Promise<any[]>;
        ask: (question: string) => Promise<any>;
      };
      settings: {
        get: () => Promise<any>;
        update: (settings: any) => Promise<any>;
        ollamaStatus: () => Promise<any>;
        ollamaPull: (model: string) => Promise<any>;
        getAutocapture: () => Promise<any>;
        updateAutocapture: (settings: any) => Promise<any>;
      };
      system: {
        health: () => Promise<any>;
        dockerStatus: () => Promise<any>;
        dockerStart: () => Promise<any>;
        dockerStop: () => Promise<any>;
        getResources: () => Promise<any>;
      };
      auth: {
        getSession: () => Promise<any>;
        signIn: (credentials: any) => Promise<any>;
        signUp: (credentials: any) => Promise<any>;
        signOut: () => Promise<any>;
      };
      native: {
        openFileDialog: () => Promise<string | null>;
        showNotification: (title: string, body: string) => Promise<void>;
        revealExplorer: (path: string) => Promise<void>;
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
      };
      workspace: {
        get: () => Promise<any>;
        invite: (data: { name: string; email: string; role: string }) => Promise<any>;
      };
    };
  }
}

// Router & Page Navigation Setup
const contentArea = document.getElementById('content') as HTMLElement;
const navItems = document.querySelectorAll('.nav-item');

function applyTheme() {
  const theme = localStorage.getItem('nexus_theme') || 'system';
  if (theme === 'dark') {
    document.body.classList.add('dark');
  } else if (theme === 'light') {
    document.body.classList.remove('dark');
  } else {
    // system theme
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (systemPrefersDark) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  }
}

// Apply immediately on load
applyTheme();

// Listen to system theme shifts
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const theme = localStorage.getItem('nexus_theme') || 'system';
  if (theme === 'system') {
    applyTheme();
  }
});

function navigateToPage(page: string) {
  navItems.forEach(item => {
    if (item.getAttribute('data-page') === page) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  if (page === 'dashboard') {
    renderDashboard();
  } else if (page === 'upload') {
    renderUpload();
  } else if (page === 'court') {
    renderCourt();
  } else if (page === 'blockers') {
    renderBlockerWeb();
  } else if (page === 'ask') {
    renderAskSynapse();
  } else if (page === 'workspace') {
    renderWorkspace();
  } else if (page === 'settings') {
    renderSettings();
  }
}

async function updateSidebarProfile() {
  const cachedName = localStorage.getItem('logged_in_name');
  const cachedEmail = localStorage.getItem('logged_in_email');
  
  const nameEl = document.getElementById('profile-name');
  const emailEl = document.getElementById('profile-email');
  const avatarEl = document.getElementById('profile-avatar');
  
  if (cachedName && nameEl) nameEl.innerText = cachedName;
  if (cachedEmail && emailEl) emailEl.innerText = cachedEmail;
  if (cachedName && avatarEl) avatarEl.innerText = cachedName.slice(0, 2).toUpperCase();

  try {
    const sessionRes = await window.synapse.auth.getSession();
    const user = sessionRes?.data?.session?.user;
    if (user) {
      const email = user.email || '';
      let name = '';
      if (user.user_metadata?.full_name) {
        name = user.user_metadata.full_name;
      } else if (email) {
        const parts = email.split('@');
        const username = parts[0] || '';
        name = username.split(/[\._-]/).map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
      }
      
      localStorage.setItem('logged_in_name', name);
      localStorage.setItem('logged_in_email', email);
      
      if (nameEl) nameEl.innerText = name;
      if (emailEl) emailEl.innerText = email;
      if (avatarEl && name) {
        avatarEl.innerText = name.slice(0, 2).toUpperCase();
      }
    }
  } catch (e) {
    console.error('Failed to update sidebar profile:', e);
  }
}

async function checkAuthAndNavigate(page: string) {
  try {
    const session = await window.synapse.auth.getSession();
    if (session) {
      localStorage.setItem('has_logged_in', 'true');
    }
    if (!session && localStorage.getItem('has_logged_in') !== 'true') {
      renderLogin();
      return;
    }
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.display = 'flex';
    updateSidebarProfile();
    checkConsentOnboarding();
    navigateToPage(page);
  } catch (err) {
    if (localStorage.getItem('has_logged_in') === 'true') {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.style.display = 'flex';
      checkConsentOnboarding();
      navigateToPage(page);
    } else {
      renderLogin();
    }
  }
}

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.slice(1) || 'dashboard';
  checkAuthAndNavigate(hash);
});

// App Initialization
document.addEventListener('DOMContentLoaded', () => {
  // Title Bar buttons hooks
  document.getElementById('btn-minimize')?.addEventListener('click', () => {
    window.synapse.native.minimize();
  });
  document.getElementById('btn-maximize')?.addEventListener('click', () => {
    window.synapse.native.maximize();
  });
  document.getElementById('btn-close')?.addEventListener('click', () => {
    window.close();
  });

  // Background Auto-Capture Status Icon Button hook
  const bgStatusBtn = document.getElementById('btn-bg-status');
  if (bgStatusBtn) {
    // Initial state setup
    window.synapse.settings.getAutocapture().then((config) => {
      if (config.enabled) {
        bgStatusBtn.classList.add('active');
        bgStatusBtn.setAttribute('title', 'Background Auto-Capture Active');
      } else {
        bgStatusBtn.classList.remove('active');
        bgStatusBtn.setAttribute('title', 'Background Auto-Capture Disabled');
      }
    });

    // Click handler to toggle setting directly
    bgStatusBtn.addEventListener('click', async () => {
      const config = await window.synapse.settings.getAutocapture();
      const nextEnabled = !config.enabled;
      await window.synapse.settings.updateAutocapture({ enabled: nextEnabled, consentGranted: true });
      
      if (nextEnabled) {
        bgStatusBtn.classList.add('active');
        bgStatusBtn.setAttribute('title', 'Background Auto-Capture Active');
      } else {
        bgStatusBtn.classList.remove('active');
        bgStatusBtn.setAttribute('title', 'Background Auto-Capture Disabled');
      }

      // Sync settings page checkbox if currently active page is settings
      const currentHash = window.location.hash.slice(1) || 'dashboard';
      if (currentHash === 'settings') {
        const toggleEl = document.getElementById('toggle-autocap') as HTMLInputElement;
        const sliders = document.querySelectorAll('.slider') as NodeListOf<HTMLElement>;
        if (toggleEl) {
          toggleEl.checked = nextEnabled;
          if (sliders[0]) {
            sliders[0].style.backgroundColor = nextEnabled ? 'var(--primary)' : 'var(--surface-card)';
          }
        }
      }
    });
  }

  // Background Auto-Capture Real Recording Listeners
  let autocapRecorder: MediaRecorder | null = null;
  let autocapChunks: Blob[] = [];

  window.synapse.ingest.onAutocapStart(async (_event: any, data: any) => {
    try {
      console.log('Background Auto-Capture started:', data.appName);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      autocapRecorder = new MediaRecorder(stream);
      autocapChunks = [];

      autocapRecorder.ondataavailable = e => {
        if (e.data.size > 0) autocapChunks.push(e.data);
      };

      autocapRecorder.onstop = async () => {
        const blob = new Blob(autocapChunks, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        try {
          console.log('Uploading real auto-captured audio buffer...');
          
          // Switch tab to Ingest Meeting to show the real pipeline progress bar!
          window.location.hash = '#upload';
          
          await window.synapse.ingest.uploadBuffer(arrayBuffer);
        } catch (err) {
          console.error("Failed to upload auto-capture buffer:", err);
        }
      };

      autocapRecorder.start();
    } catch (err) {
      console.error("Autocap mic access failed:", err);
    }
  });

  window.synapse.ingest.onAutocapStop(() => {
    if (autocapRecorder && autocapRecorder.state !== 'inactive') {
      console.log('Background Auto-Capture stopped');
      autocapRecorder.stop();
      autocapRecorder.stream.getTracks().forEach(track => track.stop());
    }
  });

  // Logout button hook
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await window.synapse.auth.signOut();
    localStorage.removeItem('has_logged_in');
    renderLogin();
  });

  // Resource indicator loop
  setInterval(async () => {
    try {
      const resources = await window.synapse.system.getResources();
      const cpuEl = document.getElementById('cpu-load');
      const ramEl = document.getElementById('ram-load');
      if (cpuEl) cpuEl.innerText = `${resources.cpu}%`;
      if (ramEl) ramEl.innerText = `${resources.ram}%`;
    } catch (e) {
      // Ignored if bridge not ready
    }
  }, 2000);

  // Initial routing
  const initialHash = window.location.hash.slice(1) || 'dashboard';
  checkAuthAndNavigate(initialHash);
});

// Render Dashboard
async function renderDashboard() {
  contentArea.innerHTML = `
    <div class="flat-panel">
      <h2>Project Command Center</h2>
      <p style="color: var(--muted); margin-bottom: 24px;">Real-time view of verified tasks, local intelligence node status, and team activity.</p>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
        <div class="flat-panel" style="margin: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <h3>Trust Meter Level</h3>
          <div id="trust-meter-value" style="font-size: 36px; font-weight: bold; color: var(--validated-green); margin: 12px 0;">—</div>
          <p id="trust-meter-desc" style="font-size: 13px; color: var(--muted);">Calculating approval ratio from verified action items...</p>
        </div>
        <div class="flat-panel" style="margin: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <h3>Meeting Transcripts</h3>
          <div id="meetings-count-dashboard" style="font-size: 36px; font-weight: bold; color: var(--primary); margin: 12px 0;">—</div>
          <p id="meetings-count-desc" style="font-size: 13px; color: var(--muted);">Total meetings ingested and indexed.</p>
        </div>
      </div>
    </div>
    
    <div class="flat-panel">
      <h2>Recent Verified Commitments</h2>
      <div id="verified-items-container">Loading...</div>
    </div>
  `;

  try {
    checkConsentOnboarding();
    const meetings = await window.synapse.meetings.list();
    const meetingsCountEl = document.getElementById('meetings-count');
    const meetingsPendingEl = document.getElementById('meetings-pending');
    if (meetingsCountEl) meetingsCountEl.innerText = String(meetings.length);

    const meetingsCountDashboardEl = document.getElementById('meetings-count-dashboard');
    if (meetingsCountDashboardEl) meetingsCountDashboardEl.innerText = String(meetings.length);
    const meetingsCountDescEl = document.getElementById('meetings-count-desc');
    if (meetingsCountDescEl) {
      const completedCount = meetings.filter((m: any) => (m.status || '').toUpperCase() === 'COMPLETED').length;
      meetingsCountDescEl.innerText = `${completedCount} of ${meetings.length} transcripts fully processed.`;
    }

    // Compute trust meter and pending count from action items across all meetings
    let totalItems = 0;
    let approvedItems = 0;
    let pendingItems = 0;
    let totalValidationScore = 0;
    let meetingWithScoreCount = 0;

    for (const m of meetings) {
      try {
        const res = await window.synapse.meetings.get(m.id);
        const items: any[] = res.actionItems || [];
        totalItems += items.length;
        approvedItems += items.filter((i: any) => ['APPROVED', 'VALIDATED', 'DISPATCHED'].includes((i.status || '').toUpperCase())).length;
        pendingItems += items.filter((i: any) => ['PENDING', 'FLAGGED', 'EXTRACTED', 'PENDING_APPROVAL'].includes((i.status || '').toUpperCase())).length;

        const score = res.executionPlan?.enkryptValidationScore ?? res.meeting?.executionPlan?.enkryptValidationScore;
        if (score !== undefined && score !== null) {
          totalValidationScore += score;
          meetingWithScoreCount++;
        }
      } catch (_) { }
    }

    let trustPct = 0;
    let aiScore = 0.82; // Base confidence score fallback (82%)
    if (meetingWithScoreCount > 0) {
      aiScore = totalValidationScore / meetingWithScoreCount;
    }

    if (totalItems > 0) {
      const approvalRatio = approvedItems / totalItems;
      // Blended Trust score formula: starts at AI confidence level and goes to 100% on full user approvals
      trustPct = Math.round((aiScore * (1 - approvalRatio) + approvalRatio) * 100);
      
      if (approvedItems === totalItems) {
        trustPct = 100;
      }
    } else {
      trustPct = Math.round(aiScore * 100);
    }

    const trustMeterEl = document.getElementById('trust-meter-value');
    const trustDescEl = document.getElementById('trust-meter-desc');
    if (trustMeterEl) trustMeterEl.innerText = `${trustPct}%`;
    if (trustDescEl) {
      trustDescEl.innerText = totalItems > 0
        ? `${approvedItems} of ${totalItems} commitments approved. ${trustPct >= 80 ? 'Autonomy enabled for low-risk actions.' : 'Manual review recommended.'}`
        : 'No action items yet. Ingest a meeting to begin.';
    }
    if (meetingsPendingEl) {
      meetingsPendingEl.innerText = pendingItems > 0
        ? `${pendingItems} action${pendingItems > 1 ? 's' : ''} pending validation in the court.`
        : 'All commitments validated.';
    }

    const container = document.getElementById('verified-items-container');
    if (container) {
      if (meetings.length === 0) {
        container.innerHTML = `<p style="color: var(--muted);">No meetings found. Upload an audio file to get started.</p>`;
      } else {
        container.innerHTML = meetings.map((m: any, index: number) => `
          <div class="action-item-card validated" style="position: relative;">
            <div style="display: flex; justify-content: space-between;">
              <strong>${m.title || 'Untitled Meeting'}</strong>
              <span class="mono" style="font-size: 11px; color: var(--muted);">${m.createdAt ? new Date(m.createdAt).toLocaleDateString() : ''}</span>
            </div>
            <p style="margin: 6px 0; font-size: 13.5px; color: var(--muted);">
              Status: <span style="font-weight: 600; color: var(--primary);">${m.status || 'PENDING'}</span>
              ${m.participantNames?.length ? '· ' + m.participantNames.join(', ') : ''}
            </p>
            <div class="clearance-rail">
              <span class="rail-node ${['PROCESSING', 'COMPLETED', 'TRANSCRIBING', 'ANALYZING', 'VALIDATING'].includes(m.status) ? 'active-green' : ''}">Extracted</span>
              <span class="rail-node ${['COMPLETED', 'VALIDATING'].includes(m.status) ? 'active-green' : ''}">Validated</span>
              <span class="rail-node ${m.status === 'COMPLETED' ? 'active-green' : ''}">Dispatched</span>
            </div>
            
            ${m.transcriptRaw || ['PENDING', 'COMPLETED', 'TRANSCRIBING', 'ANALYZING', 'VALIDATING'].includes((m.status || '').toUpperCase()) ? `
              <div style="margin-top: 12px; border-top: 1px dashed var(--hairline); padding-top: 10px;">
                <button class="btn" style="padding: 4px 8px; font-size: 11px;" onclick="toggleScript(${index})">Toggle Transcribed Script</button>
                <div id="script-block-${index}" style="display: none; margin-top: 10px; background: var(--surface-soft); padding: 12px; border-radius: var(--r-md); font-size: 12.5px; max-height: 180px; overflow-y: auto; white-space: pre-wrap; font-family: inherit; color: var(--body); border: 1px solid var(--hairline);">
                  ${m.transcriptRaw || "(Processing audio transcript...)"}
                </div>
              </div>
            ` : ''}
          </div>
        `).join('');

        // Expose toggle helper
        (window as any).toggleScript = (idx: number) => {
          const el = document.getElementById('script-block-' + idx);
          if (el) {
            el.style.display = el.style.display === 'none' ? 'block' : 'none';
          }
        };
      }
    }
  } catch (err) {
    console.error(err);
    const container = document.getElementById('verified-items-container');
    if (container) container.innerHTML = `<p style="color: var(--risk-red);">Failed to load meetings. Check database connection.</p>`;
  }
}

// Render Upload & Listen
function renderUpload() {
  contentArea.innerHTML = `
    <div class="flat-panel">
      <h2>Ingest & Record Meetings</h2>
      <p style="color: var(--muted); margin-bottom: 20px;">Upload raw audio or record your live meetings. Nexus extracts action items locally.</p>
      
      <div style="display: flex; gap: 20px; margin-bottom: 20px;">
        <div style="flex: 1; border: 2px dashed var(--hairline); padding: 40px; text-align: center; border-radius: var(--r-lg); background: var(--surface-soft);">
          <h3>File Ingestion</h3>
          <button id="btn-select-file" class="btn primary" style="margin-top: 12px;">Browse Local Files</button>
        </div>

        <div style="flex: 1; border: 2px solid var(--hairline); padding: 40px; text-align: center; border-radius: var(--r-lg); background: var(--canvas);">
          <h3>Live Listener</h3>
          <div style="margin-top: 12px; display: flex; gap: 10px; justify-content: center; align-items: center;">
            <button id="btn-start-record" class="btn primary" style="background-color: var(--neon-accent); color: black;">Start</button>
            <button id="btn-stop-record" class="btn" style="background: var(--risk-red); color: white; border-color: var(--risk-red);" disabled>Stop</button>
          </div>
          <div id="recording-indicator" style="display: none; margin-top: 12px; color: var(--risk-red); font-weight: 600; animation: pulse 1.5s infinite;">
            Recording...
          </div>
        </div>
      </div>

        <div id="upload-status" class="flat-panel" style="margin-top: 24px; display: none; background: var(--surface-dark-elevated); border: 1px solid rgba(255,255,255,0.05); padding: 20px;">
          <h3 style="color: var(--on-dark); margin-bottom: 4px;">Pipeline Progress</h3>
          <div style="background: rgba(255, 255, 255, 0.08); height: 8px; border-radius: var(--r-pill); margin: 16px 0; overflow: hidden; position: relative; border: 1px solid rgba(255, 255, 255, 0.03);">
            <div id="progress-bar" style="background: linear-gradient(90deg, var(--primary) 0%, #ff9e7d 100%); width: 0%; height: 100%; transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 0 10px rgba(204, 120, 92, 0.5);"></div>
          </div>
          <p id="progress-status-msg" style="font-size: 13.5px; color: var(--on-dark-soft); display: flex; align-items: center; gap: 8px;">
            <span class="spinner" style="width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.2); border-top-color: var(--primary); border-radius: 50%; display: inline-block; animation: spin 1s linear infinite;"></span>
            Initiating transcription...
          </p>
        </div>
      </div>
    </div>
    <style>
      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  `;

  // File Upload Logic
  const selectBtn = document.getElementById('btn-select-file');
  selectBtn?.addEventListener('click', async () => {
    const path = await window.synapse.native.openFileDialog();
    if (path) {
      startPipelineProgress();
      await window.synapse.ingest.upload(path);
    }
  });

  // Recording Logic
  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];

  const startBtn = document.getElementById('btn-start-record') as HTMLButtonElement;
  const stopBtn = document.getElementById('btn-stop-record') as HTMLButtonElement;
  const indicator = document.getElementById('recording-indicator') as HTMLElement;

  startBtn?.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        startPipelineProgress();
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();

        try {
          const res = await window.synapse.ingest.uploadBuffer(arrayBuffer);
          const config = await window.synapse.settings.get();
          if (config?.enableLocalCache && res.transcript) {
            // Save to browser local storage
            const cache = JSON.parse(localStorage.getItem('nexus_transcripts') || '[]');
            cache.push({ date: new Date().toISOString(), transcript: res.transcript });
            localStorage.setItem('nexus_transcripts', JSON.stringify(cache));
            console.log('Saved to local storage:', res.transcript);
          }
        } catch (err) {
          console.error("Failed to upload buffer", err);
        }
      };

      mediaRecorder.start();
      startBtn.disabled = true;
      stopBtn.disabled = false;
      indicator.style.display = 'block';
    } catch (err) {
      console.error("Microphone access denied or error:", err);
      alert("Could not access microphone.");
    }
  });

  stopBtn?.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    startBtn.disabled = false;
    stopBtn.disabled = true;
    indicator.style.display = 'none';
  });

  function startPipelineProgress() {
    const statusPanel = document.getElementById('upload-status');
    if (statusPanel) statusPanel.style.display = 'block';

    const progressBar = document.getElementById('progress-bar');
    if (progressBar) progressBar.style.width = '5%'; // Show initial action loading slice immediately

    const unsubscribe = window.synapse.ingest.onProgress((_event: any, data: any) => {
      const pBar = document.getElementById('progress-bar');
      const statusMsg = document.getElementById('progress-status-msg');
      if (pBar) pBar.style.width = `${Math.max(5, data.progress)}%`;
      if (statusMsg) {
        statusMsg.innerHTML = `
          <span class="spinner" style="width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.2); border-top-color: var(--primary); border-radius: 50%; display: inline-block; animation: spin 1s linear infinite; ${data.stage === 'Complete' ? 'display: none;' : ''}"></span>
          [${data.stage}] ${data.message}
        `;
      }

      if (data.stage === 'Complete') {
        window.synapse.native.showNotification('Nexus Pipeline', 'Meeting intelligence extraction complete!');
        unsubscribe();
      }
    });
  }
}

// Render Commitment Court
async function renderCourt() {
  contentArea.innerHTML = `
    <div class="flat-panel">
      <h2>Commitment Court</h2>
      <p style="color: var(--muted); margin-bottom: 20px;">Review action items flagged by the local LLM validation cross-check before dispatching.</p>
      <div id="court-items-container">Loading flagged items...</div>
    </div>
  `;

  try {
    const meetings = await window.synapse.meetings.list();
    const container = document.getElementById('court-items-container');
    if (!container) return;

    if (meetings.length === 0) {
      container.innerHTML = `<p style="color: var(--validated-green);">No meetings found. Ingest a meeting first.</p>`;
      return;
    }

    // Gather flagged items from ALL meetings
    const allFlagged: any[] = [];
    for (const m of meetings) {
      try {
        const res = await window.synapse.meetings.get(m.id);
        const flagged = (res.actionItems || []).filter((i: any) =>
          ['FLAGGED', 'PENDING', 'EXTRACTED', 'PENDING_APPROVAL'].includes((i.status || '').toUpperCase())
        ).map((i: any) => ({ ...i, meetingTitle: m.title }));
        allFlagged.push(...flagged);
      } catch (_) { }
    }

    if (allFlagged.length === 0) {
      container.innerHTML = `<p style="color: var(--validated-green); font-weight: 500;">No flagged items. All commitments clear. ✓</p>`;
    } else {
      container.innerHTML = allFlagged.map((item: any) => {
        const isFlagged = ['FLAGGED', 'PENDING'].includes((item.status || '').toUpperCase());
        const hasObjection = !!(item.validationNotes || item.validation_notes);
        const borderColor = isFlagged ? 'var(--risk-red)' : 'var(--flagged-amber)';
        const badgeColor = isFlagged ? 'var(--risk-red)' : 'var(--flagged-amber)';
        const badgeText = isFlagged ? 'Flagged Objection' : 'Extracted Commitment';

        return `
          <div class="flat-panel" style="background: #fef9f6; border-color: ${borderColor}; border-left: 3px solid ${borderColor};">
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
              <strong style="color: ${badgeColor};">${badgeText}</strong>
              <span class="mono" style="font-size: 11px; color: var(--muted);">${item.meetingTitle || ''} · ID: ${item.id.slice(0, 8)}...</span>
            </div>
            
            <p style="margin: 10px 0; font-size: 15px; color: var(--body-strong);">&ldquo;${item.description || item.title || 'No description'}&rdquo;</p>
            
            ${hasObjection ? `
            <div style="background: rgba(0,0,0,0.04); border: 1px solid var(--hairline); padding: 12px; margin: 12px 0; border-radius: 4px;">
              <span style="font-size: 11px; color: var(--risk-red); text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 4px;">Adversarial Critic Objection:</span>
              <p style="font-size: 13px; color: var(--body);">${item.validationNotes || item.validation_notes}</p>
            </div>
            ` : ''}

            <div style="background: var(--surface-soft); padding: 8px 12px; font-style: italic; font-size: 13px; border-left: 3px solid var(--hairline); border-radius: 0 var(--r-sm) var(--r-sm) 0; color: var(--muted);">
              Assignee: ${item.assignee || item.assigneeName || 'Unassigned'} · Due: ${item.dueDate ? new Date(item.dueDate).toLocaleDateString() : 'No due date'}
            </div>

            <div style="margin-top: 16px; display: flex; gap: 8px;">
              <button class="btn primary" onclick="approveFlagged('${item.id}')">Force Approve</button>
              <button class="btn" onclick="editFlagged('${item.id}')">Edit Commitment</button>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error(err);
    const container = document.getElementById('court-items-container');
    if (container) container.innerHTML = `<p style="color: var(--risk-red);">Failed to load court items. Check database connection.</p>`;
  }
}

// Global hook helpers for click actions
(window as any).approveFlagged = async (id: string) => {
  await window.synapse.meetings.approve(id, { status: 'validated' });
  renderCourt();
};

(window as any).editFlagged = (id: string) => {
  // Simple prompt for inline edit demo
  const newVal = prompt("Enter refined commitment text:");
  if (newVal) {
    window.synapse.meetings.approve(id, { description: newVal, status: 'validated' }).then(() => {
      renderCourt();
    });
  }
};

// Render Blocker Web
async function renderBlockerWeb() {
  contentArea.innerHTML = `
    <div class="flat-panel">
      <h2>Blocker Web</h2>
      <p style="color: var(--muted); margin-bottom: 20px;">Force-directed dependency graph of cross-meeting blockers and unresolved risks.</p>
      <div id="blocker-web-container">Loading blockers from database...</div>
    </div>
  `;

  try {
    const meetings = await window.synapse.meetings.list();
    const container = document.getElementById('blocker-web-container');
    if (!container) return;

    // Collect all BLOCKED/FLAGGED items from every meeting
    const blockers: any[] = [];
    for (const m of meetings) {
      try {
        const res = await window.synapse.meetings.get(m.id);
        const blocked = (res.actionItems || []).filter((i: any) =>
          ['BLOCKED', 'FLAGGED', 'OVERDUE'].includes((i.status || '').toUpperCase())
        ).map((i: any) => ({ ...i, meetingTitle: m.title }));
        blockers.push(...blocked);
      } catch (_) { }
    }

    if (blockers.length === 0) {
      container.innerHTML = `
        <div style="display: flex; justify-content: center; background: #080C10; border: 1px solid var(--border-color); border-radius: 4px; padding: 60px; text-align: center;">
          <div>
            <div style="font-size: 48px; margin-bottom: 12px;">✓</div>
            <p style="color: var(--validated-green); font-size: 16px;">No blockers detected.</p>
            <p style="color: #8892B0; font-size: 13px; margin-top: 8px;">All tracked commitments are on track.</p>
          </div>
        </div>
      `;
      return;
    }

    // Build a visual graph from real blockers
    const svgWidth = Math.max(400, blockers.length * 120);
    const cx = (i: number) => 80 + i * 120;
    const cy = 120;

    const nodes = blockers.map((b, i) => `
      <g>
        ${i > 0 ? `<line x1="${cx(i - 1)}" y1="${cy}" x2="${cx(i)}" y2="${cy}" stroke="#1E293B" stroke-width="2"/>` : ''}
        <circle cx="${cx(i)}" cy="${cy}" r="14" fill="${b.status?.toUpperCase() === 'BLOCKED' ? 'var(--risk-red)' :
        b.status?.toUpperCase() === 'OVERDUE' ? 'var(--risk-red)' :
          'var(--flagged-amber)'
      }"/>
        <text x="${cx(i)}" y="${cy + 30}" fill="#EDEAE3" font-size="10" text-anchor="middle" style="max-width:100px">
          ${(b.description || b.title || 'Blocker').slice(0, 20)}${(b.description || '').length > 20 ? '…' : ''}
        </text>
        <text x="${cx(i)}" y="${cy + 43}" fill="#8892B0" font-size="9" text-anchor="middle">${b.meetingTitle?.slice(0, 18) || ''}</text>
      </g>
    `).join('');

    container.innerHTML = `
      <div style="overflow-x: auto; background: #080C10; border: 1px solid var(--border-color); border-radius: 4px; padding: 40px;">
        <svg width="${svgWidth}" height="200" style="overflow: visible;">
          ${nodes}
        </svg>
      </div>
      <div style="margin-top: 16px;">
        ${blockers.map(b => `
          <div class="flat-panel" style="margin-bottom: 10px; background: #1A1310; border-color: ${b.status?.toUpperCase() === 'BLOCKED' ? 'var(--risk-red)' : 'var(--flagged-amber)'}; padding: 12px 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong style="color: ${b.status?.toUpperCase() === 'BLOCKED' ? 'var(--risk-red)' : 'var(--flagged-amber)'}">${b.status?.toUpperCase()}</strong>
              <span style="font-size: 11px; color: #8892B0;">${b.meetingTitle}</span>
            </div>
            <p style="margin: 6px 0; font-size: 14px;">${b.description || b.title || 'No description'}</p>
            <p style="font-size: 12px; color: #8892B0; margin: 0;">Assignee: ${b.assignee || b.assigneeName || 'Unassigned'}</p>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    console.error(err);
    const container = document.getElementById('blocker-web-container');
    if (container) container.innerHTML = `<p style="color: var(--risk-red);">Failed to load blocker data.</p>`;
  }
}

// Render Ask Synapse Query Interface
function renderAskSynapse() {
  contentArea.innerHTML = `
    <div class="flat-panel">
      <h2>Ask Nexus</h2>
      <p style="color: var(--muted); margin-bottom: 20px;">Ask plain-language questions across the local cross-meeting memory. Powered offline by Ollama.</p>
      
      <div style="display: flex; gap: 10px; margin-bottom: 20px;">
        <input type="text" id="ask-input" style="flex: 1; padding: 10px 14px; background: var(--canvas); border: 1px solid var(--hairline); color: var(--ink); border-radius: var(--r-md); font-family: inherit;" placeholder="e.g. What database tasks were assigned to Bob?">
        <button id="btn-ask" class="btn primary">Query Memory</button>
      </div>

      <div id="ask-response" class="flat-panel" style="display: none; background: var(--surface-soft);">
        <h3>Answer</h3>
        <p id="answer-text" style="font-size: 15px; margin: 12px 0; color: var(--body-strong);"></p>
        <div style="border-top: 1px solid var(--hairline); padding-top: 10px;">
          <span style="font-size: 11px; color: var(--primary); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Citations:</span>
          <div id="citations-list" style="margin-top: 6px;"></div>
        </div>
      </div>
    </div>
  `;

  const askInput = document.getElementById('ask-input') as HTMLInputElement;
  const askBtn = document.getElementById('btn-ask');

  askBtn?.addEventListener('click', async () => {
    const val = askInput.value.trim();
    if (!val) return;

    const responsePanel = document.getElementById('ask-response');
    const answerText = document.getElementById('answer-text');
    const citationsList = document.getElementById('citations-list');

    if (responsePanel) responsePanel.style.display = 'block';
    if (answerText) answerText.innerText = "Querying local vector embeddings...";
    if (citationsList) citationsList.innerHTML = "";

    const res = await window.synapse.memory.ask(val);
    if (answerText) answerText.innerText = res.answer;
    if (citationsList) {
      citationsList.innerHTML = res.citations.map((c: any) => `
        <div style="font-size: 12px; background: var(--surface-card); padding: 6px 10px; border-radius: var(--r-sm); margin-bottom: 6px; color: var(--muted); border: 1px solid var(--hairline);" class="mono">
          <strong>Meeting ID ${c.meetingId} [Timestamp ${c.timestamp}]:</strong> "${c.text}"
        </div>
      `).join('');
    }
  });
}

function renderLogin() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.style.display = 'none';

  contentArea.innerHTML = `
    <div class="flat-panel" style="max-width: 400px; margin: 60px auto;">
      <h2 id="auth-title" style="font-size: 28px; margin-bottom: 6px;">Sign In to Nexus</h2>
      <p style="color: var(--muted); margin-bottom: 24px; font-size: 13.5px;">Secure offline-first desktop intelligence console.</p>
      
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div>
          <label>Email Address</label>
          <input type="email" id="auth-email">
        </div>
        <div>
          <label>Password</label>
          <input type="password" id="auth-password">
        </div>
        <div id="auth-error-msg" style="color: var(--risk-red); font-size: 13px; display: none;"></div>
        <button id="btn-auth-submit" class="btn primary" style="width: 100%; padding: 12px; margin-top: 4px;">Sign In</button>
        
        <div style="text-align: center; margin-top: 10px; font-size: 12px;">
          <a href="#" id="auth-toggle" style="color: var(--primary); text-decoration: none; font-size: 13px;">Don't have an account? Sign Up</a>
        </div>
      </div>
    </div>
  `;

  const titleEl = document.getElementById('auth-title') as HTMLElement;
  const emailInput = document.getElementById('auth-email') as HTMLInputElement;
  const passwordInput = document.getElementById('auth-password') as HTMLInputElement;
  const errorEl = document.getElementById('auth-error-msg') as HTMLElement;
  const submitBtn = document.getElementById('btn-auth-submit') as HTMLButtonElement;
  const toggleLink = document.getElementById('auth-toggle') as HTMLElement;

  let isSignUpMode = false;

  toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    isSignUpMode = !isSignUpMode;
    if (isSignUpMode) {
      titleEl.innerText = "Create Your Account";
      submitBtn.innerText = "Sign Up";
      toggleLink.innerText = "Already have an account? Sign In";
    } else {
      titleEl.innerText = "Sign In to Nexus";
      submitBtn.innerText = "Sign In";
      toggleLink.innerText = "Don't have an account? Sign Up";
    }
  });

  submitBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      errorEl.innerText = "Email and password are required.";
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.innerText = isSignUpMode ? "Registering..." : "Signing In...";
    submitBtn.disabled = true;
    errorEl.style.display = 'none';

    try {
      if (isSignUpMode) {
        await window.synapse.auth.signUp({ email, password });
      } else {
        await window.synapse.auth.signIn({ email, password });
      }
      
      // Cache details instantly
      const namePart = email.split('@')[0] || 'User';
      const formattedName = namePart.split(/[\._-]/).map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
      localStorage.setItem('logged_in_email', email);
      localStorage.setItem('logged_in_name', formattedName);
      
      const initialHash = window.location.hash.slice(1) || 'dashboard';
      checkAuthAndNavigate(initialHash);
    } catch (err: any) {
      errorEl.innerText = err.message || "Authentication failed.";
      errorEl.style.display = 'block';
      submitBtn.innerText = isSignUpMode ? "Sign Up" : "Sign In";
      submitBtn.disabled = false;
    }
  });
}

// Check and render onboarding modal if consent not yet granted/handled
async function checkConsentOnboarding() {
  const autoCap = await window.synapse.settings.getAutocapture();
  if (!autoCap.consentGranted) {
    showConsentModal();
  }
}

function showConsentModal() {
  // Check if modal already exists
  if (document.getElementById('consent-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'consent-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.background = 'rgba(20,20,19,0.5)';
  modal.style.backdropFilter = 'blur(4px)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '1000';

  modal.innerHTML = `
    <div class="flat-panel" style="max-width: 520px; width: 90%; background: var(--canvas); border: 1px solid var(--hairline); box-shadow: 0 8px 32px rgba(0,0,0,0.12); padding: 32px; border-radius: var(--r-lg);">
      <h2 style="font-size: 26px; margin-bottom: 12px; font-family: 'Cormorant Garamond', serif;">Enable Background Auto-Capture?</h2>
      
      <p style="font-size: 14px; color: var(--body); margin-bottom: 16px; line-height: 1.5;">
        Synapse can run quietly in the background and automatically capture meeting audio (system output + microphone) when it detects active Zoom, Teams, or browser-based meetings.
      </p>

      <div style="background: var(--surface-soft); border-left: 3px solid var(--primary); padding: 12px; font-size: 12.5px; color: var(--muted); margin-bottom: 24px; border-radius: 0 var(--r-md) var(--r-md) 0;">
        <strong>Privacy & Legal Consent Notice:</strong><br>
        Auto-capture records audio from all meeting participants. By enabling this, you confirm that you are responsible for complying with local recording-consent laws (many jurisdictions require notifying or obtaining consent from all call participants).
      </div>

      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button id="btn-decline-consent" class="btn" style="padding: 10px 18px;">Keep Manual-Only</button>
        <button id="btn-accept-consent" class="btn primary" style="padding: 10px 18px;">Enable & Opt-In</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('btn-accept-consent')?.addEventListener('click', async () => {
    await window.synapse.settings.updateAutocapture({ enabled: true, consentGranted: true });
    document.body.removeChild(modal);
    // Reload dashboard or settings if open
    const currentHash = window.location.hash.slice(1) || 'dashboard';
    if (currentHash === 'settings') renderSettings();
  });

  document.getElementById('btn-decline-consent')?.addEventListener('click', async () => {
    await window.synapse.settings.updateAutocapture({ enabled: false, consentGranted: true });
    document.body.removeChild(modal);
    const currentHash = window.location.hash.slice(1) || 'dashboard';
    if (currentHash === 'settings') renderSettings();
  });
}

// Render Settings Page
async function renderSettings() {
  contentArea.innerHTML = `
    <div class="flat-panel">
      <h2>Settings & Preferences</h2>
      <p style="color: var(--muted); margin-bottom: 24px;">Configure intelligence model execution, connection parameters, and auto-capture settings.</p>
      
      <div class="divider"></div>

      <h3 style="margin-top: 16px;">General Preferences</h3>
      <p style="font-size: 13.5px; color: var(--muted); margin-bottom: 20px;">Configure offline browser storage and local data caching preferences.</p>

      <div style="display: flex; flex-direction: column; gap: 18px; max-width: 600px; margin-bottom: 30px;">
        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--surface-soft); padding: 16px; border-radius: var(--r-md); border: 1px solid var(--hairline);">
          <div>
            <strong>Enable Local Storage Cache (Offline)</strong>
            <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">Save meeting transcripts to the browser cache for offline access.</div>
          </div>
          <label class="switch" style="position: relative; display: inline-block; width: 44px; height: 24px;">
            <input type="checkbox" id="toggle-local-cache" style="opacity: 0; width: 0; height: 0;">
            <span class="slider-cache" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--surface-card); transition: .3s; border-radius: 24px; border: 1px solid var(--hairline);"></span>
          </label>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--surface-soft); padding: 16px; border-radius: var(--r-md); border: 1px solid var(--hairline);">
          <div>
            <strong>Theme / Appearance</strong>
            <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">Configure the visual interface theme of the application.</div>
          </div>
          <select id="select-theme" style="width: 180px; padding: 6px 10px; background: var(--canvas); border: 1px solid var(--hairline); color: var(--ink); border-radius: var(--r-sm); outline: none; font-size: 13.5px; font-weight: 500;">
            <option value="system">⚡ System Theme</option>
            <option value="light">☀️ Light Theme</option>
            <option value="dark">🌙 Dark Theme</option>
          </select>
        </div>
      </div>

      <div class="divider"></div>

      <h3 style="margin-top: 16px;">Background Auto-Capture</h3>
      <p style="font-size: 13.5px; color: var(--muted); margin-bottom: 20px;">Silently detect, record, and process your calls without manual triggers.</p>

      <div style="display: flex; flex-direction: column; gap: 18px; max-width: 600px;">
        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--surface-soft); padding: 16px; border-radius: var(--r-md); border: 1px solid var(--hairline);">
          <div>
            <strong>Enable Auto-Capture</strong>
            <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">Opt-in to automatic meeting recording.</div>
          </div>
          <label class="switch" style="position: relative; display: inline-block; width: 44px; height: 24px;">
            <input type="checkbox" id="toggle-autocap" style="opacity: 0; width: 0; height: 0;">
            <span class="slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--surface-card); transition: .3s; border-radius: 24px; border: 1px solid var(--hairline);"></span>
          </label>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--surface-soft); padding: 16px; border-radius: var(--r-md); border: 1px solid var(--hairline);">
          <div>
            <strong>Show Recording Overlay Widget</strong>
            <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">Display floating overlay with Pause/Delete buttons during active recordings.</div>
          </div>
          <label class="switch" style="position: relative; display: inline-block; width: 44px; height: 24px;">
            <input type="checkbox" id="toggle-show-overlay" style="opacity: 0; width: 0; height: 0;">
            <span class="slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--surface-card); transition: .3s; border-radius: 24px; border: 1px solid var(--hairline);"></span>
          </label>
        </div>

        <div>
          <label>Detection Method</label>
          <select id="select-detection-method" style="width: 100%; padding: 10px; background: var(--canvas); border: 1px solid var(--hairline); color: var(--ink); border-radius: var(--r-md); outline: none;">
            <option value="app">App / Window detection (Zoom, Teams, Meet)</option>
            <option value="audio">Audio activity detection (System + Mic audio)</option>
            <option value="both">Both (Window focus + Audio backup)</option>
          </select>
        </div>

        <div>
          <label>Monitored Applications (Allow List)</label>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; background: var(--surface-soft); padding: 16px; border-radius: var(--r-md); border: 1px solid var(--hairline);">
            <label style="display: flex; align-items: center; gap: 8px; text-transform: none; font-weight: 500; color: var(--ink); margin: 0;">
              <input type="checkbox" class="app-checkbox" value="Zoom Meeting"> Zoom
            </label>
            <label style="display: flex; align-items: center; gap: 8px; text-transform: none; font-weight: 500; color: var(--ink); margin: 0;">
              <input type="checkbox" class="app-checkbox" value="Microsoft Teams"> Microsoft Teams
            </label>
            <label style="display: flex; align-items: center; gap: 8px; text-transform: none; font-weight: 500; color: var(--ink); margin: 0;">
              <input type="checkbox" class="app-checkbox" value="Google Meet"> Google Meet (Browser tabs)
            </label>
            <label style="display: flex; align-items: center; gap: 8px; text-transform: none; font-weight: 500; color: var(--ink); margin: 0;">
              <input type="checkbox" class="app-checkbox" value="Webex"> Cisco Webex
            </label>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div>
            <label>Storage Location</label>
            <input type="text" id="input-storage-path" readonly style="cursor: not-allowed; background: var(--surface-soft);">
          </div>
          <div>
            <label>Auto-Delete Raw Recordings</label>
            <select id="select-retention" style="width: 100%; padding: 10px; background: var(--canvas); border: 1px solid var(--hairline); color: var(--ink); border-radius: var(--r-md); outline: none;">
              <option value="1">After 1 day</option>
              <option value="3">After 3 days</option>
              <option value="7">After 7 days</option>
              <option value="14">After 14 days</option>
              <option value="0">Never delete raw audio</option>
            </select>
          </div>
        </div>

        <div style="margin-top: 10px;">
          <button id="btn-save-autocap-settings" class="btn primary" style="width: 100px;">Save Settings</button>
        </div>
      </div>
    </div>
  `;

  // Fetch current configs
  const generalSettings = await window.synapse.settings.get();
  const config = await window.synapse.settings.getAutocapture();

  const toggleLocalCacheEl = document.getElementById('toggle-local-cache') as HTMLInputElement;
  const themeEl = document.getElementById('select-theme') as HTMLSelectElement;
  const toggleEl = document.getElementById('toggle-autocap') as HTMLInputElement;
  const toggleShowOverlayEl = document.getElementById('toggle-show-overlay') as HTMLInputElement;
  const methodEl = document.getElementById('select-detection-method') as HTMLSelectElement;
  const storageEl = document.getElementById('input-storage-path') as HTMLInputElement;
  const retentionEl = document.getElementById('select-retention') as HTMLSelectElement;
  const checkboxes = document.querySelectorAll('.app-checkbox') as NodeListOf<HTMLInputElement>;

  if (toggleLocalCacheEl) toggleLocalCacheEl.checked = generalSettings?.enableLocalCache ?? true;
  if (themeEl) themeEl.value = localStorage.getItem('nexus_theme') || 'system';
  if (toggleEl) toggleEl.checked = config.enabled;
  if (toggleShowOverlayEl) toggleShowOverlayEl.checked = config.showOverlay ?? true;
  if (methodEl) methodEl.value = config.method;
  if (storageEl) storageEl.value = config.storagePath;
  if (retentionEl) retentionEl.value = String(config.retentionDays);

  checkboxes.forEach(cb => {
    cb.checked = config.appList.includes(cb.value);
  });

  // Simple slider color state togglers
  const sliderCache = document.querySelector('.slider-cache') as HTMLElement;
  if (sliderCache && toggleLocalCacheEl.checked) {
    sliderCache.style.backgroundColor = 'var(--primary)';
  }
  toggleLocalCacheEl?.addEventListener('change', () => {
    if (sliderCache) {
      sliderCache.style.backgroundColor = toggleLocalCacheEl.checked ? 'var(--primary)' : 'var(--surface-card)';
    }
  });

  const sliders = document.querySelectorAll('.slider') as NodeListOf<HTMLElement>;

  if (sliders[0] && toggleEl.checked) {
    sliders[0].style.backgroundColor = 'var(--primary)';
  }
  toggleEl?.addEventListener('change', () => {
    if (sliders[0]) {
      sliders[0].style.backgroundColor = toggleEl.checked ? 'var(--primary)' : 'var(--surface-card)';
    }
  });

  if (sliders[1] && toggleShowOverlayEl.checked) {
    sliders[1].style.backgroundColor = 'var(--primary)';
  }
  toggleShowOverlayEl?.addEventListener('change', () => {
    if (sliders[1]) {
      sliders[1].style.backgroundColor = toggleShowOverlayEl.checked ? 'var(--primary)' : 'var(--surface-card)';
    }
  });

  // Save Settings
  document.getElementById('btn-save-autocap-settings')?.addEventListener('click', async () => {
    const list: string[] = [];
    checkboxes.forEach(cb => {
      if (cb.checked) list.push(cb.value);
    });

    const payload = {
      enabled: toggleEl.checked,
      consentGranted: toggleEl.checked ? true : config.consentGranted,
      showOverlay: toggleShowOverlayEl.checked,
      method: methodEl.value,
      appList: list,
      retentionDays: parseInt(retentionEl.value)
    };

    // Save auto-capture settings
    await window.synapse.settings.updateAutocapture(payload);

    // Save general settings
    await window.synapse.settings.update({
      enableLocalCache: toggleLocalCacheEl.checked
    });

    // Save theme setting
    if (themeEl) {
      localStorage.setItem('nexus_theme', themeEl.value);
      applyTheme();
    }

    alert('Settings updated successfully.');
  });
}

// Render Workspace Page (Team Management)
async function renderWorkspace() {
  let members: any[] = [];
  let workspaceName = 'Loading Workspace...';

  async function loadWorkspaceData() {
    try {
      const workspace = await window.synapse.workspace.get();
      if (workspace) {
        workspaceName = workspace.name || 'Default Workspace';
        members = (workspace.members || []).map((m: any) => {
          const colors = ['#8a5e3d', '#3d8a7c', '#7c3d8a', '#8a3d3d', '#cc785c'];
          const colorIndex = Math.abs((m.user?.email || '').split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0) || 0) % colors.length;
          const avatarColor = colors[colorIndex] || '#cc785c';

          return {
            name: m.user?.name || m.user?.email?.split('@')[0] || 'Unknown User',
            email: m.user?.email || '',
            role: m.role || 'MEMBER',
            status: 'Online',
            avatarColor
          };
        });
      }
    } catch (e) {
      console.error('Failed to load active workspace user list:', e);
    }
  }

  function drawUI() {
    const listHtml = members.map(m => {
      const initial = m.name.slice(0, 2).toUpperCase();
      const statusColor = m.status === 'Online' ? 'var(--validated-green)' : 'var(--muted)';
      return `
        <div style="display: flex; align-items: center; justify-content: space-between; background: var(--surface-soft); padding: 12px; border-radius: var(--r-md); border: 1px solid var(--hairline);">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: ${m.avatarColor}; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">
              ${initial}
            </div>
            <div style="display: flex; flex-direction: column;">
              <strong style="font-size: 13.5px; color: var(--ink);">${m.name}</strong>
              <span style="font-size: 11px; color: var(--muted);">${m.email}</span>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
            <span style="font-size: 11px; font-weight: 600; padding: 2px 6px; background: var(--canvas); border-radius: 4px; color: var(--body);">${m.role}</span>
            <span style="font-size: 10px; color: ${statusColor}; display: flex; align-items: center; gap: 4px;">
              <span style="width: 6px; height: 6px; background: ${statusColor}; border-radius: 50%;"></span>
              ${m.status}
            </span>
          </div>
        </div>
      `;
    }).join('');

    contentArea.innerHTML = `
      <div class="flat-panel">
        <h2>Workspace: ${workspaceName}</h2>
        <p style="color: var(--muted); margin-bottom: 24px;">Manage your team members, workspace identities, and project clearance levels.</p>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px;">
          <!-- Team List Card -->
          <div class="flat-panel" style="margin: 0;">
            <h3>Active Members</h3>
            <p style="font-size: 13px; color: var(--muted); margin-bottom: 16px;">Clearance level mapping for meeting summary approval keys.</p>
            
            <div id="members-list" style="display: flex; flex-direction: column; gap: 12px;">
              ${listHtml.length ? listHtml : '<p style="color: var(--muted);">No other members in this workspace yet.</p>'}
            </div>
          </div>

          <!-- Add Member Form -->
          <div class="flat-panel" style="margin: 0; display: flex; flex-direction: column;">
            <h3>Invite Team Member</h3>
            <p style="font-size: 13px; color: var(--muted); margin-bottom: 20px;">Grant workspace access credentials and email dispatch roles.</p>
            
            <div style="display: flex; flex-direction: column; gap: 16px; flex: 1;">
              <div style="display: flex; flex-direction: column; gap: 6px;">
                <label style="font-size: 12.5px; font-weight: 600; color: var(--ink);">Full Name</label>
                <input type="text" id="member-name" style="padding: 10px; background: var(--canvas); border: 1px solid var(--hairline); color: var(--ink); border-radius: var(--r-md); font-family: inherit;" placeholder="e.g. John Doe">
              </div>

              <div style="display: flex; flex-direction: column; gap: 6px;">
                <label style="font-size: 12.5px; font-weight: 600; color: var(--ink);">Email Address</label>
                <input type="email" id="member-email" style="padding: 10px; background: var(--canvas); border: 1px solid var(--hairline); color: var(--ink); border-radius: var(--r-md); font-family: inherit;" placeholder="e.g. john@example.com">
              </div>

              <div style="display: flex; flex-direction: column; gap: 6px;">
                <label style="font-size: 12.5px; font-weight: 600; color: var(--ink);">Workspace Role</label>
                <select id="member-role" style="padding: 10px; background: var(--canvas); border: 1px solid var(--hairline); color: var(--ink); border-radius: var(--r-md); font-family: inherit;">
                  <option value="MEMBER">Member</option>
                  <option value="LEAD">Lead Owner</option>
                  <option value="EXECUTIVE">Executive</option>
                  <option value="VIEWER">Viewer</option>
                </select>
              </div>

              <button id="btn-add-member" class="btn primary" style="width: 100%; margin-top: auto; padding: 12px;">Invite to Workspace</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-add-member')?.addEventListener('click', async () => {
      const nameInput = document.getElementById('member-name') as HTMLInputElement;
      const emailInput = document.getElementById('member-email') as HTMLInputElement;
      const roleSelect = document.getElementById('member-role') as HTMLSelectElement;

      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      const role = roleSelect.value;

      if (!name || !email) {
        alert('Please fill in both name and email.');
        return;
      }

      const inviteBtn = document.getElementById('btn-add-member') as HTMLButtonElement;
      if (inviteBtn) {
        inviteBtn.disabled = true;
        inviteBtn.innerText = 'Inviting...';
      }

      const res = await window.synapse.workspace.invite({ name, email, role });
      if (res.success) {
        alert(`Successfully invited ${name} to the workspace!`);
        await loadWorkspaceData();
        drawUI();
      } else {
        alert(`Failed to invite member: ${res.error || 'Unknown error'}`);
        if (inviteBtn) {
          inviteBtn.disabled = false;
          inviteBtn.innerText = 'Invite to Workspace';
        }
      }
    });
  }

  await loadWorkspaceData();
  drawUI();
}


