import { Resend } from 'resend';
import { env } from '../config/env';

// ─── Local helpers ────────────────────────────────────────────────────────────

function fmtEmail(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

function fmtDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

const CATEGORY_EMOJI: Record<string, string> = {
  DINING: '🍽️',
  SHOPPING: '🛍️',
  TRANSPORT: '🚗',
  ENTERTAINMENT: '🎬',
  UTILITIES: '⚡',
  HEALTH: '🏥',
  EDUCATION: '📚',
  OTHER: '📦',
};

const CATEGORY_COLOR: Record<string, string> = {
  DINING:        '#F97316',
  SHOPPING:      '#A855F7',
  TRANSPORT:     '#3B82F6',
  ENTERTAINMENT: '#EC4899',
  UTILITIES:     '#EAB308',
  HEALTH:        '#22C55E',
  EDUCATION:     '#06B6D4',
  OTHER:         '#6B7280',
};

const resend = new Resend(env.RESEND_API_KEY);

// ─── Base HTML wrapper ────────────────────────────────────────────────────────

const baseHtml = (content: string, previewText = '') => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Spendly</title>
  ${previewText ? `<span style="display:none;max-height:0;overflow:hidden;">${previewText}</span>` : ''}
</head>
<body style="margin:0;padding:0;background:#09090B;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090B;">
    <tr>
      <td align="center" style="padding:48px 16px 40px;">
        <table width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">

          <!-- Wordmark -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:10px;">
                    <div style="background:#18181B;border:1px solid #27272A;border-radius:8px;width:30px;height:30px;text-align:center;line-height:30px;font-size:15px;">⚡</div>
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-size:16px;font-weight:700;color:#FAFAFA;letter-spacing:-0.3px;">Spendly</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#18181B;border:1px solid #27272A;border-radius:16px;padding:0;overflow:hidden;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="font-size:12px;color:#52525B;margin:0;line-height:1.7;">
                © ${new Date().getFullYear()} Spendly Inc. · <a href="${env.FRONTEND_URL}" style="color:#52525B;text-decoration:underline;">spendly.app</a><br/>
                If you didn't request this email, you can safely ignore it.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

// ─── Section helpers ──────────────────────────────────────────────────────────

function cardHeader(emoji: string, title: string, subtitle: string, accentColor = '#FAFAFA') {
  return `
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:28px 28px 24px;border-bottom:1px solid #27272A;">
        <div style="font-size:11px;color:#71717A;text-transform:uppercase;letter-spacing:1.5px;font-weight:600;margin-bottom:12px;">${emoji} &nbsp;${title.toUpperCase()}</div>
        <div style="font-size:22px;font-weight:700;color:${accentColor};letter-spacing:-0.5px;line-height:1.3;">${subtitle}</div>
      </td>
    </tr>
  </table>`;
}

function statRow(label: string, value: string, valueColor = '#FAFAFA') {
  return `
  <tr>
    <td style="padding:10px 0;font-size:13px;color:#71717A;border-bottom:1px solid #27272A;">${label}</td>
    <td style="padding:10px 0;font-size:13px;font-weight:600;color:${valueColor};text-align:right;border-bottom:1px solid #27272A;">${value}</td>
  </tr>`;
}

function ctaButton(href: string, label: string) {
  return `
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:24px 28px 28px;">
        <a href="${href}" style="display:block;text-align:center;background:#FAFAFA;color:#09090B;font-weight:600;font-size:14px;padding:13px 24px;border-radius:8px;text-decoration:none;letter-spacing:0.1px;">
          ${label} →
        </a>
      </td>
    </tr>
  </table>`;
}

// ─── Send Verification Email ──────────────────────────────────────────────────

export async function sendVerificationEmail(
  to: string,
  name: string,
  token: string,
): Promise<void> {
  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${token}`;

  const content = `
  ${cardHeader('✉️', 'Email Verification', `Hi ${name}, confirm your email address.`)}
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:24px 28px 0;">
        <p style="font-size:14px;color:#A1A1AA;margin:0 0 24px;line-height:1.7;">
          Thanks for signing up for Spendly! Click the button below to verify your email address and activate your account. This link expires in <strong style="color:#FAFAFA;">24 hours</strong>.
        </p>
        <a href="${verifyUrl}" style="display:block;text-align:center;background:#FAFAFA;color:#09090B;font-weight:600;font-size:14px;padding:13px 24px;border-radius:8px;text-decoration:none;letter-spacing:0.1px;margin-bottom:20px;">
          Verify Email Address →
        </a>
        <div style="background:#111113;border:1px solid #27272A;border-radius:8px;padding:12px 16px;">
          <p style="font-size:11px;color:#52525B;font-family:monospace;margin:0 0 4px;">Or copy this link:</p>
          <p style="font-size:11px;color:#71717A;font-family:monospace;word-break:break-all;margin:0;">${verifyUrl}</p>
        </div>
      </td>
    </tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:0 0 28px;"></td></tr>
  </table>`;

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: 'Verify your Spendly email address',
    html: baseHtml(content, `Hi ${name}, please verify your email address to get started.`),
  });
}

// ─── Send Password Reset Email ────────────────────────────────────────────────

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  token: string,
): Promise<void> {
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`;

  const content = `
  ${cardHeader('🔐', 'Password Reset', `Hi ${name}, reset your password.`)}
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:24px 28px 0;">
        <p style="font-size:14px;color:#A1A1AA;margin:0 0 24px;line-height:1.7;">
          We received a request to reset the password for your Spendly account. Click the button below to choose a new password. This link expires in <strong style="color:#FAFAFA;">1 hour</strong>.
        </p>
        <a href="${resetUrl}" style="display:block;text-align:center;background:#FAFAFA;color:#09090B;font-weight:600;font-size:14px;padding:13px 24px;border-radius:8px;text-decoration:none;letter-spacing:0.1px;margin-bottom:20px;">
          Reset Password →
        </a>
        <div style="background:#1C1009;border:1px solid #3D1F00;border-radius:8px;padding:12px 16px;">
          <p style="font-size:12px;color:#FB923C;margin:0;">
            ⚠ &nbsp;If you didn't request a password reset, your account is safe. You can safely ignore this email.
          </p>
        </div>
      </td>
    </tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:0 0 28px;"></td></tr>
  </table>`;

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: 'Reset your Spendly password',
    html: baseHtml(content, 'Reset your Spendly password. This link expires in 1 hour.'),
  });
}

