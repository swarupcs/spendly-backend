import { Resend } from 'resend';
import { env } from '../config/env';

const resend = new Resend(env.RESEND_API_KEY);

// ─── Shared styles ────────────────────────────────────────────────────────────

const baseHtml = (content: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ExpenseAI</title>
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
                    <div style="font-size:20px;font-weight:800;color:#f0efff;letter-spacing:-0.5px;">ExpenseAI</div>
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
                © ${new Date().getFullYear()} ExpenseAI · If you didn't request this, ignore this email.
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
    subject: 'Verify your ExpenseAI email address',
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
    subject: 'Reset your ExpenseAI password',
    html: baseHtml(content),
  });
}
