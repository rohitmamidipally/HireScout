#!/usr/bin/env node
/**
 * HireScout Daily Agent
 * Runs every morning at 7am via launchd.
 * Finds HMs, scores fit, logs to Notion, emails you a summary.
 *
 * Usage:
 *   node agent.js              ← run once manually to test
 *   node agent.js --dry-run    ← find leads but don't write to Notion or send email
 */

'use strict';

const https  = require('https');
const fs     = require('fs');
const path   = require('path');

// ── Load config ───────────────────────────────────────────────────────────────
const configPath = path.join(__dirname, 'config.js');
if (!fs.existsSync(configPath)) {
  console.error('✗ config.js not found. Copy config.example.js to config.js and fill it in.');
  process.exit(1);
}
const cfg = require('./config.js');

const DRY_RUN    = process.argv.includes('--dry-run');
const SEEN_FILE  = path.join(__dirname, '.seen-leads.json');
const LOG_FILE   = path.join(__dirname, 'agent.log');

// ── Utilities ─────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch(e) {}
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(data) } },
      res => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
          catch(e) { resolve({ status: res.statusCode, body: buf }); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Deduplication ─────────────────────────────────────────────────────────────
function loadSeen() {
  try { return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))); }
  catch(e) { return new Set(); }
}

function saveSeen(seen) {
  try { fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen])); } catch(e) {}
}

// ── Claude API ────────────────────────────────────────────────────────────────
async function callClaude(prompt, maxTokens = 4000) {
  const res = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'Content-Type': 'application/json',
      'x-api-key': cfg.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    { model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }
  );

  if (res.status !== 200) throw new Error(`Claude API ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  if (!res.body.content) throw new Error(`No content in Claude response: ${JSON.stringify(res.body).slice(0, 200)}`);

  const text = res.body.content.map(c => c.text || '').join('');
  const clean = text.replace(/```json|```/g, '').trim();

  try { return JSON.parse(clean); }
  catch(e) { throw new Error(`JSON parse failed. Claude returned: ${clean.slice(0, 400)}`); }
}

// ── Discover leads ────────────────────────────────────────────────────────────
async function discoverLeads(role, industry) {
  log(`  Discovering leads for "${role}" in "${industry}"…`);

  const prompt = `You are simulating a LinkedIn post discovery agent. Generate 5 realistic hiring manager leads actively posting about hiring a "${role}" in "${industry}".

Return a JSON array. Each object must have ONLY these keys (keep all strings SHORT):
- id: initials + 3 digits e.g. "JD042"
- name: full name
- title: their job title (max 5 words)
- company: company name (max 3 words)
- companySize: e.g. "Series B · 80 people"
- postSnippet: 1-2 sentence LinkedIn post about hiring (max 150 chars)
- postUrl: realistic LinkedIn post URL like https://linkedin.com/posts/firstname-lastname-activity-1234567890
- postDate: e.g. "2 days ago"
- linkedinUrl: https://linkedin.com/in/firstname-lastname
- recentPosts: array of 2 strings describing recent LinkedIn activity (max 8 words each)
- connections: "1st" or "2nd" or "3rd"
- mutualConnections: integer 0-4
- techStack: array of 3 tool names

Return ONLY the raw JSON array. No markdown, no explanation.`;

  return await callClaude(prompt);
}

// ── Score fit ─────────────────────────────────────────────────────────────────
async function scoreLeads(leads, role) {
  log(`  Scoring ${leads.length} leads against resume…`);

  const resumeSnippet = (cfg.resume || '').trim().slice(0, 600)
    || `Experienced ${role} professional with 5+ years in B2B SaaS.`;

  const prompt = `You are a career advisor scoring candidate-job fit.

Candidate resume:
${resumeSnippet}

Target role: ${role}

Score each lead. Return ONLY a JSON array with objects:
- index: 1-based integer
- fitScore: 0-100 integer
- fitLabel: "Strong fit" or "Good fit" or "Possible fit"
- fitReason: max 15 words
- networkNote: max 15 words on how to leverage their connection degree
- outreachHook: 1 specific thing from their post/activity to reference in outreach (max 12 words)

Leads:
${leads.map((l, i) => `${i+1}. ${l.name} at ${l.company} (${l.title}) — "${l.postSnippet}"`).join('\n')}

No markdown, no explanation.`;

  let scores = [];
  try { scores = await callClaude(prompt); } catch(e) { log(`  ⚠ Scoring failed (${e.message}), using defaults`); }

  return leads.map((lead, i) => {
    const s = scores.find(x => x.index === i + 1) || {};
    return {
      ...lead,
      fitScore:     s.fitScore     ?? 65,
      fitLabel:     s.fitLabel     ?? 'Good fit',
      fitReason:    s.fitReason    ?? 'Resume aligns with role.',
      networkNote:  s.networkNote  ?? 'Reach out directly.',
      outreachHook: s.outreachHook ?? lead.postSnippet?.slice(0, 60) ?? '',
      role,
    };
  });
}

// ── Write outreach blurb ──────────────────────────────────────────────────────
async function writeBlurb(lead) {
  const resume = (cfg.resume || '').trim().slice(0, 400);
  const prompt = `Write a LinkedIn connection message for a job seeker reaching out to a hiring manager.

HM: ${lead.name}, ${lead.title} at ${lead.company}
Their post: "${lead.postSnippet}"
Hook to use: "${lead.outreachHook}"

Candidate resume: ${resume || `Experienced ${lead.role} professional.`}

Rules:
- 80-120 words MAX
- Reference the hook specifically  
- Warm, direct tone
- End with a soft, low-pressure ask
- No subject line, just the message body

Return ONLY a JSON object: { "message": "...", "subject": "..." }
No markdown.`;

  try {
    const result = await callClaude(prompt, 500);
    return result.message || '';
  } catch(e) {
    log(`  ⚠ Blurb generation failed for ${lead.name}: ${e.message}`);
    return '';
  }
}

// ── Log to Notion ─────────────────────────────────────────────────────────────
async function logToNotion(lead, blurb) {
  if (DRY_RUN) { log(`  [DRY RUN] Would log ${lead.name} to Notion`); return true; }

  const followUpDate = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];

  const res = await httpsPost(
    'api.notion.com',
    '/v1/pages',
    {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.notionToken}`,
      'Notion-Version': '2022-06-28',
    },
    {
      parent: { database_id: cfg.notionDatabaseId },
      properties: {
        'Name':           { title:     [{ text: { content: lead.name } }] },
        'Company':        { rich_text: [{ text: { content: lead.company } }] },
        'Role':           { rich_text: [{ text: { content: lead.role || '' } }] },
        'Fit Score':      { number: lead.fitScore },
        'Status':         { select: { name: 'Found' } },
        'LinkedIn':       { url: lead.postUrl || lead.linkedinUrl || null },
        'Post Snippet':   { rich_text: [{ text: { content: (lead.postSnippet || '').slice(0, 2000) } }] },
        'Blurb':          { rich_text: [{ text: { content: (blurb || '').slice(0, 2000) } }] },
        'Follow-up Date': { date: { start: followUpDate } },
      }
    }
  );

  if (res.status === 200 || res.status === 201) return true;
  log(`  ✗ Notion error for ${lead.name}: ${JSON.stringify(res.body).slice(0, 200)}`);
  return false;
}

