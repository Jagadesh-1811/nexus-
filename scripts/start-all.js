const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Synapse Desktop App and Orchestrator Backend...');

// Resolve directories
const rootDir = path.resolve(__dirname, '..');
const backendDir = path.resolve(rootDir, 'backend');

// Start backend dev server
const backendProcess = spawn('npm', ['run', 'dev'], {
  cwd: backendDir,
  shell: true,
  env: { ...process.env }
});

// Start Electron client
const electronProcess = spawn('npm', ['run', 'electron:dev'], {
  cwd: rootDir,
  shell: true,
  env: { ...process.env }
});

// Helper to prefix output logs
function prefixLog(prefix, data) {
  const lines = data.toString().trim().split('\n');
  lines.forEach(line => {
    if (line) {
      console.log(`[${prefix}] ${line}`);
    }
  });
}

backendProcess.stdout.on('data', (data) => prefixLog('Backend', data));
backendProcess.stderr.on('data', (data) => prefixLog('Backend Error', data));

electronProcess.stdout.on('data', (data) => prefixLog('Electron', data));
electronProcess.stderr.on('data', (data) => prefixLog('Electron Error', data));

// Manage lifecycle
let isTerminating = false;
function terminateAll() {
  if (isTerminating) return;
  isTerminating = true;
  console.log('\n🛑 Shutting down backend and Electron processes...');
  
  try {
    if (process.platform === 'win32') {
      // Force kill process tree on Windows
      spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
      spawn('taskkill', ['/pid', electronProcess.pid, '/f', '/t']);
    } else {
      backendProcess.kill('SIGINT');
      electronProcess.kill('SIGINT');
    }
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
  
  process.exit();
}

electronProcess.on('close', (code) => {
  console.log(`[System] Electron client exited with code ${code}`);
  terminateAll();
});

backendProcess.on('close', (code) => {
  console.log(`[System] Backend exited with code ${code}`);
  terminateAll();
});

process.on('SIGINT', terminateAll);
process.on('SIGTERM', terminateAll);
process.on('exit', terminateAll);
