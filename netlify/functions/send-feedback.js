// Receives the feedback PDF from the page and emails it through Brevo's HTTPS
// API (the company mail server rejects SMTP logins coming from Netlify).
//
// Required Netlify environment variable:
//   BREVO_API_KEY
// Optional: MAIL_FROM (a sender verified in Brevo), MAIL_TO, MAIL_CC
const MAX_PDF_BYTES = 3 * 1024 * 1024;
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

async function brevoSend(apiKey, payload) {
  const resp = await fetch(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Brevo ${resp.status}: ${text}`);
  return text;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const apiKey = (process.env.BREVO_API_KEY || '').trim();
  if (!apiKey) {
    console.error('Missing BREVO_API_KEY environment variable');
    return json(500, { ok: false, error: 'Mail service not configured' });
  }

  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { ok: false, error: 'Invalid JSON' }); }

  const name = String(data.name || '').trim().slice(0, 200);
  const phone = String(data.phone || '').trim().slice(0, 50);
  const email = String(data.email || '').trim().slice(0, 200);
  const filename = String(data.filename || 'RealStar_Feedback.pdf').replace(/[^\w.\- ]/g, '_').slice(0, 120);
  const pdfBase64 = String(data.pdfBase64 || '').replace(/\s/g, '');
  const pdfBytes = Buffer.byteLength(pdfBase64, 'base64');

  if (!name || !phone || !pdfBytes) return json(400, { ok: false, error: 'Missing required fields' });
  if (pdfBytes > MAX_PDF_BYTES) return json(413, { ok: false, error: 'PDF too large' });
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const from = (process.env.MAIL_FROM || 'enquiriesug@realstarsec.com').trim();
  const to = (process.env.MAIL_TO || 'enquiriesug@realstarsec.com').trim();
  const cc = (process.env.MAIL_CC || 'operationsug@realstarsec.com').trim();

  try {
    const result = await brevoSend(apiKey, {
      sender: { name: 'RealStar Feedback Form', email: from },
      to: [{ email: to }],
      cc: cc ? [{ email: cc }] : undefined,
      replyTo: validEmail ? { email, name } : undefined,
      subject: `Customer Feedback — ${name}`,
      textContent: `New customer feedback submitted by ${name}.\nPhone: ${phone}\nEmail: ${email || '(not provided)'}\n\nFull details are in the attached PDF.`,
      htmlContent: `<p>New customer feedback submitted by <strong>${esc(name)}</strong>.</p>
<p>Phone: ${esc(phone)}<br>Email: ${esc(email || '(not provided)')}</p>
<p>Full details are in the attached PDF.</p>`,
      attachment: [{ name: filename, content: pdfBase64 }]
    });
    console.log('Business notification sent:', result);
  } catch (err) {
    console.error('Business notification failed:', err.message);
    return json(502, { ok: false, error: 'Could not send email' });
  }

  // Customer autoresponse is best-effort: the business copy already went out.
  if (validEmail) {
    try {
      const result = await brevoSend(apiKey, {
        sender: { name: 'RealStar Security', email: from },
        to: [{ email, name }],
        replyTo: { email: to },
        subject: 'Thank you for your feedback — RealStar Security',
        textContent: `Thank you, ${name} — we've received your feedback for RealStar Security and appreciate you taking the time to share it. Our team will review it shortly. If you have anything further to add, just reply to this email.`
      });
      console.log('Autoresponse sent:', result);
    } catch (err) {
      console.error('Autoresponse failed:', err.message);
    }
  }

  return json(200, { ok: true });
};