// ─── Send Budget Alert Email ──────────────────────────────────────────────────

export async function sendBudgetAlertEmail(
  to: string,
  name: string,
  category: string,
  spent: number,
  limit: number,
  pct: number,
  currency: string,
  isExceeded: boolean,
): Promise<void> {
  try {
    const emoji = CATEGORY_EMOJI[category] ?? '📦';
    const budgetUrl = `${env.FRONTEND_URL}/budget`;
    const subject = isExceeded
      ? `Budget Exceeded — ${emoji} ${category}`
      : `Budget Warning — ${emoji} ${category}`;
    const accentColor = isExceeded ? '#F87171' : '#FBBF24';
    const barColor   = isExceeded ? '#EF4444' : '#F59E0B';
    const barWidth   = Math.min(pct, 100);
    const statusLabel = isExceeded ? 'EXCEEDED' : 'WARNING';

    const content = `
  ${cardHeader(isExceeded ? '🚨' : '⚠️', `Budget ${statusLabel}`, `${emoji} ${category}`, accentColor)}
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:24px 28px 0;">
        <p style="font-size:14px;color:#A1A1AA;margin:0 0 20px;line-height:1.7;">
          Hi ${name}, your <strong style="color:#FAFAFA;">${category}</strong> budget has reached <strong style="color:${accentColor};">${Math.round(pct)}%</strong> of the limit.
        </p>

        <!-- Stats row -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
          <tr>
            <td style="width:50%;vertical-align:top;">
              <div style="font-size:10px;color:#71717A;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:4px;">Spent</div>
              <div style="font-size:22px;font-weight:700;color:${accentColor};letter-spacing:-0.5px;">${fmtEmail(spent, currency)}</div>
            </td>
            <td style="width:50%;vertical-align:top;text-align:right;">
              <div style="font-size:10px;color:#71717A;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:4px;">Budget Limit</div>
              <div style="font-size:22px;font-weight:700;color:#FAFAFA;letter-spacing:-0.5px;">${fmtEmail(limit, currency)}</div>
            </td>
          </tr>
        </table>

        <!-- Progress bar -->
        <div style="background:#27272A;border-radius:100px;height:6px;overflow:hidden;margin-bottom:6px;">
          <div style="background:${barColor};height:100%;width:${barWidth}%;border-radius:100px;"></div>
        </div>
        <p style="font-size:11px;color:#52525B;text-align:right;margin:0 0 20px;">${Math.round(pct)}% of budget used</p>
      </td>
    </tr>
  </table>
  ${ctaButton(budgetUrl, 'Manage Budgets')}`;

    await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject,
      html: baseHtml(content, `Your ${category} budget has reached ${Math.round(pct)}% of the limit.`),
    });
  } catch (err) {
    console.error('sendBudgetAlertEmail error:', err);
  }
}

