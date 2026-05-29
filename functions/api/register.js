const WIPAY_ENDPOINTS = {
  TT: "https://tt.wipayfinancial.com/plugins/payments/request",
  JM: "https://jm.wipayfinancial.com/plugins/payments/request",
  BB: "https://bb.wipayfinancial.com/plugins/payments/request",
  GY: "https://gy.wipayfinancial.com/plugins/payments/request",
};

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

  // D1
  const db = env.DB;
  if (!db) return jsonError("Database binding not configured.", 500, corsHeaders);

  // Create table
  try {
    await db.prepare(
      "CREATE TABLE IF NOT EXISTS registrants (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0, wipay_ref TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
    ).run();
  } catch (e) { /* already exists */ }

  // Insert or get existing
  let registrantId;
  try {
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
    return jsonError("Database error: " + e.message, 500, corsHeaders);
  }

  // Save to Google Sheets (non-blocking)
  try {
    await fetch(GOOGLE_SHEET_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ full_name, email, phone }),
    });
  } catch (e) {
    console.error("Google Sheets error:", e.message);
  }

  // WiPay
  const environment   = env.WIPAY_ENVIRONMENT   || "live";
  const country       = env.WIPAY_COUNTRY_CODE  || "TT";
  const feeStructure  = env.WIPAY_FEE_STRUCTURE || "customer_pay";
  const accountNumber = env.WIPAY_ACCOUNT_NUMBER;
  const apiKey        = env.WIPAY_API_KEY;
  const siteUrl       = env.SITE_URL            || "https://www.themakeddagroup.com";

  if (!accountNumber) return jsonError("WiPay account number not configured.", 500, corsHeaders);
  if (!apiKey)        return jsonError("WiPay API key not configured.", 500, corsHeaders);

  const wipayEndpoint = `${WIPAY_ENDPOINTS[country] ?? WIPAY_ENDPOINTS.TT}?api_key=${apiKey}`;

  const wipayPayload = new URLSearchParams({
    account_number: accountNumber,
    avs:            "0",
    country_code:   country,
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
    const wipayRes  = await fetch(wipayEndpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    wipayPayload.toString(),
    });

    const wipayData = await wipayRes.json();

    if (!wipayData.url) {
      return jsonError(wipayData.message || "WiPay did not return a payment URL.", 502, corsHeaders);
    }

    if (wipayData.transaction_id) {
      await db.prepare("UPDATE registrants SET wipay_ref = ? WHERE id = ?")
        .bind(wipayData.transaction_id, registrantId).run();
    }

    return new Response(JSON.stringify({ redirect_url: wipayData.url }), {
      status:  200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return jsonError("Payment gateway error: " + err.message, 502, corsHeaders);
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
