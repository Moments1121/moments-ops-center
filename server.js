require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const cron = require('node-cron');
const axios = require('axios');
const cors = require('cors');
const http = require('http');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ============================================================
// STATE — latest fetched data stored in memory
// ============================================================
let latestData = null;
let lastFetched = null;
let isFetching = false;

// ============================================================
// WEBSOCKET — push updates to all connected clients
// ============================================================
function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

wss.on('connection', (ws) => {
  console.log('Client connected');
  // Send latest data immediately on connect
  if (latestData) {
    ws.send(JSON.stringify({ type: 'data', payload: latestData, lastFetched }));
  } else {
    ws.send(JSON.stringify({ type: 'loading' }));
  }
});

// ============================================================
// TABLEAU API
// ============================================================
let tableauAuthToken = null;
let tableauTokenExpiry = null;
let tableauSiteLuid = null; // The real UUID Tableau needs for API calls

async function getTableauToken() {
  if (tableauAuthToken && tableauTokenExpiry && Date.now() < tableauTokenExpiry) {
    return tableauAuthToken;
  }
  try {
    const res = await axios.post(
      `${process.env.TABLEAU_SERVER}/api/3.21/auth/signin`,
      {
        credentials: {
          personalAccessTokenName: process.env.TABLEAU_TOKEN_NAME,
          personalAccessTokenSecret: process.env.TABLEAU_TOKEN_VALUE,
          site: { contentUrl: process.env.TABLEAU_SITE_ID }
        }
      }
    );
    tableauAuthToken = res.data.credentials.token;
    // Capture the site LUID (UUID) — this is what the REST API actually needs
    tableauSiteLuid = res.data.credentials.site.id;
    tableauTokenExpiry = Date.now() + 200 * 60 * 1000;
    console.log('✅ Tableau auth token refreshed, site LUID:', tableauSiteLuid);
    return tableauAuthToken;
  } catch (err) {
    console.error('❌ Tableau auth failed:', err.message);
    return null;
  }
}

async function getTableauViewData(viewId) {
  const token = await getTableauToken();
  if (!token || !tableauSiteLuid) return null;
  try {
    const res = await axios.get(
      `${process.env.TABLEAU_SERVER}/api/3.21/sites/${tableauSiteLuid}/views/${viewId}/csv`,
      {
        headers: { 'X-Tableau-Auth': token },
        params: { maxAge: 5 } // allow up to 5 min cached extract
      }
    );
    return parseCSV(res.data);
  } catch (err) {
    console.error(`❌ Tableau view ${viewId} failed:`, err.message);
    return null;
  }
}

function parseCSV(csv) {
  if (!csv) return [];
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  return lines.slice(1).map(line => {
    const values = line.match(/(".*?"|[^,]+)(?=,|$)/g) || [];
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (values[i] || '').replace(/"/g, '').trim();
    });
    return obj;
  });
}

// Tableau View IDs — confirmed working March 10 2026
// (views that returned 401 have been replaced with verified working IDs)
const TABLEAU_VIEWS = {
  dailySnapshot:    'e5bf6766-726f-4f2d-ad83-9e8f72c3b72c', // ✅ Daily Snapshot — census 2032, admits 54
  adcAlos:          'ffbe2f7f-f1ee-45bd-9ac5-02a6818081e8', // ✅ ADC & ALOS — ADC 2033, ALOS 148d
  weeklyFrequency:  'fa199814-bb59-42e6-9e44-a15c989f8f7f', // ✅ Weekly patient visit frequency CNA/RN/MSW/CH
  rnMetrics:        '857f6de9-d3ae-418f-bc9e-8cdce2f55e5f', // ✅ RN Metrics — scheduled SN visits by week
  monthlyFrequency: 'c7e9b2e3-acff-4bab-be4d-5d8196437365', // ✅ Monthly MSW/Chaplain planned visits
  workerTurnover:   '8702ecdb-5356-4f3a-8bfd-99398f0920bd', // ✅ Worker Turnover (Moments project)
};

