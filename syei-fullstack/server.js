import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';
import bcrypt from 'bcryptjs';
import OpenAI from 'openai';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || '';
const SQLiteStore = SQLiteStoreFactory(session);

if (sessionSecret.length < 32) {
  console.warn('WARNING: SESSION_SECRET should be at least 32 random characters. Set it in .env before real use.');
}
if (isProduction && process.env.COOKIE_SECURE !== 'true') {
  console.warn('WARNING: Production should use HTTPS and COOKIE_SECURE=true.');
}
if (process.env.COOKIE_SECURE === 'true') app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", "https:", "blob:"],
      frameSrc: ["'self'", "https:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'data') }),
  name: 'syei.sid',
  secret: sessionSecret || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'syei.sqlite');
const sqliteModule = await import('node:sqlite').catch(() => null);
const Database = sqliteModule?.DatabaseSync || null;
// Use the built-in SQLite module on modern Node; fallback is a JSON-backed local store if unavailable.
let db;
let users = [];
let saves = [];
const jsonPath = path.join(dataDir, 'local-store.json');
try {
  if (Database) {
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS saves (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, item_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT, messages_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    `);
  } else {
    if (fs.existsSync(jsonPath)) {
      const stored = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      users = stored.users || [];
      saves = stored.saves || [];
    }
  }
} catch (e) {
  console.error('Database initialisation failed:', e.message);
  process.exit(1);
}
function saveJsonStore() {
  fs.writeFileSync(jsonPath, JSON.stringify({ users, saves }, null, 2), { mode: 0o600 });
}
function userByEmail(email) {
  return db ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : users.find(u => u.email === email);
}
function userById(id) {
  return db ? db.prepare('SELECT id,email FROM users WHERE id = ?').get(id) : users.find(u => u.id === id);
}
function createUser(email, passwordHash) {
  if (db) {
    const result = db.prepare('INSERT INTO users (email,password_hash) VALUES (?,?)').run(email, passwordHash);
    return { id: Number(result.lastInsertRowid), email };
  }
  const user = { id: users.reduce((n,u) => Math.max(n,u.id), 0) + 1, email, password_hash: passwordHash };
  users.push(user); saveJsonStore(); return { id: user.id, email };
}
function addSave(userId, item) {
  if (db) return Number(db.prepare('INSERT INTO saves (user_id,item_json) VALUES (?,?)').run(userId, JSON.stringify(item)).lastInsertRowid);
  const id = saves.reduce((n,s) => Math.max(n,s.id), 0) + 1;
  saves.push({ id, user_id: userId, item }); saveJsonStore(); return id;
}
function listSaves(userId) {
  if (db) return db.prepare('SELECT id, item_json, created_at FROM saves WHERE user_id = ? ORDER BY id DESC').all(userId).map(s => ({ id: s.id, ...JSON.parse(s.item_json), createdAt: s.created_at }));
  return saves.filter(s => s.user_id === userId).slice().reverse().map(s => ({ id: s.id, ...s.item }));
}
function removeSave(userId, id) {
  if (db) return db.prepare('DELETE FROM saves WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  const index = saves.findIndex(s => s.id === id && s.user_id === userId);
  if (index < 0) return false;
  saves.splice(index, 1); saveJsonStore(); return true;
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 50, standardHeaders: 'draft-7', legacyHeaders: false });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const emailSchema = z.string().email().max(254).transform(v => v.toLowerCase().trim());
const passwordSchema = z.string().min(10).max(128);

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Sign in to use this feature.' });
  next();
}
function publicUser(req) { return req.session.userId ? userById(req.session.userId) : null; }
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('AI is not configured yet. Add OPENAI_API_KEY to your .env file and restart SYEI.');
    error.status = 503; throw error;
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
function safeError(res, error) {
  console.error(error?.message || error);
  const status = error.status || (error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500);
  res.status(status).json({ error: status === 500 ? 'The request failed. Check the server terminal for details.' : error.message });
}
async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { 'User-Agent': 'SYEI/1.0 (local discovery app)', ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`External provider returned ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timeout); }
}
function movieCatalog() {
  const configured = process.env.MOVIE_CATALOG_PATH || './data/movies.json';
  const target = path.resolve(__dirname, configured);
  if (!fs.existsSync(target)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(m => m && typeof m.title === 'string' && typeof m.watchUrl === 'string')
      .map((m, i) => ({ id: String(m.id || `movie-${i}`), title: m.title.slice(0,160), category: String(m.category || 'Other').slice(0,60),
        year: Number(m.year) || null, language: String(m.language || '').slice(0,40), poster: safeImageUrl(m.poster),
        description: String(m.description || '').slice(0,600), watchUrl: safeExternalUrl(m.watchUrl),
        downloadUrl: safeExternalUrl(m.downloadUrl || ''), rights: String(m.rights || '').slice(0,200) }));
  } catch (e) { console.warn('Movie catalog could not be loaded:', e.message); return []; }
}
function safeExternalUrl(value) {
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) ? u.href : '';
  } catch { return ''; }
}
function safeImageUrl(value) { return safeExternalUrl(value); }

