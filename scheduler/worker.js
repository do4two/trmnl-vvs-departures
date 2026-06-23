/**
 * Cloudflare Worker — VVS Geradstetten → TRMNL Webhook Push
 *
 * Holt alle 5 Min (per Cron) die VVS-EFA-Abfahrten, transformiert sie und
 * pusht sie an den TRMNL-Webhook. So werden die 5-Min-Updates erreicht, die
 * das Plugin-Polling (Floor 15 Min) nicht kann.
 *
 * Gepusht wird NUR im Fenster täglich (Mo–So) 06:00–08:00 (Europe/Berlin, DST-sicher).
 * (06:00 statt 06:30 = Vorlauf, damit das Display am Anzeige-Start frische Daten hat
 *  und nicht den letzten Stand vom Vortag zeigt.)
 * Cron feuert breiter in UTC; das Zeitfenster wird hier im Worker exakt geprüft.
 *
 * Secrets/Vars (siehe wrangler.toml + `wrangler secret put`):
 *   TRMNL_WEBHOOK_URL  z.B. https://trmnl.com/api/custom_plugins/<UUID>   (Secret)
 *   EFA_URL            optional, überschreibt die Standard-EFA-URL          (Var)
 */

const DEFAULT_EFA_URL =
  "https://www3.vvs.de/vvs/widget/XML_DM_REQUEST" +
  "?outputFormat=JSON&language=de&type_dm=stop&name_dm=5001702" +
  "&useRealtime=1&mode=direct&limit=8&itdDateTimeDepArr=dep";

// Zeitfenster (Minuten seit Mitternacht, Europe/Berlin) und Wochentage.
const WINDOW_START = 6 * 60; // 06:00 (Vorlauf, damit ab 06:30 garantiert frische Daten am Display stehen)
const WINDOW_END = 8 * 60; // 08:00 (exklusiv)
const WEEKDAYS = new Set([0, 1, 2, 3, 4, 5, 6]); // täglich (Mo–So)

/** Aktuelle Wanduhr in Europe/Berlin (DST-sicher via Intl). */
function berlinNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // manche ICU geben "24" für Mitternacht
  return {
    weekday: wdMap[get("weekday")],
    minutes: hour * 60 + parseInt(get("minute"), 10),
  };
}

function inWindow() {
  const { weekday, minutes } = berlinNow();
  return WEEKDAYS.has(weekday) && minutes >= WINDOW_START && minutes < WINDOW_END;
}

/** "HH:MM" Berliner Wanduhr – für lesbare Log-Zeitstempel. */
function berlinClock() {
  const { minutes } = berlinNow();
  const pad = (n) => ("0" + String(n)).slice(-2);
  return pad(Math.floor(minutes / 60)) + ":" + pad(minutes % 60);
}

/** EFA-DM-JSON → flache, TRMNL-/Liquid-freundliche merge_variables.
 *  stopName überschreibt den Anzeigenamen (Var STOP_NAME); ohne Wert Default unten. */