// ─── Send Large Expense Alert Email ──────────────────────────────────────────

export async function sendLargeExpenseAlertEmail(
  to: string,
  name: string,
  expenseTitle: string,
  expenseAmount: number,
  expenseCurrency: string,
  convertedAmount: number,
  homeCurrency: string,
  category: string,
  date: string,
  threshold: number,
): Promise<void> {
  try {
    const emoji = CATEGORY_EMOJI[category] ?? '📦';
    const catColor = CATEGORY_COLOR[category] ?? '#6B7280';
    const expensesUrl = `${env.FRONTEND_URL}/expenses`;

    const content = `
  ${cardHeader('💸', 'Large Expense Detected', expenseTitle)}
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:24px 28px 0;">
        <p style="font-size:14px;color:#A1A1AA;margin:0 0 20px;line-height:1.7;">
          Hi ${name}, a transaction exceeding your alert threshold of <strong style="color:#FAFAFA;">${fmtEmail(threshold, homeCurrency)}</strong> was just recorded.
        </p>

        <!-- Expense card -->
        <div style="background:#111113;border:1px solid #27272A;border-radius:10px;padding:16px;margin-bottom:20px;">
          <div style="display:flex;align-items:center;margin-bottom:12px;">
            <span style="display:inline-block;background:${catColor}22;border:1px solid ${catColor}44;color:${catColor};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding:3px 8px;border-radius:4px;">${emoji} ${category}</span>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${statRow('Amount', fmtEmail(expenseAmount, expenseCurrency))}
            ${expenseCurrency !== homeCurrency ? statRow('Converted', fmtEmail(convertedAmount, homeCurrency), '#A1A1AA') : ''}
            ${statRow('Date', fmtDate(date))}
            ${statRow('Alert Threshold', fmtEmail(threshold, homeCurrency), '#FBBF24')}
          </table>
        </div>
      </td>
    </tr>
  </table>
  ${ctaButton(expensesUrl, 'View in Expenses')}`;

    await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: `Large expense detected — ${expenseTitle}`,
      html: baseHtml(content, `${fmtEmail(convertedAmount, homeCurrency)} at ${expenseTitle} detected.`),
    });
  } catch (err) {
    console.error('sendLargeExpenseAlertEmail error:', err);
  }
}

// ─── Send Weekly Report Email ─────────────────────────────────────────────────

export interface WeeklyData {
  fromDate: string;
  toDate: string;
  total: number;
  count: number;
  currency: string;
  byCategory: Array<{ category: string; amount: number; count: number }>;
}