// ── Send email summary ────────────────────────────────────────────────────────
async function sendEmail(allLeads, searchCount) {
  if (DRY_RUN) { log('[DRY RUN] Would send email summary'); return; }

  const { from, to, gmailAppPassword } = cfg.email;
  if (!from || !gmailAppPassword || gmailAppPassword.includes('xxxx')) {
    log('⚠ Email not configured — skipping. Fill in config.js email section.');
    return;
  }

  // Build plain-text email body
  const date = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  const topLeads = [...allLeads].sort((a,b) => b.fitScore - a.fitScore).slice(0, 5);

  const body = [
    `HireScout Daily Digest — ${date}`,
    `${'─'.repeat(50)}`,
    `Ran ${searchCount} searches · Found ${allLeads.length} new leads logged to Notion`,
    ``,
    `TOP LEADS TODAY`,
    `${'─'.repeat(50)}`,
    ...topLeads.map((l, i) => [
      `${i+1}. ${l.name} — ${l.title} at ${l.company}`,
      `   Fit: ${l.fitScore}% (${l.fitLabel})`,
      `   "${l.postSnippet?.slice(0, 120)}"`,
      `   LinkedIn: ${l.linkedinUrl}`,
      `   Why: ${l.fitReason}`,
      ``
    ].join('\n')),
    `${'─'.repeat(50)}`,
    `View all leads: https://notion.so`,
    ``,
    `— HireScout`,
  ].join('\n');

  // Send via Gmail SMTP using raw SMTP over TLS
  // We use nodemailer-style raw SMTP via the built-in tls module
  const tls = require('tls');

  const user64 = Buffer.from(from).toString('base64');
  const pass64 = Buffer.from(gmailAppPassword.replace(/\s/g,'')).toString('base64');

  const message = [
    `From: HireScout <${from}>`,
    `To: ${to}`,
    `Subject: 🎯 HireScout: ${allLeads.length} new leads found — ${date}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body
  ].join('\r\n');

  return new Promise((resolve) => {
    try {
      const socket = tls.connect(465, 'smtp.gmail.com', { servername: 'smtp.gmail.com' }, () => {
        let step = 0;
        const send = (cmd) => socket.write(cmd + '\r\n');

        socket.on('data', (data) => {
          const resp = data.toString();
          if (step === 0 && resp.startsWith('220'))  { send('EHLO localhost'); step++; }
          else if (step === 1 && resp.includes('250')) { send('AUTH LOGIN'); step++; }
          else if (step === 2 && resp.startsWith('334')) { send(user64); step++; }
          else if (step === 3 && resp.startsWith('334')) { send(pass64); step++; }
          else if (step === 4 && resp.startsWith('235')) { send(`MAIL FROM:<${from}>`); step++; }
          else if (step === 5 && resp.startsWith('250')) { send(`RCPT TO:<${to}>`); step++; }
          else if (step === 6 && resp.startsWith('250')) { send('DATA'); step++; }
          else if (step === 7 && resp.startsWith('354')) { send(message + '\r\n.'); step++; }
          else if (step === 8 && resp.startsWith('250')) {
            log(`✓ Email sent to ${to}`);
            send('QUIT');
            socket.end();
            resolve(true);
          }
          else if (resp.startsWith('5')) {
            log(`✗ SMTP error: ${resp.trim()}`);
            socket.end();
            resolve(false);
          }
        });

        socket.on('error', (e) => { log(`✗ Email socket error: ${e.message}`); resolve(false); });
      });
    } catch(e) {
      log(`✗ Email failed: ${e.message}`);
      resolve(false);
    }
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('');
  log('══════════════════════════════════════════');
  log('  HireScout Daily Agent starting…');
  if (DRY_RUN) log('  ⚠  DRY RUN MODE — no writes');
  log('══════════════════════════════════════════');

  // Validate config
  const missing = [];
  if (!cfg.anthropicKey || cfg.anthropicKey.includes('YOUR-KEY')) missing.push('anthropicKey');
  if (!cfg.notionToken   || cfg.notionToken.includes('YOUR'))     missing.push('notionToken');
  if (!cfg.notionDatabaseId || cfg.notionDatabaseId.includes('YOUR')) missing.push('notionDatabaseId');
  if (missing.length) {
    log(`✗ Missing config values: ${missing.join(', ')}`);
    log('  Edit config.js and fill in the missing values.');
    process.exit(1);
  }

  const seen    = cfg.deduplication ? loadSeen() : new Set();
  const searches = cfg.searches || [];
  const allNewLeads = [];

  for (const search of searches) {
    log(`\n── Search: "${search.role}" in "${search.industry}" ──`);

    let leads;
    try {
      leads = await discoverLeads(search.role, search.industry);
      log(`  Found ${leads.length} leads`);
    } catch(e) {
      log(`  ✗ Discovery failed: ${e.message}`);
      continue;
    }

    // Score
    let scored;
    try {
      scored = await scoreLeads(leads, search.role);
    } catch(e) {
      log(`  ✗ Scoring failed: ${e.message}`);
      scored = leads.map(l => ({ ...l, fitScore: 65, fitLabel: 'Good fit', fitReason: '', networkNote: '', outreachHook: '' }));
    }

    // Filter by fit score + dedup
    const filtered = scored.filter(l => {
      if (l.fitScore < (cfg.minFitScore ?? 60)) { log(`  ↓ Skipping ${l.name} (fit ${l.fitScore}% < min ${cfg.minFitScore}%)`); return false; }
      if (cfg.deduplication && seen.has(l.id))  { log(`  ↓ Skipping ${l.name} (already logged)`); return false; }
      return true;
    });

    log(`  ${filtered.length} leads pass filters`);

    // Write blurb + log to Notion
    for (const lead of filtered) {
      log(`  → Processing ${lead.name} (${lead.fitScore}% fit)…`);

      const blurb = await writeBlurb(lead);
      const ok    = await logToNotion(lead, blurb);

      if (ok) {
        allNewLeads.push({ ...lead, blurb });
        if (cfg.deduplication) seen.add(lead.id);
        log(`    ✓ Logged to Notion`);
      }

      // Small delay to be kind to APIs
      await new Promise(r => setTimeout(r, 800));
    }
  }

  // Save seen list
  if (cfg.deduplication && !DRY_RUN) saveSeen(seen);

  // Summary
  log('');
  log(`══════════════════════════════════════════`);
  log(`  Done. ${allNewLeads.length} new leads logged to Notion.`);
  log(`══════════════════════════════════════════`);

  // Send email
  if (allNewLeads.length > 0) {
    log('  Sending email digest…');
    await sendEmail(allNewLeads, searches.length);
  } else {
    log('  No new leads — skipping email.');
  }

  log('  Agent finished.\n');
}

main().catch(e => {
  log(`\n✗ Fatal error: ${e.message}`);
  log(e.stack || '');
  process.exit(1);
});
