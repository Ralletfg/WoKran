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
- Jedes Fahrzeug bekommt automatisch einen internen Code (FZ-0001, FZ-0002, ...), der nur im QR-Code steckt; angezeigt wird überall nur der Kostenträger
- Der QR-Code enthält einen Link auf die App mit diesem Code, die normale Handy-Kamera öffnet also direkt das Fahrzeug
- Startseite mit Kacheln nach Fahrzeugtyp (FA080, AC80, ...); ein Tipp öffnet eine eigene Ansicht mit den QR-Etiketten dieses Typs, erkannt am Anfang des Kostenträgers; die Zuordnung steht in `config.js` unter `TYPES`. Wer in keinen Typ passt, landet unter "Sonstige"
- "Etiketten drucken" erzeugt die Etiketten des gewählten Typs als A4-Blatt mit drei Etiketten pro Zeile (im Druckdialog auch als PDF speicherbar)

Wichtig: Etiketten erst drucken, wenn die App unter ihrer endgültigen Adresse online ist, denn die Adresse steckt im QR-Code.

## Stand: Schritt 3

- "Scannen" öffnet die Kamera und erkennt den QR-Code (Android über den eingebauten Detektor, iPhone über jsQR)
- Alternativ öffnet die normale Handy-Kamera den Link auf dem Etikett direkt in der App
- Danach misst die App bis zu 10 Sekunden GPS (früher fertig bei 5 m), nimmt die besten Werte und zeigt einen verschiebbaren Marker mit Angabe der Genauigkeit
- Marker bei Bedarf auf den richtigen Stellplatz ziehen, dann "Standort speichern" (wird als "von Hand" vermerkt)
- Suche oben nach Kostenträger zeigt das Fahrzeug auf der Karte, ein Tipp zeigt Zeitpunkt, Quelle und Melder

Im Test-Browser durchgespielt: Scan über eine simulierte Kamera, Speichern mit GPS, Öffnen per Etikett-Link, Marker verschieben, Suche.

## Stand: Schritt 4

- Anmeldung für Mitarbeiter mit Benutzername und Passwort (`auth.js`). Beim Registrieren gibt man Vor- und Nachnamen ein, der Benutzername entsteht daraus automatisch: erster Buchstabe des Vornamens + die ersten 4 des Nachnamens (Max Muster → mmust, bei Doppelungen mmust2 usw.). Intern wird daraus eine E-Mail-Kennung ohne Postfach, deshalb muss "Confirm email" aus sein. Ein vergessenes Passwort setzt man im Supabase-Dashboard unter Authentication → Users zurück.
- Ohne Anmeldung lässt die Datenbank weder lesen noch schreiben; den Namen des Melders setzt die Datenbank selbst
- Im Fahrzeug-Popup "Verlauf": die letzten 20 Meldungen mit Zeit, Melder und GPS oder von Hand, ein Tipp zeigt den damaligen Platz
- "Teilen": erzeugt einen Kartenausschnitt als Bild (Satellit oder Lageplan, je nach Ansicht) mit Kostenträger, Zeit und Melder. "Senden" öffnet auf dem Handy das Teilen-Menü (WhatsApp, Teams, ...) mit Bild und App-Link (`?f=FZ-0001`, zeigt das Fahrzeug direkt auf der Karte). Am PC: Bild speichern und Link kopieren

## Stand: Schritt 5 (Admin und Backup)

- Rollen: Mitarbeiter und Admin. Mitarbeiter sehen alles, melden Standorte und legen Fahrzeuge an. Ändern und Löschen darf nur ein Admin; das prüft die Datenbank selbst
- Beim ersten Ausführen des neuen `schema.sql` wird das älteste Konto Admin, falls es noch keinen gibt
- Seite "Admin" (`admin.html`, Link oben nur für Admins):
  - Fahrzeuge: Kostenträger ändern, Fahrzeug löschen, einzelne Meldungen löschen
  - Benutzer: Rolle ändern, sperren/entsperren (gesperrte Konten können sich nicht mehr anmelden), Passwort neu setzen, Konto löschen
  - Backup: jetzt erstellen, aktuellen Stand als Datei herunterladen, Backup aus der Liste oder aus einer Datei einspielen
- Tägliches Backup jede Nacht um 2 Uhr UTC über pg_cron in der Datenbank (Tabelle `backups`), automatische Backups werden 30 Tage aufbewahrt. Vor jedem Einspielen wird der aktuelle Stand gesichert
- Die Backups liegen in derselben Datenbank. Gegen den Verlust der ganzen Datenbank hilft nur, ab und zu "Herunterladen" zu nutzen und die Datei woanders abzulegen

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html`, `style.css` | Oberfläche |
| `app.js` | Karte, eigener Standort, Suche, Standort erfassen, Verlauf, Teilen |
| `auth.js` | Anmeldemaske |
| `admin.html`, `admin.css`, `admin.js` | Admin-Seite |
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
