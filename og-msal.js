/**
 * og-msal.js — Open Grace Director Portal
 * MSAL.js v3 authentication + Microsoft Graph API layer
 *
 * Responsibilities:
 *   1. Authenticate Joshua's @opengrace.org account silently via M365
 *   2. Provide graphFetch() — authenticated Graph API wrapper
 *   3. Read/write SharePoint lists: Clients, Pipeline (Navigator Submissions)
 *   4. Drop-in replacements for load(K.clients) and load(K.pipeline) calls
 *
 * Architecture:
 *   - MSAL runs AFTER the passkey gate (device security layer)
 *   - On first visit: M365 login popup (one time per browser)
 *   - Subsequent visits: silent token refresh (no UI)
 *   - All SharePoint data cached in memory, synced on read/write
 */

const OG_MSAL_CONFIG = {
  clientId:  'ede1a3cf-cf8d-466b-94f0-ed1008ad0f5f',
  tenantId:  '1916d89f-0ee3-4972-a513-d91fb3007040',
  authority: 'https://login.microsoftonline.com/1916d89f-0ee3-4972-a513-d91fb3007040',
  redirectUri: 'https://opengrace.org/director.html',
};

const OG_GRAPH_SCOPES = ['User.Read', 'Sites.ReadWrite.All'];
const OG_SP_SITE = 'https://graph.microsoft.com/v1.0/sites/netorg20110136.sharepoint.com:/sites/OpenGrace-Records:';

const OG_LISTS = {
  clients:      { name: 'Clients',               id: null },
  pipeline:     { name: 'Navigator Submissions',  id: null },
  contacts:     { name: 'Contact Logs',           id: null },
  training:     { name: 'Training Log',           id: null },
  compliance:   { name: 'Compliance Alerts',      id: null },
};

let _msalApp = null, _msalToken = null, _msalUser = null, _msalReady = false;

async function loadMsal() {
  if (window.msal) return;
  // Load via fetch+eval to bypass CSP script-src restrictions
  const msalText = await fetch('/msal-browser.min.js?v=3.11.1').then(r => r.text());
  (0, eval)(msalText);
}

async function ogMsalInit() {
  if (_msalReady) return true;
  try {
    await loadMsal();
    _msalApp = new msal.PublicClientApplication({
      auth: { clientId: OG_MSAL_CONFIG.clientId, authority: OG_MSAL_CONFIG.authority, redirectUri: OG_MSAL_CONFIG.redirectUri },
      cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false },
    });
    await _msalApp.initialize();
    const redirectResult = await _msalApp.handleRedirectPromise();
    if (redirectResult) {
      _msalToken = redirectResult.accessToken;
      _msalUser = redirectResult.account;
      _msalReady = true;
      console.log('[OG-MSAL] Redirect auth complete:', _msalUser?.username);
      return true;
    }
    const accounts = _msalApp.getAllAccounts();
    if (accounts.length > 0) {
      try {
        const r = await _msalApp.acquireTokenSilent({ scopes: OG_GRAPH_SCOPES, account: accounts[0] });
        _msalToken = r.accessToken; _msalUser = r.account; _msalReady = true; return true;
      } catch {}
    }
    // Use redirect instead of popup to avoid popup blockers
    await _msalApp.acquireTokenRedirect({ scopes: OG_GRAPH_SCOPES, prompt: 'select_account' });
    return false; // page will redirect — result handled on return via handleRedirectPromise above
  } catch (err) { console.warn('[OG-MSAL] Init failed:', err); return false; }
}

async function getAccessToken() {
  if (!_msalApp) return null;
  try {
    const accounts = _msalApp.getAllAccounts();
    if (!accounts.length) return null;
    const r = await _msalApp.acquireTokenSilent({ scopes: OG_GRAPH_SCOPES, account: accounts[0] });
    _msalToken = r.accessToken; return _msalToken;
  } catch { return null; }
}