async function fetchTableauData() {
  console.log('📊 Fetching Tableau data...');
  const [census, adcAlos, rnMetrics, weeklyFreq, monthlyFreq, workerTurnover] = await Promise.all([
    getTableauViewData(TABLEAU_VIEWS.dailySnapshot),    // cols: "Patient Count"
    getTableauViewData(TABLEAU_VIEWS.adcAlos),          // cols: "Month of Date","Average Daily Census","Branch Group"
    getTableauViewData(TABLEAU_VIEWS.rnMetrics),        // cols: "Week of Visit Start Date","Branch Code","Avg. count to completed"
    getTableauViewData(TABLEAU_VIEWS.weeklyFrequency),  // large — patient-level weekly freq data
    getTableauViewData(TABLEAU_VIEWS.monthlyFrequency), // cols: "Branch Code","Discipline Code","Month of Visit Start Date","Patient","Year of Visit Start Date","Planned Frequency"
    getTableauViewData(TABLEAU_VIEWS.workerTurnover),   // cols: "Month of Period End Date","Turnover %","New Hires","Terminations","Worker Count - End","Worker Count - Start"
  ]);

  // ── PROCESS MONTHLY FREQUENCY by Discipline Code ──────────────────
  // Discipline codes: MA=CNA/Aide, CH=Chaplain, MSW=Social Work, MU=Music, RN=Nursing, LVN=LVN
  const monthlyRows = monthlyFreq || [];
  const currentMonth = new Date().toLocaleString('default', { month: 'long' }); // e.g. "March"

  function avgFreqByDisc(rows, discCode, month) {
    const matching = rows.filter(r =>
      r['Discipline Code'] === discCode &&
      (r['Month of Visit Start Date'] || '').includes(month)
    );
    if (!matching.length) return { avg: null, count: 0, patients: 0 };
    const freqs = matching.map(r => parseFloat(r['Planned Frequency'])).filter(v => !isNaN(v) && v > 0 && v < 50);
    if (!freqs.length) return { avg: null, count: matching.length, patients: matching.length };
    return {
      avg: freqs.reduce((a, b) => a + b, 0) / freqs.length,
      count: freqs.length,
      patients: matching.length,
    };
  }

  // ── PROCESS RN METRICS ───────────────────────────────────────────
  const rnRows = rnMetrics || [];
  const latestRNRows = rnRows.slice(-4); // last 4 weeks
  const rnAvgCompletion = latestRNRows.length
    ? latestRNRows.reduce((s, r) => s + (parseFloat(r['Avg. count to completed']) || 0), 0) / latestRNRows.length
    : null;

  // ── BUILD DISCIPLINE SUMMARY ─────────────────────────────────────
  const disciplines = {
    cna:      { ...avgFreqByDisc(monthlyRows, 'MA', currentMonth),  targetWeekly: 5,   targetMonthly: null, label: 'CNA (Aide)',     code: 'MA'  },
    rn:       { avg: rnAvgCompletion ? (rnAvgCompletion * 2) : null, count: latestRNRows.length, patients: null, targetWeekly: 2, targetMonthly: null, label: 'RN (Nursing)', code: 'RN', completionRate: rnAvgCompletion },
    sw:       { ...avgFreqByDisc(monthlyRows, 'MSW', currentMonth), targetWeekly: null, targetMonthly: 2,  label: 'Social Work',   code: 'MSW' },
    chaplain: { ...avgFreqByDisc(monthlyRows, 'CH', currentMonth),  targetWeekly: null, targetMonthly: 2,  label: 'Chaplain',      code: 'CH'  },
  };

  // ── ADC TREND ──────────────────────────────────────────────────
  const adcRows = adcAlos || [];
  const latestADC = adcRows.length ? parseFloat((adcRows[adcRows.length - 1]['Average Daily Census'] || '').replace(/,/g, '')) : null;

  return {
    census: census || [],
    admitsDischarges: adcRows,        // monthly ADC trend
    visits: rnRows,                   // RN weekly metrics
    visitPatterns: weeklyFreq || [],  // weekly freq (large)
    monthlyFrequency: monthlyRows,    // patient-level monthly planned freq
    workerTurnover: workerTurnover || [],
    disciplines,                       // ← processed summary sent to frontend
    currentCensus: (census || []).reduce((s, r) => {
      const v = parseFloat((r['Patient Count'] || '').replace(/,/g, ''));
      return s + (isNaN(v) ? 0 : v);
    }, 0),
    latestADC,
    rnCompletionRate: rnAvgCompletion,
  };
}

