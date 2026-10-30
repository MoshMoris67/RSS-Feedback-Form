// Receives the feedback PDF from the page and emails it through the company
// mailbox's own SMTP server. Replaces the FormSubmit.co dependency.
//
// Required Netlify environment variables:
//   SMTP_HOST, SMTP_USER, SMTP_PASS
// Optional: SMTP_PORT (default 465), MAIL_TO, MAIL_CC
const nodemailer = require('nodemailer');

const MAX_PDF_BYTES = 4 * 1024 * 1024;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  // Trim: a stray space/newline pasted into the Netlify UI causes a 535.
  const SMTP_HOST = (process.env.SMTP_HOST || '').trim();
  const SMTP_USER = (process.env.SMTP_USER || '').trim();
  const SMTP_PASS = (process.env.SMTP_PASS || '').trim();
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error('Missing SMTP_HOST / SMTP_USER / SMTP_PASS environment variables');
    return json(500, { ok: false, error: 'Mail server not configured' });
  }

  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { ok: false, error: 'Invalid JSON' }); }

  const name = String(data.name || '').trim().slice(0, 200);
  const phone = String(data.phone || '').trim().slice(0, 50);
  const email = String(data.email || '').trim().slice(0, 200);
  const filename = String(data.filename || 'RealStar_Feedback.pdf').replace(/[^\w.\- ]/g, '_').slice(0, 120);
  const pdf = Buffer.from(String(data.pdfBase64 || ''), 'base64');

  if (!name || !phone || !pdf.length) return json(400, { ok: false, error: 'Missing required fields' });
  if (pdf.length > MAX_PDF_BYTES) return json(413, { ok: false, error: 'PDF too large' });
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  const to = process.env.MAIL_TO || 'enquiriesug@realstarsec.com';
  const cc = process.env.MAIL_CC || 'operationsug@realstarsec.com';

  try {
    const info = await transporter.sendMail({
      from: `"RealStar Feedback Form" <${SMTP_USER}>`,
      to,
      cc,
      replyTo: validEmail ? email : undefined,
      subject: `Customer Feedback — ${name}`,
      text: `New customer feedback submitted by ${name}.\nPhone: ${phone}\nEmail: ${email || '(not provided)'}\n\nFull details are in the attached PDF.`,
      html: `<p>New customer feedback submitted by <strong>${esc(name)}</strong>.</p>
<p>Phone: ${esc(phone)}<br>Email: ${esc(email || '(not provided)')}</p>
<p>Full details are in the attached PDF.</p>`,
      attachments: [{ filename, content: pdf, contentType: 'application/pdf' }]
    });
    console.log('Business notification sent:', JSON.stringify({
      accepted: info.accepted, rejected: info.rejected, response: info.response, messageId: info.messageId
    }));
  } catch (err) {
    console.error('Business notification failed:', err);
    // Safe diagnostic for auth failures: shows what was received, never the password itself.
    console.error('SMTP config seen:', JSON.stringify({
      host: SMTP_HOST, user: SMTP_USER, port,
      passLength: SMTP_PASS.length,
      rawPassLength: (process.env.SMTP_PASS || '').length
    }));
    return json(502, { ok: false, error: 'Could not send email' });
  }

  // Customer autoresponse is best-effort: the business copy already went out.
  if (validEmail) {
    try {
      const reply = await transporter.sendMail({
        from: `"RealStar Security" <${SMTP_USER}>`,
        to: email,
        replyTo: to,
        subject: 'Thank you for your feedback — RealStar Security',
        text: `Thank you, ${name} — we've received your feedback for RealStar Security and appreciate you taking the time to share it. Our team will review it shortly. If you have anything further to add, just reply to this email.`
      });
      console.log('Autoresponse sent:', JSON.stringify({
        accepted: reply.accepted, rejected: reply.rejected, response: reply.response, messageId: reply.messageId
      }));
    } catch (err) {
      console.error('Autoresponse failed:', err);
    }
  }

  return json(200, { ok: true });
};
