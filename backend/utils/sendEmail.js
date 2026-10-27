const nodemailer = require('nodemailer');
const { AppError } = require('./AppError');

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;

function appPassword() {
  return String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
}

function isEmailConfigured() {
  return Boolean(String(process.env.GMAIL_USER || '').trim() && appPassword());
}

function fromAddress() {
  const user = String(process.env.GMAIL_USER || '').trim();
  return `TraceX AI <${user}>`;
}

let transporter;

function getTransport() {
  if (!isEmailConfigured()) {
    throw new AppError('Mail delivery is not configured.', 503);
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false,
      auth: {
        user: String(process.env.GMAIL_USER).trim(),
        pass: appPassword()
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000
    });
  }
  return transporter;
}

function diagnostic(err) {
  const raw = String((err && (err.response || err.message)) || '');
  const secret = appPassword();
  const user = String(process.env.GMAIL_USER || '').trim();
  let text = raw;
  if (secret) {
    text = text.split(secret).join('[redacted]');
  }
  if (user) {
    text = text.split(user).join('[redacted]');
  }
  return text.replace(/\s+/g, ' ').slice(0, 180);
}

function isAuthFailure(err) {
  const code = String((err && err.code) || '');
  const responseCode = Number(err && err.responseCode);
  const text = diagnostic(err);
  return code === 'EAUTH' || responseCode === 535 || /invalid login|username and password|badcredentials|application-specific password/i.test(text);
}

function deliveryError(err, kind) {
  const code = String((err && err.code) || (err && err.name) || 'error');
  console.error('Unable to send email.', code, diagnostic(err));
  if (kind === 'alert') {
    return new AppError(
      isAuthFailure(err)
        ? 'The community email could not be sent. The mail sign-in was rejected.'
        : 'The community email could not be sent. Please try again.',
      503
    );
  }
  return new AppError(
    isAuthFailure(err)
      ? 'OTP could not be sent. The mail sign-in was rejected.'
      : 'OTP could not be sent. Please try again.',
    503
  );
}

function missingConfigError(kind) {
  return new AppError(
    kind === 'alert'
      ? 'The community email could not be sent. Please try again.'
      : 'OTP could not be sent. Please try again.',
    503
  );
}

function toAttachments(attachments) {
  if (!attachments || !attachments.length) {
    return undefined;
  }
  return attachments.map((item) => ({
    filename: item.filename,
    content: item.content,
    contentType: item.contentType,
    cid: item.contentId || item.cid
  }));
}

async function verifyTransport() {
  try {
    await getTransport().verify();
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw deliveryError(err, 'otp');
  }
}

async function sendEmail({ to, subject, html, text, kind = 'otp', attachments }) {
  if (!isEmailConfigured()) {
    throw missingConfigError(kind);
  }
  try {
    const info = await getTransport().sendMail({
      from: fromAddress(),
      to,
      subject,
      html,
      text,
      attachments: toAttachments(attachments)
    });
    console.info('[email] accepted', info && info.messageId ? 'yes' : 'no');
    return info;
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw deliveryError(err, kind);
  }
}

module.exports = {
  sendEmail,
  verifyTransport,
  isEmailConfigured
};