async function graphFetch(url, options = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error('No access token');
  const response = await fetch(url, {
    ...options,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) { const e = await response.text(); throw new Error(`Graph ${response.status}: ${e}`); }
  return response.status === 204 ? null : response.json();
}

async function resolveListIds() {
  if (Object.values(OG_LISTS).every(l => l.id)) return;
  try {
    const data = await graphFetch(`${OG_SP_SITE}/lists?$select=id,displayName`);
    (data.value || []).forEach(list => {
      Object.keys(OG_LISTS).forEach(key => {
        if (OG_LISTS[key].name.toLowerCase() === list.displayName.toLowerCase()) OG_LISTS[key].id = list.id;
      });
    });
  } catch (err) { console.warn('[OG-MSAL] resolveListIds failed:', err); }
}

async function spGetClients() {
  await resolveListIds();
  const listId = OG_LISTS.clients.id;
  if (!listId) return null;
  try {
    const data = await graphFetch(`${OG_SP_SITE}/lists/${listId}/items?$expand=fields&$select=id,fields&$top=200`);
    return (data.value || []).map(item => ({
      _spId: item.id, name: item.fields.Title || '', uci: item.fields.UCI || '',
      serviceStart: item.fields.ServiceStart || '', qprDue: item.fields.QPRDue || '',
      authorizedHours: parseFloat(item.fields.AuthorizedHours) || 0,
      usedHours: parseFloat(item.fields.UsedHours) || 0,
      coordinator: item.fields.Coordinator || '', active: item.fields.Active !== false,
      referralStatus: item.fields.ReferralStatus || '',
    }));
  } catch (err) { console.warn('[OG-MSAL] spGetClients failed:', err); return null; }
}

async function spSaveClient(client) {
  await resolveListIds();
  const listId = OG_LISTS.clients.id;
  if (!listId) return false;
  const fields = {
    Title: client.name || '', UCI: client.uci || '', ServiceStart: client.serviceStart || '',
    QPRDue: client.qprDue || '', AuthorizedHours: client.authorizedHours || 0,
    UsedHours: client.usedHours || 0, Coordinator: client.coordinator || '', Active: client.active !== false,
    ReferralStatus: client.referralStatus || '',
  };
  try {
    if (client._spId) {
      await graphFetch(`${OG_SP_SITE}/lists/${listId}/items/${client._spId}/fields`, { method: 'PATCH', body: JSON.stringify(fields) });
    } else {
      await graphFetch(`${OG_SP_SITE}/lists/${listId}/items`, { method: 'POST', body: JSON.stringify({ fields }) });
    }
    return true;
  } catch (err) { console.warn('[OG-MSAL] spSaveClient failed:', err); return false; }
}

async function spUpdateReferralStatus(spId, referralStatus) {
  await resolveListIds();
  const listId = OG_LISTS.clients.id;
  if (!listId || !spId) return false;
  try {
    await graphFetch(`${OG_SP_SITE}/lists/${listId}/items/${spId}/fields`, {
      method: 'PATCH',
      body: JSON.stringify({ ReferralStatus: referralStatus || '' })
    });
    return true;
  } catch (err) { console.warn('[OG-MSAL] spUpdateReferralStatus failed:', err); return false; }
}

async function spDeleteClient(spId) {
  await resolveListIds();
  const listId = OG_LISTS.clients.id;
  if (!listId || !spId) return false;
  try { await graphFetch(`${OG_SP_SITE}/lists/${listId}/items/${spId}`, { method: 'DELETE' }); return true; }
  catch (err) { console.warn('[OG-MSAL] spDeleteClient failed:', err); return false; }
}

async function spGetPipeline() {
  await resolveListIds();
  const listId = OG_LISTS.pipeline.id;
  if (!listId) return null;
  try {
    const data = await graphFetch(`${OG_SP_SITE}/lists/${listId}/items?$expand=fields&$select=id,fields&$top=500`);
    const pipeline = { 'referral-pending': [], 'referral-assign': [], 'onboarding': [], 'completed': [] };
    (data.value || []).forEach(item => {
      const stage = item.fields.Stage || 'referral-pending';
      if (!pipeline[stage]) pipeline[stage] = [];
      pipeline[stage].push({
        _spId: item.id, name: item.fields.Title || '', phone: item.fields.Phone || '',
        notes: item.fields.Notes || '', date: item.fields.DateAdded || '',
        added: item.fields.DateAdded || '', uci: item.fields.UCI || '',
        status: item.fields.Status || '',
      });
    });
    return pipeline;
  } catch (err) { console.warn('[OG-MSAL] spGetPipeline failed:', err); return null; }
}

async function spAddPipelineItem(stage, item) {
  await resolveListIds();
  const listId = OG_LISTS.pipeline.id;
  if (!listId) return false;
  try {
    await graphFetch(`${OG_SP_SITE}/lists/${listId}/items`, {
      method: 'POST',
      body: JSON.stringify({ fields: {
        Title: item.name || '', Phone: item.phone || '', Notes: item.notes || '',
        DateAdded: item.date || new Date().toISOString().split('T')[0],
        Stage: stage, Status: 'New Submission', HumanReviewComplete: 'No',
      }})
    });
    return true;
  } catch (err) { console.warn('[OG-MSAL] spAddPipelineItem failed:', err); return false; }
}

async function spMovePipelineItem(spId, newStage) {
  await resolveListIds();
  const listId = OG_LISTS.pipeline.id;
  if (!listId || !spId) return false;
  try { await graphFetch(`${OG_SP_SITE}/lists/${listId}/items/${spId}/fields`, { method: 'PATCH', body: JSON.stringify({ Stage: newStage }) }); return true; }
  catch (err) { console.warn('[OG-MSAL] spMovePipelineItem failed:', err); return false; }
}

async function spDeletePipelineItem(spId) {
  await resolveListIds();
  const listId = OG_LISTS.pipeline.id;
  if (!listId || !spId) return false;
  try { await graphFetch(`${OG_SP_SITE}/lists/${listId}/items/${spId}`, { method: 'DELETE' }); return true; }
  catch (err) { console.warn('[OG-MSAL] spDeletePipelineItem failed:', err); return false; }
}

// ── CONTACT LOGS (Case Notes) ──────────────────────────────────────────────────

async function spGetContactLogs(clientUCI = null) {
  await resolveListIds();
  const listId = OG_LISTS.contacts.id;
  if (!listId) return null;
  try {
    const filter = clientUCI ? `&$filter=fields/UCI eq '${clientUCI}'` : '';
    const data = await graphFetch(`${OG_SP_SITE}/lists/${listId}/items?$expand=fields&$select=id,fields&$top=500&$orderby=fields/ContactDate desc${filter}`);
    return (data.value || []).map(item => ({
      _spId:    item.id,
      clientId: item.fields.ClientOGID || '',
      uci:      item.fields.UCI || '',
      date:     item.fields.ContactDate || '',
      author:   item.fields.Author || item.fields.NavigatorName || '',
      type:     item.fields.ContactType || '',
      method:   item.fields.ContactMethod || '',
      service:  item.fields.ServiceType || '',
      location: item.fields.Location || '',
      domains:  item.fields.CFSDomains ? item.fields.CFSDomains.split(';').filter(Boolean) : [],
      hours:    parseFloat(item.fields.HoursSpent || 0),
      note:     item.fields.ProgressNotes || '',
      followup: item.fields.FollowUpActions || '',
      qpr:      item.fields.QPRNarrativeNotes || '',
    }));
  } catch (err) { console.warn('[OG-MSAL] spGetContactLogs failed:', err); return null; }
}

async function spSaveContactLog(note) {
  await resolveListIds();
  const listId = OG_LISTS.contacts.id;
  if (!listId) return false;
  try {
    const fields = {
      Title:              note.date + ' — ' + (note.clientId || ''),
      ClientOGID:         note.clientId || '',
      UCI:                note.uci || '',
      ContactDate:        note.date || new Date().toISOString().split('T')[0],
      NavigatorName:      note.author || '',
      ContactType:        note.type || '',
      ContactMethod:      note.method || '',
      ServiceType:        note.service || '',
      Location:           note.location || '',
      CFSDomains:         (note.domains || []).join(';'),
      HoursSpent:         note.hours || 0,
      ProgressNotes:      note.note || '',
      FollowUpActions:    note.followup || '',
      QPRNarrativeNotes:  note.qpr || '',
    };
    if (note._spId) {
      await graphFetch(`${OG_SP_SITE}/lists/${listId}/items/${note._spId}/fields`, { method: 'PATCH', body: JSON.stringify(fields) });
    } else {
      await graphFetch(`${OG_SP_SITE}/lists/${listId}/items`, { method: 'POST', body: JSON.stringify({ fields }) });
    }
    return true;
  } catch (err) { console.warn('[OG-MSAL] spSaveContactLog failed:', err); return false; }
}

// ── TRAINING LOG ───────────────────────────────────────────────────────────────

async function spGetTrainingLog(staffCode = null) {
  await resolveListIds();
  const listId = OG_LISTS.training.id;
  if (!listId) return null;
  try {
    const filter = staffCode ? `&$filter=fields/StaffCode eq '${staffCode}'` : '';
    const data = await graphFetch(`${OG_SP_SITE}/lists/${listId}/items?$expand=fields&$select=id,fields&$top=500${filter}`);
    return (data.value || []).map(item => ({
      _spId:      item.id,
      staffCode:  item.fields.StaffCode || '',
      staffName:  item.fields.StaffName || '',
      module:     item.fields.ModuleName || '',
      hours:      parseFloat(item.fields.Hours || 0),
      date:       item.fields.DateCompleted || '',
      verified:   item.fields.Verified === 'Yes',
    }));
  } catch (err) { console.warn('[OG-MSAL] spGetTrainingLog failed:', err); return null; }
}

async function spSaveTrainingEntry(entry) {
  await resolveListIds();
  const listId = OG_LISTS.training.id;
  if (!listId) return false;
  try {
    const fields = {
      Title:          entry.staffCode + ' — ' + entry.module,
      StaffCode:      entry.staffCode || '',
      StaffName:      entry.staffName || '',
      ModuleName:     entry.module || '',
      Hours:          entry.hours || 0,
      DateCompleted:  entry.date || new Date().toISOString().split('T')[0],
      Verified:       entry.verified ? 'Yes' : 'No',
    };
    await graphFetch(`${OG_SP_SITE}/lists/${listId}/items`, { method: 'POST', body: JSON.stringify({ fields }) });
    return true;
  } catch (err) { console.warn('[OG-MSAL] spSaveTrainingEntry failed:', err); return false; }
}

// ── FILE UPLOAD ────────────────────────────────────────────────────────────────
// SP Drive ID for OpenGrace-Records
const OG_SP_DRIVE = 'b!aPF3yLGE5E-Sm0Mi2ZvrLvkB8CnsSbFEmRsoH0_jrSIi81q3bXf3RJKC4SIpQ_CT';

async function spUploadFile(file, spFolderPath) {
  // spFolderPath e.g. "Client Records/Open Grace - Clients/Burks, Jaybrion"
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const encoded = spFolderPath.split('/').map(encodeURIComponent).join('/');
    const url = `https://graph.microsoft.com/v1.0/drives/${OG_SP_DRIVE}/root:/${encoded}/${encodeURIComponent(file.name)}:/content`;
    const resp = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!resp.ok) throw new Error('Upload failed: ' + resp.status);
    const result = await resp.json();
    return {
      name:        result.name,
      webUrl:      result.webUrl,
      downloadUrl: result['@microsoft.graph.downloadUrl'] || result.webUrl,
      spId:        result.id,
      size:        result.size,
    };
  } catch (err) { console.warn('[OG-MSAL] spUploadFile failed:', err); return null; }
}

