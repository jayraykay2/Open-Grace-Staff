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
const OG_SP_SITE = 'https://graph.microsoft.com/v1.0/sites/netorg20110136.sharepoint.com:/sites/OpenGrace-Records';

const OG_LISTS = {
  clients:  { name: 'Clients',              id: null },
  pipeline: { name: 'Navigator Submissions', id: null },
  contacts: { name: 'Contacts',             id: null },
};

let _msalApp = null, _msalToken = null, _msalUser = null, _msalReady = false;

async function loadMsal() {
  if (window.msal) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://alcdn.msauth.net/browser/3.11.1/js/msal-browser.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
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
    if (redirectResult) { _msalToken = redirectResult.accessToken; _msalUser = redirectResult.account; }
    const accounts = _msalApp.getAllAccounts();
    if (accounts.length > 0) {
      try {
        const r = await _msalApp.acquireTokenSilent({ scopes: OG_GRAPH_SCOPES, account: accounts[0] });
        _msalToken = r.accessToken; _msalUser = r.account; _msalReady = true; return true;
      } catch {}
    }
    // Use redirect instead of popup to avoid popup blockers
    await _msalApp.acquireTokenRedirect({ scopes: OG_GRAPH_SCOPES, prompt: 'select_account' });
    return false; // page will redirect — result handled via handleRedirectPromise
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
  init: ogMsalStart, user: ogMsalUser, displayName: ogMsalDisplayName, graphFetch,
  clients: { get: spGetClients, save: spSaveClient, delete: spDeleteClient },
  pipeline: { get: spGetPipeline, add: spAddPipelineItem, move: spMovePipelineItem, delete: spDeletePipelineItem },
  load: { clients: ogLoadClients, pipeline: ogLoadPipeline },
};
