const $ = (s) => document.querySelector(s);
let ja = null;       // zalogowany użytkownik
let socket = null;   // połączenie do czatu
let profil = null;   // profil widoczny na karcie
let rozmowca = null; // osoba w otwartym czacie

async function api(adres, dane) {
  const res = await fetch('/api/' + adres, dane === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dane),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.blad || 'Coś poszło nie tak');
  return json;
}

const komunikat = (t) => { $('#komunikat').textContent = t; };
const adresZdjecia = (id) => `/api/zdjecie/${id}?t=${Date.now()}`;

// ---------- ZDJĘCIE: 4 poziomy ostrości ----------
async function przygotujZdjecia(plik) {
  const obraz = await createImageBitmap(plik);
  const bok = Math.min(obraz.width, obraz.height); // przycinamy do kwadratu
  return [8, 16, 40, 400].map((rozmiar) => {
    const c = document.createElement('canvas');
    c.width = c.height = rozmiar;
    c.getContext('2d').drawImage(
      obraz, (obraz.width - bok) / 2, (obraz.height - bok) / 2, bok, bok, 0, 0, rozmiar, rozmiar
    );
    return c.toDataURL('image/jpeg', 0.85);
  });
}

// ---------- LOGOWANIE I REJESTRACJA ----------
document.querySelectorAll('[data-pokaz]').forEach((p) => {
  p.onclick = () => {
    $('#logowanie').hidden = p.dataset.pokaz !== 'logowanie';
    $('#rejestracja').hidden = p.dataset.pokaz !== 'rejestracja';
    komunikat('');
  };
});

$('#logowanie').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('logowanie', Object.fromEntries(new FormData(e.target)));
    location.reload();
  } catch (blad) { komunikat(blad.message); }
};

$('#rejestracja').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  try {
    const zdjecia = await przygotujZdjecia(f.plik.files[0]);
    await api('rejestracja', {
      login: f.login.value, haslo: f.haslo.value, imie: f.imie.value,
      wiek: Number(f.wiek.value), opis: f.opis.value, zdjecia,
    });
    location.reload();
  } catch (blad) { komunikat(blad.message); }
};

$('#wyloguj').onclick = async () => { await api('wyloguj', {}); location.reload(); };

// ---------- WIDOKI ----------
function pokaz(widok) {
  ['odkrywaj', 'pary', 'czat'].forEach((w) => { $('#' + w).hidden = w !== widok; });
  if (widok !== 'czat') rozmowca = null;
  komunikat('');
  if (widok === 'odkrywaj') nastepnyProfil();
  if (widok === 'pary') wczytajPary();
}
document.querySelectorAll('[data-widok]').forEach((p) => { p.onclick = () => pokaz(p.dataset.widok); });

// ---------- PRZESUWANIE PROFILI ----------
async function nastepnyProfil() {
  ({ profil } = await api('profil'));
  $('#karta').hidden = $('#przyciski').hidden = !profil;
  $('#pusto').hidden = Boolean(profil);
  if (!profil) return;
  $('#karta-zdjecie').src = adresZdjecia(profil.id);
  $('#karta-imie').textContent = `${profil.imie}, ${profil.wiek}`;
  $('#karta-opis').textContent = profil.opis;
}

async function ocen(lubi) {
  if (!profil) return;
  const oceniany = profil;
  profil = null; // blokada przed podwójnym kliknięciem
  const { para } = await api('ocena', { kogo: oceniany.id, lubi });
  await nastepnyProfil();
  komunikat(para ? `Macie parę: ${oceniany.imie}! Zajrzyj do zakładki Pary.` : '');
}
$('#tak').onclick = () => ocen(true);
$('#nie').onclick = () => ocen(false);

// przeciąganie karty myszą lub palcem
const karta = $('#karta');
let startX = null;
karta.onpointerdown = (e) => { startX = e.clientX; karta.setPointerCapture(e.pointerId); };
karta.onpointermove = (e) => {
  if (startX === null) return;
  const dx = e.clientX - startX;
  karta.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`;
};
karta.onpointerup = (e) => {
  if (startX === null) return;
  const dx = e.clientX - startX;
  startX = null;
  karta.style.transform = '';
  if (Math.abs(dx) > 100) ocen(dx > 0);
};
karta.onpointercancel = () => { startX = null; karta.style.transform = ''; };

// ---------- PARY I CZAT ----------
async function wczytajPary() {
  const pary = await api('pary');
  $('#lista').replaceChildren(...pary.map((p) => {
    const li = document.createElement('li');
    const przycisk = document.createElement('button');
    przycisk.className = 'drugi';
    const img = document.createElement('img');
    img.src = adresZdjecia(p.id);
    img.alt = '';
    przycisk.append(img, `${p.imie}, ${p.wiek} · odsłona ${p.poziom}/3`);
    przycisk.onclick = () => otworzCzat(p);
    li.append(przycisk);
    return li;
  }));
  if (!pary.length) komunikat('Nie masz jeszcze par.');
}

async function otworzCzat(osoba) {
  const dane = await api('czat/' + osoba.id);
  pokaz('czat');
  rozmowca = osoba;
  $('#czat-imie').textContent = osoba.imie;
  $('#wiadomosci').replaceChildren();
  dane.wiadomosci.forEach(dodajDymek);
  pokazPostep(dane);
}

function pokazPostep({ poziom, brakuje }) {
  $('#czat-zdjecie').src = adresZdjecia(rozmowca.id);
  $('#czat-postep').textContent = poziom === 3
    ? 'Zdjęcie w pełni odsłonięte!'
    : `Odsłona ${poziom}/3. Do następnej każde z was potrzebuje jeszcze maks. ${brakuje} wiad.`;
}

function dodajDymek(w) {
  const d = document.createElement('div');
  d.className = w.od === ja.id ? 'dymek moj' : 'dymek';
  d.textContent = w.tresc; // textContent chroni przed wstrzyknięciem HTML (XSS)
  $('#wiadomosci').append(d);
  $('#wiadomosci').scrollTop = $('#wiadomosci').scrollHeight;
}

$('#wyslij').onsubmit = (e) => {
  e.preventDefault();
  const pole = e.target.elements.tresc;
  socket.emit('wiadomosc', { doKogo: rozmowca.id, tresc: pole.value });
  pole.value = '';
};

// ---------- START ----------
(async () => {
  try { ja = await api('ja'); } catch { $('#start').hidden = false; return; }
  $('#aplikacja').hidden = false;
  socket = io();
  socket.on('wiadomosc', (w) => {
    const inny = w.od === ja.id ? w.doKogo : w.od;
    if (rozmowca && rozmowca.id === inny) { dodajDymek(w); pokazPostep(w); }
    else if (w.od !== ja.id) komunikat('Masz nową wiadomość w zakładce Pary.');
  });
  socket.on('nowaPara', () => komunikat('Masz nową parę!'));
  pokaz('odkrywaj');
})();
