# Beitragen & Teilen – als TRMNL-Recipe veröffentlichen

Dieses Plugin lässt sich mit **einem Klick** an die TRMNL-Community weitergeben,
**ohne** dass jemand deine Cloudflare-Infrastruktur oder dieses GitHub-Repo braucht.
TRMNL nennt das **„Recipe"**: eine kuratierte, installierbare Version eines Private
Plugins. Jeder Installierende trägt nur seine eigene **Haltestellen-ID** ein.

> Wichtig: Recipe-fähig ist die **Polling-Variante** (Plugin holt die Daten selbst).
> Die **Webhook-Variante** (Cloudflare Worker, README Abschnitt 8) ist *deine eigene*
> Infrastruktur und kann **nicht** als 1-Klick-Recipe geteilt werden – sie gehört in
> die README als optionaler „Self-Host"-Teil.

---

## 1. Voraussetzung: Plugin ist generisch (bereits erledigt)

Damit das Recipe für jeden funktioniert, darf nichts Persönliches hartkodiert sein:

- ✅ **Haltestelle** ist ein Formularfeld `stop_id` und wird per `##{{ stop_id }}`
  in die Polling-URL eingesetzt (`plugin/settings.yml`).
- ✅ **Anzeigename** kommt automatisch aus der EFA-Antwort (`plugin/transform.js`),
  nicht hartkodiert.
- ✅ Keine privaten Daten (Account, Webhook-UUID) in Markup/Settings.

## 2. Veröffentlichen

1. TRMNL-Dashboard → dein Private Plugin (Polling-Strategie, mit `stop_id`-Feld).
2. Rechts **„Publish as a Recipe"** klicken.
3. Der Linter **„Chef"** prüft automatisch (siehe Checkliste unten).
4. Danach **manuelles Review** durch das TRMNL-Team (i. d. R. 1–2 Tage), dann live.

**Alternative ohne Review:** **„Unlisted"** erzeugt sofort einen teilbaren Link
(keine automatische/manuelle Moderation, taucht nicht im öffentlichen Katalog auf) –
ideal zum Vorab-Testen mit Freunden.

## 3. Chef-Checkliste (damit das Review durchläuft)

**Formular & Daten**
- `author_bio`-Feld mit Kontakt/Erklärung ausfüllen; passende Kategorie wählen.
- `default`/`placeholder` sinnvoll nutzen; `optional: false` nur wo nötig.
- **Keine** persönlichen Daten; bei Polling-URLs mit Auth Demo-Daten hinterlegen.
  → Hier nicht nötig: die VVS-EFA-Schnittstelle ist **öffentlich, ohne API-Key**.
- Form-Felder real testen (eintragen → speichern → Markup prüfen).

**Markup (häufige Ablehnungsgründe)**
- Keine asynchronen API-Calls im Markup (5-Sekunden-Renderer-Timeout).
- Kein CSS `opacity` → stattdessen die Framework-Graustufen-Klassen.
- Keine eigenen Fonts → die Framework-Fonts nutzen.
- JS: `DOMContentLoaded` statt `window.onload`; Charts mit eindeutiger Klasse.
- Über Layouts hinweg testen: TRMNL OG/X **Landscape** und TRMNL X **Portrait**;
  responsive Klassen (`lg:`, `portrait:`), Liquid `truncate`/Clamping gegen Overflow.

**Webhook-Hinweis (falls du die Worker-Variante mitgibst)**
- Setup-Schritte in `author_bio` skizzieren und auf diese README/GitHub verlinken.

## 4. Was Nutzer nach der Installation tun

1. Recipe installieren → das Plugin fragt **Haltestellen-ID** (`stop_id`).
2. ID per STOPFINDER ermitteln (siehe [README Abschnitt 6](README.md#6-eigene-haltestelle-eintragen)).
3. Plugin einer Playlist zuweisen – fertig. Anzeigename erscheint automatisch.

---

## Lokal entwickeln / testen

```bash
npm install liquidjs
node test/render_test.js      # Transform gegen Sample + alle 4 Layouts rendern
```

Änderungen an Layouts/Transform bitte vorher mit dem Render-Test prüfen.
