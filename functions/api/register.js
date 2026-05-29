const WIPAY_ENDPOINT  = "https://tt.wipayfinancial.com/plugins/payments/request";
const WIPAY_ME_LINK   = "https://tt.wipayfinancial.com/to_me/themakeddagroup";
const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbwLNQm4aEuLiicqQHIv3VQIo4jiqmct3ddDMoLE1u6ODd2gOVdfe6B1Ha0PNsMCh_-9wQ/exec";

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Parse body
  let full_name, email, phone;
  const ct = request.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      ({ full_name, email, phone } = await request.json());
    } else {
      const params = new URLSearchParams(await request.text());
      full_name = params.get("full_name");
      email     = params.get("email");
      phone     = params.get("phone");
    }
  } catch {
    return jsonError("Could not parse request body.", 400, corsHeaders);
  }

  // Validate
  if (!full_name?.trim() || !email?.trim() || !phone?.trim()) {
    return jsonError("All fields are required.", 400, corsHeaders);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError("Invalid email address.", 400, corsHeaders);
  }

  // D1 — save registrant
  const db = env.DB;
  let registrantId = 0;

  if (db) {
    try {
      await db.prepare(
        "CREATE TABLE IF NOT EXISTS registrants (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0, wipay_ref TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
      ).run();

      const existing = await db
        .prepare("SELECT id FROM registrants WHERE email = ?")
        .bind(email.toLowerCase().trim())
        .first();

      if (existing) {
        registrantId = existing.id;
      } else {
        const insert = await db
          .prepare("INSERT INTO registrants (full_name, email, phone) VALUES (?, ?, ?) RETURNING id")
          .bind(full_name.trim(), email.toLowerCase().trim(), phone.trim())
          .first();
        registrantId = insert.id;
      }
    } catch (e) {
      console.error("D1 error:", e.message);
      // Don't block — continue to payment
    }
  }

  // Google Sheets — non-blocking
  fetch(GOOGLE_SHEET_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ full_name, email, phone }),
  }).catch(e => console.error("Sheets error:", e.message));

  // WiPay
  const environment   = env.WIPAY_ENVIRONMENT   || "live";
  const feeStructure  = env.WIPAY_FEE_STRUCTURE || "customer_pay";
  const accountNumber = env.WIPAY_ACCOUNT_NUMBER;
  const apiKey        = env.WIPAY_API_KEY;
  const siteUrl       = env.SITE_URL            || "https://www.themakeddagroup.com";

  // If WiPay not configured, fall back to me link
  if (!accountNumber || !apiKey) {
    return new Response(JSON.stringify({ redirect_url: WIPAY_ME_LINK }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const wipayPayload = new URLSearchParams({
    api_key:        apiKey,
    account_number: accountNumber,
    avs:            "0",
    country_code:   "TT",
    currency:       "TTD",
    environment:    environment,
    fee_structure:  feeStructure,
    method:         "credit_card",
    order_id:       `REG-${registrantId}-${Date.now()}`,
    origin:         "SafeSpace",
    response_url:   `${siteUrl}/payment-success?reg=${registrantId}`,
    total:          "340.00",
  });

  try {
    const wipayRes  = await fetch(WIPAY_ENDPOINT, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    wipayPayload.toString(),
    });

    const wipayData = await wipayRes.json();

    if (wipayData.url) {
      // Success — update DB and redirect
      if (db && wipayData.transaction_id) {
        await db.prepare("UPDATE registrants SET wipay_ref = ? WHERE id = ?")
          .bind(wipayData.transaction_id, registrantId).run();
      }
      return new Response(JSON.stringify({ redirect_url: wipayData.url }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // WiPay returned error — fall back to me link
    console.error("WiPay error:", JSON.stringify(wipayData));
    return new Response(JSON.stringify({ redirect_url: WIPAY_ME_LINK }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    // Network error — fall back to me link
    console.error("WiPay fetch error:", err.message);
    return new Response(JSON.stringify({ redirect_url: WIPAY_ME_LINK }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function jsonError(message, status = 400, extraHeaders = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...extraHeaders, "Content-Type": "application/json" },
  });
}