// ============================================================
// ZENDESK API
// ============================================================
const FRUSTRATION_KEYWORDS = [
  'still waiting', 'no response', 'urgent', 'unacceptable',
  'called 3 times', 'no one answered', 'frustrated', 'pain',
  'emergency', 'fell', 'fall', 'medication', 'not received',
  'never came', 'no show', 'angry', 'complaint'
];

const CLINICAL_KEYWORDS = [
  'medication', 'pain', 'fall', 'emergency', 'not breathing',
  'hospice nurse', 'supply', 'equipment', 'pharmacy'
];

async function fetchZendeskData() {
  if (!process.env.ZENDESK_SUBDOMAIN || !process.env.ZENDESK_API_TOKEN) {
    return { available: false };
  }
  console.log('📞 Fetching Zendesk data...');

  const base = `https://${process.env.ZENDESK_SUBDOMAIN.replace(/^https?:\/\//, '').replace('.zendesk.com', '')}.zendesk.com/api/v2`;
  const auth = Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString('base64');
  const headers = { Authorization: `Basic ${auth}` };

  try {
    // Open tickets
    const [openRes, overdueRes, recentRes] = await Promise.all([
      axios.get(`${base}/tickets?status=open&per_page=100`, { headers }),
      axios.get(`${base}/tickets?status=open&sort_by=created_at&sort_order=asc&per_page=50`, { headers }),
      axios.get(`${base}/tickets?status=open&per_page=100&sort_by=updated_at&sort_order=desc`, { headers }),
    ]);

    const openTickets = openRes.data.tickets || [];
    const now = Date.now();

    // Analyze tickets
    const overdueTickets = openTickets.filter(t => {
      const createdAt = new Date(t.created_at).getTime();
      const hoursOpen = (now - createdAt) / (1000 * 60 * 60);
      return hoursOpen > 48;
    });

    const escalatedTickets = openTickets.filter(t =>
      t.priority === 'urgent' || t.priority === 'high' || t.tags?.includes('escalated')
    );

    // Find frustrated tickets by scanning descriptions
    const frustratedTickets = openTickets.filter(t => {
      const text = ((t.subject || '') + ' ' + (t.description || '')).toLowerCase();
      return FRUSTRATION_KEYWORDS.some(kw => text.includes(kw));
    });

    const clinicalTickets = openTickets.filter(t => {
      const text = ((t.subject || '') + ' ' + (t.description || '')).toLowerCase();
      return CLINICAL_KEYWORDS.some(kw => text.includes(kw));
    });

    // Category breakdown
    const categoryMap = {};
    openTickets.forEach(t => {
      const text = ((t.subject || '') + ' ' + (t.description || '')).toLowerCase();
      let category = 'General';
      if (text.includes('medication') || text.includes('pain') || text.includes('pharmacy')) category = 'Medication / Pain';
      else if (text.includes('visit') || text.includes('nurse') || text.includes('aide')) category = 'Visit Issue';
      else if (text.includes('fall') || text.includes('emergency') || text.includes('safety')) category = 'Safety / Fall';
      else if (text.includes('equipment') || text.includes('supply')) category = 'Equipment / Supply';
      else if (text.includes('complaint') || text.includes('family')) category = 'Family Complaint';
      else if (text.includes('billing') || text.includes('invoice')) category = 'Billing';

      if (!categoryMap[category]) categoryMap[category] = [];
      categoryMap[category].push(t);
    });

    const topIssues = Object.entries(categoryMap)
      .map(([category, tickets]) => ({
        category,
        count: tickets.length,
        avgHoursOpen: Math.round(
          tickets.reduce((sum, t) => sum + (now - new Date(t.created_at).getTime()) / (1000 * 60 * 60), 0) / tickets.length
        ),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Average response time
    const solvedRes = await axios.get(`${base}/tickets?status=solved&per_page=50&sort_by=updated_at&sort_order=desc`, { headers });
    const solvedTickets = solvedRes.data.tickets || [];
    const avgResponseHours = solvedTickets.length > 0
      ? Math.round(
          solvedTickets.reduce((sum, t) => {
            return sum + (new Date(t.updated_at).getTime() - new Date(t.created_at).getTime()) / (1000 * 60 * 60);
          }, 0) / solvedTickets.length
        )
      : 0;

    // Tickets bouncing back and forth (updated many times but still open)
    const bouncingTickets = openTickets.filter(t => {
      const hoursOpen = (now - new Date(t.created_at).getTime()) / (1000 * 60 * 60);
      return hoursOpen > 72; // Open more than 3 days = bouncing
    });

    return {
      available: true,
      openCount: openTickets.length,
      overdueCount: overdueTickets.length,
      escalatedCount: escalatedTickets.length,
      frustratedCount: frustratedTickets.length,
      clinicalCount: clinicalTickets.length,
      bouncingCount: bouncingTickets.length,
      avgResponseHours,
      topIssues,
      detectedKeywords: FRUSTRATION_KEYWORDS.filter(kw =>
        openTickets.some(t => ((t.subject || '') + (t.description || '')).toLowerCase().includes(kw))
      ),
      criticalTickets: clinicalTickets.slice(0, 5).map(t => ({
        id: t.id,
        subject: t.subject,
        hoursOpen: Math.round((now - new Date(t.created_at).getTime()) / (1000 * 60 * 60)),
        priority: t.priority,
        status: t.status,
      })),
    };
  } catch (err) {
    console.error('❌ Zendesk fetch failed:', err.message);
    return { available: false, error: err.message };
  }
}

// ============================================================
// MICROSOFT 365 — Email Scanning
// ============================================================
let msGraphToken = null;
let msGraphTokenExpiry = null;

async function getMsGraphToken() {
  // Skip silently if Azure app not yet configured
  if (!process.env.MICROSOFT_TENANT_ID || !process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) {
    return null;
  }
  if (msGraphToken && msGraphTokenExpiry && Date.now() < msGraphTokenExpiry) {
    return msGraphToken;
  }
  try {
    const res = await axios.post(
      `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default'
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    msGraphToken = res.data.access_token;
    msGraphTokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
    console.log('✅ Microsoft Graph token refreshed');
    return msGraphToken;
  } catch (err) {
    console.error('❌ Microsoft Graph auth failed:', err.message);
    return null;
  }
}

const RESIGNATION_KEYWORDS = ['resign', '2-week notice', 'two week notice', 'last day', 'leaving', 'my notice', 'notice of resignation', 'effective immediately', 'final day'];
const COMPLAINT_KEYWORDS = ['complaint', 'grievance', 'survey', 'concern', 'issue with care', 'unhappy', 'dissatisfied'];
const STAFFING_KEYWORDS = ['short staffed', 'no coverage', "can't cover", 'need coverage', 'call out', 'no show', 'last minute'];

async function fetchEmailData() {
  const token = await getMsGraphToken();
  if (!token) return { available: false };

  console.log('📧 Scanning emails...');

  const headers = { Authorization: `Bearer ${token}` };
  const mailbox = process.env.MICROSOFT_MAILBOX;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const searchEmails = async (keywords) => {
    const query = keywords.map(k => `"${k}"`).join(' OR ');
    try {
      const res = await axios.get(
        `https://graph.microsoft.com/v1.0/users/${mailbox}/messages`,
        {
          headers,
          params: {
            '$search': `"${keywords[0]}"`,
            '$filter': `receivedDateTime ge ${sevenDaysAgo}`,
            '$select': 'subject,receivedDateTime,from,bodyPreview',
            '$top': 50,
          }
        }
      );
      return res.data.value || [];
    } catch { return []; }
  };

  const [resignationEmails, complaintEmails, staffingEmails] = await Promise.all([
    searchEmails(RESIGNATION_KEYWORDS),
    searchEmails(COMPLAINT_KEYWORDS),
    searchEmails(STAFFING_KEYWORDS),
  ]);

  // Extract branch from email content
  const extractBranch = (text) => {
    const branches = ['MKM', 'MKT', 'MIA', 'CHI', 'IL', 'Minneapolis', 'Mankato', 'Miami', 'Chicago'];
    for (const b of branches) {
      if (text.toUpperCase().includes(b.toUpperCase())) return b;
    }
    return 'Unknown';
  };

  const resignations = resignationEmails
    .filter(e => RESIGNATION_KEYWORDS.some(k => (e.subject || '').toLowerCase().includes(k.toLowerCase())))
    .map(e => ({
      subject: e.subject,
      from: e.from?.emailAddress?.name || e.from?.emailAddress?.address,
      receivedAt: e.receivedDateTime,
      branch: extractBranch(e.subject + ' ' + e.bodyPreview),
      preview: e.bodyPreview?.substring(0, 100),
    }));

  const complaints = complaintEmails
    .filter(e => COMPLAINT_KEYWORDS.some(k => (e.subject || '').toLowerCase().includes(k.toLowerCase())))
    .map(e => ({
      subject: e.subject,
      from: e.from?.emailAddress?.name,
      receivedAt: e.receivedDateTime,
      branch: extractBranch(e.subject + ' ' + e.bodyPreview),
    }));

  const staffingAlerts = staffingEmails
    .filter(e => STAFFING_KEYWORDS.some(k => (e.subject || '').toLowerCase().includes(k.toLowerCase())))
    .map(e => ({
      subject: e.subject,
      from: e.from?.emailAddress?.name,
      receivedAt: e.receivedDateTime,
      branch: extractBranch(e.subject + ' ' + e.bodyPreview),
    }));

  return {
    available: true,
    resignations,
    complaints,
    staffingAlerts,
    resignationCount: resignations.length,
    complaintCount: complaints.length,
    staffingAlertCount: staffingAlerts.length,
  };
}

// ============================================================
// AI SYNTHESIS — Claude generates the intelligence summary
// ============================================================
async function generateIntelligence(tableau, zendesk, email) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return generateRuleBasedAlerts(tableau, zendesk, email);
  }

  try {
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: `You are the Moments Hospice operations intelligence system. Analyze real operational data and return ONLY valid JSON (no markdown) with this structure:
{
  "riskAlerts": [{"level":"critical|high|medium|low","title":"...","detail":"...","source":"zendesk|email|tableau","branch":"..."}],
  "summary": "2-3 sentence executive summary of the most urgent issues right now",
  "staffingModelStatus": "on-track|at-risk|critical",
  "topAction": "The single most important thing to address today"
}`,
        messages: [{
          role: 'user',
          content: `Analyze this Moments Hospice operational data and generate risk alerts:

TABLEAU DATA:
- Current Census: ${tableau.currentCensus || 0} patients on service
- Current ADC: ${tableau.latestADC || 0}
- ADC Trend: ${(tableau.admitsDischarges || []).slice(-3).map(r => `${r['Month of Date']||r['Month Tooltip']||''}: ${r['Average Daily Census']||''}`).join(' → ')}

VISIT FREQUENCY (this month):
- CNA/Aide (MA): avg planned ${tableau.disciplines?.cna?.avg?.toFixed(1) || '?'} visits/month across ${tableau.disciplines?.cna?.patients || 0} patients (target: 5/wk = ~20/mo)
- RN Completion Rate: ${tableau.disciplines?.rn?.completionRate ? (tableau.disciplines.rn.completionRate * 100).toFixed(1) + '%' : '?'} of scheduled visits completed
- Social Work (MSW): avg planned ${tableau.disciplines?.sw?.avg?.toFixed(1) || '?'} visits/month (target: 2/month)
- Chaplain (CH): avg planned ${tableau.disciplines?.chaplain?.avg?.toFixed(1) || '?'} visits/month (target: 2/month)

WORKFORCE (rolling 12-month):
- Current workforce: ${(tableau.workerTurnover || []).slice(-1)[0]?.['Worker Count - End'] || 'unknown'} workers
- Turnover rate: ${(tableau.workerTurnover || []).slice(-1)[0]?.['Turnover %'] || 'unknown'} (target <25%)
- New hires: ${(tableau.workerTurnover || []).slice(-1)[0]?.['New Hires'] || 'unknown'}
- Terminations: ${(tableau.workerTurnover || []).slice(-1)[0]?.['Terminations'] || 'unknown'}

ZENDESK:
- Open tickets: ${zendesk.openCount || 0}
- Overdue (>48h): ${zendesk.overdueCount || 0}
- Escalated: ${zendesk.escalatedCount || 0}
- Clinical/safety: ${zendesk.clinicalCount || 0}
- Bouncing (>72h): ${zendesk.bouncingCount || 0}
- Top issues: ${JSON.stringify(zendesk.topIssues || [])}

EMAIL (last 7 days):
- Resignations: ${email.resignationCount || 0}
- Staffing alerts: ${email.staffingAlertCount || 0}
- Complaints: ${email.complaintCount || 0}

Generate specific, actionable risk alerts. Flag: visit frequency gaps vs targets, RN completion rate below 90%, turnover acceleration, Zendesk clinical safety tickets, resignation spikes.`
        }]
      },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );

    const text = res.data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : generateRuleBasedAlerts(tableau, zendesk, email);
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('❌ AI synthesis failed:', detail);
    return generateRuleBasedAlerts(tableau, zendesk, email);
  }
}

