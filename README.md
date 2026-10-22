# Fahrzeug-Standorte (Prototyp)

Web-App zum Erfassen von Fahrzeugstandorten auf dem Firmengelände Faunberg, Lauf an der Pegnitz.
Läuft im Handy-Browser (Android und iPhone), kann auf den Startbildschirm gelegt werden.

## Stand: Schritt 1

- Oben rechts umschalten zwischen Satellitenkarte (Esri World Imagery) und Lageplan
- Der Lageplan ist fest an den echten Gebäuden ausgerichtet (an OpenStreetMap-Umrisse angepasst, Werte in `config.js` unter `PLAN`)
- Die Geländegrenze kommt aus dem Lageplan und erscheint auf beiden Karten gleich
- Herauszoomen ist nur bis zur Größe des Geländes möglich
- "Standort" zeigt die eigene GPS-Position mit Genauigkeitskreis
- Fahrzeuge werden mit ihrem letzten Standort als Punkte angezeigt
- Datenbasis: Fahrzeuge, Standortverlauf, Geländegrenze

Ohne Zugangsdaten in `config.js` läuft die App im Demo-Modus, die Daten bleiben dann nur auf dem jeweiligen Gerät.

## Stand: Schritt 2

- Seite "QR-Etiketten" (`labels.html`): Fahrzeuge einzeln oder als Liste (aus Excel kopiert) anlegen
- Jedes Fahrzeug bekommt automatisch einen Code (FZ-0001, FZ-0002, ...)
- Der QR-Code enthält einen Link auf die App mit diesem Code, die normale Handy-Kamera öffnet also direkt das Fahrzeug
- "Etiketten drucken" erzeugt ein A4-Blatt mit drei Etiketten pro Zeile (im Druckdialog auch als PDF speicherbar)

Wichtig: Etiketten erst drucken, wenn die App unter ihrer endgültigen Adresse online ist, denn die Adresse steckt im QR-Code.

## Stand: Schritt 3

- "Scannen" öffnet die Kamera und erkennt den QR-Code (Android über den eingebauten Detektor, iPhone über jsQR)
- Alternativ öffnet die normale Handy-Kamera den Link auf dem Etikett direkt in der App
- Danach wird die GPS-Position geholt und als verschiebbarer Marker gezeigt, mit Angabe der Genauigkeit
- Marker bei Bedarf auf den richtigen Stellplatz ziehen, dann "Standort speichern" (wird als "von Hand" vermerkt)
- Der eigene Name wird einmal eingegeben und gemerkt, damit man sieht, wer zuletzt gemeldet hat
- Suche oben nach Name, Kennzeichen oder Code springt zum Fahrzeug auf der Karte
- Alle Fahrzeuge sind mit Namen auf der Karte beschriftet, ein Tipp zeigt Zeitpunkt, Quelle und Melder

Im Test-Browser durchgespielt: Scan über eine simulierte Kamera, Speichern mit GPS, Öffnen per Etikett-Link, Marker verschieben, Suche.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html`, `style.css` | Oberfläche |
| `app.js` | Karte, eigener Standort, Grenz-Editor, Suche, Standort erfassen |
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

Der anon-Schlüssel ist für den Browser gedacht und darf in der App stehen. Im Prototyp darf jeder mit dem Link lesen und schreiben, vor dem echten Einsatz kommt eine Anmeldung dazu.

## Veröffentlichen

Kamera und GPS funktionieren im Browser nur über HTTPS. Am einfachsten über GitHub Pages: Ordner in ein Repository legen und unter "Settings → Pages" den Branch freigeben.
