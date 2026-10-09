// جمع‌کننده‌ی خبر: روی سرورهای GitHub اجرا می‌شود، فیدها و جست‌وجوی علاقه‌مندی‌ها را می‌گیرد،
// برای هر خبر عکس و متن کامل را بیرون می‌کشد و نتیجه را در _site/data می‌نویسد.
import { XMLParser } from "fast-xml-parser";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "_site", "data");
const SITE = (process.env.SITE_URL || "").replace(/\/$/, "");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

const DEFAULT_FEEDS = [
  {name:"IGN", url:"https://feeds.feedburner.com/ign/news", cat:"game", on:true},
  {name:"GameSpot", url:"https://www.gamespot.com/feeds/news/", cat:"game", on:true},
  {name:"PC Gamer", url:"https://www.pcgamer.com/rss/", cat:"game", on:true},
  {name:"Polygon", url:"https://www.polygon.com/rss/index.xml", cat:"game", on:true},
  {name:"Eurogamer", url:"https://www.eurogamer.net/feed", cat:"game", on:false},
  {name:"Anime News Network", url:"https://www.animenewsnetwork.com/all/rss.xml?ann-edition=w", cat:"anime", on:true},
  {name:"MyAnimeList", url:"https://myanimelist.net/rss/news.xml", cat:"anime", on:true},
  {name:"Anime Corner", url:"https://animecorner.me/feed/", cat:"anime", on:true},
  {name:"Cartoon Brew", url:"https://www.cartoonbrew.com/feed", cat:"animation", on:true}
];
const CAT_WORDS = {game:["game","gaming"], anime:["anime","manga"], animation:["animated","series","season"], tech:["tech"], other:[]};
const PER_FEED = 20, PER_SEARCH = 15, MAX_FEED_ITEMS = 160, SEARCH_DAYS = 30;
const ARTICLE_BUDGET = 160;           // سقف خبرهای تازه‌ای که در هر اجرا متن کاملشان گرفته می‌شود
const BLOCKED = /(^|\.)(polymarket\.com|msn\.com|youtube\.com|tiktok\.com|facebook\.com|x\.com|twitter\.com|reddit\.com)$/i;

