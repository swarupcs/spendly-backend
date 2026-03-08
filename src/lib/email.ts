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

const resend = new Resend(env.RESEND_API_KEY);

// ─── Shared styles ────────────────────────────────────────────────────────────

const baseHtml = (content: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Spendly</title>
</head>
<body style="margin:0;padding:0;background:#080810;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080810;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="100%" style="max-width:480px;" cellpadding="0" cellspacing="0">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#7c5cfc,#00d4ff);border-radius:14px;padding:12px;width:44px;height:44px;text-align:center;vertical-align:middle;">
                    <span style="font-size:22px;color:#fff;">⚡</span>
                  </td>
                  <td style="padding-left:12px;vertical-align:middle;">
                    <div style="font-size:20px;font-weight:800;color:#f0efff;letter-spacing:-0.5px;">Spendly</div>
                    <div style="font-size:10px;color:#4a4870;letter-spacing:2px;text-transform:uppercase;font-family:monospace;">Smart Tracking</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:rgba(13,13,26,0.95);border:1px solid rgba(124,92,252,0.2);border-radius:20px;padding:36px 32px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="font-size:11px;color:#4a4870;font-family:monospace;margin:0;">
                © ${new Date().getFullYear()} Spendly · If you didn't request this, ignore this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

// ─── Send Verification Email ──────────────────────────────────────────────────

export async function sendVerificationEmail(
  to: string,
  name: string,
  token: string,
): Promise<void> {
  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${token}`;

  const content = `
    <h1 style="font-size:24px;font-weight:800;color:#f0efff;margin:0 0 8px;letter-spacing:-0.5px;">
      Verify your email
    </h1>
    <p style="font-size:14px;color:#8b89b0;margin:0 0 28px;line-height:1.6;">
      Hi ${name}, thanks for signing up! Click the button below to verify your email address and activate your account.
    </p>

    <a href="${verifyUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#7c5cfc,#00d4ff);color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;letter-spacing:0.2px;margin-bottom:24px;">
      Verify Email Address
    </a>

    <p style="font-size:12px;color:#4a4870;font-family:monospace;margin:0 0 8px;">
      Or copy this link:
    </p>
    <p style="font-size:11px;color:#7c5cfc;font-family:monospace;word-break:break-all;background:rgba(124,92,252,0.08);padding:10px 12px;border-radius:8px;margin:0 0 24px;border:1px solid rgba(124,92,252,0.15);">
      ${verifyUrl}
    </p>

    <p style="font-size:12px;color:#4a4870;font-family:monospace;margin:0;text-align:center;">
      This link expires in <strong style="color:#8b89b0;">24 hours</strong>.
    </p>`;

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: 'Verify your Spendly email address',
    html: baseHtml(content),
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
    <h1 style="font-size:24px;font-weight:800;color:#f0efff;margin:0 0 8px;letter-spacing:-0.5px;">
      Reset your password
    </h1>
    <p style="font-size:14px;color:#8b89b0;margin:0 0 28px;line-height:1.6;">
      Hi ${name}, we received a request to reset your password. Click the button below to set a new one.
    </p>

    <a href="${resetUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#7c5cfc,#00d4ff);color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;letter-spacing:0.2px;margin-bottom:24px;">
      Reset Password
    </a>

    <p style="font-size:12px;color:#4a4870;font-family:monospace;margin:0 0 8px;">
      Or copy this link:
    </p>
    <p style="font-size:11px;color:#7c5cfc;font-family:monospace;word-break:break-all;background:rgba(124,92,252,0.08);padding:10px 12px;border-radius:8px;margin:0 0 24px;border:1px solid rgba(124,92,252,0.15);">
      ${resetUrl}
    </p>

    <div style="background:rgba(255,59,92,0.06);border:1px solid rgba(255,59,92,0.2);border-radius:10px;padding:12px 16px;margin-bottom:0;">
      <p style="font-size:12px;color:#ff6b8a;font-family:monospace;margin:0;">
        ⚠ This link expires in <strong>1 hour</strong>. If you didn't request this, your account is safe — just ignore this email.
      </p>
    </div>`;

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: 'Reset your Spendly password',
    html: baseHtml(content),
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
    const icon = isExceeded ? '🚨' : '⚠️';
    const subject = isExceeded
      ? `🚨 Budget Exceeded: ${category}`
      : `⚠️ Budget Warning: ${category}`;
    const headingColor = isExceeded ? '#ff6b8a' : '#fbbf24';
    const barColor = isExceeded ? '#ff3b5c' : '#fbbf24';
    const barWidth = Math.min(pct, 100);

    const content = `
    <h1 style="font-size:22px;font-weight:800;color:${headingColor};margin:0 0 8px;letter-spacing:-0.5px;">
      ${icon} Budget ${isExceeded ? 'Exceeded' : 'Warning'}
    </h1>
    <p style="font-size:14px;color:#8b89b0;margin:0 0 24px;line-height:1.6;">
      Hi ${name}, your <strong style="color:#f0efff;">${emoji} ${category}</strong> budget has reached <strong style="color:${headingColor};">${Math.round(pct)}%</strong>.
    </p>

    <div style="background:rgba(8,8,16,0.8);border:1px solid rgba(124,92,252,0.15);border-radius:14px;padding:20px;margin-bottom:24px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:12px;color:#4a4870;font-family:monospace;text-transform:uppercase;letter-spacing:1px;">Spent</span>
        <span style="font-size:12px;color:#4a4870;font-family:monospace;text-transform:uppercase;letter-spacing:1px;">Limit</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:14px;">
        <span style="font-size:20px;font-weight:800;color:${headingColor};">${fmtEmail(spent, currency)}</span>
        <span style="font-size:20px;font-weight:800;color:#f0efff;">${fmtEmail(limit, currency)}</span>
      </div>
      <div style="background:rgba(124,92,252,0.12);border-radius:100px;height:8px;overflow:hidden;">
        <div style="background:${barColor};height:100%;width:${barWidth}%;border-radius:100px;"></div>
      </div>
      <p style="font-size:11px;color:#4a4870;font-family:monospace;margin:8px 0 0;text-align:right;">${Math.round(pct)}% used</p>
    </div>

    <a href="${budgetUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#7c5cfc,#00d4ff);color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;letter-spacing:0.2px;">
      View Budgets
    </a>`;

    await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject,
      html: baseHtml(content),
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
    const expensesUrl = `${env.FRONTEND_URL}/expenses`;

    const content = `
    <h1 style="font-size:22px;font-weight:800;color:#f0efff;margin:0 0 8px;letter-spacing:-0.5px;">
      💸 Large Expense Recorded
    </h1>
    <p style="font-size:14px;color:#8b89b0;margin:0 0 24px;line-height:1.6;">
      Hi ${name}, a large expense was just added to your account that exceeds your alert threshold.
    </p>

    <div style="background:rgba(8,8,16,0.8);border:1px solid rgba(124,92,252,0.15);border-radius:14px;padding:20px;margin-bottom:24px;">
      <p style="font-size:18px;font-weight:800;color:#f0efff;margin:0 0 16px;">${expenseTitle}</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#4a4870;font-family:monospace;text-transform:uppercase;letter-spacing:1px;">Amount</td>
          <td style="padding:6px 0;font-size:13px;color:#f0efff;text-align:right;font-weight:600;">${fmtEmail(expenseAmount, expenseCurrency)}${expenseCurrency !== homeCurrency ? ` <span style="color:#4a4870;font-size:11px;">(${fmtEmail(convertedAmount, homeCurrency)})</span>` : ''}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#4a4870;font-family:monospace;text-transform:uppercase;letter-spacing:1px;">Category</td>
          <td style="padding:6px 0;font-size:13px;color:#f0efff;text-align:right;">${emoji} ${category}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#4a4870;font-family:monospace;text-transform:uppercase;letter-spacing:1px;">Date</td>
          <td style="padding:6px 0;font-size:13px;color:#f0efff;text-align:right;">${date}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#4a4870;font-family:monospace;text-transform:uppercase;letter-spacing:1px;">Threshold</td>
          <td style="padding:6px 0;font-size:13px;color:#fbbf24;text-align:right;font-weight:600;">${fmtEmail(threshold, homeCurrency)}</td>
        </tr>
      </table>
    </div>

    <a href="${expensesUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#7c5cfc,#00d4ff);color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;letter-spacing:0.2px;">
      View Expenses
    </a>`;

    await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: `💸 Large expense recorded: ${expenseTitle}`,
      html: baseHtml(content),
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
    const categoryRows = topCategories
      .map((c) => {
        const emoji = CATEGORY_EMOJI[c.category] ?? '📦';
        return `
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#f0efff;border-bottom:1px solid rgba(124,92,252,0.08);">
            ${emoji} ${c.category}
          </td>
          <td style="padding:8px 0;font-size:13px;color:#9d7fff;text-align:right;font-weight:600;border-bottom:1px solid rgba(124,92,252,0.08);">
            ${fmtEmail(c.amount, data.currency)}
          </td>
          <td style="padding:8px 0;font-size:11px;color:#4a4870;text-align:right;font-family:monospace;border-bottom:1px solid rgba(124,92,252,0.08);">
            ${c.count}x
          </td>
        </tr>`;
      })
      .join('');

    const content = `
    <h1 style="font-size:22px;font-weight:800;color:#f0efff;margin:0 0 8px;letter-spacing:-0.5px;">
      📊 Weekly Spending Report
    </h1>
    <p style="font-size:14px;color:#8b89b0;margin:0 0 24px;line-height:1.6;">
      Hi ${name}, here's your spending summary for <strong style="color:#f0efff;">${data.fromDate}</strong> to <strong style="color:#f0efff;">${data.toDate}</strong>.
    </p>

    <div style="background:rgba(8,8,16,0.8);border:1px solid rgba(124,92,252,0.15);border-radius:14px;padding:20px;margin-bottom:24px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <div>
          <p style="font-size:12px;color:#4a4870;font-family:monospace;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Total Spent</p>
          <p style="font-size:28px;font-weight:900;color:#7c5cfc;margin:0;letter-spacing:-1px;">${fmtEmail(data.total, data.currency)}</p>
        </div>
        <div style="text-align:right;">
          <p style="font-size:12px;color:#4a4870;font-family:monospace;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Transactions</p>
          <p style="font-size:28px;font-weight:900;color:#00d4ff;margin:0;">${data.count}</p>
        </div>
      </div>
    </div>

    ${topCategories.length > 0 ? `
    <div style="background:rgba(8,8,16,0.8);border:1px solid rgba(124,92,252,0.15);border-radius:14px;padding:20px;margin-bottom:24px;">
      <p style="font-size:11px;color:#4a4870;font-family:monospace;text-transform:uppercase;letter-spacing:2px;margin:0 0 14px;">Top Categories</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${categoryRows}
      </table>
    </div>` : ''}`;

    await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: '📊 Your weekly spending report',
      html: baseHtml(content),
    });
  } catch (err) {
    console.error('sendWeeklyReportEmail error:', err);
  }
}

