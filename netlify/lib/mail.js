/* One transactional sender. Resend when a key is present; otherwise, outside
   production, the link is returned to the caller so a developer or the test
   suite can follow it, and it is logged. Production without a key is an
   error, never a silent no-op. */
export async function sendMagicLink(to, link) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || 'Lunch Sorted <hello@lunchsorted.app>';
  if (!key) {
    if ((process.env.SITE_ENV || 'production') === 'production') throw new Error('RESEND_API_KEY is not set');
    console.log(`[mail] magic link for ${to}: ${link}`);
    return { devLink: link };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from, to: [to],
      subject: 'Your Lunch Sorted sign-in link',
      text: `Tap to sign in to Lunch Sorted:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
      html: `<p>Tap to sign in to Lunch Sorted:</p><p><a href="${link}">Sign in to Lunch Sorted</a></p><p style="color:#6E7F75;font-size:13px">The link works once and expires in 15 minutes. If you did not ask for it, ignore this email.</p>`
    })
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return {};
}