// Helper: get SP folder path for a client by name
function spClientFolder(clientName) {
  return `Client Records/Open Grace - Clients/${clientName}`;
}

// Helper: get SP folder path for staff by name
function spStaffFolder(staffName) {
  return `Employee Personnel Files/${staffName}`;
}

// ── ROLE-BASED ACCESS ──────────────────────────────────────────────────────────

function ogUserRole() {
  const email = (_msalUser?.username || '').toLowerCase();
  if (email.includes('joshua.kennedy') || email.includes('director')) return 'director';
  return 'navigator';
}

function ogUserEmail() {
  return _msalUser?.username || '';
}

// Filter clients based on role — director sees all, navigator sees assigned only
function ogFilterClientsByRole(clients) {
  if (ogUserRole() === 'director') return clients;
  const email = ogUserEmail().toLowerCase();
  return clients.filter(c => (c.navigatorEmail || c.navigator || '').toLowerCase().includes(email.split('@')[0]));
}

// ── HOURS AGGREGATION ──────────────────────────────────────────────────────────

async function spGetHoursForClient(clientUCI) {
  const logs = await spGetContactLogs(clientUCI);
  if (!logs) return null;
  return logs.reduce((sum, log) => sum + (parseFloat(log.hours) || 0), 0);
}

// ── DASHBOARD REFRESH ──────────────────────────────────────────────────────────