/* ---------- helpers ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = s => crypto.createHash("sha1").update(s).digest("base64url").slice(0, 14);
const norm = s => " " + (s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
                                 .replace(/[^\p{L}\p{N}]+/gu, " ").trim() + " ";
const text = v => v == null ? "" : typeof v === "object" ? (v["#text"] ?? "") + "" : v + "";
const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
const okUrl = u => /^https?:\/\//i.test(u || "") ? u : "";
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
function strip(html){ if (!html) return ""; const { document } = parseHTML("<!doctype html><html><body><div>" + html + "</div></body></html>"); return (document.body.textContent || "").replace(/\s+/g, " ").trim(); }
const clip = (t, n) => t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "…" : t;

async function get(url, {ms = 20000, tries = 2, headers = {}, method = "GET", body} = {}){
  let err;
  for (let i = 0; i < tries; i++){
    const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, {method, body, signal:c.signal, redirect:"follow",
        headers:{"User-Agent":UA, "Accept-Language":"en-US,en;q=0.9", ...headers}});
      if (!r.ok) throw new Error("HTTP " + r.status);
      return {text: await r.text(), url: r.url};
    } catch(e){ err = e; await sleep(800 * (i + 1)); }
    finally { clearTimeout(t); }
  }
  throw err;
}
async function pool(items, n, fn){
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({length:Math.min(n, items.length)}, async () => {
    while (i < items.length){ const k = i++; try { out[k] = await fn(items[k], k); } catch(e){ out[k] = {error:e}; } }
  }));
  return out;
}

/* ---------- feeds ---------- */
const xml = new XMLParser({ignoreAttributes:false, attributeNamePrefix:"@", textNodeName:"#text", cdataPropName:false, processEntities:true, htmlEntities:true});
function parseFeed(body, feed){
  if (!/<(rss|feed|rdf)/i.test(body.slice(0, 2000))) throw new Error("not a feed");
  const doc = xml.parse(body);
  const nodes = arr(doc.rss?.channel?.item || doc.feed?.entry || doc["rdf:RDF"]?.item);
  return nodes.map(n => {
    let link = text(n.link);
    if (!okUrl(link)) link = (arr(n.link).find(l => !l["@rel"] || l["@rel"] === "alternate") || {})["@href"] || "";
    if (/bing\.com\/news\/apiclick/i.test(link)){ try { link = new URL(link).searchParams.get("url") || link; } catch {} }
    const html = text(n["content:encoded"]) || text(n.description) || text(n.summary) || text(n.content);
    const encl = arr(n.enclosure).find(e => /image/i.test(e["@type"] || "") || /\.(jpe?g|png|webp|gif)/i.test(e["@url"] || ""));
    let img = text(n["News:Image"]);
    if (img) img = img.replace(/^http:/, "https:") + "&w=960&h=540&c=14";
    img = img || encl?.["@url"] || arr(n["media:thumbnail"])[0]?.["@url"] ||
          arr(n["media:content"]).find(m => (m["@medium"] || "image") === "image" || /image/i.test(m["@type"] || ""))?.["@url"] ||
          ((html.match(/<img[^>]+src=["']([^"']+)/i) || [])[1]) || "";
    const source = text(n.source) || text(n["News:Source"]);
    let title = strip(text(n.title));
    if (feed.search && source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3)).trim();
    let summary = clip(strip(html), 300);
    if (norm(summary).startsWith(norm(title).trimEnd())) summary = "";
    const ts = Date.parse(text(n.pubDate) || text(n.published) || text(n.updated) || text(n["dc:date"])) || 0;
    return {title, summary, link: okUrl(link), img: okUrl(img), ts, src: feed.search ? (source || feed.name) : feed.name,
            cat: feed.cat, ...(feed.search ? {search:true, fav:feed.fav} : {})};
  }).filter(x => x.title && x.link);
}

function searchSources(fav, cat){
  const quoted = fav.terms.map(t => '"' + t.replace(/"/g, "") + '"');
  const words = CAT_WORDS[cat] || [];
  const gq = "(" + quoted.join(" OR ") + ")" + (words.length ? " (" + words.join(" OR ") + ")" : "") + " when:" + SEARCH_DAYS + "d";
  const bq = quoted.join(" OR ") + (words.length ? " " + words[0] : "");
  return [
    {name:"Google News", url:"https://news.google.com/rss/search?q=" + encodeURIComponent(gq) + "&hl=en-US&gl=US&ceid=US:en"},
    {name:"Bing News", url:"https://www.bing.com/news/search?q=" + encodeURIComponent(bq) + "&format=rss&setlang=en-US&qft=" + encodeURIComponent('sortbydate="1"')}
  ].map(x => ({...x, cat, fav:fav.name, terms:fav.terms, search:true}));
}

/* ---------- Google News links → real article URL ---------- */
async function decodeGoogle(link){
  const id = (link.match(/\/articles\/([^?]+)/) || [])[1];
  if (!id) return link;
  const page = await get("https://news.google.com/rss/articles/" + id + "?hl=en-US&gl=US&ceid=US:en", {headers:{Cookie:"CONSENT=YES+"}});
  const ts = (page.text.match(/data-n-a-ts="([^"]+)"/) || [])[1], sg = (page.text.match(/data-n-a-sg="([^"]+)"/) || [])[1];
  if (!ts || !sg) throw new Error("no signature");
  const inner = JSON.stringify(["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],id,+ts,sg]);
  const body = "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]));
  const r = await get("https://news.google.com/_/DotsSplashUi/data/batchexecute", {method:"POST", body,
    headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"}});
  const m = r.text.match(/garturlres\\",\\"(.*?)\\"/);
  if (!m) throw new Error("no url");
  return JSON.parse('"' + m[1] + '"');
}

/* ---------- full article ---------- */
const KEEP = new Set(["P","H2","H3","H4","UL","OL","LI","BLOCKQUOTE","FIGURE","IMG","FIGCAPTION","STRONG","EM","B","I","A","BR"]);
function cleanArticle(html, base){
  const { document } = parseHTML("<!doctype html><html><body><div id=\"r\">" + html + "</div></body></html>");
  const root = document.getElementById("r");
  const blocks = [];
  const walk = node => {
    for (const el of [...node.children]){
      const tag = el.tagName;
      if (tag === "P" || /^H[2-4]$/.test(tag) || tag === "BLOCKQUOTE" || tag === "LI"){
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (t.length > 1) blocks.push({t: tag === "P" ? "p" : tag === "LI" ? "li" : tag === "BLOCKQUOTE" ? "q" : "h", x: t});
      } else if (tag === "IMG" || tag === "PICTURE" || tag === "FIGURE"){
        const im = tag === "IMG" ? el : el.querySelector("img");
        let src = im && (im.getAttribute("src") || im.getAttribute("data-src") || "");
        try { src = new URL(src, base).href; } catch { src = ""; }
        if (okUrl(src) && !/\.svg($|\?)/i.test(src) && !blocks.some(b => b.s === src)) {
          const cap = el.querySelector && el.querySelector("figcaption");
          blocks.push({t:"img", s:src, x: cap ? cap.textContent.replace(/\s+/g, " ").trim() : ""});
        }
      } else walk(el);
    }
  };
  walk(root);
  return blocks;
}
async function fetchArticle(item){
  const page = await get(item.link, {ms:20000, tries:1});
  const { document } = parseHTML(page.text);
  const meta = (...names) => { for (const n of names){ const m = document.querySelector(`meta[property="${n}"],meta[name="${n}"]`); const v = m && m.getAttribute("content"); if (v) return v; } return ""; };
  let og = meta("og:image", "og:image:url", "twitter:image", "twitter:image:src");
  try { og = og ? new URL(og, page.url).href : ""; } catch { og = ""; }
  let blocks = [];
  try {
    const art = new Readability(document, {charThreshold: 400}).parse();
    if (art && art.content) blocks = cleanArticle(art.content, page.url);
  } catch {}
  const words = blocks.filter(b => b.t !== "img").reduce((n, b) => n + b.x.split(" ").length, 0);
  if (words < 80) blocks = [];   // صفحه‌ی خالی، پرداختی یا فقط‌ویدیو
  const desc = meta("og:description", "description");
  return {og: okUrl(og), blocks, url: page.url, desc: strip(desc)};
}

/* ---------- main ---------- */
async function loadJson(p, fallback){ try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return fallback; } }
async function remoteJson(u){ if (!SITE) return null; try { return JSON.parse((await get(SITE + u + "?t=" + Date.now(), {tries:1, ms:15000})).text); } catch { return null; } }

const config = await loadJson(path.join(ROOT, "config", "config.json"), {});
const feeds = (config.feeds && config.feeds.length ? config.feeds : DEFAULT_FEEDS).filter(f => f.on);
const favs = config.favs || {};
const prev = (await remoteJson("/data/news.json")) || {items:[]};
const prevById = new Map((prev.items || []).map(x => [x.id, x]));
console.log(`feeds: ${feeds.length}, favourites: ${Object.values(favs).flat().length}, previous items: ${prevById.size}`);

const searches = [];
for (const [cat, list] of Object.entries(favs)) for (const f of list) if (f.terms && f.terms.length) searches.push(...searchSources(f, cat));
const sources = [...feeds, ...searches];
const results = await pool(sources, 6, async src => {
  const r = await get(src.url, {tries: src.search ? 3 : 2});
  let items = parseFeed(r.text, src);
  if (src.search){
    // فقط خبرهایی که اسم علاقه‌مندی در تیترشان هست
    const terms = src.terms.map(norm).filter(t => t.trim());
    items = items.filter(x => terms.some(t => norm(x.title).includes(t)))
                 .sort((a, b) => b.ts - a.ts).slice(0, PER_SEARCH);
  } else items = items.slice(0, PER_FEED);
  return items;
});
const failed = [];
let feedItems = [], found = [];
results.forEach((r, i) => {
  const s = sources[i];
  if (!r || r.error){ console.log("FAILED", s.name, s.fav || "", r && r.error && r.error.message); if (!s.search) failed.push(s.name); return; }
  (s.search ? found : feedItems).push(...r);
});
for (const name of new Set(searches.map(s => s.fav)))
  if (!found.some(x => x.fav === name) && results.every((r, i) => sources[i].fav !== name || !r || r.error)) failed.push("جست‌وجوی " + name);

feedItems = feedItems.sort((a, b) => b.ts - a.ts).slice(0, MAX_FEED_ITEMS);

// لینک‌های گوگل‌نیوز را به آدرس واقعی تبدیل کن (از اجرای قبل اگر داریم، دوباره نگیر)
const prevByGLink = new Map((prev.items || []).filter(x => x.glink).map(x => [x.glink, x.link]));
await pool(found.filter(x => /news\.google\.com/.test(x.link)), 4, async x => {
  x.glink = x.link;
  if (prevByGLink.has(x.link)){ x.link = prevByGLink.get(x.link); return; }
  try { x.link = await decodeGoogle(x.link); } catch {}
});
found = found.filter(x => !/news\.google\.com/.test(x.link) && !BLOCKED.test(host(x.link)));

// یکی کردن و حذف تکراری‌ها
let all = [...feedItems, ...found];
for (const x of all) x.id = hash(x.link);
const seen = new Set(), seenT = new Set();
all = all.filter(x => { const t = norm(x.title).trim(); if (seen.has(x.id) || seenT.has(t)) return false; seen.add(x.id); seenT.add(t); return true; })
         .sort((a, b) => b.ts - a.ts);

// پوستر علاقه‌مندی به‌عنوان عکس پشتیبان
const favImg = {};
for (const [cat, list] of Object.entries(favs)) for (const f of list) if (f.img) favImg[cat + ":" + f.name] = f.img;

// متن کامل و عکس: از اجرای قبل بردار، فقط خبرهای تازه را بگیر
await fs.mkdir(path.join(OUT, "a"), {recursive:true});
const fresh = [];
for (const x of all){
  const old = prevById.get(x.id);
  if (old && old.checked){ x.img = x.img || old.img; x.full = old.full; x.checked = true; if (!x.summary && old.summary) x.summary = old.summary;
    if (old.full){ const a = await remoteJson("/data/a/" + x.id + ".json"); if (a) await fs.writeFile(path.join(OUT, "a", x.id + ".json"), JSON.stringify(a)); else x.full = false; } }
  else fresh.push(x);
}
console.log(`items: ${all.length}, new to enrich: ${fresh.length}`);
let enriched = 0;
await pool(fresh.slice(0, ARTICLE_BUDGET), 8, async x => {
  try {
    const a = await fetchArticle(x);
    if (!x.img || /bing\.com\/th/.test(x.img)) x.img = a.og || x.img;
    if (!x.summary && a.desc) x.summary = clip(a.desc, 300);
    if (a.blocks.length){
      x.full = true;
      await fs.writeFile(path.join(OUT, "a", x.id + ".json"), JSON.stringify({id:x.id, url:a.url, blocks:a.blocks}));
    }
    enriched++;
  } catch {}
  x.checked = true;
});
for (const x of all){
  if (!x.img && x.fav) x.img = favImg[x.cat + ":" + x.fav] || "";
  delete x.terms;
}
console.log(`enriched: ${enriched}, with image: ${all.filter(x => x.img).length}/${all.length}, full text: ${all.filter(x => x.full).length}`);

await fs.writeFile(path.join(OUT, "news.json"), JSON.stringify({ts: Date.now(), items: all, failed}));