export async function sendWeeklyReportEmail(
  to: string,
  name: string,
  data: WeeklyData,
): Promise<void> {
  try {
    const topCategories = data.byCategory.slice(0, 5);

    const categoryRows = topCategories.map((c) => {
      const emoji = CATEGORY_EMOJI[c.category] ?? '📦';
      const catColor = CATEGORY_COLOR[c.category] ?? '#6B7280';
      const pct = data.total > 0 ? Math.round((c.amount / data.total) * 100) : 0;
      return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #27272A;">
          <span style="display:inline-block;background:${catColor}22;border:1px solid ${catColor}44;color:${catColor};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding:2px 7px;border-radius:4px;">${emoji} ${c.category}</span>
        </td>
        <td style="padding:10px 0;font-size:13px;font-weight:600;color:#FAFAFA;text-align:right;border-bottom:1px solid #27272A;">${fmtEmail(c.amount, data.currency)}</td>
        <td style="padding:10px 0;font-size:11px;color:#52525B;text-align:right;border-bottom:1px solid #27272A;padding-left:12px;">${pct}%</td>
      </tr>`;
    }).join('');

    const insightsUrl = `${env.FRONTEND_URL}/insights`;

    const content = `
  ${cardHeader('📊', 'Weekly Report', `${fmtDate(data.fromDate)} – ${fmtDate(data.toDate)}`)}
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:24px 28px 0;">
        <p style="font-size:14px;color:#A1A1AA;margin:0 0 20px;line-height:1.7;">
          Hi ${name}, here's your weekly spending summary.
        </p>

        <!-- Hero stats -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#111113;border:1px solid #27272A;border-radius:10px;margin-bottom:20px;">
          <tr>
            <td style="padding:18px 20px;width:50%;border-right:1px solid #27272A;">
              <div style="font-size:10px;color:#71717A;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:4px;">Total Spent</div>
              <div style="font-size:24px;font-weight:700;color:#FAFAFA;letter-spacing:-0.5px;">${fmtEmail(data.total, data.currency)}</div>
            </td>
            <td style="padding:18px 20px;">
              <div style="font-size:10px;color:#71717A;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:4px;">Transactions</div>
              <div style="font-size:24px;font-weight:700;color:#FAFAFA;letter-spacing:-0.5px;">${data.count}</div>
            </td>
          </tr>
        </table>

        ${topCategories.length > 0 ? `
        <!-- Category breakdown -->
        <div style="margin-bottom:20px;">
          <p style="font-size:10px;color:#71717A;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin:0 0 10px;">Top Categories</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${categoryRows}
          </table>
        </div>` : ''}
      </td>
    </tr>
  </table>
  ${ctaButton(insightsUrl, 'View Full Insights')}`;

    await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: `Weekly report — ${fmtDate(data.fromDate)} to ${fmtDate(data.toDate)}`,
      html: baseHtml(content, `You spent ${fmtEmail(data.total, data.currency)} across ${data.count} transactions this week.`),
    });
  } catch (err) {
    console.error('sendWeeklyReportEmail error:', err);
  }
}

// ─── Send Monthly Summary Email ───────────────────────────────────────────────

export interface MonthlyData {
  monthLabel: string;
  total: number;
  count: number;
  dailyAvg: number;
  currency: string;
  byCategory: Array<{ category: string; amount: number; count: number }>;
}

export async function sendMonthlySummaryEmail(
  to: string,
  name: string,
  data: MonthlyData,
): Promise<void> {
  try {
    const topCategories = data.byCategory.slice(0, 5);

    const categoryRows = topCategories.map((c) => {
      const emoji = CATEGORY_EMOJI[c.category] ?? '📦';
      const catColor = CATEGORY_COLOR[c.category] ?? '#6B7280';
      const pct = data.total > 0 ? Math.round((c.amount / data.total) * 100) : 0;
      return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #27272A;">
          <span style="display:inline-block;background:${catColor}22;border:1px solid ${catColor}44;color:${catColor};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding:2px 7px;border-radius:4px;">${emoji} ${c.category}</span>
        </td>
        <td style="padding:10px 0;font-size:13px;font-weight:600;color:#FAFAFA;text-align:right;border-bottom:1px solid #27272A;">${fmtEmail(c.amount, data.currency)}</td>
        <td style="padding:10px 0;font-size:11px;color:#52525B;text-align:right;border-bottom:1px solid #27272A;padding-left:12px;">${pct}%</td>
      </tr>`;
    }).join('');

    const insightsUrl = `${env.FRONTEND_URL}/insights`;

    const content = `
  ${cardHeader('📅', 'Monthly Summary', data.monthLabel)}
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:24px 28px 0;">
        <p style="font-size:14px;color:#A1A1AA;margin:0 0 20px;line-height:1.7;">
          Hi ${name}, here's your complete spending recap for <strong style="color:#FAFAFA;">${data.monthLabel}</strong>.
        </p>

        <!-- Hero stats grid -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#111113;border:1px solid #27272A;border-radius:10px;margin-bottom:20px;">
          <tr>
            <td style="padding:16px 18px;border-right:1px solid #27272A;border-bottom:1px solid #27272A;">
              <div style="font-size:10px;color:#71717A;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:4px;">Total Spent</div>
              <div style="font-size:20px;font-weight:700;color:#FAFAFA;letter-spacing:-0.5px;">${fmtEmail(data.total, data.currency)}</div>
            </td>
            <td style="padding:16px 18px;border-bottom:1px solid #27272A;">
              <div style="font-size:10px;color:#71717A;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:4px;">Transactions</div>
              <div style="font-size:20px;font-weight:700;color:#FAFAFA;letter-spacing:-0.5px;">${data.count}</div>
            </td>
          </tr>
          <tr>
            <td colspan="2" style="padding:16px 18px;">
              <div style="font-size:10px;color:#71717A;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:4px;">Daily Average</div>
              <div style="font-size:20px;font-weight:700;color:#FAFAFA;letter-spacing:-0.5px;">${fmtEmail(data.dailyAvg, data.currency)}</div>
            </td>
          </tr>
        </table>

        ${topCategories.length > 0 ? `
        <!-- Category breakdown -->
        <div style="margin-bottom:20px;">
          <p style="font-size:10px;color:#71717A;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin:0 0 10px;">Category Breakdown</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${categoryRows}
          </table>
        </div>` : ''}
      </td>
    </tr>
  </table>
  ${ctaButton(insightsUrl, 'View Full Insights')}`;

    await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: `${data.monthLabel} spending summary`,
      html: baseHtml(content, `You spent ${fmtEmail(data.total, data.currency)} in ${data.monthLabel}.`),
    });
  } catch (err) {
    console.error('sendMonthlySummaryEmail error:', err);
  }
}

