export {};

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
        onProgress: (callback: (event: any, progress: any) => void) => () => void;
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
    };
  }
}

// Router & Page Navigation Setup
const contentArea = document.getElementById('content') as HTMLElement;
const navItems = document.querySelectorAll('.nav-item');

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
  }
}

async function checkAuthAndNavigate(page: string) {
  try {
    const session = await window.synapse.auth.getSession();
    if (!session) {
      renderLogin();
      return;
    }
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.display = 'flex';
    navigateToPage(page);
  } catch (err) {
    renderLogin();
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
      <p style="color: #8892B0; margin-bottom: 24px;">Real-time view of verified tasks, local intelligence node status, and team activity.</p>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1-fraction)); gap: 20px;">
        <div class="flat-panel" style="margin: 0;">
          <h3>Trust Meter Level</h3>
          <div style="font-size: 36px; font-weight: bold; color: var(--validated-green); margin: 12px 0;">87%</div>
          <p style="font-size: 12px; color: #8892B0;">Auto-dispatch threshold set to 85%. Autonomy enabled for low-risk actions.</p>
        </div>
        <div class="flat-panel" style="margin: 0;">
          <h3>Meetings Transcribed</h3>
          <div style="font-size: 36px; font-weight: bold; color: var(--text-color); margin: 12px 0;">12</div>
          <p style="font-size: 12px; color: #8892B0;">3 new actions pending validation in the court.</p>
        </div>
      </div>
    </div>
    
    <div class="flat-panel">
      <h2>Recent Verified Commitments</h2>
      <div id="verified-items-container">Loading...</div>
    </div>
  `;

  try {
    const meetings = await window.synapse.meetings.list();
    const container = document.getElementById('verified-items-container');
    if (container) {
      if (meetings.length === 0) {
        container.innerHTML = `<p style="color: #8892B0;">No verified commitments found.</p>`;
      } else {
        container.innerHTML = meetings.map((m: any) => `
          <div class="action-item-card validated">
            <div style="display: flex; justify-content: space-between;">
              <strong>${m.title}</strong>
              <span class="mono" style="font-size: 11px; color: #8892B0;">${m.created_at ? m.created_at.slice(0, 10) : ''}</span>
            </div>
            <p style="margin: 8px 0; font-size: 14px;">${m.transcript_raw || ''}</p>
            <div class="clearance-rail">
              <span class="rail-node active-green">Extracted</span>
              <span class="rail-node active-green">Validated</span>
              <span class="rail-node">Dispatched</span>
            </div>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error(err);
  }
}

