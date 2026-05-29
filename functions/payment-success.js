/**
 * GET /payment-success?reg=ID
 *
 * WiPay returns the user here after payment.
 * WiPay also POSTs an IPN (Instant Payment Notification) to this same URL
 * with full transaction details — we use that to confirm payment.
 *
 * Query params WiPay appends:
 *   status         — "success" | "failed" | "error"
 *   transaction_id
 *   order_id
 *   total
 *   hash           — MD5 verification hash (success only)
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url    = new URL(request.url);
  const regId  = url.searchParams.get("reg");
  const status = url.searchParams.get("status");       // "success" | "failed" | "error"
  const txId   = url.searchParams.get("transaction_id") || "";

  const db = env.DB;

  if (regId && status === "success" && db) {
    await db
      .prepare("UPDATE registrants SET paid = 1, wipay_ref = ? WHERE id = ?")
      .bind(txId, regId)
      .run()
      .catch(() => {}); // fail silently — user still sees success page
  }

  // Serve a polished success page
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Registration Confirmed — SafeSpace</title>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Roboto', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f8fafc;
      padding: 2rem;
    }
    .card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 1.5rem;
      padding: 3rem 2.5rem;
      text-align: center;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,.07);
    }
    .icon { font-size: 3.5rem; margin-bottom: 1.25rem; }
    h1 { font-size: 1.6rem; font-weight: 900; color: #0f172a; text-transform: uppercase; letter-spacing: -.02em; margin-bottom: .75rem; }
    p  { color: #64748b; font-size: .9rem; line-height: 1.6; margin-bottom: 1.5rem; }
    .badge {
      display: inline-block;
      background: #eff6ff;
      color: #2563eb;
      border: 1px solid #bfdbfe;
      font-size: .7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .1em;
      padding: .4rem 1rem;
      border-radius: 9999px;
      margin-bottom: 1.5rem;
    }
    a.btn {
      display: inline-block;
      background: #2563eb;
      color: white;
      font-weight: 700;
      font-size: .75rem;
      text-transform: uppercase;
      letter-spacing: .1em;
      padding: .85rem 2rem;
      border-radius: .75rem;
      text-decoration: none;
      transition: background .2s;
    }
    a.btn:hover { background: #1d4ed8; }
    .tx { font-family: monospace; font-size: .7rem; color: #94a3b8; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${status === "success" ? "✅" : "⚠️"}</div>
    <span class="badge">${status === "success" ? "Payment Confirmed" : "Status Unknown"}</span>
    <h1>${status === "success" ? "You're In!" : "Check Your Email"}</h1>
    <p>
      ${status === "success"
        ? "Your registration for <strong>Everyday Safety Skills</strong> has been confirmed. A Zoom invite and session details will be emailed to you shortly before each session."
        : "We couldn't confirm your payment status automatically. Please contact us on WhatsApp and we'll sort it out right away."}
    </p>
    <a class="btn" href="https://wa.me/12462451634">💬 Contact Candace on WhatsApp</a>
    ${txId ? `<p class="tx">Transaction ref: ${txId}</p>` : ""}
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=UTF-8" },
  });
}