app.get('/api/health', (req, res) => res.json({
  ok: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY),
  database: db ? 'sqlite' : 'json-fallback',
  movieCount: movieCatalog().length,
  node: process.version
}));
app.get('/api/me', (req, res) => res.json({ user: publicUser(req) || null }));
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const email = emailSchema.parse(req.body.email);
    const password = passwordSchema.parse(req.body.password);
    if (userByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
    const hash = await bcrypt.hash(password, 12);
    const user = createUser(email, hash);
    req.session.userId = user.id;
    res.status(201).json({ user });
  } catch (e) { if (e instanceof z.ZodError) return res.status(400).json({ error: 'Enter a valid email and a password of at least 10 characters.' }); safeError(res, e); }
});
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const email = emailSchema.parse(req.body.email);
    const password = z.string().min(1).max(128).parse(req.body.password);
    const user = userByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    req.session.regenerate(err => {
      if (err) return safeError(res, err);
      req.session.userId = user.id;
      res.json({ user: { id: user.id, email: user.email } });
    });
  } catch (e) { if (e instanceof z.ZodError) return res.status(400).json({ error: 'Enter a valid email and password.' }); safeError(res, e); }
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => {
  res.clearCookie('syei.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true' });
  res.json({ ok: true });
}));

app.get('/api/discover', apiLimiter, async (req, res) => {
  const q = String(req.query.q || 'nature design architecture').trim().slice(0, 140);
  const page = Math.max(1, Math.min(10, Number(req.query.page) || 1));
  try {
    const params = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: q, gsrnamespace: '6', gsrlimit: '24', gsroffset: String((page-1)*24), prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '640', format: 'json', origin: '*' });
    const data = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`);
    const pages = Object.values(data.query?.pages || {});
    const items = pages.map(p => {
      const info = p.imageinfo?.[0]; const meta = info?.extmetadata || {};
      return { id: `commons-${p.pageid}`, title: p.title.replace(/^File:/,''), image: info?.thumburl || info?.url || '',
        pageUrl: p.fullurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
        credit: String(meta.Artist?.value || meta.Credit?.value || 'Wikimedia Commons').replace(/<[^>]*>/g,'').slice(0,180),
        license: String(meta.LicenseShortName?.value || 'See source page').replace(/<[^>]*>/g,'').slice(0,80),
        source: 'Wikimedia Commons' };
    }).filter(i => i.image && safeExternalUrl(i.image));
    res.json({ items, page, query: q });
  } catch (e) { safeError(res, e); }
});

app.get('/api/media/search', apiLimiter, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 180);
  if (!q) return res.status(400).json({ error: 'Enter something to search for.' });
  try {
    const params = new URLSearchParams({ q: `${q} AND mediatype:(movies OR audio OR software OR image OR texts)`, fl: 'identifier,title,description,mediatype,year,creator,licenseurl', rows: '30', page: '1', output: 'json' });
    const data = await fetchJson(`https://archive.org/advancedsearch.php?${params}`);
    const items = (data.response?.docs || []).map((d, i) => ({
      id: d.identifier || `ia-${i}`, title: String(d.title || d.identifier || 'Untitled').slice(0,180),
      description: String(d.description || '').replace(/<[^>]*>/g,'').slice(0,360),
      year: d.year || null, creator: Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''),
      mediaType: d.mediatype || 'unknown', license: d.licenseurl || '',
      sourceUrl: `https://archive.org/details/${encodeURIComponent(d.identifier || '')}`,
      downloadUrl: `https://archive.org/download/${encodeURIComponent(d.identifier || '')}/`,
      source: 'Internet Archive'
    }));
    res.json({ items, query: q, note: 'Check the item page and licence before reusing or downloading any work.' });
  } catch (e) { safeError(res, e); }
});
app.get('/api/movies', (req, res) => {
  const q = String(req.query.q || '').toLowerCase().slice(0, 100);
  const category = String(req.query.category || '').toLowerCase();
  const items = movieCatalog().filter(m => (!q || `${m.title} ${m.description} ${m.language}`.toLowerCase().includes(q)) && (!category || m.category.toLowerCase() === category));
  res.json({ items, categories: [...new Set(movieCatalog().map(m => m.category))] });
});

