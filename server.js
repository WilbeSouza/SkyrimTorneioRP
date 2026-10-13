const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8770);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
const INDEX_FILE = path.join(ROOT, 'index.html');
fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultSettings = { fightWinner: 70, fightHouse: 20, fightFund: 10, groupWinner: 85, groupHouse: 15, championWinner: 80, championHouse: 20, entryFee: 20 };
const names = ['Aela, a Caçadora','Ragnar Punho de Ferro','Sigrun da Neve','Hrothgar, o Incansável','Vilkas de Jorrvaskr','Kora Lâmina Rubra','Bjorna Martelo-Seco','Malacath Filho do Ferro','Eydis da Lua','Gunnar Quebra-Escudos','Freyja Cinza-Fria','Tormund Corvo Negro','Yrsa Olho de Gelo','Keld Martelo-Seco','Astrid Lâmina Pálida','Rurik Filho do Urso','Svala do Salto Alto','Hakon Marca-Ferro','Dagna Punho Rubro','Leif Lobo Cinzento','Ingrid da Montanha','Sten Quebra-Crânios','Runa Coração-de-Pedra','Ottar do Norte','Kari Lança-Longa','Einar Sangue-Frio','Thora Vento-Sul','Baldur Mão-de-Ferro','Liv da Geada','Njal Sem-Medo','Gerdur Espada-Negra','Sigurd da Cicatriz'];
const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const roundNames = ['Rodada preliminar','32 avos de final','16 avos de final','Oitavas de final','Quartas de final','Semifinal','Grande final'];

function roundName(roundIndex, totalRounds) {
  return roundNames[Math.max(0, roundNames.length - totalRounds + roundIndex)] || `Rodada ${roundIndex + 1}`;
}
function createFighters(count = 8) {
  return Array.from({ length: count }, (_, i) => ({ id: `f${i+1}`, name: names[i] || `Lutador ${i+1}`, isBolg: false }));
}
function createMatches(count = 8) {
  const totalRounds = Math.log2(count), fighters = createFighters(count), matches = [];
  for (let roundIndex = 0; roundIndex < totalRounds; roundIndex++) {
    const matchCount = count / Math.pow(2, roundIndex + 1);
    for (let i = 0; i < matchCount; i++) {
      matches.push({ id: `r${roundIndex}m${i}`, roundIndex, round: roundName(roundIndex, totalRounds), label: `${roundIndex === totalRounds - 1 ? 'Final' : roundIndex === totalRounds - 2 ? 'SF' : 'R'} ${i + 1}`, a: roundIndex === 0 ? fighters[i * 2].id : null, b: roundIndex === 0 ? fighters[i * 2 + 1].id : null, winner: null, status: roundIndex === 0 ? 'open' : 'waiting', settlement: null });
    }
  }
  return matches;
}
function freshState() {
  return { version: 2, revision: 0, bracketSize: 8, settings: { ...defaultSettings }, fighters: createFighters(8), matches: createMatches(8), bets: [], payouts: [], settlements: [], activity: [], eventStatus: 'open', bolg: null, tab: 'public' };
}
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, JSON.stringify(freshState(), null, 2));
if (!fs.existsSync(ADMINS_FILE)) fs.writeFileSync(ADMINS_FILE, JSON.stringify([], null, 2));
let state = loadJson(STATE_FILE, freshState());
let admins = loadJson(ADMINS_FILE, []);
let revision = Number(state.revision || 0);
const sessions = new Map();

