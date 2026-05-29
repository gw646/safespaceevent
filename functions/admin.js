/**
 * GET /admin
 *
 * Password-protected admin panel.
 * Pass ?secret=YOUR_ADMIN_SECRET in the URL, or set a cookie after first auth.
 *
 * Environment variables:
 *   ADMIN_SECRET  — secret token (set in Cloudflare Pages env vars)
 *   DB            — D1 database binding
 */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url    = new URL(request.url);
  const secret = url.searchParams.get("secret") || getCookie(request, "admin_session");

  /* ─── Auth gate ─────────────────────────────────────────────────── */
  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
    return new Response(loginPage(), {
      status: 401,
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    });
  }

  /* ─── Fetch data ─────────────────────────────────────────────────── */
  const db = env.DB;
  let rows = [];
  let stats = { total: 0, paid: 0, unpaid: 0 };

  if (db) {
    try {
      // Ensure table exists (in case no one has registered yet)
     await db.prepare(
  "CREATE TABLE IF NOT EXISTS registrants (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0, wipay_ref TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
).run();

      const result = await db
        .prepare("SELECT * FROM registrants ORDER BY created_at DESC")
        .all();

      rows = result.results || [];
      stats.total  = rows.length;
      stats.paid   = rows.filter(r => r.paid).length;
      stats.unpaid = stats.total - stats.paid;
    } catch (e) {
      rows = [];
    }
  }

  /* ─── Render ─────────────────────────────────────────────────────── */
  const sessionCookie = `admin_session=${secret}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`;

  return new Response(adminPage(rows, stats, secret), {
    status: 200,
    headers: {
      "Content-Type": "text/html;charset=UTF-8",
      "Set-Cookie":   sessionCookie,
      "Cache-Control":"no-store",
    },
  });
}

/* ─── Helper: get cookie value ──────────────────────────────────────── */
function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  const match  = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

