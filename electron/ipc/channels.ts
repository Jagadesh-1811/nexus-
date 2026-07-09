export const IPC_CHANNELS = {
  MEETINGS: {
    LIST: 'meetings:list',
    GET: 'meetings:get',
    APPROVE: 'meetings:approve'
  },
  INGEST: {
    UPLOAD: 'ingest:upload',
    PROGRESS: 'ingest:progress'
  },
  MEMORY: {
    SEARCH: 'memory:search',
    ASK: 'memory:ask'
  },
  SETTINGS: {
    GET: 'settings:get',
    UPDATE: 'settings:update',
    OLLAMA_STATUS: 'settings:ollama-status',
    OLLAMA_PULL: 'settings:ollama-pull'
  },
  AUTH: {
    GET_SESSION: 'auth:get-session',
    SIGN_IN: 'auth:sign-in',
    SIGN_UP: 'auth:sign-up',
    SIGN_OUT: 'auth:sign-out'
  },
  SYSTEM: {
    HEALTH: 'system:health',
    DOCKER_STATUS: 'system:docker-status',
    DOCKER_START: 'system:docker-start',
    DOCKER_STOP: 'system:docker-stop',
    RESOURCES: 'system:resources'
  },
  NATIVE: {
    OPEN_FILE_DIALOG: 'native:open-file-dialog',
    SHOW_NOTIFICATION: 'native:show-notification',
    REVEAL_EXPLORER: 'native:reveal-explorer'
  }
} as const;