// Render Upload & Listen
function renderUpload() {
  contentArea.innerHTML = `
    <div class="flat-panel">
      <h2>Ingest & Record Meetings</h2>
      <p style="color: #8892B0; margin-bottom: 20px;">Upload raw audio or record your live meetings. Nexus extracts action items locally.</p>
      
      <div style="display: flex; gap: 20px; margin-bottom: 20px;">
        <div style="flex: 1; border: 2px dashed var(--border-color); padding: 40px; text-align: center; border-radius: 4px; background: rgba(18, 24, 32, 0.5);">
          <h3>📁 File Upload</h3>
          <button id="btn-select-file" class="btn primary" style="margin-top: 12px;">Browse Local Files</button>
        </div>

        <div style="flex: 1; border: 2px solid var(--border-color); padding: 40px; text-align: center; border-radius: 4px; background: rgba(18, 24, 32, 0.8);">
          <h3>🎙️ Live Listener</h3>
          <div style="margin-top: 12px; display: flex; gap: 10px; justify-content: center; align-items: center;">
            <button id="btn-start-record" class="btn primary" style="background-color: var(--neon-accent); color: black;">▶ Start</button>
            <button id="btn-stop-record" class="btn" style="background-color: #ff4c4c; color: white;" disabled>⏹ Stop</button>
          </div>
          <div id="recording-indicator" style="display: none; margin-top: 12px; color: #ff4c4c; font-weight: bold; animation: pulse 1.5s infinite;">
            🔴 Recording...
          </div>
          <div style="margin-top: 20px;">
            <label style="color: #8892B0; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 8px;">
              <input type="checkbox" id="toggle-local-storage" checked>
              Enable Local Storage Cache (Offline)
            </label>
          </div>
        </div>
      </div>

      <div id="upload-status" class="flat-panel" style="margin-top: 24px; display: none;">
        <h3>Pipeline Progress</h3>
        <div style="background: #1e293b; height: 8px; border-radius: 4px; margin: 12px 0; overflow: hidden;">
          <div id="progress-bar" style="background: var(--validated-green); width: 0%; height: 100%; transition: width 0.3s;"></div>
        </div>
        <p id="progress-status-msg" style="font-size: 13px; color: var(--flagged-amber);">Initiating transcription...</p>
      </div>
    </div>
    <style>
      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
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
  const localStorageToggle = document.getElementById('toggle-local-storage') as HTMLInputElement;

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
          if (localStorageToggle.checked && res.transcript) {
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

    const unsubscribe = window.synapse.ingest.onProgress((_event: any, data: any) => {
      const progressBar = document.getElementById('progress-bar');
      const statusMsg = document.getElementById('progress-status-msg');
      if (progressBar) progressBar.style.width = `${data.progress}%`;
      if (statusMsg) statusMsg.innerText = `[${data.stage}] ${data.message}`;

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
      <p style="color: #8892B0; margin-bottom: 20px;">Review action items flagged by the local LLM validation cross-check before dispatching.</p>
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

    const res = await window.synapse.meetings.get(meetings[0].id);
    if (container) {
      const flagged = res.actionItems.filter((i: any) => i.status.toLowerCase() === 'flagged');
      if (flagged.length === 0) {
        container.innerHTML = `<p style="color: var(--validated-green);">No flagged items. All commitments clear.</p>`;
      } else {
        container.innerHTML = flagged.map((item: any) => `
          <div class="flat-panel" style="background: #1A1310; border-color: var(--flagged-amber);">
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
              <strong style="color: var(--flagged-amber);">Flagged Action Item:</strong>
              <span class="mono" style="font-size: 11px; color: #8892B0;">ID: ${item.id}</span>
            </div>
            
            <p style="margin: 8px 0; font-size: 15px;">"${item.description}"</p>
            
            <div style="background: rgba(0,0,0,0.2); padding: 12px; margin: 12px 0; border-radius: 4px;">
              <span style="font-size: 11px; color: var(--risk-red); text-transform: uppercase; font-weight: bold; display: block; margin-bottom: 4px;">Adversarial Critic Objection:</span>
              <p style="font-size: 13px; color: #EDEAE3;">${item.validation_notes || 'Action item requires manual refinement or verification.'}</p>
            </div>

            <div style="background: rgba(237, 234, 227, 0.05); padding: 8px 12px; font-style: italic; font-size: 13px; border-left: 3px solid #8892B0;">
              Context transcript snippet: "... ${item.description} ..."
            </div>

            <div style="margin-top: 16px; display: flex; gap: 8px;">
              <button class="btn primary" onclick="approveFlagged('${item.id}')">Force Approve</button>
              <button class="btn" onclick="editFlagged('${item.id}')">Edit Commitment</button>
            </div>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error(err);
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
function renderBlockerWeb() {
  contentArea.innerHTML = `
    <div class="flat-panel">
      <h2>Blocker Web</h2>
      <p style="color: #8892B0; margin-bottom: 20px;">Force-directed dependency graph of cross-meeting blockers and unresolved risks.</p>
      
      <div style="display: flex; justify-content: center; background: #080C10; border: 1px solid var(--border-color); border-radius: 4px; padding: 40px;">
        <svg width="400" height="300" style="overflow: visible;">
          <!-- Simple inline SVG force-directed representation -->
          <line x1="100" y1="150" x2="200" y2="150" stroke="#1E293B" stroke-width="2"></line>
          <line x1="200" y1="150" x2="300" y2="150" stroke="#1E293B" stroke-width="2"></line>
          
          <circle cx="100" cy="150" r="14" fill="var(--risk-red)"></circle>
          <text x="100" y="180" fill="#EDEAE3" font-size="11" text-anchor="middle">API Schema Blocker</text>
          
          <circle cx="200" cy="150" r="12" fill="var(--flagged-amber)"></circle>
          <text x="200" y="180" fill="#EDEAE3" font-size="11" text-anchor="middle">DB Migration</text>
          
          <circle cx="300" cy="150" r="10" fill="var(--validated-green)"></circle>
          <text x="300" y="180" fill="#EDEAE3" font-size="11" text-anchor="middle">Release August 15</text>
        </svg>
      </div>
    </div>
  `;
}

// Render Ask Synapse Query Interface
function renderAskSynapse() {
  contentArea.innerHTML = `
    <div class="flat-panel">
      <h2>Ask Nexus</h2>
      <p style="color: #8892B0; margin-bottom: 20px;">Ask plain-language questions across the local cross-meeting memory. Powered offline by Ollama.</p>
      
      <div style="display: flex; gap: 10px; margin-bottom: 20px;">
        <input type="text" id="ask-input" style="flex: 1; padding: 12px; background: #121820; border: 1px solid var(--border-color); color: #EDEAE3; border-radius: 4px;" placeholder="e.g. What database tasks were assigned to Bob?">
        <button id="btn-ask" class="btn primary">Query Memory</button>
      </div>

      <div id="ask-response" class="flat-panel" style="display: none; background: #131A24;">
        <h3>Answer</h3>
        <p id="answer-text" style="font-size: 15px; margin: 12px 0;"></p>
        <div style="border-top: 1px solid var(--border-color); padding-top: 10px;">
          <span style="font-size: 11px; color: var(--validated-green); text-transform: uppercase; font-weight: bold;">Citations:</span>
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
        <div style="font-size: 12px; background: rgba(0,0,0,0.1); padding: 6px 10px; border-radius: 4px; margin-bottom: 6px;" class="mono">
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
      <h2 id="auth-title">Sign In to Nexus</h2>
      <p style="color: #8892B0; margin-bottom: 20px; font-size: 13px;">Secure offline-first desktop intelligence console.</p>
      
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div>
          <label style="display: block; font-size: 12px; margin-bottom: 6px; color: #8892B0;">Email Address</label>
          <input type="email" id="auth-email" style="width: 100%; padding: 10px; background: #121820; border: 1px solid var(--border-color); color: #EDEAE3; border-radius: 4px; border-style: solid;">
        </div>
        <div>
          <label style="display: block; font-size: 12px; margin-bottom: 6px; color: #8892B0;">Password</label>
          <input type="password" id="auth-password" style="width: 100%; padding: 10px; background: #121820; border: 1px solid var(--border-color); color: #EDEAE3; border-radius: 4px; border-style: solid;">
        </div>
        <div id="auth-error-msg" style="color: var(--risk-red); font-size: 12px; display: none;"></div>
        <button id="btn-auth-submit" class="btn primary" style="width: 100%; padding: 12px;">Sign In</button>
        
        <div style="text-align: center; margin-top: 10px; font-size: 12px;">
          <a href="#" id="auth-toggle" style="color: var(--validated-green); text-decoration: none;">Don't have an account? Sign Up</a>
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
