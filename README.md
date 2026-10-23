# Fahrzeug-Standorte (Prototyp)

Web-App zum Erfassen von Fahrzeugstandorten auf dem Firmengelände Faunberg, Lauf an der Pegnitz.
Läuft im Handy-Browser (Android und iPhone), kann auf den Startbildschirm gelegt werden.

## Stand: Schritt 1

- Oben rechts umschalten zwischen Satellitenkarte (Esri World Imagery) und Lageplan
- Der Lageplan ist fest an den echten Gebäuden ausgerichtet (an OpenStreetMap-Umrisse angepasst, Werte in `config.js` unter `PLAN`)
- Die Geländegrenze kommt aus dem Lageplan und erscheint auf beiden Karten gleich
- Herauszoomen ist nur bis zur Größe des Geländes möglich
- "Standort" zeigt die eigene GPS-Position mit Genauigkeitskreis
- Auf der Karte erscheint nur das Fahrzeug, nach dem gesucht wurde (oder das gerade erfasst wurde)
- Datenbasis: Fahrzeuge, Standortverlauf, Geländegrenze

Ohne Zugangsdaten in `config.js` läuft die App im Demo-Modus, die Daten bleiben dann nur auf dem jeweiligen Gerät.

## Stand: Schritt 2

- Seite "QR-Etiketten" (`labels.html`): Fahrzeuge über ihren Kostenträger einzeln oder als Liste (aus Excel kopiert) anlegen
- Jedes Fahrzeug bekommt automatisch einen Code (FZ-0001, FZ-0002, ...)
- Der QR-Code enthält einen Link auf die App mit diesem Code, die normale Handy-Kamera öffnet also direkt das Fahrzeug
- "Etiketten drucken" erzeugt ein A4-Blatt mit drei Etiketten pro Zeile (im Druckdialog auch als PDF speicherbar)

Wichtig: Etiketten erst drucken, wenn die App unter ihrer endgültigen Adresse online ist, denn die Adresse steckt im QR-Code.

## Stand: Schritt 3

- "Scannen" öffnet die Kamera und erkennt den QR-Code (Android über den eingebauten Detektor, iPhone über jsQR)
- Alternativ öffnet die normale Handy-Kamera den Link auf dem Etikett direkt in der App
- Danach misst die App bis zu 10 Sekunden GPS (früher fertig bei 5 m), nimmt die besten Werte und zeigt einen verschiebbaren Marker mit Angabe der Genauigkeit
- Marker bei Bedarf auf den richtigen Stellplatz ziehen, dann "Standort speichern" (wird als "von Hand" vermerkt)
- Suche oben nach Kostenträger oder Code zeigt das Fahrzeug auf der Karte, ein Tipp zeigt Zeitpunkt, Quelle und Melder

Im Test-Browser durchgespielt: Scan über eine simulierte Kamera, Speichern mit GPS, Öffnen per Etikett-Link, Marker verschieben, Suche.

## Stand: Schritt 4

- Anmeldung für Mitarbeiter mit Benutzername und Passwort (`auth.js`). Beim Registrieren gibt man Vor- und Nachnamen ein, der Benutzername entsteht daraus automatisch: erster Buchstabe des Vornamens + die ersten 4 des Nachnamens (Max Muster → mmust, bei Doppelungen mmust2 usw.). Intern wird daraus eine E-Mail-Kennung ohne Postfach, deshalb muss "Confirm email" aus sein. Ein vergessenes Passwort setzt man im Supabase-Dashboard unter Authentication → Users zurück.
- Ohne Anmeldung lässt die Datenbank weder lesen noch schreiben; den Namen des Melders setzt die Datenbank selbst
- Im Fahrzeug-Popup "Verlauf": die letzten 20 Meldungen mit Zeit, Melder und GPS oder von Hand, ein Tipp zeigt den damaligen Platz
- "Teilen": auf dem Handy über das normale Teilen-Menü (WhatsApp, Teams, ...), am PC über WhatsApp- und Teams-Links oder Kopieren
- Der geteilte Text enthält einen Google-Maps-Link und einen App-Link (`?f=FZ-0001`), der das Fahrzeug direkt auf der Karte zeigt

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html`, `style.css` | Oberfläche |
| `app.js` | Karte, eigener Standort, Suche, Standort erfassen, Verlauf, Teilen |
| `auth.js` | Anmeldemaske |
| `scan.js` | QR-Scanner über die Kamera |
| `store.js` | Datenzugriff (Supabase oder lokaler Demo-Speicher) |
| `labels.html`, `labels.css`, `labels.js` | QR-Etiketten anlegen und drucken |
| `config.js` | Supabase-Zugangsdaten, Lage des Lageplans und Geländegrenze |
| `lageplan.png` | Lageplan, außerhalb der Grenze transparent |
| `supabase/schema.sql` | Tabellen für die gemeinsame Datenbank |

## Gemeinsame Datenbank einrichten (Supabase, kostenlos)

1. Auf supabase.com ein Konto und ein neues Projekt anlegen (Region: Frankfurt).
2. Im Projekt "SQL Editor" öffnen, den Inhalt von `supabase/schema.sql` einfügen und ausführen.
3. Unter "Project Settings → API" die "Project URL" und den "anon public"-Schlüssel in `config.js` eintragen.
4. Unter "Authentication → URL Configuration" als Site URL die Adresse der App eintragen (https://ralletfg.github.io/WoKran/).
5. Für den Prototyp unter "Authentication → Sign In / Providers → Email" die Option "Confirm email" ausschalten. Sonst muss jeder neue Mitarbeiter erst den Link in einer Bestätigungs-E-Mail öffnen.

Der anon-Schlüssel ist für den Browser gedacht und darf in der App stehen. Lesen und Schreiben geht nur nach der Anmeldung.

## Veröffentlichen

Kamera und GPS funktionieren im Browser nur über HTTPS. Am einfachsten über GitHub Pages: Ordner in ein Repository legen und unter "Settings → Pages" den Branch freigeben.