async function ogRefreshDashboard() {
  if (!window._ogSpReady) return false;
  try {
    // Refresh clients
    const spClients = await spGetClients();
    if (spClients && spClients.length > 0 && window.CLIENTS) {
      // Merge SP data with local hardcoded data (SP wins for live fields)
      spClients.forEach(spC => {
        const local = window.CLIENTS.find(c => c.uci === spC.uci);
        if (local) {
          local.usedHours = spC.usedHours || local.usedHours;
          local.authHours = spC.authHours || local.authHours;
          local.stage = spC.stage || local.stage;
          local._spId = spC._spId;
          local.referralStatus = spC.referralStatus || local.referralStatus || '';
        }
      });
    }
    // Refresh pipeline from Navigator Submissions
    const spPipeline = await spGetPipeline();
    if (spPipeline && window.PIPELINE) {
      // SP pipeline items get added to PIPELINE if not already there
      Object.entries(spPipeline).forEach(([stage, items]) => {
        items.forEach(item => {
          const exists = window.PIPELINE.find(p => p._spId === item._spId);
          if (!exists && item.name) {
            window.PIPELINE.push({
              id: 'SP-' + item._spId,
              lane: 'Initial Contact',
              age: item.date || 'today',
              owner: 'ACE',
              status: 'new',
              name: item.name,
              phone: item.phone || '',
              next: 'Review and assign — from Navigator Submissions SP list',
              source: 'SP Auto',
              _spId: item._spId,
            });
          }
        });
      });
    }
    // Refresh case notes from Contact Logs — attach to matching client by UCI
    const spNotes = await spGetContactLogs();
    if (spNotes && spNotes.length > 0 && window.CLIENTS) {
      window.CLIENTS.forEach(c => {
        const mine = spNotes.filter(n => n.uci && n.uci === c.uci)
          .map(n => ({ ...n, clientId: c.id }));
        if (mine.length) {
          // SP-sourced notes replace any local placeholder for this client, sorted newest first
          c.caseNotes = mine.sort((a,b) => (b.date||'').localeCompare(a.date||''));
          c.lastNote = c.caseNotes[0];
        }
      });
    }
    console.log('[OG-MSAL] Dashboard refreshed from SharePoint');
    return true;
  } catch (err) { console.warn('[OG-MSAL] ogRefreshDashboard failed:', err); return false; }
}


