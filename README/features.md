# Done
## 🔐 Auth & User Management
- Email/password signup & login
- Google OAuth (code flow + ID token)
- JWT access + refresh token rotation
- Change password

# Tobe Implemented


## 🔐 Auth & User Management

- Account deactivation
- Role-based access (USER / ADMIN)

---

## 💸 Expense Management
- Create / read / update / delete expenses
- Bulk delete
- Filter by date range, category, search
- Pagination
- Expense stats (total, avg, min, max)
- Category breakdown
- 8 categories (Dining, Shopping, Transport, etc.)

---

## 🤖 AI Chat Agent
- Multi-provider LLM (OpenAI / Gemini / Groq)
- SSE streaming responses
- Add expense via natural language
- Query past expenses via chat
- Generate chart data via chat
- Delete expense via chat
- Topic guard (off-topic rejection)
- Per-user conversation memory
- Per-thread chat history (DB-persisted)
- Tool call announcements in stream

---

## 🛡️ Security & Infrastructure
- Helmet security headers
- CORS with allowlist
- Rate limiting (API / Auth / Chat)
- Input validation (Zod schemas)
- Bcrypt password hashing
- Environment validation at startup
- Graceful shutdown
- Global error handler
- 404 handler
- Prisma P2002 / P2025 error handling

---

## ❌ Not Built Yet (SaaS Opportunities)

### 💰 Monetization
- Subscription plans (Free / Pro / Business)
- Usage-based limits per plan
- Stripe billing integration
- Invoice generation

### 📊 Analytics
- Month-over-month trends
- Spending anomaly detection
- Budget forecasting
- Recurring expense detection
- Spending score / health index

### 🔔 Notifications
- Budget threshold alerts
- Weekly/monthly digest emails
- Unusual spending spike alerts
- In-app notification center

### 👥 Multi-user / Teams
- Workspace model
- Invite members
- Shared expense tracking
- Role-based workspace permissions
- Accountant / client access model

### 🏦 Bank & UPI Integration
- UPI SMS auto-import
- Bank statement CSV import
- Plaid integration (international)
- Auto-categorization of imports

### 🧾 Receipt OCR
- Upload receipt photo
- Extract merchant, amount, date, category
- Auto-fill expense form
- Attach receipt image to expense

### 🧠 AI Enhancements
- Persistent AI memory per user
- Proactive spending insights
- Natural language budget setting
- AI-generated monthly reports
- Smart category suggestions

### 📁 Export & Integrations
- CSV / PDF export
- Google Sheets sync
- Tally / QuickBooks integration
- GST-ready reports (India)
- Zapier / webhook support

### 🔄 Budgets & Goals
- Monthly category budgets
- Savings goals with progress tracking
- Overspend warnings
- Budget vs actual reports

### 🛡️ Compliance & Admin
- Immutable audit logs
- Admin dashboard
- User management panel
- Usage analytics per user
- Data retention policies
- GDPR / data export / delete account

### 🌍 Localization
- Multi-currency support
- Live exchange rates
- Regional tax handling
- Language localization