app.get('/api/saves', requireAuth, (req, res) => res.json({ items: listSaves(req.session.userId) }));
app.post('/api/saves', requireAuth, (req, res) => {
  const schema = z.object({ id: z.string().max(240), title: z.string().min(1).max(240), image: z.string().url().max(1500).optional(), url: z.string().url().max(1500).optional(), type: z.string().max(50).default('discovery'), source: z.string().max(100).optional() });
  try {
    const item = schema.parse(req.body);
    if (item.image && !safeImageUrl(item.image)) return res.status(400).json({ error: 'Invalid image URL.' });
    const id = addSave(req.session.userId, item);
    res.status(201).json({ id, item });
  } catch (e) { res.status(400).json({ error: 'Save needs a title, id, and valid URLs.' }); }
});
app.delete('/api/saves/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid save id.' });
  res.json({ deleted: removeSave(req.session.userId, id) });
});

app.post('/api/ai/chat', requireAuth, aiLimiter, async (req, res) => {
  try {
    const schema = z.object({ messages: z.array(z.object({ role: z.enum(['user','assistant']), content: z.string().min(1).max(12000) })).min(1).max(24) });
    const { messages } = schema.parse(req.body);
    const input = messages.map(m => ({ role: m.role, content: m.content }));
    const response = await getOpenAI().responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5.5',
      instructions: 'You are SYEI AI, a helpful assistant. Be accurate, clear, and honest about uncertainty. Do not claim to have performed external actions you have not performed.',
      input,
      max_output_tokens: 1800
    });
    res.json({ answer: response.output_text || 'I could not produce a text response.', responseId: response.id });
  } catch (e) { if (e instanceof z.ZodError) return res.status(400).json({ error: 'Chat input is invalid or too long.' }); safeError(res, e); }
});

app.post('/api/ai/build', requireAuth, aiLimiter, async (req, res) => {
  try {
    const schema = z.object({ prompt: z.string().min(10).max(6000), stack: z.enum(['html','react','node']).default('html') });
    const { prompt, stack } = schema.parse(req.body);
    const response = await getOpenAI().responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5.5',
      instructions: `You are SYEI Code Builder. Generate a useful small project from the user's description. Stack: ${stack}. Return a concise overview followed by complete files in this exact format:
<FILE path="relative/path.ext">
file contents
</FILE>
Use only safe relative paths, no secrets, no binaries, no package install scripts, and no path traversal. For html stack, prefer index.html, styles.css, app.js. For react stack, include package.json and src/App.jsx. For node stack, include package.json and server.js. Never claim the generated code was executed or tested. Keep output below 7000 tokens.`,
      input: prompt,
      max_output_tokens: 7000
    });
    res.json({ output: response.output_text || 'No code was returned.', responseId: response.id, stack });
  } catch (e) { if (e instanceof z.ZodError) return res.status(400).json({ error: 'Describe the project (10–6000 characters) and choose a supported stack.' }); safeError(res, e); }
});

// A safe proxy for downloads: only direct files from the two known public archives.
// It deliberately does not fetch arbitrary URLs supplied by clients (SSRF protection).
app.get('/api/download', apiLimiter, async (req, res) => {
  const raw = String(req.query.url || '');
  let url;
  try { url = new URL(raw); } catch { return res.status(400).send('Invalid URL.'); }
  const allowed = url.protocol === 'https:' && (
    url.hostname === 'upload.wikimedia.org' ||
    url.hostname === 'archive.org' ||
    url.hostname.endsWith('.archive.org')
  );
  if (!allowed) return res.status(403).send('Downloads are limited to direct files from Wikimedia Commons and Internet Archive. Check the licence and permissions first.');
  try {
    const upstream = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'SYEI/1.0' } });
    if (!upstream.ok || !upstream.body) return res.status(502).send('Source file could not be retrieved.');
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    if (contentType.includes('text/html')) return res.status(415).send('This is a webpage, not a direct media file. Open the source page instead.');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'attachment; filename="syei-download"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (upstream.headers.get('content-length')) res.setHeader('Content-Length', upstream.headers.get('content-length'));
    upstream.body.pipeTo(new WritableStream({
      write(chunk) { res.write(Buffer.from(chunk)); },
      close() { res.end(); },
      abort() { res.end(); }
    })).catch(() => res.end());
  } catch (e) { console.error(e.message); res.status(502).send('Download failed.'); }
});

app.get('/api/config', (req, res) => res.json({ appName: 'SYEI', aiConfigured: Boolean(process.env.OPENAI_API_KEY), user: publicUser(req) || null }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`SYEI running at http://localhost:${PORT}`);
  console.log(`AI API: ${process.env.OPENAI_API_KEY ? 'configured' : 'not configured (add OPENAI_API_KEY to .env)'}`);
});
