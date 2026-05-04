# SaaS Telegram Bot System

A production-ready NestJS-based Telegram SaaS bot that lets users activate subscriptions, connect their personal Telegram accounts via MTProto, manage groups, create messages, and auto-send them on a schedule.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS (Node.js + TypeScript) |
| Telegram Bot | Telegraf |
| MTProto Client | gramJS (telegram) |
| Database | SQLite via Prisma ORM |
| Queue System | BullMQ + Redis |
| Encryption | crypto-js (AES) |

---

## Project Structure

```
src/
├── prisma/          # PrismaService (global DB client)
├── auth/            # Subscription activation & user management
├── session/         # MTProto session (gramJS) management
├── groups/          # Group sync & management
├── messages/        # Message CRUD
├── schedule/        # BullMQ scheduler & job processor
├── bot/             # Telegraf bot with all command handlers
└── common/          # Shared utilities (encryption)

prisma/
├── schema.prisma    # Database schema
├── seed.ts          # Sample data seeder
└── migrations/      # Auto-generated SQL migrations
```

---

## Prerequisites

- Node.js 18+
- Redis (for BullMQ queues)
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Telegram API credentials (from [my.telegram.org](https://my.telegram.org))

---

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```env
DATABASE_URL="file:./dev.db"
BOT_TOKEN="your_bot_token"
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH="your_api_hash"
ENCRYPTION_KEY="your_32_char_key!!"
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

### 3. Database Setup

```bash
# Run migrations (creates dev.db)
npm run db:migrate

# Generate Prisma client
npm run db:generate

# Seed with sample activation codes
npm run db:seed
```

### 4. Start the Bot

```bash
# Development (hot reload)
npm run start:dev

# Production
npm run build
npm run start:prod
```

---

## Database Schema

### Models & Relations

```
User ─┬─ ActivationCode (one-to-many, used_by)
      ├─ Session       (one-to-one)
      ├─ Group         (one-to-many)
      ├─ Message       (one-to-many)
      └─ Schedule      (one-to-many)
```

### Prisma Commands

```bash
npm run db:migrate          # Create + apply new migration
npm run db:generate         # Regenerate Prisma Client after schema change
npm run db:studio           # Open Prisma Studio (visual DB browser)
npm run db:seed             # Insert sample data
npm run db:reset            # Reset DB and re-seed
```

---

## Bot Commands

### Account
| Command | Description |
|---------|-------------|
| `/start` | Register & view status |
| `/activate <code>` | Activate subscription with a code |
| `/status` | View account & subscription info |
| `/help` | Show all commands |

### MTProto Connection
| Command | Description |
|---------|-------------|
| `/connect` | Start connecting your Telegram account |
| `/disconnect` | Disconnect the MTProto session |
| `/session_status` | Check connection status |

> After `/connect`, enter your phone number, then the OTP.

### Groups
| Command | Description |
|---------|-------------|
| `/sync_groups` | Fetch groups from your Telegram account |
| `/my_groups` | List all saved groups |

### Messages
| Command | Description |
|---------|-------------|
| `/add_message` | Add a text or media message |
| `/my_messages` | List all messages |
| `/del_message <id>` | Delete a message by ID |

### Scheduling
| Command | Description |
|---------|-------------|
| `/set_schedule <sec> [global\|sequential]` | Configure sending interval & mode |
| `/start_schedule` | Begin auto-sending |
| `/stop_schedule` | Stop auto-sending |
| `/schedule_status` | Check current scheduler state |

---

## Schedule Modes

| Mode | Behavior |
|------|---------|
| `global` | Sends the first message to all active groups every interval |
| `sequential` | Cycles through messages one by one on each tick |

---

## Seed Data

After running `npm run db:seed`:

| Code | Duration |
|------|----------|
| `DEMO-ACTIVATE-30D` | 30 days |
| `DEMO-ACTIVATE-90D` | 90 days |
| *(random codes)* | 30 / 90 / 365 days |

---

## Security

- MTProto session strings are **AES-encrypted** before storage
- Subscription expiry is enforced on every protected command
- Bot commands validate active subscription before proceeding

---

## Production Notes

1. Use a process manager like **PM2** for the Node process
2. Ensure **Redis** is running before starting the app
3. Store `.env` secrets securely (never commit to git)
4. Use `npm run start:prod` after `npm run build`