function generateRuleBasedAlerts(tableau, zendesk, email) {
  const alerts = [];

  if ((email.resignationCount || 0) >= 2) {
    const branches = [...new Set((email.resignations || []).map(r => r.branch))];
    alerts.push({
      level: 'critical',
      title: `${email.resignationCount} Resignations in Last 7 Days`,
      detail: `Branches affected: ${branches.join(', ')}. Check census levels and schedule coverage immediately.`,
      source: 'email',
      branch: branches[0] || 'Unknown'
    });
  }

  if ((zendesk.escalatedCount || 0) > 0) {
    alerts.push({
      level: 'critical',
      title: `${zendesk.escalatedCount} Escalated Zendesk Tickets`,
      detail: `${zendesk.clinicalCount || 0} are clinical/safety related. Immediate follow-up required.`,
      source: 'zendesk',
      branch: 'ALL'
    });
  }

  if ((zendesk.overdueCount || 0) > 10) {
    alerts.push({
      level: 'high',
      title: `${zendesk.overdueCount} Tickets Overdue (>48hrs)`,
      detail: `Average response time is ${zendesk.avgResponseHours}h. Target is under 4 hours.`,
      source: 'zendesk',
      branch: 'ALL'
    });
  }

  if ((email.staffingAlertCount || 0) > 0) {
    alerts.push({
      level: 'high',
      title: `${email.staffingAlertCount} Staffing Alert Emails Detected`,
      detail: `Emails with keywords: short staffed, no coverage, can't cover. Review branch schedule.`,
      source: 'email',
      branch: 'Unknown'
    });
  }

  if ((zendesk.bouncingCount || 0) > 5) {
    alerts.push({
      level: 'medium',
      title: `${zendesk.bouncingCount} Tickets Open >72 Hours Without Resolution`,
      detail: `These are bouncing back and forth with no resolution — highest customer service failure risk.`,
      source: 'zendesk',
      branch: 'ALL'
    });
  }

  return {
    riskAlerts: alerts,
    summary: `${alerts.filter(a => a.level === 'critical').length} critical alerts active. ${zendesk.openCount || 0} open Zendesk tickets with ${zendesk.overdueCount || 0} overdue. ${email.resignationCount || 0} resignation(s) detected this week.`,
    staffingModelStatus: (email.resignationCount || 0) >= 2 ? 'critical' : 'at-risk',
    topAction: alerts[0]?.title || 'Review Zendesk ticket queue and respond to overdue items.'
  };
}

