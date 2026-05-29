const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbwLNQm4aEuLiicqQHIv3VQIo4jiqmct3ddDMoLE1u6ODd2gOVdfe6B1Ha0PNsMCh_-9wQ/exec";
const WIPAY_ME_LINK   = "https://tt.wipayfinancial.com/to_me/themakeddagroup";

export async function onRequestPost(context) {
  const { request } = context;

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

  // Save to Google Sheets (fire and don't block on failure)
  try {
    await fetch(GOOGLE_SHEET_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ full_name, email, phone }),
    });
  } catch (e) {
    // Log but don't block — still send them to payment
    console.error("Google Sheets error:", e.message);
  }

  // Redirect to WiPay me link
  return new Response(JSON.stringify({ redirect_url: WIPAY_ME_LINK }), {
    status:  200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
