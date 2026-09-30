import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const android = join(root, "artifacts/solarchik-handoff/android");
const src = join(android, "app/src");
const gradle = readFileSync(join(android, "app/build.gradle.kts"), "utf8");
const version = gradle.match(/versionName = "([^"]+)"/)?.[1] ?? "";
const lines = [];

function pass(msg) {
  lines.push(`PASS ${msg}`);
}
function fail(msg) {
  lines.push(`FAIL ${msg}`);
}

function walk(dir, hits, pattern) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "build" || name === "intermediates") continue;
      walk(path, hits, pattern);
      continue;
    }
    if (/\.(png|jpg|jpeg|webp|gif|mp3|ogg|jks)$/i.test(name)) continue;
    const text = readFileSync(path, "utf8");
    if (pattern.test(text)) hits.push(path.slice(src.length + 1));
  }
}

const webviewHits = [];
walk(src, webviewHits, /WebView|JavascriptInterface|TrustedWebActivity|Capacitor|Cordova/);
const inLauncher = webviewHits.filter((path) => /MainActivity\.kt|RunActivity\.kt|RunView\.kt|AndroidManifest\.xml/.test(path));
if (inLauncher.length) fail(`WebView у лаунчері: ${inLauncher.join(", ")}`);
else pass("MainActivity / RunActivity без WebView");

const deskHits = [];
walk(join(src, "main"), deskHits, /DeskActivity/);
if (deskHits.length) fail(`DeskActivity: ${deskHits.join(", ")}`);
else pass("DeskActivity немає в сорсах");

if (!/applicationId = "net\.solardepin\.solarchik"/.test(gradle)) fail("applicationId не net.solardepin.solarchik");
else pass("applicationId net.solardepin.solarchik");

if (!version) fail("versionName не прочитано");
else pass(`versionName ${version}`);

if (/storePassword = "|"keyPassword = "/.test(gradle)) fail("пароль keystore лишився в build.gradle.kts");
else pass("пароль keystore не в gradle");

const manifest = readFileSync(join(src, "main/AndroidManifest.xml"), "utf8");
if (!manifest.includes('android:name=".MainActivity"')) fail("маніфест без MainActivity");
else pass("лаунчер MainActivity");
if (!manifest.includes(".game.RunActivity")) fail("маніфест без RunActivity");
else pass("забіг RunActivity");

const main = readFileSync(join(src, "main/java/net/solardepin/solarchik/MainActivity.kt"), "utf8");
if (!main.includes("wallet.clockInOnChain(")) fail("CLOCK IN не кличе clockInOnChain");
else pass("CLOCK IN → clockInOnChain");
if (main.includes("setContentView(web") || main.includes("WebView")) fail("setContentView(web)");
else pass("немає setContentView(web)");
if (!main.includes('clockKind == "message"') || main.includes("explorer") && main.includes('clockKind != "tx"')) {
  /* explorer only inside openProof which returns unless kind == tx */
}
if (!/clockKind != "tx"/.test(main) && main.includes('if (save.clockKind != "tx"')) {
  pass("message без tx-лінка");
} else if (main.includes('if (save.clockKind != "tx" || save.clockSig.isBlank()) return')) {
  pass("message без tx-лінка");
} else fail("openProof може намалювати tx для message");

const sprites = join(src, "main/assets/sprites");
for (const name of [
  ...Array.from({ length: 8 }, (_, i) => `hero-run-${i + 1}.png`),
  ...Array.from({ length: 4 }, (_, i) => `hero-jump-${i + 1}.png`),
  "foe-mite.png",
  "foe-drone.png",
]) {
  if (!existsSync(join(sprites, name))) fail(`немає спрайта ${name}`);
}
if (!existsSync(join(src, "main/assets/yard-bg.jpg"))) fail("немає yard-bg.jpg");
else pass("спрайти забігу і yard-bg.jpg на місці");

const i18n = readFileSync(join(root, "src/lib/game/i18n.ts"), "utf8");
const need = i18n.split('"yard.needApk"').length - 1;
if (need < 6) fail(`yard.needApk є в ${need} локалях, треба 6`);
else pass("yard.needApk у 6 локалях");

const game = readFileSync(join(root, "src/components/game/GameApp.tsx"), "utf8");
if (!game.includes("if (!isNativeApp())") || !game.includes('"need-apk"') || !game.includes("stampClock")) {
  fail("веб CLOCK IN не зупиняється на need-apk");
} else pass("веб CLOCK IN: Потрібен APK / Seed Vault, день не ставиться");

const engine = readFileSync(join(root, "src/lib/agents/engine.ts"), "utf8");
if (!engine.includes("DRY_RUN") || !engine.includes("fill: null")) fail("арб не DRY_RUN");
else pass("арб DRY_RUN, філ null");

const yard = readFileSync(join(root, "src/components/game/Yard.tsx"), "utf8");
if (yard.includes("0.19.44")) fail("двір все ще качає APK з WebView 0.19.44");
else if (!yard.includes(version)) fail(`двір не качає APK ${version}`);
else pass(`двір качає APK ${version}`);

const apk = join(root, "public", `Solarchik-CLOCK-IN-${version}.apk`);
if (!existsSync(apk)) fail(`немає public/Solarchik-CLOCK-IN-${version}.apk`);
else {
  const listing = execFileSync("unzip", ["-l", apk], { encoding: "utf8" });
  if (/assets\/index\.html|native\.js/.test(listing)) fail("публічний APK містить WebView");
  else if (!/hero-run-1\.png/.test(listing) || !/yard-bg\.jpg/.test(listing)) fail("публічний APK без спрайтів забігу");
  else pass(`публічний APK ${version} без WebView`);
  const packed = execFileSync("unzip", ["-p", apk], { maxBuffer: 32 * 1024 * 1024 });
  const text = packed.toString("utf8");
  if (!text.includes("CLOCK IN") || !text.includes("Забіг")) fail("в APK немає тексту CLOCK IN / Забіг");
  else pass("в APK є CLOCK IN і Забіг");
}

const build = readFileSync(join(root, "artifacts/solarchik-handoff/BUILD.md"), "utf8");
if (!build.includes("APK = здача Clock In без WebView; сайт = демо Colosseum у браузері.")) {
  fail("BUILD.md без рядка Clock In / Colosseum");
} else pass("BUILD.md: APK Clock In, сайт Colosseum");

const fails = lines.filter((line) => line.startsWith("FAIL"));
console.log(lines.join("\n"));
console.log(fails.length ? `\n${fails.length} FAIL` : "\n0 FAIL");
process.exit(fails.length ? 1 : 0);