// ─── Send Monthly Summary Email ───────────────────────────────────────────────

export interface MonthlyData {
  monthLabel: string; // e.g. "March 2025"
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
    const categoryRows = topCategories
      .map((c) => {
        const emoji = CATEGORY_EMOJI[c.category] ?? '📦';
        const pct = data.total > 0 ? Math.round((c.amount / data.total) * 100) : 0;
        return `
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#f0efff;border-bottom:1px solid rgba(124,92,252,0.08);">
            ${emoji} ${c.category}
          </td>
          <td style="padding:8px 0;font-size:13px;color:#9d7fff;text-align:right;font-weight:600;border-bottom:1px solid rgba(124,92,252,0.08);">
            ${fmtEmail(c.amount, data.currency)}
          </td>
          <td style="padding:8px 0;font-size:11px;color:#4a4870;text-align:right;font-family:monospace;border-bottom:1px solid rgba(124,92,252,0.08);">
            ${pct}%
          </td>
        </tr>`;
      })
      .join('');

    const insightsUrl = `${env.FRONTEND_URL}/insights`;

    const content = `
    <h1 style="font-size:22px;font-weight:800;color:#f0efff;margin:0 0 8px;letter-spacing:-0.5px;">
      📅 ${data.monthLabel} Summary
    </h1>
    <p style="font-size:14px;color:#8b89b0;margin:0 0 24px;line-height:1.6;">
      Hi ${name}, here's a recap of your spending for <strong style="color:#f0efff;">${data.monthLabel}</strong>.
    </p>

    <div style="background:rgba(8,8,16,0.8);border:1px solid rgba(124,92,252,0.15);border-radius:14px;padding:20px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#4a4870;font-family:monospace;text-transform:uppercase;letter-spacing:1px;">Total Spent</td>
          <td style="padding:6px 0;font-size:16px;font-weight:800;color:#7c5cfc;text-align:right;">${fmtEmail(data.total, data.currency)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#4a4870;font-family:monospace;text-transform:uppercase;letter-spacing:1px;">Transactions</td>
          <td style="padding:6px 0;font-size:16px;font-weight:800;color:#f0efff;text-align:right;">${data.count}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#4a4870;font-family:monospace;text-transform:uppercase;letter-spacing:1px;">Daily Average</td>
          <td style="padding:6px 0;font-size:16px;font-weight:800;color:#00d4ff;text-align:right;">${fmtEmail(data.dailyAvg, data.currency)}</td>
        </tr>
      </table>
    </div>

    ${topCategories.length > 0 ? `
    <div style="background:rgba(8,8,16,0.8);border:1px solid rgba(124,92,252,0.15);border-radius:14px;padding:20px;margin-bottom:24px;">
      <p style="font-size:11px;color:#4a4870;font-family:monospace;text-transform:uppercase;letter-spacing:2px;margin:0 0 14px;">Category Breakdown</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${categoryRows}
      </table>
    </div>` : ''}

    <a href="${insightsUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#7c5cfc,#00d4ff);color:#fff;font-weight:700;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;letter-spacing:0.2px;">
      View Insights
    </a>`;

    await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: `📅 Your ${data.monthLabel} spending summary`,
      html: baseHtml(content),
    });
  } catch (err) {
    console.error('sendMonthlySummaryEmail error:', err);
  }
}
