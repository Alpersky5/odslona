const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const WIADOMOSCI_NA_POZIOM = 3; // tyle wiadomosci od KAZDEJ osoby odslania kolejny poziom
const MAX_POZIOM = 3;

// ---------- BAZA DANYCH ----------
const db = new DatabaseSync(path.join(__dirname, 'baza.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, login TEXT UNIQUE NOT NULL, haslo TEXT NOT NULL,
    imie TEXT NOT NULL, wiek INTEGER NOT NULL, opis TEXT NOT NULL, zdjecia TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sesje (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS oceny (
    kto INTEGER NOT NULL, kogo INTEGER NOT NULL, lubi INTEGER NOT NULL,
    PRIMARY KEY (kto, kogo)
  );
  CREATE TABLE IF NOT EXISTS wiadomosci (
    id INTEGER PRIMARY KEY, od INTEGER NOT NULL, do_kogo INTEGER NOT NULL, tresc TEXT NOT NULL
  );
`);

// ---------- HASLA I SESJE ----------
// Hasel nie zapisujemy wprost, tylko ich skrot (scrypt) z losowa sola.
function hashuj(haslo) {
  const sol = crypto.randomBytes(16).toString('hex');
  return sol + ':' + crypto.scryptSync(haslo, sol, 64).toString('hex');
}

function sprawdzHaslo(haslo, zapisane) {
  const [sol, skrot] = zapisane.split(':');
  return crypto.timingSafeEqual(crypto.scryptSync(haslo, sol, 64), Buffer.from(skrot, 'hex'));
}

function tokenZCiasteczka(naglowek = '') {
  const m = naglowek.match(/(?:^|;\s*)sesja=([a-f0-9]+)/);
  return m ? m[1] : null;
}

function userZTokenu(token) {
  if (!token) return null;
  const w = db.prepare('SELECT user_id FROM sesje WHERE token = ?').get(token);
  return w ? w.user_id : null;
}

function zaloguj(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesje VALUES (?, ?)').run(token, userId);
  res.setHeader('Set-Cookie', `sesja=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

// ---------- DOPASOWANIA I ODSLANIANIE ----------
function czyPara(a, b) {
  const q = db.prepare('SELECT 1 FROM oceny WHERE kto = ? AND kogo = ? AND lubi = 1');
  return Boolean(q.get(a, b) && q.get(b, a));
}

function postep(a, b) {
  const q = db.prepare('SELECT COUNT(*) AS n FROM wiadomosci WHERE od = ? AND do_kogo = ?');
  // liczy sie slabsza strona, wiec nie da sie odslonic zdjecia samemu spamujac
  const mniejsza = Math.min(q.get(a, b).n, q.get(b, a).n);
  const poziom = Math.min(MAX_POZIOM, Math.floor(mniejsza / WIADOMOSCI_NA_POZIOM));
  const brakuje = poziom === MAX_POZIOM ? 0 : (poziom + 1) * WIADOMOSCI_NA_POZIOM - mniejsza;
  return { poziom, brakuje };
}

// ---------- API ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

app.post('/api/rejestracja', (req, res) => {
  const { login, haslo, imie, wiek, opis, zdjecia } = req.body || {};
  const tekst = (t, min, max) => typeof t === 'string' && t.trim().length >= min && t.length <= max;

  if (!tekst(login, 3, 20)) return res.status(400).json({ blad: 'Login: od 3 do 20 znaków' });
  if (!tekst(haslo, 6, 100)) return res.status(400).json({ blad: 'Hasło: minimum 6 znaków' });
  if (!tekst(imie, 2, 30)) return res.status(400).json({ blad: 'Podaj imię' });
  if (!Number.isInteger(wiek) || wiek < 18 || wiek > 120) return res.status(400).json({ blad: 'Musisz mieć 18+' });
  if (!tekst(opis, 0, 200)) return res.status(400).json({ blad: 'Opis: max 200 znaków' });
  const obrazOk = (z) => typeof z === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(z);
  if (!Array.isArray(zdjecia) || zdjecia.length !== MAX_POZIOM + 1 || !zdjecia.every(obrazOk)) {
    return res.status(400).json({ blad: 'Dodaj zdjęcie' });
  }

  const nazwa = login.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(nazwa)) {
    return res.status(409).json({ blad: 'Ten login jest zajęty' });
  }
  const wynik = db.prepare(
    'INSERT INTO users (login, haslo, imie, wiek, opis, zdjecia) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(nazwa, hashuj(haslo), imie.trim(), wiek, opis.trim(), JSON.stringify(zdjecia));
  zaloguj(res, Number(wynik.lastInsertRowid));
  res.json({ ok: true });
});

app.post('/api/logowanie', (req, res) => {
  const { login, haslo } = req.body || {};
  const u = db.prepare('SELECT id, haslo FROM users WHERE login = ?').get(String(login || '').trim().toLowerCase());
  if (!u || !sprawdzHaslo(String(haslo || ''), u.haslo)) {
    return res.status(401).json({ blad: 'Zły login lub hasło' });
  }
  zaloguj(res, u.id);
  res.json({ ok: true });
});

// Wszystko ponizej wymaga zalogowania
app.use('/api', (req, res, next) => {
  req.token = tokenZCiasteczka(req.headers.cookie);
  req.userId = userZTokenu(req.token);
  if (!req.userId) return res.status(401).json({ blad: 'Zaloguj się' });
  next();
});

app.post('/api/wyloguj', (req, res) => {
  db.prepare('DELETE FROM sesje WHERE token = ?').run(req.token);
  io.in('sesja:' + req.token).disconnectSockets();
  res.setHeader('Set-Cookie', 'sesja=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/ja', (req, res) => {
  res.json(db.prepare('SELECT id, imie, wiek, opis FROM users WHERE id = ?').get(req.userId));
});

// Nastepny profil, ktorego jeszcze nie ocenilismy
app.get('/api/profil', (req, res) => {
  const p = db.prepare(`
    SELECT id, imie, wiek, opis FROM users
    WHERE id != ? AND id NOT IN (SELECT kogo FROM oceny WHERE kto = ?)
    ORDER BY RANDOM() LIMIT 1
  `).get(req.userId, req.userId);
  res.json({ profil: p || null });
});

app.post('/api/ocena', (req, res) => {
  const { kogo, lubi } = req.body || {};
  if (!Number.isInteger(kogo) || kogo === req.userId || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(kogo)) {
    return res.status(400).json({ blad: 'Nie ma takiej osoby' });
  }
  db.prepare('INSERT OR IGNORE INTO oceny VALUES (?, ?, ?)').run(req.userId, kogo, lubi ? 1 : 0);
  const para = czyPara(req.userId, kogo);
  if (para) io.to('user:' + kogo).emit('nowaPara');
  res.json({ para });
});

app.get('/api/pary', (req, res) => {
  const pary = db.prepare(`
    SELECT u.id, u.imie, u.wiek, u.opis FROM users u
    JOIN oceny a ON a.kogo = u.id AND a.kto = ? AND a.lubi = 1
    JOIN oceny b ON b.kto = u.id AND b.kogo = ? AND b.lubi = 1
  `).all(req.userId, req.userId);
  res.json(pary.map((p) => ({ ...p, ...postep(req.userId, p.id) })));
});

app.get('/api/czat/:id', (req, res) => {
  const inny = Number(req.params.id);
  if (!czyPara(req.userId, inny)) return res.status(403).json({ blad: 'Nie jesteście parą' });
  const wiadomosci = db.prepare(`
    SELECT od, tresc FROM wiadomosci
    WHERE (od = ? AND do_kogo = ?) OR (od = ? AND do_kogo = ?) ORDER BY id
  `).all(req.userId, inny, inny, req.userId);
  res.json({ wiadomosci, ...postep(req.userId, inny) });
});

// Serwer wysyla tylko taka wersje zdjecia, na jaka zasluzyles - nie da sie tego obejsc w przegladarce
app.get('/api/zdjecie/:id', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT zdjecia FROM users WHERE id = ?').get(id);
  if (!u) return res.sendStatus(404);
  let poziom = 0;
  if (id === req.userId) poziom = MAX_POZIOM;
  else if (czyPara(req.userId, id)) poziom = postep(req.userId, id).poziom;
  const base64 = JSON.parse(u.zdjecia)[poziom].split(',')[1];
  res.set('Cache-Control', 'no-store').type('jpeg').send(Buffer.from(base64, 'base64'));
});

// ---------- CZAT NA ZYWO ----------
io.use((socket, next) => {
  socket.data.token = tokenZCiasteczka(socket.handshake.headers.cookie);
  socket.data.userId = userZTokenu(socket.data.token);
  next(socket.data.userId ? undefined : new Error('brak logowania'));
});

io.on('connection', (socket) => {
  const ja = socket.data.userId;
  socket.join(['user:' + ja, 'sesja:' + socket.data.token]);

  socket.on('wiadomosc', (dane) => {
    const doKogo = dane?.doKogo;
    const tresc = typeof dane?.tresc === 'string' ? dane.tresc.trim().slice(0, 500) : '';
    if (!tresc || !Number.isInteger(doKogo) || !czyPara(ja, doKogo)) return;
    db.prepare('INSERT INTO wiadomosci (od, do_kogo, tresc) VALUES (?, ?, ?)').run(ja, doKogo, tresc);
    io.to(['user:' + ja, 'user:' + doKogo]).emit('wiadomosc', {
      od: ja, doKogo, tresc, ...postep(ja, doKogo),
    });
  });
});

server.listen(PORT, () => console.log(`Działa: http://localhost:${PORT}`));
