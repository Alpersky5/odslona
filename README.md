# Odsłona

Aplikacja randkowa w stylu Tindera, w której zdjęcie rozmówcy na początku jest rozpikselowane
i odsłania się dopiero w miarę rozmowy.

## Funkcje
- zakładanie konta i logowanie (hasła hashowane przez scrypt)
- przesuwanie profili: lubię / pomiń
- czat na żywo między dopasowanymi użytkownikami (Socket.IO)
- **nietypowa funkcja:** 4 poziomy ostrości zdjęcia; kolejny odblokowuje się,
  gdy każda z osób wyśle następne 3 wiadomości

## Uruchomienie
Wymagany Node.js 22.13 lub nowszy.

    npm install
    npm start

Otwórz http://localhost:3000

Do testu załóż dwa konta: jedno w zwykłym oknie, drugie w oknie incognito.
Polubcie się nawzajem i piszcie.

## Struktura
- `server.js` – serwer, API, baza danych, czat
- `public/` – strona (HTML, CSS, JavaScript)
- `baza.db` – baza SQLite, tworzy się sama

Projekt do uruchamiania lokalnego (przed publikacją w sieci potrzebny byłby m.in. HTTPS
i limit prób logowania).
