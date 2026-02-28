# 🌉 Yojana-Setu — The Universal Welfare Companion

> AI-powered platform that helps Indian citizens discover, understand, and apply for government welfare schemes via WhatsApp in 22 Indian languages.

---

## Architecture

```
yojana-setu/
├── packages/
│   ├── shared/              # Types, interfaces, utilities, errors (build this first)
│   ├── gateway/             # API Gateway — Express.js, auth, rate limiting
│   ├── whatsapp-service/    # WhatsApp message routing, sessions, media
│   ├── voice-service/       # Bhashini ASR/TTS/translation integration
│   ├── scheme-service/      # Scheme matching, eligibility, explanations (GPT-4)
│   ├── profile-service/     # User profiles with AES-256 encryption
│   ├── document-service/    # OCR validation (AWS Textract)
│   └── notification-service/# Multi-channel notifications
├── infrastructure/
│   ├── docker/              # Dockerfiles
│   ├── db/                  # PostgreSQL init SQL
│   └── k8s/                 # Kubernetes manifests (Phase 5)
└── tests/
    ├── integration/         # End-to-end flows
    └── property/            # fast-check property tests
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.4 (strict mode) |
| Runtime | Node.js 20 |
| Package Manager | pnpm 8 (workspaces) |
| API Framework | Express.js 4 |
| Database | PostgreSQL 16 |
| Cache / Sessions | Redis 7 |
| Object Storage | AWS S3 (MinIO locally) |
| Conversation AI | OpenAI GPT-4 |
| Language API | Bhashini (GOI) |
| OCR | AWS Textract |
| WhatsApp | Twilio (dev) / Meta Business API (prod) |
| Testing | Jest + fast-check (property tests) |
| Containerization | Docker + docker-compose |

## Quick Start

### Prerequisites
- Node.js 20+
- pnpm 8+ (`npm install -g pnpm`)
- Docker + Docker Compose

### 1. Clone and install

```bash
git clone <repo>
cd yojana-setu
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
# Edit .env.local with your API keys
```

### 3. Start infrastructure

```bash
docker-compose up postgres redis minio -d
```

### 4. Build shared types

```bash
pnpm --filter @yojana-setu/shared build
```

### 5. Start the gateway

```bash
pnpm --filter @yojana-setu/gateway dev
```

Visit `http://localhost:3000/api/v1/health` to confirm it's running.

---

## API Keys You'll Need

| Service | Where to Get | Required for |
|---------|-------------|--------------|
| OpenAI | https://platform.openai.com | Conversation + scheme explanation |
| Bhashini | https://bhashini.gov.in/ulca | Voice processing + translation |
| Twilio | https://console.twilio.com | WhatsApp (dev sandbox) |
| AWS | https://aws.amazon.com | Textract OCR + S3 storage |

---

## Implementation Progress

- [x] Task 1: Project Setup & Core Infrastructure
- [ ] Task 2: User Profile Service
- [ ] Task 3: Scheme Database & Matching
- [ ] Task 4: Checkpoint
- [ ] Task 5: Voice Processing (Bhashini)
- [ ] Task 6: Document Validation (OCR)
- [ ] Task 7: WhatsApp Integration
- [ ] Task 8: Checkpoint
- [ ] Task 9: Application Tracking
- [ ] Task 10: Security & Privacy
- [ ] Task 11: Performance & Scaling
- [ ] Task 12: Advanced Features
- [ ] Task 13: Integration Testing
- [ ] Task 14: Deployment
- [ ] Task 15: Final Checkpoint

---

## Testing

```bash
# Run all tests
pnpm test

# Run property-based tests only
pnpm test:property

# Run tests for a specific service
pnpm --filter @yojana-setu/profile-service test
```

Property tests use [fast-check](https://fast-check.dev/) with minimum 100 iterations per property, as specified in the design document.

---

## Design Decisions

**Why PostgreSQL over MongoDB?**
User profiles and scheme data are highly relational. JSONB columns give us flexibility for dynamic fields (eligibility criteria, translations) while keeping strong consistency guarantees.

**Why GPT-4 for conversation?**
Scheme eligibility criteria written in complex government language needs strong reasoning to simplify accurately. GPT-4 handles multilingual simplification better than rule-based approaches.

**Why Twilio for WhatsApp (initially)?**
Instant sandbox access for development. The `IWhatsAppService` interface abstracts the provider, so switching to direct Meta Business API in production requires no changes to other services.

**Why BullMQ for event bus?**
Redis-backed queues are sufficient for this scale and eliminate a dependency on Kafka/RabbitMQ in early phases. The event contracts are defined in shared types for easy future migration.

---

## Services & Ports

| Service | Port | Responsibility |
|---------|------|----------------|
| `gateway` | 3000 | Request routing, rate limiting, auth |
| `profile-service` | 3001 | User demographics, AES-256 per-field encryption |
| `scheme-service` | 3002 | Eligibility scoring, GPT-4 explanations |
| `voice-service` | 3003 | Bhashini ASR/TTS, conversation state |
| `document-service` | 3004 | OCR validation, S3 encrypted storage |
| `whatsapp-service` | 3005 | Twilio webhook, 7 conversational flows |
| `application-service` | 3006 | FSM application lifecycle (DRAFT→DISBURSED) |
| `privacy-service` | 3007 | PDPB consent, data retention, audit chain |

## Testing

```bash
# Unit + property tests (no services needed)
pnpm test

# Property tests only (200 fast-check iterations each)
pnpm test:property

# Integration tests (requires docker-compose up)
pnpm test:integration

# All tests including integration
pnpm test:all
```

### Property Tests Coverage

| Property | Service | Invariant |
|----------|---------|-----------|
| 1 | voice-service | Language detection consistency |
| 2 | scheme-service | Eligibility score monotonicity |
| 3 | profile-service | Completion score ∈ [0,100] |
| 4 | document-service | Confidence scores ∈ [0,1] |
| 5 | whatsapp-service | Conversation flow completion |
| 6 | document-service | Validation idempotency |
| 7 | voice-service | Intent detection stability |
| 8 | whatsapp-service | Multi-turn context consistency |
| 9 | application-service | State machine integrity |
| 11 | application-service | Application idempotency |
| 12 | privacy-service | Consent integrity |
| 14 | privacy-service | Data retention compliance |

## Deployment

```bash
# Dev
docker-compose up --build

# Staging (auto on push to staging branch)
kubectl apply -k infrastructure/k8s/overlays/staging

# Production (requires GitHub Actions manual approval)
kubectl apply -k infrastructure/k8s/overlays/production
```

## Security

- AES-256-GCM encryption at rest, per-field keys
- Twilio webhook signature verification
- PostgreSQL row-level security on consent and audit tables
- SHA-256 tamper-evident audit hash chain (append-only)
- PDPB right to erasure: 30-day SLA, salt-shredding pseudonymisation
- Zero secrets in code — all via K8s Secrets / env vars
