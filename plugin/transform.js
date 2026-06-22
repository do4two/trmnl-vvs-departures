/**
 * TRMNL Sandbox Transform — VVS EFA Departure Monitor
 * Haltestelle: beliebig (stopID wird im Plugin-Formular gewählt, siehe settings.yml).
 *
 * Läuft serverlos im TRMNL "Transform"-Tab (Node v22, isolated-vm, 1s, kein Netz).
 * Wandelt die tief verschachtelte EFA-DM-Antwort in flache, Liquid-freundliche
 * Felder um und reduziert den Payload (~60 KB -> wenige KB).
 *
 * Rückgabe-Felder (im Markup via {{ ... }} erreichbar):
 *   stop_name        String  Anzeigename der Haltestelle
 *   updated_at       String  "HH:MM" Stand des Abrufs (Serverzeit EFA)
 *   departure_count  Number  Anzahl gelieferter Abfahrten
 *   departures[]     Array   je Abfahrt:
 *       line         "S2"
 *       destination  "Schorndorf"
 *       planned      "09:02"  Soll-Abfahrt
 *       real         "09:09"  Ist-Abfahrt (= planned wenn keine Echtzeit)
 *       delay        7 | 0 | null   Minuten (null = keine Echtzeitdaten)
 *       delay_label  "+7" | ""      vorformatiert
 *       status       "late" | "ontime" | "planned" | "cancelled"
 *       platform     "Gleis 2"
 *       countdown    Number  Minuten bis Abfahrt
 *       hint         String  kurze Echtzeit-Notiz (z.B. Grund der Verspätung)
 *   disruptions[]    Array   eindeutige Störungs-/Bauarbeiten-Titel
 */
function transform(input) {
  var pad = function (n) { return ('0' + String(n)).slice(-2); };
  var fmt = function (dt) {
    if (!dt || dt.hour === undefined || dt.hour === null || dt.hour === '') return null;
    return pad(dt.hour) + ':' + pad(dt.minute);
  };

  var list = Array.isArray(input && input.departureList) ? input.departureList : [];

  var departures = list.map(function (d) {
    var sl = (d && d.servingLine) || {};
    var rawDelay = sl.delay;
    var statusStr = String(d.realtimeTripStatus || '').toUpperCase();

    var cancelled = rawDelay === '-9999' ||
                    statusStr.indexOf('CANCEL') !== -1 ||
                    statusStr.indexOf('AUSF') !== -1;

    // Echtzeit vorhanden? delay ist ein nicht-leerer String und kein Ausfall-Sentinel
    var hasRt = !cancelled && rawDelay !== undefined && rawDelay !== null && rawDelay !== '';
    var delay = hasRt ? parseInt(rawDelay, 10) : null;
    if (isNaN(delay)) { delay = null; hasRt = false; }

    var planned = fmt(d.dateTime);
    var real = fmt(d.realDateTime) || planned;

    var status;
    if (cancelled) status = 'cancelled';
    else if (hasRt && delay > 0) status = 'late';
    else if (hasRt) status = 'ontime';
    else status = 'planned';

    var hints = Array.isArray(sl.hints) ? sl.hints.map(function (h) { return h && h.content; }).filter(Boolean) : [];

    var platform = d.platformName || (d.platform ? 'Gleis ' + d.platform : '');

    var cd = parseInt(d.countdown, 10);
    if (isNaN(cd)) cd = null;

    return {
      line: sl.symbol || sl.number || '',
      destination: sl.direction || '',
      planned: planned || '',
      real: real || '',
      delay: delay,
      delay_label: (delay !== null && delay > 0) ? ('+' + delay) : '',
      status: status,
      platform: platform,
      countdown: cd,
      hint: hints[0] || ''
    };
  });

  // Störungen: eindeutige Titel aus lineInfos über alle Abfahrten sammeln
  var seen = {};
  var disruptions = [];
  list.forEach(function (d) {
    var infos = Array.isArray(d.lineInfos) ? d.lineInfos : [];
    infos.forEach(function (li) {
      var t = (li && li.infoText) || {};
      var title = t.subtitle || t.subject || li.infoLinkText || '';
      if (title && !seen[title]) { seen[title] = true; disruptions.push(title); }
    });
  });

  // Anzeigename direkt aus der EFA-Antwort – so passt er sich automatisch an die
  // gewählte Haltestelle an. EFA liefert oft "Ort, Haltestelle"; ist beides
  // identisch ("Geradstetten, Geradstetten"), wird der doppelte Teil gekürzt.
  var point = (((input && input.dm) || {}).points || {}).point || {};
  var rawName = (point.name || '').trim();
  var parts = rawName.split(',').map(function (s) { return s.trim(); });
  var stopName = (parts.length === 2 && parts[0] === parts[1]) ? parts[0] : (rawName || 'Abfahrten');

  return {
    stop_name: stopName,
    updated_at: fmt(input && input.dateTime) || '',
    departure_count: departures.length,
    departures: departures,
    disruptions: disruptions
  };
}