/* ─── Login page HTML ───────────────────────────────────────────────── */
function loginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin — SafeSpace</title>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Roboto', sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0f172a; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 1rem; padding: 2.5rem 2rem; max-width: 360px; width: 100%; }
    h1 { color: #f1f5f9; font-size: 1.1rem; font-weight: 900; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 1.5rem; }
    label { display: block; color: #94a3b8; font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; margin-bottom: .4rem; }
    input { width: 100%; background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: .75rem 1rem; border-radius: .5rem; font-size: .9rem; margin-bottom: 1rem; outline: none; }
    input:focus { border-color: #3b82f6; }
    button { width: 100%; background: #2563eb; color: white; font-weight: 700; font-size: .75rem; text-transform: uppercase; letter-spacing: .1em; padding: .85rem; border: none; border-radius: .5rem; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    .logo { color: #3b82f6; font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .15em; margin-bottom: 1.5rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🛡️ SafeSpace Admin</div>
    <h1>Secure Access</h1>
    <form onsubmit="auth(event)">
      <label>Admin Secret</label>
      <input type="password" id="secret" placeholder="Enter admin secret" required autofocus>
      <button type="submit">Enter Admin Portal</button>
    </form>
  </div>
  <script>
    function auth(e) {
      e.preventDefault();
      const s = document.getElementById('secret').value;
      window.location.href = '/admin?secret=' + encodeURIComponent(s);
    }
  </script>
</body>
</html>`;
}

/* ─── Admin dashboard HTML ──────────────────────────────────────────── */
function adminPage(rows, stats, secret) {
  const tableRows = rows.length === 0
    ? `<tr><td colspan="6" style="text-align:center;padding:2rem;color:#64748b">No registrants yet.</td></tr>`
    : rows.map(r => `
        <tr>
          <td>${r.id}</td>
          <td>${esc(r.full_name)}</td>
          <td>${esc(r.email)}</td>
          <td>${esc(r.phone)}</td>
          <td>
            <span class="badge ${r.paid ? 'paid' : 'unpaid'}">
              ${r.paid ? '✓ Paid' : '✗ Unpaid'}
            </span>
          </td>
          <td>${r.created_at ? r.created_at.replace('T', ' ').substring(0, 16) : '—'}</td>
        </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Dashboard — SafeSpace</title>
  <link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500&family=Roboto:wght@400;500;700;900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Roboto', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }

    header {
      background: #1e293b;
      border-bottom: 1px solid #334155;
      padding: 1rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo { color: #3b82f6; font-weight: 900; font-size: .9rem; text-transform: uppercase; letter-spacing: .12em; }
    .logout { color: #94a3b8; font-size: .72rem; text-decoration: none; }
    .logout:hover { color: #f1f5f9; }

    main { max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem; }

    h1 { font-size: 1.4rem; font-weight: 900; text-transform: uppercase; letter-spacing: -.01em; margin-bottom: .3rem; }
    .sub { color: #64748b; font-size: .8rem; margin-bottom: 2rem; }

    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: .75rem;
      padding: 1.25rem 1.5rem;
    }
    .stat-label { color: #64748b; font-size: .65rem; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; margin-bottom: .4rem; }
    .stat-value { font-size: 2rem; font-weight: 900; color: #f1f5f9; }
    .stat-value.green { color: #22c55e; }
    .stat-value.amber { color: #f59e0b; }

    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      gap: .75rem;
    }
    .toolbar input {
      background: #1e293b;
      border: 1px solid #334155;
      color: #f1f5f9;
      padding: .5rem 1rem;
      border-radius: .5rem;
      font-size: .8rem;
      outline: none;
      width: 220px;
    }
    .toolbar input::placeholder { color: #475569; }
    .toolbar input:focus { border-color: #3b82f6; }
    .export-btn {
      background: #1e293b;
      border: 1px solid #334155;
      color: #94a3b8;
      font-size: .7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .1em;
      padding: .5rem 1rem;
      border-radius: .5rem;
      cursor: pointer;
    }
    .export-btn:hover { border-color: #3b82f6; color: #f1f5f9; }

    .table-wrap {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: .75rem;
      overflow: hidden;
      overflow-x: auto;
    }
    table { width: 100%; border-collapse: collapse; font-size: .82rem; }
    thead tr { background: #0f172a; }
    th {
      padding: .75rem 1rem;
      text-align: left;
      color: #64748b;
      font-size: .65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .1em;
      white-space: nowrap;
    }
    tbody tr { border-top: 1px solid #1e293b80; }
    tbody tr:hover { background: #0f172a50; }
    td { padding: .75rem 1rem; color: #cbd5e1; vertical-align: middle; font-family: 'Roboto Mono', monospace; font-size: .8rem; }
    td:nth-child(2) { font-family: 'Roboto', sans-serif; font-weight: 500; color: #f1f5f9; }

    .badge { display: inline-block; font-size: .65rem; font-weight: 700; padding: .25rem .65rem; border-radius: 9999px; text-transform: uppercase; letter-spacing: .07em; }
    .badge.paid   { background: #14532d; color: #4ade80; border: 1px solid #166534; }
    .badge.unpaid { background: #431407; color: #fb923c; border: 1px solid #7c2d12; }

    @media(max-width: 600px) { .stats { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <span class="logo">🛡️ SafeSpace Admin</span>
    <a class="logout" href="/admin">← Reload</a>
  </header>

  <main>
    <h1>Registrant Dashboard</h1>
    <p class="sub">Live view from D1 database · Everyday Safety Skills 2026</p>

    <div class="stats">
      <div class="stat">
        <div class="stat-label">Total Registrations</div>
        <div class="stat-value">${stats.total}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Confirmed Paid</div>
        <div class="stat-value green">${stats.paid}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Awaiting Payment</div>
        <div class="stat-value amber">${stats.unpaid}</div>
      </div>
    </div>

    <div class="toolbar">
      <input type="text" id="search" placeholder="🔍  Search by name or email…" oninput="filterTable(this.value)">
      <button class="export-btn" onclick="exportCSV()">⬇ Export CSV</button>
    </div>

    <div class="table-wrap">
      <table id="regTable">
        <thead>
          <tr>
            <th>#</th><th>Full Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Registered</th>
          </tr>
        </thead>
        <tbody id="tableBody">
          ${tableRows}
        </tbody>
      </table>
    </div>
  </main>

  <script>
    const allRows = Array.from(document.querySelectorAll('#tableBody tr'));

    function filterTable(q) {
      q = q.toLowerCase();
      allRows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(q) ? '' : 'none';
      });
    }

    function exportCSV() {
      const rows = [['ID','Full Name','Email','Phone','Paid','Registered']];
      allRows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td')).map(td => {
          const badge = td.querySelector('.badge');
          return '"' + (badge ? badge.textContent.trim() : td.textContent.trim()).replace(/"/g,'""') + '"';
        });
        if (cells.length) rows.push(cells);
      });
      const blob = new Blob([rows.map(r => r.join(',')).join('\\n')], { type: 'text/csv' });
      const a    = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'registrants.csv' });
      a.click();
    }
  </script>
</body>
</html>`;
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