// ============================================================
// MAIN DATA FETCH ORCHESTRATOR
// ============================================================
async function fetchAllData() {
  if (isFetching) {
    console.log('⏳ Fetch already in progress, skipping...');
    return;
  }
  isFetching = true;
  console.log('\n🔄 Starting full data refresh at', new Date().toLocaleTimeString());
  broadcast({ type: 'refreshing' });

  try {
    const [tableau, zendesk, email] = await Promise.all([
      fetchTableauData().catch(e => ({ error: e.message })),
      fetchZendeskData().catch(e => ({ available: false, error: e.message })),
      fetchEmailData().catch(e => ({ available: false, error: e.message })),
    ]);

    const intelligence = await generateIntelligence(tableau, zendesk, email);

    latestData = {
      tableau,
      zendesk,
      email,
      intelligence,
      dataAvailability: {
        tableau: !tableau.error,
        zendesk: zendesk.available !== false,
        email: email.available !== false,
      }
    };
    lastFetched = new Date().toISOString();

    broadcast({ type: 'data', payload: latestData, lastFetched });
    console.log('✅ Data refresh complete');

    // Check for critical alerts — send push email if configured
    const criticalAlerts = intelligence.riskAlerts?.filter(a => a.level === 'critical') || [];
    if (criticalAlerts.length > 0 && process.env.DIGEST_RECIPIENTS) {
      await sendAlertEmail(criticalAlerts, email, zendesk);
    }

  } catch (err) {
    console.error('❌ Full fetch failed:', err.message);
    broadcast({ type: 'error', message: err.message });
  } finally {
    isFetching = false;
  }
}