// ── PROGRESS / JOURNEY WRITE-BACK ─────────────────────────────────────────────
async function spUpdateProgress(clientId, updates) {
  await resolveListIds();
  const listId = OG_LISTS.pipeline.id;
  if (!listId) return false;
  try {
    const data = await graphFetch(OG_SP_SITE + '/lists/' + listId + '/items?$expand=fields&$filter=fields/UCI eq \'' + clientId + '\'&$top=1');
    const item = data.value?.[0];
    if (!item) return false;
    const fields = {};
    if (updates.stage) fields.Stage = updates.stage;
    if (updates.enclosureCDate) fields.EnclosureCDate = updates.enclosureCDate;
    if (updates.ackComplete !== undefined) fields.AcknowledgmentComplete = updates.ackComplete ? 'Yes' : 'No';
    if (updates.casePlanFiled !== undefined) fields.CasePlanFiled = updates.casePlanFiled ? 'Yes' : 'No';
    if (updates.serviceStart) fields.ServiceStart = updates.serviceStart;
    if (updates.qprDue) fields.QPRDue = updates.qprDue;
    await graphFetch(OG_SP_SITE + '/lists/' + listId + '/items/' + item.id + '/fields', { method: 'PATCH', body: JSON.stringify(fields) });
    console.log('[OG-MSAL] Progress updated for', clientId);
    return true;
  } catch (err) { console.warn('[OG-MSAL] spUpdateProgress failed:', err); return false; }
}

async function spSaveJourney(clientId, flags) {
  await resolveListIds();
  const listId = OG_LISTS.pipeline.id;
  if (!listId) return false;
  try {
    const data = await graphFetch(OG_SP_SITE + '/lists/' + listId + '/items?$expand=fields&$filter=fields/UCI eq \'' + clientId + '\'&$top=1');
    const item = data.value?.[0];
    if (!item) return false;
    const fields = {};
    if (flags.welcomed !== undefined) fields.WelcomeSent = flags.welcomed ? 'Yes' : 'No';
    if (flags.prescreenSent !== undefined) fields.PrescreenSent = flags.prescreenSent ? 'Yes' : 'No';
    if (flags.ackSent !== undefined) fields.AcknowledgmentSent = flags.ackSent ? 'Yes' : 'No';
    if (flags.ackComplete !== undefined) fields.AcknowledgmentComplete = flags.ackComplete ? 'Yes' : 'No';
    if (flags.casePlanUploaded !== undefined) fields.CasePlanFiled = flags.casePlanUploaded ? 'Yes' : 'No';
    await graphFetch(OG_SP_SITE + '/lists/' + listId + '/items/' + item.id + '/fields', { method: 'PATCH', body: JSON.stringify(fields) });
    return true;
  } catch (err) { console.warn('[OG-MSAL] spSaveJourney failed:', err); return false; }
}