// ─── Send On-Demand Expense Report Email ──────────────────────────────────────

export interface OnDemandReportData {
  total: number;
  count: number;
  currency: string;
  expenses: Array<{ title: string; amount: number; category: string; date: string; merchant?: string | null }>;
}

export async function sendOnDemandExpenseReportEmail(
  to: string,
  name: string,
  data: OnDemandReportData,
): Promise<void> {
  try {
    const now = new Date();
    const reportDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const expensesUrl = `${env.FRONTEND_URL}/expenses`;

    // Compute category totals for summary bar
    const catMap: Record<string, number> = {};
    for (const e of data.expenses) {
      catMap[e.category] = (catMap[e.category] ?? 0) + e.amount;
    }
    const topCats = Object.entries(catMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const expenseRows = data.expenses.map((e) => {
      const emoji = CATEGORY_EMOJI[e.category] ?? '📦';
      const catColor = CATEGORY_COLOR[e.category] ?? '#6B7280';
      return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #27272A;vertical-align:middle;">
          <div style="font-size:13px;font-weight:600;color:#FAFAFA;margin-bottom:4px;">${e.title}</div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="display:inline-block;background:${catColor}22;border:1px solid ${catColor}44;color:${catColor};font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding:2px 6px;border-radius:4px;">${emoji} ${e.category}</span>
            <span style="font-size:11px;color:#52525B;">${fmtDate(e.date)}</span>
            ${e.merchant ? `<span style="font-size:11px;color:#52525B;">· ${e.merchant}</span>` : ''}
          </div>
        </td>
        <td style="padding:12px 0;font-size:14px;font-weight:700;color:#FAFAFA;text-align:right;border-bottom:1px solid #27272A;vertical-align:middle;white-space:nowrap;">
          ${fmtEmail(e.amount, data.currency)}
        </td>
      </tr>`;
    }).join('');

    const categoryHighlights = topCats.map(([cat, amt]) => {
      const emoji = CATEGORY_EMOJI[cat] ?? '📦';
      const catColor = CATEGORY_COLOR[cat] ?? '#6B7280';
      const pct = data.total > 0 ? Math.round((amt / data.total) * 100) : 0;
      return `
      <td style="width:33%;padding:14px 12px;text-align:center;">
        <div style="font-size:18px;margin-bottom:6px;">${emoji}</div>
        <div style="font-size:10px;color:${catColor};text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px;">${cat}</div>
        <div style="font-size:13px;font-weight:700;color:#FAFAFA;">${fmtEmail(amt, data.currency)}</div>
        <div style="font-size:10px;color:#52525B;margin-top:2px;">${pct}% of total</div>
      </td>`;
    }).join('');

    const content = `
  <!-- Card top accent bar -->
  <div style="height:3px;background:linear-gradient(90deg,#3B82F6,#8B5CF6,#EC4899);border-radius:16px 16px 0 0;"></div>

  ${cardHeader('📄', `Expense Report · ${reportDate}`, `${fmtEmail(data.total, data.currency)}`)}

  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:24px 28px 0;">

        <p style="font-size:14px;color:#A1A1AA;margin:0 0 20px;line-height:1.7;">
          Hi ${name}, here's the expense report you requested. It covers <strong style="color:#FAFAFA;">${data.count} transaction${data.count !== 1 ? 's' : ''}</strong> with a total spend of <strong style="color:#FAFAFA;">${fmtEmail(data.total, data.currency)}</strong>.
        </p>

        <!-- Summary stats -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#111113;border:1px solid #27272A;border-radius:10px;margin-bottom:20px;">
          <tr>
            <td style="padding:16px 20px;width:50%;border-right:1px solid #27272A;">
              <div style="font-size:10px;color:#71717A;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:4px;">Total Spent</div>
              <div style="font-size:26px;font-weight:700;color:#FAFAFA;letter-spacing:-0.5px;">${fmtEmail(data.total, data.currency)}</div>
            </td>
            <td style="padding:16px 20px;">
              <div style="font-size:10px;color:#71717A;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:4px;">Transactions</div>
              <div style="font-size:26px;font-weight:700;color:#FAFAFA;letter-spacing:-0.5px;">${data.count}</div>
            </td>
          </tr>
        </table>

        ${topCats.length > 0 ? `
        <!-- Top category highlights -->
        <p style="font-size:10px;color:#71717A;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin:0 0 10px;">Top Categories</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#111113;border:1px solid #27272A;border-radius:10px;margin-bottom:20px;">
          <tr>
            ${categoryHighlights}
          </tr>
        </table>` : ''}

        ${data.expenses.length > 0 ? `
        <!-- Transactions list -->
        <p style="font-size:10px;color:#71717A;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin:0 0 10px;">All Transactions</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${expenseRows}
        </table>` : ''}

      </td>
    </tr>
  </table>
  ${ctaButton(expensesUrl, 'Open Spendly')}`;

    await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: `Expense report — ${reportDate}`,
      html: baseHtml(content, `Your Spendly expense report: ${data.count} transactions totalling ${fmtEmail(data.total, data.currency)}.`),
    });
  } catch (err) {
    console.error('sendOnDemandExpenseReportEmail error:', err);
    throw err;
  }
}