// ============================================================
// EMAIL DIGEST / ALERTS
// ============================================================
async function sendAlertEmail(criticalAlerts, emailData, zendeskData) {
  const token = await getMsGraphToken();
  if (!token || !process.env.DIGEST_RECIPIENTS) return;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <div style="background: #0b0f1a; color: #0AADA8; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin:0; font-size: 18px;">🚨 Moments Hospice — Critical Alert</h1>
        <p style="margin:5px 0 0; color: #64748b; font-size: 13px;">${new Date().toLocaleString()}</p>
      </div>
      <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0;">
        ${criticalAlerts.map(a => `
          <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; margin-bottom: 10px; border-radius: 0 4px 4px 0;">
            <strong style="color: #dc2626;">${a.title}</strong>
            <p style="color: #64748b; font-size: 13px; margin: 5px 0 0;">${a.detail}</p>
            <span style="font-size: 11px; color: #9ca3af;">Source: ${a.source} · Branch: ${a.branch}</span>
          </div>
        `).join('')}
        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e2e8f0;">
          <p style="font-size: 13px; color: #64748b;">
            Open tickets: ${zendeskData.openCount || 0} · 
            Resignations this week: ${emailData.resignationCount || 0}
          </p>
        </div>
      </div>
    </div>
  `;

  try {
    await axios.post(
      `https://graph.microsoft.com/v1.0/users/${process.env.MICROSOFT_MAILBOX}/sendMail`,
      {
        message: {
          subject: `🚨 Moments Ops Alert: ${criticalAlerts.length} Critical Issue${criticalAlerts.length > 1 ? 's' : ''} — ${new Date().toLocaleDateString()}`,
          body: { contentType: 'HTML', content: html },
          toRecipients: process.env.DIGEST_RECIPIENTS.split(',').map(e => ({
            emailAddress: { address: e.trim() }
          }))
        }
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log('📧 Alert email sent');
  } catch (err) {
    console.error('❌ Alert email failed:', err.message);
  }
}

