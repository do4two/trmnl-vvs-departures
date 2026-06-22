# TRMNL Private Plugin – VVS Abfahrten (Stuttgart / VVS)

Zeigt die nächsten S-Bahn-/Bus-Abfahrten **einer beliebigen VVS-Haltestelle** auf
einem TRMNL E-Ink-Display – **inklusive Echtzeit-Verspätungen**. Die Haltestelle
wird beim Installieren als Eingabefeld (`stop_id`) abgefragt; kein Code-Edit nötig.

> Beispiel-Haltestelle durchgängig in dieser Doku: **Remshalden-Geradstetten**
> (stopID `5001702`, primär Linie **S2**). Einfach durch deine eigene ID ersetzen
> – siehe [Abschnitt 6](#6-eigene-haltestelle-eintragen).
>
> **Teilen / Beitragen?** Siehe [CONTRIBUTING.md](CONTRIBUTING.md) – wie dieses
> Plugin als 1-Klick-**TRMNL-Recipe** für die Community veröffentlicht wird.

> **Warum nicht die DB-Timetables-API?** Ein früherer Test mit der offiziellen
> DB-Timetables-API zeigte für diese S-Bahn keine Verspätungen ("immer on
> time"). Die echten Verspätungen stecken in der **VVS-EFA-Schnittstelle**
> (Mentz-System). Genau die nutzt dieses Plugin – verifiziert: es liefert
> Verspätungen wie `+7`, `+5`, `+3` in Echtzeit (siehe unten).

---

## 1. API-Verifikation (empirisch geprüft am 2026-06-19)

### Endpunkt
```
https://www3.vvs.de/vvs/widget/XML_DM_REQUEST
```
Getestet und liefert JSON (`outputFormat=JSON`). `efa.vvs.de/vvs/XML_DM_REQUEST`
funktioniert identisch als Fallback.

### Haltestellen-ID (nicht geraten – per STOPFINDER ermittelt)
| Feld | Wert |
|------|------|
| stopID (`name_dm`) | **5001702** |
| Global ID (GID) | `de:08119:1702` |
| Name laut EFA | Remshalden, Geradstetten |

Ermittelt über:
```
https://www3.vvs.de/vvs/widget/XML_STOPFINDER_REQUEST?outputFormat=JSON&language=de&type_sf=any&name_sf=Remshalden-Geradstetten
```

### Finale Polling-URL
```
https://www3.vvs.de/vvs/widget/XML_DM_REQUEST?outputFormat=JSON&language=de&type_dm=stop&name_dm=5001702&useRealtime=1&mode=direct&limit=8&itdDateTimeDepArr=dep
```

| Parameter | Wert | Bedeutung |
|-----------|------|-----------|
| `outputFormat` | `JSON` | JSON statt XML |
| `language` | `de` | deutsche Texte |
| `type_dm` | `stop` | Abfrage per Haltestelle |
| `name_dm` | `5001702` | die stopID |
| `useRealtime` | `1` | **aktiviert Echtzeit/Verspätung – entscheidend** |
| `mode` | `direct` | direkte Abfahrtstafel |
| `limit` | `8` | Anzahl Abfahrten |
| `itdDateTimeDepArr` | `dep` | Abfahrten (nicht Ankünfte) |

> Keine API-Keys nötig (offene Schnittstelle). Bei aggressivem Polling kann es
> theoretisch zu Rate-Limits kommen – mit 15-Min-Intervall völlig unkritisch.

### Feld-Mapping (aus echter Antwort)
Pro Eintrag in `departureList[]`:

| Anzeige | JSON-Pfad | Beispiel |
|---------|-----------|----------|
| Linie | `servingLine.symbol` (oder `.number`) | `S2` |
| Ziel/Richtung | `servingLine.direction` | `Schorndorf` |
| Soll-Zeit | `dateTime.hour` + `:` + `dateTime.minute` | `9:2` → `09:02` |
| Ist-Zeit | `realDateTime.hour`/`.minute` | `9:9` → `09:09` |
| **Verspätung (Min)** | `servingLine.delay` | `"7"` |
| Echtzeit-Status | `realtimeTripStatus` | `MONITORED` |
| Gleis | `platformName` (oder `platform`) | `Gleis 2` |
| Countdown (Min) | `countdown` | `10` |
| Echtzeit-Hinweis | `servingLine.hints[].content` | `Verspätung eines vorausfahrenden Zuges` |
| Störung/Bauarbeiten | `lineInfos[].infoText.subtitle` | `… Zugausfälle wegen Bauarbeiten` |

**Sonderfälle:**
- `delay` = `null` / leeres `realDateTime` → noch **keine Echtzeit** (nur Soll), wird als `—` angezeigt.
- `delay` = `"0"` → **pünktlich**.
- `delay` = `"-9999"` oder `realtimeTripStatus` enthält `CANCEL` → **Ausfall**.
- leere `departureList` (nachts/Betriebsende) → "Keine Abfahrten".

Beispiel-Antwort liegt unter [`sample/efa_dm_sample.json`](sample/efa_dm_sample.json).

---

## 2. Architektur

```
VVS EFA (JSON, ~60 KB)  ──poll──▶  TRMNL Transform (Sandbox-JS)  ──▶  Liquid-Templates  ──▶  E-Ink
                                   flach + ~1.7 KB                    4 Layouts
```

Die EFA-Antwort ist tief verschachtelt (separate `hour`/`minute`-Strings ohne
führende Null, riesige HTML-Störungstexte). Statt das in Liquid zu lösen,
nutzen wir den **TRMNL-Sandbox-Runtime** (`transform()`-Funktion, läuft
serverlos in TRMNL, Node v22, kein eigenes Hosting). Er

- formt saubere flache Felder (`09:02` statt `9`/`2`),
- berechnet Status (`late` / `ontime` / `planned` / `cancelled`),
- dedupliziert Störungsmeldungen,
- reduziert den Payload von ~60 KB auf ~1.7 KB (TRMNL-Polling-Limit: 100 KB).

Code: [`plugin/transform.js`](plugin/transform.js). Ausgabe-Felder:
`stop_name`, `updated_at`, `departure_count`, `departures[]`
(`line`, `destination`, `planned`, `real`, `delay`, `delay_label`, `status`,
`platform`, `countdown`, `hint`), `disruptions[]`.

---

## 3. Plugin in TRMNL anlegen – Schritt für Schritt

1. **TRMNL Dashboard** → *Plugins* → *Private Plugin* → **Create**.
2. **Name**: z. B. `VVS Abfahrten`. **Strategy**: `Polling`.
3. **Polling URL** (eine Zeile) – `name_dm` ist die stopID. Entweder direkt deine
   ID eintragen, **oder** ein Formularfeld `stop_id` anlegen und `##{{ stop_id }}`
   einsetzen (so wie in [`plugin/settings.yml`](plugin/settings.yml), empfohlen für
   wiederverwendbare/teilbare Plugins):
   ```
   https://www3.vvs.de/vvs/widget/XML_DM_REQUEST?outputFormat=JSON&language=de&type_dm=stop&name_dm=##{{ stop_id }}&useRealtime=1&mode=direct&limit=8&itdDateTimeDepArr=dep
   ```
   **Verb**: `GET`. **Headers** (optional): `user-agent=TRMNL-VVS-Plugin`.
4. **Refresh interval**: `15 minutes` (kleinster Wert, passend zum E-Ink-Takt).
5. **Transform / Sandbox-Tab**: den kompletten Inhalt von
   [`plugin/transform.js`](plugin/transform.js) einfügen (die `transform(input)`-
   Funktion). Speichern.
   > Der Transform-Code ist **nicht** Teil des Import-ZIP (siehe unten) und muss
   > einmalig hier eingefügt werden.
6. **Markup-Editor**: für jede der vier Größen den passenden Inhalt einfügen:
   - **Full** → [`plugin/full.liquid`](plugin/full.liquid)
   - **Half Horizontal** → [`plugin/half_horizontal.liquid`](plugin/half_horizontal.liquid)
   - **Half Vertical** → [`plugin/half_vertical.liquid`](plugin/half_vertical.liquid)
   - **Quadrant** → [`plugin/quadrant.liquid`](plugin/quadrant.liquid)
7. **Save** → Plugin zu einem **Playlist/Mashup** hinzufügen und dem Gerät zuweisen.

### Alternativ: Import per ZIP
`plugin/vvs-geradstetten.zip` enthält `settings.yml` + die vier `.liquid`-Dateien
(das von TRMNL dokumentierte Flat-Format). Nach dem Import in Schritt 5 **noch
den Transform-Code einfügen** – dann ist alles fertig.

---

## 4. Anzeige

```
Linie  Ziel                 Ab     Echtzeit        Gleis
S2     Schorndorf           09:02  +7 → 09:09      Gl. 2
S2     Filderstadt via Hbf  09:11  pünktlich       Gl. 1
S2     Schorndorf           09:17  +5 → 09:22      Gl. 2
```
- Verspätung als fettes `+N` mit Ist-Zeit hervorgehoben (`value`-Klasse).
- Pünktlich dezent ("pünktlich", grau).
- Ausfälle als `Ausfall`, Störungen/Bauarbeiten als ⚠-Zeile (Full-Layout).
- Kopfzeile (title_bar): Haltestelle + `Stand HH:MM` (Zeit des letzten Abrufs).

Layouts: **full** (Tabelle + Störungen), **half_horizontal** (4 Zeilen kompakt),
**half_vertical** (6 Einträge gestapelt), **quadrant** (Top 3, minimal).

---

## 5. Refresh-Intervall – zwei Varianten

**Variante A (Standard, dieses Plugin):** Polling alle 15 Minuten
(`refresh_interval: 15`). Kleinstmöglicher Polling-Wert, passt zum E-Ink-Takt.
Einfach, ohne externe Infrastruktur.

**Variante B (5-Min-Updates im Zeitfenster):** siehe Abschnitt 8. Das
Plugin-Polling kann nicht unter 15 Min – wer alle 5 Min frische Verspätungen
will (z. B. morgens vor der Fahrt), braucht die **Webhook-Strategie** + einen
kleinen externen Scheduler (Cloudflare Worker).

> **Wichtig zum Verständnis:** Die **Geräte-Refresh-Rate** (Battery & Sleep,
> bis 5 Min) bestimmt nur, wie oft das Display ein Bild abholt/neu zeichnet –
> sie macht die **Plugin-Daten nicht frischer**. Frische Daten < 15 Min gibt es
> nur über Webhook-Push. Für echte 5-Min-Anzeige braucht man **beides**:
> Webhook-Push alle 5 Min **und** Geräte-Refresh 5 Min.

---

## 6. Eigene Haltestelle eintragen

Es ist **kein** Code-Edit nötig: Die Haltestelle ist ein Formularfeld (`stop_id`,
definiert in [`plugin/settings.yml`](plugin/settings.yml)). Beim Installieren des
Plugins (oder im Plugin-Formular) einfach deine **EFA-stopID** eintragen – sie
wird per `##{{ stop_id }}` in die Polling-URL eingesetzt.

**stopID ermitteln** über den STOPFINDER (Haltestellenname im letzten Parameter):
```
https://www3.vvs.de/vvs/widget/XML_STOPFINDER_REQUEST?outputFormat=JSON&language=de&type_sf=any&name_sf=<HALTESTELLE>
```
Die ID steht in `stopFinder.points.point.ref.id` (z. B. `5001702` für
Remshalden-Geradstetten).

Der **Anzeigename** in der Kopfzeile kommt automatisch aus der EFA-Antwort
(`transform.js`) – passt sich also ohne weiteres Zutun an die gewählte Haltestelle
an. (Beim Webhook-Worker, Abschnitt 8, steckt der Name in `worker.js` bzw. der
Variable `STOP_NAME`.)

---

## 7. Lokaler Test

```bash
# Transform gegen das echte Sample prüfen + alle Layouts rendern
node test/render_test.js
```
(Voraussetzung: `npm install liquidjs`.)

---

## 8. Variante B: 5-Minuten-Updates täglich 06:00–08:00 (Webhook + Cloudflare Worker)

Für echte 5-Min-Frische in einem Zeitfenster. Architektur:

```
Cloudflare Worker (Cron, alle 5 Min)
   ├─ prüft: ist es täglich 06:00–08:00 (Europe/Berlin)?  → sonst Ende
   ├─ holt EFA-JSON
   ├─ transform()  (gleiche Logik wie der Sandbox-Transform)
   └─ POST {merge_variables: …}  →  TRMNL Webhook  →  Liquid-Templates (unverändert)
```

Die vier `.liquid`-Dateien bleiben **identisch** – Webhook-`merge_variables` sind
in Liquid genauso auf Top-Level erreichbar (`{{ stop_name }}`, `{% for d in
departures %}`).

### 8.1 TRMNL: Plugin auf Webhook umstellen
1. Privates Plugin anlegen (oder bestehendes bearbeiten), **Strategy = Webhook**.
2. TRMNL zeigt eine **Webhook-URL** der Form
   `https://trmnl.com/api/custom_plugins/<UUID>`. Diese kopieren.
3. Markup-Editor: dieselben vier Layouts wie in Abschnitt 3 einfügen.
   (Transform-Tab wird hier **nicht** gebraucht – der Worker transformiert.)

### 8.2 Cloudflare Worker deployen
Dateien: [`scheduler/worker.js`](scheduler/worker.js), [`scheduler/wrangler.toml`](scheduler/wrangler.toml).

```bash
cd scheduler
npx wrangler login
npx wrangler secret put TRMNL_WEBHOOK_URL   # die Webhook-URL aus 8.1 einfügen
npx wrangler deploy
```
> `npx wrangler …` benutzen (kein globales `wrangler` nötig). Deploy danach immer
> mit `npx wrangler deploy`.

**Andere Haltestelle / anderer Name im Worker** (optional, nur Self-Host):
- Haltestelle: in [`scheduler/wrangler.toml`](scheduler/wrangler.toml) die `EFA_URL`
  als `[vars]` mit deiner stopID setzen (überschreibt den Default im Worker).
- Anzeigename: Variable `STOP_NAME` setzen, z. B.
  `npx wrangler secret put STOP_NAME` bzw. als `[vars] STOP_NAME = "…"`.
  Ohne Wert bleibt der Default (`Remshalden-Geradstetten`).

Test (pusht sofort, auch außerhalb des Fensters):
```
https://<dein-worker>.workers.dev/?force=1
```
Der Cron `*/6 4-7 * * *` (UTC) feuert breit; der Worker pusht aber **nur**
täglich 06:00–08:00 Europe/Berlin (DST-sicher via `Intl`, kein manuelles
Sommer/Winterzeit-Umstellen nötig).

> **Warum 06:00 statt 06:30?** 30 Min **Vorlauf**: Pusht der Worker erst ab 06:30,
> zeigt das Display beim Anzeige-Start (Playlist-Fenster 06:30, Abschnitt 9) noch
> den **letzten Stand vom Vortag** (Beobachtung: um 06:33 stand unten `07:48` mit
> Zeiten ab 07:56). Durch den Start um 06:00 sind bis 06:30 schon ~5 Pushes
> gelaufen – die Daten sind beim Einblenden garantiert frisch.

### 8.3 Gerät konfigurieren (TRMNL → Devices → Battery & Sleep)
- **Refresh rate: 5 Minuten** (damit das Display die frischen Bilder auch zieht).
- **Sleep Mode** so setzen, dass das Gerät nur ~06:30–08:00 wach ist – spart bei
  5-Min-Takt massiv Akku. Per API (Sekunden seit Mitternacht):
  ```
  PATCH /api/devices/{id}
  { "sleep_mode_enabled": true, "sleep_start_time": 28800, "sleep_end_time": 23400 }
  ```
  (28800 = 08:00 schlafen ab, 23400 = 06:30 aufwachen). Sleep ist täglich.
  Das Aufwachen bleibt bei **06:30** – der Worker pusht bewusst schon ab **06:00**
  (30 Min Vorlauf), damit beim Aufwachen frische Daten anliegen statt des
  Vortags-Screens. Wer das Display schon ab 06:00 wach haben will: `sleep_end_time`
  auf `21600` (06:00) setzen und das Playlist-Fenster (Abschnitt 9) auf 06:00 ziehen.

### 8.4 Push-Takt & Rate-Limit (Standard-Account)
Webhook-Limit Standard = **12 Pushes/Stunde**. Der Default ist daher **alle
6 Min** (`*/6 4-7 * * *` → max. 10/Std, sicherer Abstand). Das ergibt im
Fenster 06:00–08:00 rund 20 frische Aktualisierungen – für eine S-Bahn völlig
ausreichend.

Wer **exakt 5 Min** will: in `wrangler.toml` Cron auf `*/5 4-7 * * *` setzen.
Achtung – das trifft die Stunde 07:00–08:00 mit **genau 12** Pushes (= Limit);
durch TRMNLs „fuzzy" Timing dann gelegentlich ein `429` (harmlos: ein Push fällt
aus, der nächste Zyklus korrigiert). Ganz ohne Risiko nur mit **TRMNL+** (30/Std).

Payload-Größe geprüft: 1739 Bytes < 2 KB (Standard-Limit). Lange Störungstexte
werden im Worker auf 2 Meldungen / je 110 Zeichen gekappt.

---

## 9. Anzeige NUR 06:30–08:00 erzwingen (Playlist-Scheduling)

> **Einstieg / Merkzettel.** Das hier ist der Teil, der **nicht** im Code steckt,
> sondern einmalig in der TRMNL-UI eingestellt werden muss. Häufigster Stolperstein.

### Drei verschiedene „Refresh"-Takte – nicht verwechseln
| Takt | Steuert | Unser Wert |
|------|---------|------------|
| **Plugin-Refresh** (Dropdown „Every 15 mins / TRMNL+") | Wie oft das **Polling** Daten holt | **irrelevant** – wir nutzen Webhook |
| **Webhook-Push** (Cloudflare Worker, Abschnitt 8) | Wie **frisch die Daten** sind | alle 6 Min |
| **Geräte-Refresh / Playlist-Rotation** (Battery & Sleep) | Welches **Plugin gezeigt** wird | 5 Min |

→ **Kein TRMNL+ nötig.** Der „Every 15 mins"-Dropdown ist der Polling-Pfad und
hat auf unsere Webhook-Frische **keinen** Einfluss. Ruhig auf 15 Min stehen lassen.

### Warum der Screen nach 5 Min „weghüpft"
Das Gerät blättert bei **jedem** Geräte-Refresh (~5 Min) zum **nächsten** Plugin
der Playlist. Mehrere Plugins in einer Playlist ⇒ jedes bekommt nur einen Zyklus.
Das ist **kein** Worker-/Plugin-Fehler, sondern reine **Playlist-Rotation**.

### Die Lösung: Sichtbarkeits-Fenster (TRMNL → Playlists)
TRMNL kennt pro Playlist-Item nur ein „**von–bis sichtbar**"-Fenster (kein
„ausblenden"). Darum wird das Fenster **invertiert**:

- **VVS-Plugin:** sichtbar **06:30 – 08:00**
- **Alle anderen Plugins:** sichtbar **08:00 – 06:30** (Komplement, läuft über
  Mitternacht → lässt genau die Morgenlücke 06:30–08:00 für VVS frei)

Damit ist VVS im Fenster das einzige aktive Item und bleibt stehen (zieht bei
jedem Refresh die frischen Worker-Daten).

### ⚠️ Stolperstein: Über-Mitternacht-Fenster
Das **Über-Mitternacht-Fenster `08:00–06:30`** (Ende vor Start): manche
Scheduling-UIs lesen das korrekt als „über Mitternacht", andere zeigen dann **nie**
oder **immer**. Falls die *anderen* Plugins sich seltsam verhalten (tauchen nie
auf): ihr Fenster in **zwei** splitten — `00:00–06:30` **und** `08:00–24:00`.

### Checkliste Gerät
- **Devices → Battery & Sleep → Refresh rate = 5 Min** (damit das Gerät die
  6-Min-Pushes auch abholt; gratis bis 5 Min – ≠ Plugin-Dropdown).
- Optional Sleep-Fenster passend zu 06:30–08:00 (Abschnitt 8.3) → Akku.

### Diagnose (Webhook-Variante)
- **`cd scheduler && npx wrangler tail`** im aktiven Fenster (06:00–08:00) laufen
  lassen → zeigt, ob der Cron feuert und der Push `200` liefert (außerhalb des
  Fensters pusht der Worker bewusst nicht).
- **Einmaliger Sofort-Test:** in `wrangler.toml` `workers_dev = true`, deployen,
  `/?force=1` aufrufen, danach zurückstellen.