function saveState(nextState = state) {
  const temp = `${STATE_FILE}.tmp-${process.pid}`;
  const handle = fs.openSync(temp, 'w');
  try { fs.writeFileSync(handle, JSON.stringify(nextState, null, 2)); fs.fsyncSync(handle); }
  finally { fs.closeSync(handle); }
  fs.renameSync(temp, STATE_FILE);
}
function saveAdmins() { fs.writeFileSync(ADMINS_FILE, JSON.stringify(admins, null, 2)); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function checkPassword(password, record) {
  const actual = crypto.scryptSync(password, record.salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(record.hash, 'hex'));
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(v => {
    const i = v.indexOf('=');
    return [v.slice(0, i).trim(), decodeURIComponent(v.slice(i + 1))];
  }));
}
function session(req) {
  const token = parseCookies(req).arena_session;
  const current = token && sessions.get(token);
  if (!current) return null;
  if (Date.now() - current.createdAt > 86400000) { sessions.delete(token); return null; }
  return current;
}
function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': 'true' });
  res.end(text);
}
function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}
function publicState() { return state; }
function authInfo(req) { const s = session(req); return { authenticated: Boolean(s), username: s?.username || null, needsSetup: admins.length === 0 }; }
function requireAdmin(req, res) {
  const s = session(req);
  if (!s) { json(res, 401, { error: 'Acesso administrativo necessário.' }); return null; }
  return s;
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
}
function normalizeState(input) {
  const size = Number(input?.bracketSize);
  if (![8, 16, 32].includes(size)) return null;
  if (!Array.isArray(input.fighters) || input.fighters.length !== size) return null;
  if (!Array.isArray(input.matches) || input.matches.length !== size - 1) return null;
  if (!Array.isArray(input.bets) || !Array.isArray(input.payouts) || !Array.isArray(input.settlements)) return null;
  if (!input.settings || typeof input.settings !== 'object') return null;
  const settings = { ...defaultSettings, ...input.settings };
  const numeric = ['fightWinner','fightHouse','fightFund','groupWinner','groupHouse','championWinner','championHouse','entryFee'];
  if (numeric.some(key => !Number.isFinite(Number(settings[key])) || Number(settings[key]) < 0 || Number(settings[key]) > (key === 'entryFee' ? Number.MAX_SAFE_INTEGER : 100))) return null;
  if (Number(settings.fightWinner) + Number(settings.fightHouse) + Number(settings.fightFund) !== 100) return null;
  if (Number(settings.groupWinner) + Number(settings.groupHouse) !== 100) return null;
  if (Number(settings.championWinner) + Number(settings.championHouse) !== 100) return null;
  return { ...input, version: 2, bracketSize: size, settings, activity: Array.isArray(input.activity) ? input.activity.slice(0, 100) : [], eventStatus: input.eventStatus === 'settled' ? 'settled' : 'open', flow: { shuffled: Boolean(input.flow?.shuffled), currentMatchId: input.flow?.currentMatchId || null, nextMatchId: input.flow?.nextMatchId || null, lastEvent: input.flow?.lastEvent || 'idle', eventNonce: Number(input.flow?.eventNonce || 0), lastWinnerId: input.flow?.lastWinnerId || null, lastRoundIndex: input.flow?.lastRoundIndex, lastMatchSequence: Number(input.flow?.lastMatchSequence || 0) }, bolg: input.bolg || null, tab: 'public' };
}

// Serve only known static asset types from the project folder. The state and
// administrator files are never exposed through this route.
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};
function serveStaticAsset(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { res.writeHead(400); res.end('Bad request'); return true; }
  const filePath = path.resolve(ROOT, `.${decoded}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) { res.writeHead(403); res.end('Forbidden'); return true; }
  const extension = path.extname(filePath).toLowerCase();
  if (!mimeTypes[extension]) return false;
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mimeTypes[extension], 'Content-Length': stat.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
  return true;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/session' && req.method === 'GET') return json(res, 200, authInfo(req));
    if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, { state: publicState(), revision, auth: authInfo(req) });
    if (url.pathname === '/api/setup' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Origem não autorizada.' });
      if (admins.length) return json(res, 409, { error: 'O administrador inicial já foi criado.' });
      const input = await body(req);
      const username = String(input.username || '').trim();
      if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username) || !input.password || String(input.password).length < 8) return json(res, 400, { error: 'Informe um usuário válido e senha com pelo menos 8 caracteres.' });
      const record = hashPassword(String(input.password));
      admins.push({ username, ...record, createdAt: Date.now() });
      saveAdmins();
      return json(res, 201, { ok: true });
    }
    if (url.pathname === '/api/login' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Origem não autorizada.' });
      const input = await body(req);
      const record = admins.find(a => a.username === String(input.username || '').trim());
      if (!record || !checkPassword(String(input.password || ''), record)) return json(res, 401, { error: 'Usuário ou senha inválidos.' });
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { username: record.username, createdAt: Date.now() });
      const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': `arena_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure ? '; Secure' : ''}`, 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, auth: authInfo({ headers: { cookie: `arena_session=${token}` } }) }));
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Origem não autorizada.' });
      const token = parseCookies(req).arena_session;
      if (token) sessions.delete(token);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'arena_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
      return res.end('{"ok":true}');
    }
    if (url.pathname === '/api/state' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Origem não autorizada.' });
      if (!requireAdmin(req, res)) return;
      const input = await body(req);
      if (Number(input.revision) !== revision) return json(res, 409, { error: 'O estado mudou em outro painel. Atualize antes de salvar.', revision });
      const nextState = normalizeState(input.state);
      if (!nextState) return json(res, 400, { error: 'Estado do torneio inválido ou incompleto.' });
      revision += 1;
      nextState.revision = revision;
      saveState(nextState);
      state = nextState;
      return json(res, 200, { ok: true, state, revision });
    }
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, persistentFile: STATE_FILE, admins: admins.length });
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      return res.end('User-agent: *\nDisallow: /admin\nDisallow: /api\n');
    }
    if (url.pathname === '/index.html/admin' || url.pathname === '/index.html/admin/') {
      res.writeHead(302, { Location: '/admin', 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/admin' || url.pathname === '/admin/') {
      const file = fs.readFileSync(INDEX_FILE);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(file);
    }
    if (serveStaticAsset(req, res, url.pathname)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (error) {
    console.error(error);
    json(res, 500, { error: 'Erro interno do servidor.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Arena Skyrim RP ouvindo na porta ${PORT}`);
  console.log(`Acesso local: http://localhost:${PORT}`);
  console.log(`Painel administrativo: http://localhost:${PORT}/admin`);
  console.log('Para acesso externo, use o IP público ou domínio configurado no proxy.');
});