async function sendDailyDigest() {
  const token = await getMsGraphToken();
  if (!token || !latestData || !process.env.DIGEST_RECIPIENTS) return;

  const { intelligence, zendesk, email } = latestData;
  const alerts = intelligence?.riskAlerts || [];
  const critical = alerts.filter(a => a.level === 'critical');
  const high = alerts.filter(a => a.level === 'high');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 650px;">
      <div style="background: #0b0f1a; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="margin:0; font-size: 22px; color: #0AADA8;">Moments Hospice</h1>
        <p style="margin:4px 0 0; font-size: 14px; color: #94a3b8;">Daily Operations Intelligence · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </div>
      <div style="background: #fff8ed; border: 1px solid #fed7aa; padding: 16px; border-bottom: none;">
        <strong style="font-size: 14px; color: #c2410c;">📋 SUMMARY</strong>
        <p style="font-size: 13px; color: #78350f; margin: 6px 0 0;">${intelligence?.summary || 'No summary available.'}</p>
      </div>
      <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-radius: 0 0 8px 8px;">
        <h3 style="font-size: 14px; color: #374151; margin: 0 0 12px;">⚡ TOP ACTION TODAY</h3>
        <div style="background: #eff6ff; padding: 10px 14px; border-radius: 6px; font-size: 13px; color: #1e40af; margin-bottom: 20px;">
          ${intelligence?.topAction || 'Review Zendesk queue'}
        </div>
        ${critical.length > 0 ? `
          <h3 style="font-size: 14px; color: #dc2626; margin: 0 0 10px;">🚨 CRITICAL (${critical.length})</h3>
          ${critical.map(a => `
            <div style="background: #fef2f2; border-left: 3px solid #ef4444; padding: 10px 12px; margin-bottom: 8px; border-radius: 0 4px 4px 0;">
              <strong style="font-size: 13px; color: #dc2626;">${a.title}</strong>
              <p style="font-size: 12px; color: #6b7280; margin: 4px 0 0;">${a.detail}</p>
            </div>
          `).join('')}
        ` : ''}
        ${high.length > 0 ? `
          <h3 style="font-size: 14px; color: #d97706; margin: 16px 0 10px;">⚠️ HIGH RISK (${high.length})</h3>
          ${high.map(a => `
            <div style="background: #fffbeb; border-left: 3px solid #f59e0b; padding: 10px 12px; margin-bottom: 8px; border-radius: 0 4px 4px 0;">
              <strong style="font-size: 13px; color: #d97706;">${a.title}</strong>
              <p style="font-size: 12px; color: #6b7280; margin: 4px 0 0;">${a.detail}</p>
            </div>
          `).join('')}
        ` : ''}
        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e5e7eb; display: flex; gap: 20px;">
          <div style="text-align: center;">
            <div style="font-size: 24px; font-weight: 800; color: #0AADA8;">${zendesk.openCount || 0}</div>
            <div style="font-size: 11px; color: #9ca3af;">Open Tickets</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 24px; font-weight: 800; color: #ef4444;">${zendesk.overdueCount || 0}</div>
            <div style="font-size: 11px; color: #9ca3af;">Overdue</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 24px; font-weight: 800; color: #f59e0b;">${email.resignationCount || 0}</div>
            <div style="font-size: 11px; color: #9ca3af;">Resignations (7d)</div>
          </div>
        </div>
      </div>
    </div>
  `;

  try {
    await axios.post(
      `https://graph.microsoft.com/v1.0/users/${process.env.MICROSOFT_MAILBOX}/sendMail`,
      {
        message: {
          subject: `📊 Moments Ops Digest · ${new Date().toLocaleDateString()} · ${critical.length} Critical, ${high.length} High`,
          body: { contentType: 'HTML', content: html },
          toRecipients: process.env.DIGEST_RECIPIENTS.split(',').map(e => ({
            emailAddress: { address: e.trim() }
          }))
        }
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log('📧 Daily digest sent');
  } catch (err) {
    console.error('❌ Daily digest failed:', err.message);
  }
}