function transform(input, stopName) {
  const pad = (n) => ("0" + String(n)).slice(-2);
  const fmt = (dt) =>
    dt && dt.hour !== undefined && dt.hour !== null && dt.hour !== ""
      ? pad(dt.hour) + ":" + pad(dt.minute)
      : null;

  const list = Array.isArray(input && input.departureList) ? input.departureList : [];

  const departures = list.map((d) => {
    const sl = (d && d.servingLine) || {};
    const rawDelay = sl.delay;
    const statusStr = String(d.realtimeTripStatus || "").toUpperCase();
    const cancelled =
      rawDelay === "-9999" ||
      statusStr.indexOf("CANCEL") !== -1 ||
      statusStr.indexOf("AUSF") !== -1;

    let hasRt = !cancelled && rawDelay !== undefined && rawDelay !== null && rawDelay !== "";
    let delay = hasRt ? parseInt(rawDelay, 10) : null;
    if (isNaN(delay)) {
      delay = null;
      hasRt = false;
    }

    const planned = fmt(d.dateTime);
    const real = fmt(d.realDateTime) || planned;

    let status;
    if (cancelled) status = "cancelled";
    else if (hasRt && delay > 0) status = "late";
    else if (hasRt) status = "ontime";
    else status = "planned";

    const hints = Array.isArray(sl.hints)
      ? sl.hints.map((h) => h && h.content).filter(Boolean)
      : [];

    let cd = parseInt(d.countdown, 10);
    if (isNaN(cd)) cd = null;

    return {
      line: sl.symbol || sl.number || "",
      destination: sl.direction || "",
      planned: planned || "",
      real: real || "",
      delay: delay,
      delay_label: delay !== null && delay > 0 ? "+" + delay : "",
      status: status,
      platform: d.platformName || (d.platform ? "Gleis " + d.platform : ""),
      countdown: cd,
      hint: hints[0] || "",
    };
  });

  // Störungen: eindeutige Titel, gekappt für das 2-KB-Webhook-Limit (Standard).
  const seen = {};
  const disruptions = [];
  list.forEach((d) => {
    (Array.isArray(d.lineInfos) ? d.lineInfos : []).forEach((li) => {
      const t = (li && li.infoText) || {};
      const title = t.subtitle || t.subject || li.infoLinkText || "";
      if (title && !seen[title] && disruptions.length < 2) {
        seen[title] = true;
        disruptions.push(title.length > 110 ? title.slice(0, 107) + "…" : title);
      }
    });
  });

  return {
    stop_name: stopName || "Remshalden-Geradstetten",
    updated_at: fmt(input && input.dateTime) || "",
    departure_count: departures.length,
    departures: departures,
    disruptions: disruptions,
  };
}

async function pushToTrmnl(env) {
  const efaUrl = env.EFA_URL || DEFAULT_EFA_URL;
  if (!env.TRMNL_WEBHOOK_URL) throw new Error("TRMNL_WEBHOOK_URL nicht gesetzt");

  const efaResp = await fetch(efaUrl, {
    headers: { "user-agent": "TRMNL-VVS-Worker", accept: "application/json" },
  });
  if (!efaResp.ok) throw new Error("EFA HTTP " + efaResp.status);
  const data = await efaResp.json();

  const merge_variables = transform(data, env.STOP_NAME);
  const body = JSON.stringify({ merge_variables });

  const resp = await fetch(env.TRMNL_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  // Webhook-Antwortkörper bei Fehlern mitloggen (z.B. 429-Rate-Limit-Hinweis).
  let detail = "";
  if (!resp.ok) {
    try {
      detail = (await resp.text()).slice(0, 200);
    } catch (_) {}
  }

  return {
    ok: resp.ok,
    status: resp.status,
    bytes: body.length,
    departures: merge_variables.departure_count,
    updated_at: merge_variables.updated_at,
    detail,
  };
}

export default {
  // Cron-Trigger: nur im Berliner Zeitfenster pushen.
  async scheduled(event, env, ctx) {
    const t = berlinClock();
    if (!inWindow()) {
      console.log(`[${t}] Außerhalb Fenster (täglich 06:00–08:00 Berlin) – kein Push.`);
      return;
    }
    try {
      const r = await pushToTrmnl(env);
      console.log(`[${t}] Push ${r.ok ? "OK" : "FEHLER"}:`, JSON.stringify(r));
    } catch (e) {
      console.error(`[${t}] Push fehlgeschlagen:`, e.message);
    }
  },

  // Manueller Test im Browser: GET ?force=1 pusht auch außerhalb des Fensters.
  async fetch(req, env) {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    if (!force && !inWindow()) {
      return new Response("Außerhalb Fenster täglich 06:00–08:00 (Berlin). ?force=1 zum Testen.", {
        status: 200,
      });
    }
    try {
      const r = await pushToTrmnl(env);
      return new Response(JSON.stringify(r, null, 2), {
        status: r.ok ? 200 : 502,
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return new Response("Fehler: " + e.message, { status: 500 });
    }
  },
};
