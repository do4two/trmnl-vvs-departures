/**
 * Lokaler Render-Test: wendet plugin/transform.js auf das echte EFA-Sample an
 * und rendert alle vier Liquid-Layouts (kompatibel zur TRMNL-Liquid-Engine).
 *
 * Voraussetzung:  npm install liquidjs
 * Ausführen:      node test/render_test.js
 */
const fs = require("fs");
const path = require("path");
const { Liquid } = require("liquidjs");

const root = path.join(__dirname, "..");
const engine = new Liquid();

const code = fs.readFileSync(path.join(root, "plugin/transform.js"), "utf8");
const input = JSON.parse(fs.readFileSync(path.join(root, "sample/efa_dm_sample.json"), "utf8"));
const transform = new Function(code + "; return transform;")();
const data = transform(input);

console.log("Transform-Ausgabe:", JSON.stringify(data, null, 2).slice(0, 400), "...\n");

(async () => {
  for (const layout of ["full", "half_horizontal", "half_vertical", "quadrant"]) {
    const tpl = fs.readFileSync(path.join(root, "plugin", layout + ".liquid"), "utf8");
    const html = await engine.parseAndRender(tpl, data);
    const txt = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(`===== ${layout}.liquid (${html.length} chars) =====`);
    console.log(txt + "\n");
  }
})();
