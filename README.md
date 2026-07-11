# Nexus: Local-First AI Meeting Workspace

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](#)
[![Stack](https://img.shields.io/badge/stack-Electron%20%7C%20Mastra%20%7C%20Ollama-blue)](#)
[![Database](https://img.shields.io/badge/database-PostgreSQL%20%7C%20Qdrant-orange)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](#)

Nexus is an offline-first meeting capture, transcription, and action item validation workspace. Designed for hackathons and fast-paced developer teams, Nexus uses local and cloud AI orchestration to capture meeting recordings, generate accurate transcripts, validate action items against adversarial AI critics, and organize commitments in an interactive dashboard command center.

---

## System Architecture

```mermaid
graph TD
    A[Meeting Audio / Live Recording] -->|Deepgram / Whisper| B(Speech-to-Text Transcription)
    B -->|Mastra Workflow Pipeline| C{Extraction Gate}
    C -->|Local Ollama LLM| D[Extract Action Items & Decisions]
    D -->|Ollama Adversarial Auditor| E{Groundedness Check}
    E -->|Approved / Flagged| F[(Supabase PostgreSQL)]
    E -->|Local Embeddings| G[(Qdrant Vector DB)]
    F -->|Real-Time Sync| H[Dashboard Command Center UI]
    G -->|Semantic Search| I[Ask Nexus Interface]
```

---

## Key Features

*   **Hybrid AI Core (Mastra + Ollama)**: Orchestrated AI workflow pipeline extracting structure, action items, and decisions from transcription text using local LLMs.
*   **Speech-to-Text Integration**: Seamless audio transcription using high-performance cloud providers (Deepgram) or fully offline engines (Whisper).
*   **Adversarial Validation Gate**: Local dual-model cross-check validating draft commitments against literal transcripts to flag hallucinations and unconfirmed assertions.
*   **Ask Nexus (Vector Memory)**: Semantic search memory powered by Qdrant vector database and Ollama embeddings (nomic-embed-text) allowing you to ask queries across past meetings.
*   **Commitment Dashboard**: Interactive dashboard center to view progress rails, approve pending/flagged commitments, and delete records cleanly.

---

## Installation Requirements

### Prerequisites
*   **Node.js**: v18.0.0 or later
*   **PostgreSQL**: A running instance (local or hosted on Supabase)
*   **Ollama**: Install Ollama Desktop on your machine.

### Installation Procedure

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/Jagadesh-1811/nexus-.git
    cd nexus-
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Setup the Database Schema**:
    Ensure your PostgreSQL connection string is in your .env file, then push the database schema:
    ```bash
    npx prisma db push
    npm run prisma:generate
    ```

---

## Quick Start

1.  **Start Ollama**:
    Ensure Ollama is running and start the daemon:
    ```powershell
    ollama serve
    ```

2.  **Pull Necessary AI Models**:
    Pull the default models used by the extraction, auditing, and vector memory steps:
    ```powershell
    ollama pull gpt-oss:20b-cloud
    ollama pull nomic-embed-text:latest
    ```

3.  **Launch the App**:
    Start the Electron desktop interface and orchestrator backend concurrently:
    ```bash
    npm run electron:dev
    ```

---

## Configuration

Configure your environment settings in the .env file at the root of the project:

```env
# Supabase & PostgreSQL Connection
SUPABASE_URL=https://your-supabase-url.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
DATABASE_URL="postgresql://postgres:password@host:5432/postgres"

# Ollama Local Configuration
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=gpt-oss:20b-cloud

# Cloud Transcription Service (Optional)
DEEPGRAM_API_KEY=your-deepgram-api-key

# Enkrypt AI Validator (Optional)
ENKRYPT_API_KEY=your-enkrypt-api-key
ENKRYPT_PROJECT_ID=default

# Qdrant Vector DB Search Settings
QDRANT_URL=https://your-qdrant-cluster.qdrant.io
QDRANT_API_KEY=your-qdrant-api-key
```

---

## License

This project is licensed under the MIT License.

---

## The Team

*   **Jagadeeshwar C V** 
*   **Shyam Yemuka** 