// ============================================================
// SCHEDULING
// ============================================================
const refreshMinutes = parseInt(process.env.REFRESH_INTERVAL_MINUTES || '30');
// Run every N minutes
cron.schedule(`*/${refreshMinutes} * * * *`, fetchAllData);

// Daily digest
if (process.env.SEND_EMAIL_DIGEST === 'true' && process.env.DIGEST_TIME) {
  const [hour, minute] = (process.env.DIGEST_TIME || '06:30').split(':');
  cron.schedule(`${minute} ${hour} * * *`, sendDailyDigest);
  console.log(`📅 Daily digest scheduled for ${process.env.DIGEST_TIME}`);
}

// ============================================================
// API ROUTES
// ============================================================
app.get('/api/data', (req, res) => {
  res.json({ data: latestData, lastFetched });
});

app.post('/api/refresh', async (req, res) => {
  res.json({ message: 'Refresh started' });
  fetchAllData();
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    lastFetched,
    dataAvailable: !!latestData,
    refreshIntervalMinutes: refreshMinutes,
    connections: wss.clients.size,
  });
});

// Catch-all: serve index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// START
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   Moments Hospice Operations Command Center  ║
║   Running on port ${PORT}                       ║
╚══════════════════════════════════════════════╝
  `);
  // Fetch data immediately on startup
  setTimeout(fetchAllData, 2000);
});
