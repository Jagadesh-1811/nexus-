# Product Requirements Document (PRD): Synapse Meeting Intelligence Agent

## 1. Executive Summary
**Synapse** is an AI-powered meeting intelligence agent designed to transform raw meeting recordings into validated, context-aware execution plans. Unlike standard transcription tools, Synapse maintains a "long-term memory" across multiple meetings using vector embeddings and employs a dedicated safety layer to validate AI-generated commitments, ensuring that action items are realistic and free from hallucinations.

## 2. Problem Statement
Teams often struggle with "meeting amnesia," where critical decisions and action items discussed during calls are lost or misremembered. Existing AI summarization tools often treat meetings as isolated events, losing context from previous discussions. Furthermore, Large Language Models (LLMs) are prone to "hallucinations"—inventing deadlines or assignees that weren't actually discussed—which creates manual overhead for verification and risks project misalignment.

## 3. Goals & Objectives
*   **Automated Execution:** Convert audio/video recordings into structured execution plans (decisions, tasks, deadlines, assignees) without manual intervention.
*   **High Integrity:** Use a dedicated validation gate (Enkrypt AI) to ensure 0% hallucination rate in finalized action items.
*   **Contextual Continuity:** Maintain cross-meeting memory to identify dependencies and project evolution over time.
*   **Autonomous Follow-up:** Drive project momentum by automatically pushing validated tasks to Jira, Slack, and email.

## 4. Target Users / Stakeholders
*   **Project Managers:** To track progress and identify blockers across multiple workstreams.
*   **Engineering Leads:** To ensure technical decisions are documented and Jira tickets are created accurately.
*   **Executive Leadership:** To receive high-level summaries of project health and risks.

## 5. Functional Requirements

### 5.1. Ingestion & Transcription
*   The system shall accept audio/video recording uploads via a web dashboard.
*   The system shall utilize high-fidelity transcription services (Whisper/Deepgram) to convert audio to text.

### 5.2. Intelligence Orchestration (The "Brain")
*   The system shall use **Mastra** and **LangChain.js** to coordinate the analysis workflow.
*   The system shall extract:
    *   Key Decisions
    *   Action Items (with specific assignees and deadlines)
    *   Project Risks and Blockers
    *   Cross-meeting dependencies.

### 5.3. Cross-Meeting Memory
*   The system shall query a vector database (**Qdrant**) before analysis to retrieve context from previous meetings.
*   The system shall index new meeting insights back into Qdrant to maintain a continuous project history.

### 5.4. Commitment Validation (The "Safety Gate")
*   Every extracted action item must pass through **Enkrypt AI** for validation.
*   The system shall flag and refine any commitments identified as hallucinations or unrealistic before they are persisted.

### 5.5. Autonomous Follow-ups
*   The system shall monitor the Execution Plan DB for new, validated entries.
*   The system shall autonomously trigger:
    *   **Jira:** Ticket creation for action items.
    *   **Slack:** Summary notifications and reminders.
    *   **SendGrid:** Follow-up emails to stakeholders.

### 5.6. Centralized Dashboard
*   A Next.js-based UI shall provide a real-time view of project progress, identified risks, and the status of automated follow-ups.

## 6. Non-Functional Requirements
*   **Language:** The entire backend and orchestration layer must be implemented in **TypeScript**.
*   **Type Safety:** End-to-end type safety from the dashboard to the database to minimize integration errors.
*   **Reliability:** The validation gate must act as a mandatory checkpoint; no data shall reach the Execution Plan DB without Enkrypt AI clearance.
*   **Performance:** The system should process a 60-minute meeting in under 5 minutes (asynchronous processing).

## 7. System Architecture Overview
The system follows a **Hub-and-Spoke Architecture** centered on the **Intelligence Orchestrator**:
1.  **Client Layer:** Next.js Dashboard for user interaction.
2.  **Intelligence Layer:** Mastra-based orchestrator managing Transcription, GPT-4o synthesis, and Enkrypt AI validation.
3.  **Data Layer:** Qdrant for semantic vector memory and PostgreSQL for relational execution plans.
4.  **Automation Layer:** A dedicated Follow-up Agent watching the database to trigger external APIs.

## 8. Tech Stack
*   **Frontend:** React, Next.js, Tailwind CSS.
*   **Orchestration:** TypeScript, Mastra, LangChain.js.
*   **LLM:** OpenAI GPT-4o.
*   **Transcription:** Whisper, Deepgram.
*   **Validation:** Enkrypt AI.
*   **Databases:** Qdrant (Vector), PostgreSQL (Relational).
*   **Integrations:** Slack API, Jira API, SendGrid.
*   **Cloud Infrastructure:** AWS.

## 9. Data Requirements
*   **Vector Data:** Semantic embeddings of meeting transcripts and decisions stored in Qdrant.
*   **Relational Data:** Structured tables in PostgreSQL for:
    *   Meetings (ID, Date, Participants, Transcript Link).
    *   Action Items (ID, Description, Assignee, Deadline, Status).
    *   Decisions (ID, Context, Impact).
*   **Data Flow:** Audio -> Transcript -> Vector Search (Context) -> Synthesis -> Validation -> SQL Persistence -> External Trigger.

## 10. API Specifications
*   `POST /api/ingest`: Accepts audio file/URL and initiates the orchestration pipeline.
*   `GET /api/execution-plan/:id`: Retrieves the validated plan for a specific meeting.
*   `POST /api/validate`: Internal endpoint for Enkrypt AI to verify draft commitments.
*   `GET /api/memory/search`: Queries Qdrant for relevant historical context.

## 11. Security Requirements
*   **Authentication:** Secure user access via Auth0 or Clerk.
*   **Data Integrity:** Mandatory validation gate via Enkrypt AI to prevent "dirty data" (hallucinations) from entering the system of record.
*   **Authorization:** Role-based access control (RBAC) to ensure users only see meetings they are authorized to view.

## 12. Deployment & Infrastructure
*   **Environment:** Node.js runtime for all TypeScript services.
*   **Cloud:** Hosted on AWS.
*   **CI/CD:** Automated pipelines for type-checking and deployment of the Next.js and Orchestrator services.

## 13. Success Metrics
*   **Extraction Accuracy:** >95% accuracy in identifying assignees and deadlines.
*   **Hallucination Rate:** 0% of hallucinated tasks reaching external integrations (Slack/Jira).
*   **User Efficiency:** 80% reduction in time spent manually creating follow-up tasks after meetings.
*   **Memory Recall:** Successful retrieval of relevant context in >90% of multi-part project discussions.

## 14. Timeline & Milestones
*   **Phase 1 (Core Pipeline):** Transcription + GPT-4o Extraction + PostgreSQL storage.
*   **Phase 2 (Memory & Safety):** Qdrant integration for cross-meeting context and Enkrypt AI validation gate.
*   **Phase 3 (Automation):** Follow-up Agent implementation with Slack and Jira integrations.
*   **Phase 4 (Dashboard):** Full Next.js UI for monitoring and manual overrides.

## 15. Open Questions & Risks
*   **Human-in-the-loop:** Should there be a manual "Approve" button on the dashboard before the Follow-up Agent creates Jira tickets?
*   **PII Redaction:** While removed for the MVP, will future enterprise requirements necessitate the re-introduction of PII scrubbing (e.g., Microsoft Presidio)?
*   **Scalability:** Handling very large meeting recordings (>2 hours) may require re-introducing a task queue (BullMQ) if the direct orchestrator approach hits timeout limits.