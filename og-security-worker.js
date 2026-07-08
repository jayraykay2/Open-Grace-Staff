/**
 * Open Grace Security Worker — v2 (2026-07-03)
 * FIX: All SharePoint I/O now uses Microsoft Graph (Sites.ReadWrite.All app permission).
 *      v1 used SharePoint REST for Staff Sessions with a Graph-audience token -> silent 401s,
 *      so magic-link codes were never stored. All Graph errors now surface loudly.
 * Lookups fetch items and filter in JS (.find) — SP columns are not indexed, $filter fails.
 *
 * Secrets required (already set): TENANT_ID, CLIENT_ID, CLIENT_SECRET, OG_JWT_SECRET,
 *                                 DEPLOY_SECRET, CF_ZONE_ID, CF_API_TOKEN
 */

const SITE_PATH = 'netorg20110136.sharepoint.com:/sites/OpenGrace-Records:';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SITE = `${GRAPH}/sites/${SITE_PATH}`;
const MAIL_SENDER = 'joshua.kennedy@opengrace.org';
const CODE_TTL_MIN = 15;
const SESSION_HOURS = 8;
const REMEMBER_HOURS = 30 * 24;

/* ---------- helpers ---------- */

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

let _tok = null; // {token, exp}
async function graphToken(env) {
  const now = Date.now();
  if (_tok && _tok.exp > now + 60000) return _tok.token;
  const body = new URLSearchParams({
    client_id: env.CLIENT_ID,
    client_secret: env.CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const r = await fetch(`https://login.microsoftonline.com/${env.TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error('Token acquisition failed: ' + (d.error_description || r.status));
  _tok = { token: d.access_token, exp: now + (d.expires_in - 120) * 1000 };
  return _tok.token;
}

/** Graph fetch that THROWS on any non-2xx so failures are never silent. */
async function graphFetch(env, path, opts = {}) {
  const token = await graphToken(env);
  const r = await fetch(path.startsWith('http') ? path : `${SITE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (r.status === 204) return null;
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!r.ok) {
    const msg = (data && data.error && data.error.message) ? data.error.message : String(text).slice(0, 200);
    throw new Error(`Graph ${r.status} on ${path.split('?')[0]}: ${msg}`);
  }
  return data;
}

async function listItems(env, listName, top = 500) {
  const d = await graphFetch(env, `/lists/${encodeURIComponent(listName)}/items?expand=fields&$top=${top}`);
  return d.value || [];
}

async function createItem(env, listName, fields) {
  return graphFetch(env, `/lists/${encodeURIComponent(listName)}/items`, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  });
}

async function updateItem(env, listName, itemId, fields) {
  return graphFetch(env, `/lists/${encodeURIComponent(listName)}/items/${itemId}/fields`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

async function hashPIN(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function genCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(100000 + (a[0] % 900000));
}

/* ---------- JWT (HS256) ---------- */

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = (s) => b64u(new TextEncoder().encode(s));

async function hmacKey(env) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.OG_JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signJWT(env, payload, hours) {
  const now = Math.floor(Date.now() / 1000);
  const full = { ...payload, iat: now, exp: now + hours * 3600 };
  const head = b64uStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64uStr(JSON.stringify(full));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

async function verifyJWT(env, token) {
  try {
    const [h, b, s] = token.split('.');
    if (!h || !b || !s) return null;
    const sigBytes = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), sigBytes, new TextEncoder().encode(`${h}.${b}`));
    if (!ok) return null;
    const payload = JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) { return null; }
}

async function requireStaff(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  return verifyJWT(env, token);
}

/* ---------- staff helpers ---------- */

async function findStaff(env, email) {
  const items = await listItems(env, 'Staff Profiles');
  const e = String(email || '').trim().toLowerCase();
  return items.find(i => (i.fields?.Email || '').trim().toLowerCase() === e && i.fields?.Active === 'Yes') || null;
}

function staffPayload(f) {
  return {
    email: (f.Email || '').trim().toLowerCase(),
    staffCode: f.StaffCode || '',
    name: f.Title || '',
    role: f.Role || '',
    clients: f.AssignedClients || '',
  };
}

async function sendEmail(env, to, subject, html) {
  await graphFetch(env, `${GRAPH}/users/${MAIL_SENDER}/sendMail`, {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  });
}

/* ---------- route handlers ---------- */

async function handleRequestCode(env, request) {
  const { email } = await request.json();
  if (!email) return json({ error: 'Email is required.' }, 400);
  const staff = await findStaff(env, email);
  if (!staff) return json({ error: 'No active staff account found for that email.' }, 404);

  // Deactivate any prior pending codes for this email
  const sessions = await listItems(env, 'Staff Sessions');
  const e = String(email).trim().toLowerCase();
  for (const s of sessions) {
    if ((s.fields?.StaffEmail || '').toLowerCase() === e && s.fields?.Active === 'Yes') {
      await updateItem(env, 'Staff Sessions', s.id, { Active: 'No' });
    }
  }

  const code = genCode();
  const expires = new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString();
  await createItem(env, 'Staff Sessions', {
    Title: e,
    StaffEmail: e,
    MagicCode: code,
    CodeExpires: expires,
    StaffCode: staff.fields.StaffCode || '',
    Active: 'Yes',
  });

  const first = (staff.fields.Title || 'there').split(' ')[0];
  await sendEmail(env, e, 'Your Open Grace login code', `
    <div style="font-family:'DM Sans',Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#1E1C5E;margin:0 0 8px;">Your login code</h2>
      <p>Hi ${first} — here is your Open Grace staff portal login code:</p>
      <div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#FF6B1A;padding:16px 0;">${code}</div>
      <p style="color:#555;">This code expires in ${CODE_TTL_MIN} minutes. If you didn't request this, ignore this email.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
      <p style="color:#999;font-size:12px;">Open Grace LLC · Coordinated Family Support · IRC Vendor PJ6208</p>
    </div>`);

  return json({ sent: true, email: e, expiresIn: CODE_TTL_MIN * 60 });
}

async function handleVerifyCode(env, request) {
  const { email, code, remember } = await request.json();
  if (!email || !code) return json({ error: 'Email and code are required.' }, 400);
  const e = String(email).trim().toLowerCase();

  const sessions = await listItems(env, 'Staff Sessions');
  const row = sessions.find(s =>
    (s.fields?.StaffEmail || '').toLowerCase() === e &&
    s.fields?.Active === 'Yes' &&
    s.fields?.MagicCode);
  if (!row) return json({ error: 'No pending code found. Please request a new one.' }, 400);
  if (new Date(row.fields.CodeExpires) < new Date()) {
    await updateItem(env, 'Staff Sessions', row.id, { Active: 'No' });
    return json({ error: 'Code expired. Please request a new one.' }, 400);
  }
  if (String(row.fields.MagicCode) !== String(code).trim()) {
    return json({ error: 'Incorrect code.' }, 400);
  }

  await updateItem(env, 'Staff Sessions', row.id, { Active: 'No', MagicCode: '' });

  const staff = await findStaff(env, e);
  if (!staff) return json({ error: 'Staff account not found or inactive.' }, 404);
  const hours = remember ? REMEMBER_HOURS : SESSION_HOURS;
  const token = await signJWT(env, staffPayload(staff.fields), hours);
  return json({ token, staff: staffPayload(staff.fields), expiresInHours: hours });
}

async function handleVerifyPin(env, request) {
  const { email, pin, remember } = await request.json();
  if (!email || !pin) return json({ error: 'Email and PIN are required.' }, 400);
  const staff = await findStaff(env, email);
  if (!staff) return json({ error: 'No active staff account found for that email.' }, 404);
  const h = await hashPIN(String(pin).trim());
  if (h !== staff.fields.PINHash) return json({ error: 'Incorrect PIN.' }, 400);
  const hours = remember ? REMEMBER_HOURS : SESSION_HOURS;
  const token = await signJWT(env, staffPayload(staff.fields), hours);
  return json({ token, staff: staffPayload(staff.fields), expiresInHours: hours });
}

async function handleValidate(env, request) {
  const payload = await requireStaff(env, request);
  if (!payload) return json({ valid: false }, 401);
  return json({ valid: true, staff: payload });
}

async function handleStaffAuth(env, request) {
  // Alias kept for compatibility with older clients
  return handleValidate(env, request);
}

async function handleContactLog(env, request, staff) {
  const b = await request.json();
  const item = await createItem(env, 'Contact Logs', {
    Title: `${b.clientName || b.clientOGID || 'Contact'} — ${b.contactDate || new Date().toISOString().slice(0, 10)}`,
    ClientOGID: b.clientOGID || '',
    UCI: b.uci || '',
    ContactDate: b.contactDate || new Date().toISOString().slice(0, 10),
    NavigatorName: staff.name || b.navigatorName || '',
    ContactType: b.contactType || '',
    ContactMethod: b.contactMethod || '',
    ServiceType: b.serviceType || '',
    Location: b.location || '',
    CFSDomains: Array.isArray(b.cfsDomains) ? b.cfsDomains.join(';') : (b.cfsDomains || ''),
    HoursSpent: Number(b.hoursSpent) || 0,
    ProgressNotes: b.progressNotes || '',
    FollowUpActions: b.followUpActions || '',
    QPRNarrativeNotes: b.qprNarrativeNotes || '',
  });
  return json({ saved: true, id: item.id });
}

async function handleClients(env, request, staff) {
  const assigned = String(staff.clients || '').toLowerCase().split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const items = await listItems(env, 'Clients');
  const mine = items.filter(i => {
    const f = i.fields || {};
    if (f.Active === 'No') return false;
    const name = (f.Title || '').toLowerCase();
    const ogid = (f.OGClientID || '').toLowerCase();
    const nav = (f.Navigator || '').toLowerCase();
    return assigned.some(a => name.includes(a) || ogid === a) || (staff.name && nav.includes(staff.name.toLowerCase()));
  });
  return json({
    clients: mine.map(i => ({
      name: i.fields.Title || '',
      uci: i.fields.UCI || '',
      ogClientID: i.fields.OGClientID || '',
      qprDue: i.fields.QPRDue || '',
      phone: i.fields.Phone || '',
      caregiver: i.fields.Caregiver || '',
      caregiverPhone: i.fields.CaregiverPhone || '',
      authorizedHours: i.fields.AuthorizedHours || '',
      usedHours: i.fields.UsedHours || '',
    })),
  });
}

async function handleMessages(env, request, staff) {
  const items = await listItems(env, 'Supervisor Messages');
  const mine = items.filter(i =>
    (i.fields?.ToStaffEmail || '').toLowerCase() === staff.email ||
    (i.fields?.ToStaffCode || '') === staff.staffCode ||
    (i.fields?.ToStaffCode || '').toUpperCase() === 'ALL');
  mine.sort((a, b) => new Date(b.createdDateTime) - new Date(a.createdDateTime));
  if (request.method === 'POST') {
    const { markRead } = await request.json();
    if (markRead) { await updateItem(env, 'Supervisor Messages', markRead, { Read: 'Yes' }); return json({ ok: true }); }
  }
  return json({
    messages: mine.map(i => ({
      id: i.id,
      from: i.fields.FromName || 'Supervisor',
      subject: i.fields.Title || '',
      body: i.fields.MessageBody || '',
      priority: i.fields.Priority || 'Normal',
      category: i.fields.Category || '',
      read: i.fields.Read === 'Yes',
      date: i.createdDateTime,
    })),
  });
}

async function handleHours(env, request, staff) {
  const b = await request.json();
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const total = days.reduce((t, d) => t + (Number(b[d]) || 0), 0);
  const item = await createItem(env, 'Staff Hours', {
    Title: `${staff.staffCode} — Week of ${b.weekOf || ''}`,
    StaffEmail: staff.email,
    StaffCode: staff.staffCode,
    WeekOf: b.weekOf || '',
    Monday: Number(b.monday) || 0,
    Tuesday: Number(b.tuesday) || 0,
    Wednesday: Number(b.wednesday) || 0,
    Thursday: Number(b.thursday) || 0,
    Friday: Number(b.friday) || 0,
    TotalHours: total,
    Notes: b.notes || '',
    Approved: 'Pending',
  });
  return json({ saved: true, id: item.id, totalHours: total });
}

async function handleHoursHistory(env, request, staff) {
  const items = await listItems(env, 'Staff Hours');
  const mine = items.filter(i => (i.fields?.StaffEmail || '').toLowerCase() === staff.email);
  mine.sort((a, b) => new Date(b.createdDateTime) - new Date(a.createdDateTime));
  return json({
    entries: mine.map(i => ({
      id: i.id,
      weekOf: i.fields.WeekOf || '',
      monday: i.fields.Monday || 0,
      tuesday: i.fields.Tuesday || 0,
      wednesday: i.fields.Wednesday || 0,
      thursday: i.fields.Thursday || 0,
      friday: i.fields.Friday || 0,
      total: i.fields.TotalHours || 0,
      notes: i.fields.Notes || '',
      approved: i.fields.Approved || 'Pending',
    })),
  });
}

async function handleDeploy(env, request) {
  const secret = request.headers.get('X-Deploy-Secret');
  if (!secret || secret !== env.DEPLOY_SECRET) return json({ error: 'Unauthorized' }, 401);
  const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ purge_everything: true }),
  });
  const d = await r.json();
  return json({ purged: d.success === true });
}

/* ---------- router ---------- */

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/auth/request-code' && request.method === 'POST') return await handleRequestCode(env, request);
      if (path === '/auth/verify-code' && request.method === 'POST') return await handleVerifyCode(env, request);
      if (path === '/auth/verify-pin' && request.method === 'POST') return await handleVerifyPin(env, request);
      if (path === '/auth/validate') return await handleValidate(env, request);
      if (path === '/auth/logout') return json({ ok: true });
      if (path === '/api/staff-auth') return await handleStaffAuth(env, request);
      if (path === '/deploy' && request.method === 'POST') return await handleDeploy(env, request);

      if (path.startsWith('/api/')) {
        const staff = await requireStaff(env, request);
        if (!staff) return json({ error: 'Unauthorized. Please log in again.' }, 401);
        if (path === '/api/clients') return await handleClients(env, request, staff);
        if (path === '/api/contact-log' && request.method === 'POST') return await handleContactLog(env, request, staff);
        if (path === '/api/messages') return await handleMessages(env, request, staff);
        if (path === '/api/hours' && request.method === 'POST') return await handleHours(env, request, staff);
        if (path === '/api/hours-history') return await handleHoursHistory(env, request, staff);
      }
      return json({ error: 'Not Found' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};