const OG_WORKER_URL = 'https://og-security-worker.jayraykay2.workers.dev';
const OG_DEPLOY_SECRET = '8164c25bb1de20a7aa3454d244dcf349668942c06c6057b9ab23c81020730691';

async function workerPush(files, message) {
  const encoded = files.map(f => ({ path: f.path, content: btoa(unescape(encodeURIComponent(f.content))) }));
  const resp = await fetch(OG_WORKER_URL + '/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Deploy-Secret': OG_DEPLOY_SECRET },
    body: JSON.stringify({ files: encoded, message: message || 'Deploy via dashboard', purge: true }),
  });
  if (!resp.ok) throw new Error('Worker push failed: ' + resp.status);
  return await resp.json();
}

async function workerPurge(filePaths) {
  const resp = await fetch(OG_WORKER_URL + '/purge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Deploy-Secret': OG_DEPLOY_SECRET },
    body: JSON.stringify(filePaths ? { files: filePaths } : {}),
  });
  return await resp.json();
}

function ogMsalUser() { return _msalUser || null; }
function ogMsalDisplayName() { return _msalUser?.name || _msalUser?.username || 'Joshua Kennedy'; }

async function syncLocalToSharePoint() {
  if (localStorage.getItem('og_sp_migrated')) return;
  try {
    const spClients = await spGetClients();
    if (spClients !== null && spClients.length === 0) {
      const localClients = JSON.parse(localStorage.getItem('og_clients_v1') || '[]');
      for (const c of localClients) await spSaveClient(c);
      if (localClients.length) console.log(`[OG-MSAL] Migrated ${localClients.length} clients to SharePoint`);
    }
    const spPipeline = await spGetPipeline();
    if (spPipeline !== null) {
      const isEmpty = Object.values(spPipeline).every(arr => arr.length === 0);
      if (isEmpty) {
        const localPipeline = JSON.parse(localStorage.getItem('og_pipeline_v2') || '{}');
        for (const [stage, items] of Object.entries(localPipeline)) {
          for (const item of (items || [])) await spAddPipelineItem(stage, item);
        }
      }
    }
    localStorage.setItem('og_sp_migrated', '1');
  } catch (err) { console.warn('[OG-MSAL] Migration failed (non-fatal):', err); }
}

async function ogLoadClients() {
  if (window._ogSpReady) { const r = await spGetClients(); if (r !== null) return r; }
  try { return JSON.parse(localStorage.getItem('og_clients_v1') || '[]'); } catch { return []; }
}

async function ogLoadPipeline() {
  if (window._ogSpReady) { const r = await spGetPipeline(); if (r !== null) return r; }
  try { return JSON.parse(localStorage.getItem('og_pipeline_v2') || '{"referral-pending":[],"referral-assign":[],"onboarding":[],"completed":[]}'); }
  catch { return { 'referral-pending': [], 'referral-assign': [], 'onboarding': [], 'completed': [] }; }
}

async function ogMsalStart() {
  const ok = await ogMsalInit();
  if (!ok) { console.warn('[OG-MSAL] Auth failed — running in offline/local mode'); return false; }
  resolveListIds().then(() => syncLocalToSharePoint());
  window._ogSpReady = true;
  console.log('[OG-MSAL] Ready —', ogMsalDisplayName());
  return true;
}

window.ogMsal = {
  init:        ogMsalStart,
  user:        ogMsalUser,
  displayName: ogMsalDisplayName,
  role:        ogUserRole,
  email:       ogUserEmail,
  filterByRole: ogFilterClientsByRole,
  graphFetch,
  clients:  { get: spGetClients,      save: spSaveClient,       delete: spDeleteClient, updateStatus: spUpdateReferralStatus },
  pipeline: { get: spGetPipeline,     add: spAddPipelineItem,   move: spMovePipelineItem, delete: spDeletePipelineItem },
  notes:    { get: spGetContactLogs,  save: spSaveContactLog },
  training: { get: spGetTrainingLog,  save: spSaveTrainingEntry },
  files:    { upload: spUploadFile,   clientFolder: spClientFolder, staffFolder: spStaffFolder },
  hours:    { forClient: spGetHoursForClient },
  progress: { update: spUpdateProgress, journey: spSaveJourney },
  deploy:   { push: workerPush, purge: workerPurge },
  load:     { clients: ogLoadClients, pipeline: ogLoadPipeline },
  refresh:  ogRefreshDashboard,
};
