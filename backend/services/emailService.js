const { Resend } = require('resend');
const { AppError } = require('../utils/AppError');

function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

function getFromAddress() {
  const name = process.env.RESEND_FROM_NAME || 'TraceX AI';
  const email = process.env.RESEND_FROM_EMAIL;
  return `${name} <${email}>`;
}

function getClient(kind = 'otp') {
  if (!isEmailConfigured()) {
    throw new AppError(
      kind === 'alert'
        ? 'The community email could not be sent. Please try again.'
        : 'OTP could not be sent. Please try again.',
      503
    );
  }
  return new Resend(process.env.RESEND_API_KEY);
}

function resendErrorMessage(error, kind = 'otp') {
  const message = error && error.message ? String(error.message) : '';
  const testSender = /only send testing emails/i.test(message) || /verify a domain/i.test(message) || /domain is not verified/i.test(message);
  if (kind === 'alert') {
    if (testSender) {
      return 'Community mail can only be delivered to the email on your sending account until a sending domain is verified. Other campus addresses were not delivered.';
    }
    return 'The community email could not be sent. Please try again.';
  }
  if (testSender) {
    return 'OTP could not be sent to this email. With the current test sender, mail is only delivered to the email on your sending account. Check Spam and Promotions, or verify a sending domain.';
  }
  return 'OTP could not be sent. Please try again.';
}

async function sendEmail({ to, subject, html, text, kind = 'otp', attachments }) {
  try {
    const resend = getClient(kind);
    const payload = {
      from: getFromAddress(),
      to: [to],
      subject,
      html,
      text
    };
    if (attachments && attachments.length) {
      payload.attachments = attachments.map((item) => ({
        filename: item.filename,
        content: item.content,
        contentType: item.contentType,
        contentId: item.contentId
      }));
    }
    const { data, error } = await resend.emails.send(payload);

    if (error) {
      console.error('Unable to send email.', error.name || '', error.statusCode || '', error.message || '');
      throw new AppError(resendErrorMessage(error, kind), 503);
    }

    if (data && data.id) {
      console.info('[email] accepted by Resend', data.id);
    }
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    console.error('Unable to send email.', err && err.name);
    throw new AppError(
      kind === 'alert'
        ? 'The community email could not be sent. Please try again.'
        : 'OTP could not be sent. Please try again.',
      503
    );
  }
}

function otpEmailCopy(purpose) {
  if (purpose === 'reset') {
    return {
      subject: 'Your TraceX AI password reset code',
      intro: 'Use this code to reset your TraceX AI password.'
    };
  }
  if (purpose === 'verify') {
    return {
      subject: 'Verify your TraceX AI email',
      intro: 'Use this code to verify your TraceX AI email address.'
    };
  }
  return {
    subject: 'Your TraceX AI sign-in code',
    intro: 'Use this code to sign in to TraceX AI.'
  };
}

function otpEmailHtml(otp, purpose) {
  const copy = otpEmailCopy(purpose);
  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1c2430;">
      <h2 style="color:#1f3b5a;margin-bottom:8px;">TRACE X AI</h2>
      <p style="margin:0 0 16px;">${copy.intro}</p>
      <p style="font-size:28px;font-weight:bold;margin:16px 0;font-family:Consolas,Menlo,monospace;">${otp}</p>
      <p>This 6-digit code expires in 10 minutes.</p>
      <p>Do not share this code with anyone. TraceX AI will never ask you for this code by phone.</p>
      <p style="color:#5b6775;font-size:13px;">If you did not request this, you can ignore this email.</p>
    </div>
  `;
}

function otpEmailText(otp, purpose) {
  const copy = otpEmailCopy(purpose);
  return [
    'TRACE X AI',
    copy.intro,
    `Your code is ${otp}.`,
    'This 6-digit code expires in 10 minutes.',
    'If you do not see this email in your inbox, check Spam and Promotions.',
    'Do not share this code with anyone.',
    'If you did not request this, you can ignore this email.'
  ].join('\n\n');
}

async function sendOtpEmail(to, otp, purpose = 'login') {
  const copy = otpEmailCopy(purpose);
  await sendEmail({
    to,
    subject: copy.subject,
    html: otpEmailHtml(otp, purpose),
    text: otpEmailText(otp, purpose),
    kind: 'otp'
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendCommunityItemAlert(to, report, image) {
  const typeLabel = report.reportType === 'found' ? 'Found item' : 'Lost item';
  const communityName = report.community && report.community.name ? report.community.name : 'your community';
  const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const dateValue = report.approximateDate
    ? new Date(report.approximateDate).toISOString().slice(0, 10)
    : '';
  const when = [dateValue, report.approximateTime].filter(Boolean).join(' ');
  const subject = `TraceX AI: ${typeLabel} in ${communityName} — ${report.itemName}`;
  const hasImage = Boolean(image && image.content);
  const photoHtml = hasImage
    ? '<p><img src="cid:item-photo" alt="Reported item" width="480" style="max-width:100%;height:auto;border-radius:8px;border:1px solid #E5E7EB;" /></p>'
    : '';
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827;">
      <h2 style="color:#0B1220;margin-bottom:8px;">TraceX AI</h2>
      <p style="margin:0 0 12px;color:#667085;">Campus lost &amp; found alert</p>
      <p><strong>${escapeHtml(typeLabel)}</strong>: ${escapeHtml(report.itemName)}</p>
      <p>Category: ${escapeHtml(report.category || '')}</p>
      <p>Location: ${escapeHtml(report.location || '')}</p>
      <p>When: ${escapeHtml(when || 'Not specified')}</p>
      <p>${escapeHtml((report.description || '').slice(0, 280))}</p>
      ${photoHtml}
      <p>Sign in to TraceX AI to view the report.</p>
      <p><a href="${origin}/login" style="color:#2563EB;">${origin}/login</a></p>
    </div>
  `;
  const text = [
    'TraceX AI',
    `${typeLabel}: ${report.itemName}`,
    `Category: ${report.category || ''}`,
    `Location: ${report.location || ''}`,
    `When: ${when || 'Not specified'}`,
    report.description || '',
    hasImage ? 'A photo of the item is attached.' : '',
    `Sign in at ${origin}/login to view the report.`
  ].filter(Boolean).join('\n\n');

  const attachments = hasImage
    ? [{
      filename: image.filename,
      content: image.content,
      contentType: image.contentType,
      contentId: 'item-photo'
    }]
    : undefined;

  await sendEmail({ to, subject, html, text, kind: 'alert', attachments });
}

module.exports = {
  sendEmail,
  sendOtpEmail,
  sendCommunityItemAlert,
  isEmailConfigured
};
