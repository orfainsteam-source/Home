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
  {name:"ویجیاتو", url:"https://t.me/s/vigiatonet", cat:"game", on:true, lang:"fa"},
  {name:"زومجی", url:"https://t.me/s/myzoomg", cat:"game", on:true, lang:"fa"},
  {name:"گیمفا", url:"https://t.me/s/gamefa_official", cat:"game", on:true, lang:"fa"},
  {name:"آقای انیمه", url:"https://t.me/s/animestertv", cat:"anime", on:true, lang:"fa"},
  {name:"MyAnimes", url:"https://t.me/s/MyAnimes", cat:"anime", on:true, lang:"fa"},
  {name:"IGN", url:"https://feeds.feedburner.com/ign/news", cat:"game", on:false},
  {name:"GameSpot", url:"https://www.gamespot.com/feeds/news/", cat:"game", on:false},
  {name:"PC Gamer", url:"https://www.pcgamer.com/rss/", cat:"game", on:false},
  {name:"Polygon", url:"https://www.polygon.com/rss/index.xml", cat:"game", on:false},
  {name:"Anime News Network", url:"https://www.animenewsnetwork.com/all/rss.xml?ann-edition=w", cat:"anime", on:false},
  {name:"MyAnimeList", url:"https://myanimelist.net/rss/news.xml", cat:"anime", on:false},
  {name:"Cartoon Brew", url:"https://www.cartoonbrew.com/feed", cat:"animation", on:false}
];
const CAT_WORDS = {game:["game","gaming"], anime:["anime","manga"], animation:["animated","series","season"], studio:["game","studio"], tech:["tech"], other:[]};
const CAT_FA = {game:"بازی", anime:"انیمه", animation:"انیمیشن", studio:"بازی", tech:"", other:""};
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
    return {title, summary, link: okUrl(link), img: okUrl(img), ts,
            src: feed.official ? feed.name + " (رسمی)" : feed.search ? (source || feed.name) : feed.name,
            cat: feed.cat, ...(feed.lang ? {lang:feed.lang} : {}), ...(feed.search ? {search:true, fav:feed.fav} : {}),
            ...(feed.official ? {official:true, _html: html} : {})};
  }).filter(x => x.title && x.link);
}

/* ---------- public Telegram channels (t.me/s/<name>) ---------- */
// سایت‌های ایرانی از خارج از ایران در دسترس نیستند، اما کانال تلگرامشان هست
const tgName = url => (url.match(/^https?:\/\/(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]{4,})/i) || [])[1] || "";
function parseTelegram(page, feed){
  const name = tgName(feed.url);
  const ent = t => t.replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return page.split('<div class="tgme_widget_message_wrap').slice(1).map(m => {
    const post = (m.match(/data-post="([^"]+)"/) || [])[1];
    const body = (m.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/) || [])[1];
    if (!post || !body) return null;
    const textAll = ent(body.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\r/g, "");
    // خط‌های تبلیغ کانال و هشتگ‌ها را حذف کن
    const lines = textAll.split("\n").map(l => l.replace(/^[\s\p{Extended_Pictographic}\u200d\ufe0f⏺•▪️◾️🔸🔹➖]+/u, "").trim())
      .filter(l => l && !/^(@|#|https?:\/\/t\.me|🆔)/i.test(l) && !/@\w{4,}\s*$/.test(l)
                && !(l.length < 60 && /(مطالعه کامل|ادامه مطلب|بیشتر بخوانید|مشاهده کامل|لینک مطلب)/.test(l)));
    if (!lines.length) return null;
    const title = lines[0].slice(0, 220);
    const paras = lines.slice(1);
    const img = (m.match(/tgme_widget_message_(?:photo_wrap|video_thumb)[^>]*background-image:url\('([^']+)'\)/) || [])[1]
             || (m.match(/link_preview_(?:right_)?image[^>]*background-image:url\('([^']+)'\)/) || [])[1] || "";
    const site = (m.match(/href="(https?:\/\/(?!t\.me)[^"]+)"/) || [])[1] || "";
    const ts = Date.parse((m.match(/<time datetime="([^"]+)"/) || [])[1] || "") || 0;
    return {title, summary: clip(paras.join(" "), 300), link: ent(site) || "https://t.me/" + post, img: okUrl(img), ts, src: feed.name, cat: feed.cat,
            lang: feed.lang || "", _tg: [...paras.map(x => ({t:"p", x}))]};
  }).filter(Boolean).reverse();
}

/* ---------- public Instagram pages (no login) ---------- */
const igName = url => (url.match(/instagram\.com\/([A-Za-z0-9_.]+)/i) || [])[1] || "";
async function fetchInstagram(feed){
  const user = igName(feed.url);
  const r = await get("https://www.instagram.com/api/v1/feed/user/" + user + "/username/?count=12",
    {tries:2, headers:{"x-ig-app-id":"936619743392459", "Accept":"application/json", "Referer":"https://www.instagram.com/" + user + "/"}});
  const d = JSON.parse(r.text);
  return (d.items || []).map(x => {
    const cap = ((x.caption || {}).text || "").replace(/\r/g, "");
    const media = x.image_versions2 ? x : ((x.carousel_media || [])[0] || {});
    const img = (((media.image_versions2 || {}).candidates || [])[0] || {}).url || "";
    const lines = cap.split("\n").map(l => l.replace(/^[\s\p{Extended_Pictographic}\u200d\ufe0f•▪️◾️🔸🔹➖⏺🔻]+/u, "").trim())
      .filter(l => l && !/^[#@]/.test(l) && !/^(لینک|link in bio)/i.test(l));
    if (!lines.length || !img) return null;
    return {title: lines[0].slice(0, 220), summary: clip(lines.slice(1).join(" "), 300), link: "https://www.instagram.com/p/" + x.code + "/",
            img, ts: (x.taken_at || 0) * 1000, src: feed.name, cat: feed.cat, ...(hasFa(cap) ? {lang:"fa"} : {}),
            _tg: lines.slice(1).map(t => ({t:"p", x:t}))};
  }).filter(Boolean);
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

/* ---------- Persian web search (Bing, Persian edition) ---------- */
const toFaDigits = t => t.replace(/[0-9]/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
const toEnDigits = t => t.replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
function hasFa(t){ return /[\u0600-\u06FF]/.test(t || ""); }
function persianSources(fav, cat, meta){
  const fa = [...new Set((meta.fa || []).flatMap(n => [n, toFaDigits(n), toEnDigits(n)]))];
  const qs = [];
  if (fa.length) qs.push('"' + fa[0] + '"' + (CAT_FA[cat] ? " " + CAT_FA[cat] : ""));
  qs.push('"' + fav.name.replace(/"/g, "") + '"' + (CAT_FA[cat] ? " " + CAT_FA[cat] : ""));
  return qs.map(q => ({name:"Bing", url:"https://www.bing.com/news/search?q=" + encodeURIComponent(q) + "&format=rss&setlang=fa&cc=IR&qft=" + encodeURIComponent('sortbydate="1"'),
    cat, fav:fav.name, terms:[...fav.terms, ...fa], search:true, persian:true}));
}

/* ---------- favourite metadata: Persian names, Steam id, official site, cover art ---------- */
const ART_STEAM = id => "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/" + id + "/library_hero.jpg";
const WD_RE = {game:/video game|game series|franchise/i, anime:/anime|manga|television series/i, animation:/animated|television series|cartoon/i,
               studio:/developer|publisher|studio|company|video game/i};
async function wdEntity(id){
  return (await json("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|aliases|claims&languages=fa|en&ids=" + id)).entities[id];
}
async function favMeta(fav, cat){
  const meta = {fa:[], steam:"", site:"", art:""};
  try {
    let wid = fav.src === "wikidata" ? fav.id : "";
    if (!wid && fav.src === "anilist" && fav.id){
      const q = `SELECT ?i WHERE { { ?i wdt:P8729 "${+fav.id}" } } LIMIT 1`;
      const r = await json("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), {headers:{Accept:"application/sparql-results+json"}});
      const b = r.results.bindings[0]; if (b) wid = b.i.value.split("/").pop();
    }
    if (!wid){
      const r = await json("https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&type=item&limit=8&language=en&search=" + encodeURIComponent(fav.name));
      const hit = (r.search || []).find(x => (WD_RE[cat] || /./).test(x.description || ""));
      if (hit) wid = hit.id;
    }
    if (wid){
      const e = await wdEntity(wid);
      const v = p => { const c = (e.claims[p] || [])[0]; return c && c.mainsnak.datavalue ? c.mainsnak.datavalue.value : ""; };
      if (e.labels.fa) meta.fa.push(e.labels.fa.value);
      for (const a of (e.aliases && e.aliases.fa) || []) meta.fa.push(a.value);
      meta.steam = String(v("P1733") || ""); meta.site = v("P856") || "";
    }
    if (fav.src === "anilist" && fav.id){
      const d = await json("https://graphql.anilist.co", {method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({query:"query($id:Int){Media(id:$id){bannerImage coverImage{extraLarge} externalLinks{site url}}}", variables:{id:+fav.id}})});
      const m = d.data.Media;
      meta.art = m.bannerImage || (m.coverImage && m.coverImage.extraLarge) || "";
      if (!meta.site) meta.site = ((m.externalLinks || []).find(l => l.site === "Official Site") || {}).url || "";
    } else if (fav.src === "tvmaze" && fav.id){
      const imgs = await json("https://api.tvmaze.com/shows/" + fav.id + "/images");
      const pick = imgs.find(x => x.type === "background") || imgs.find(x => x.type === "poster");
      if (pick) meta.art = pick.resolutions.original.url;
      if (!meta.site) meta.site = (await json("https://api.tvmaze.com/shows/" + fav.id)).officialSite || "";
    }
    if (!meta.steam && (cat === "game")){
      const d = await json("https://store.steampowered.com/api/storesearch/?l=english&cc=US&term=" + encodeURIComponent(fav.name));
      const want = norm(fav.name).trim(); const hit = (d.items || []).find(x => norm(x.name).trim() === want);
      if (hit) meta.steam = String(hit.id);
    }
    if (meta.steam && !meta.art) meta.art = ART_STEAM(meta.steam);
  } catch(e){ console.log("meta failed", fav.name, e.message); }
  meta.fa = [...new Set(meta.fa.filter(n => n && n.length >= 2))];
  return meta;
}

/* ---------- official sources: Steam news and the official site's own feed ---------- */
async function json(url, opts){ return JSON.parse((await get(url, {tries:2, ms:15000, ...opts})).text); }
async function discoverFeed(site){
  try {
    const page = await get(site, {tries:1, ms:15000});
    const m = page.text.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi) || [];
    for (const tag of m){
      const href = (tag.match(/href=["']([^"']+)/i) || [])[1];
      if (!href || /comments/i.test(href)) continue;
      return new URL(href, page.url).href;
    }
  } catch {}
  return "";
}
async function officialSources(fav, cat, meta){
  const out = [];
  if (/^\d+$/.test(meta.steam || "")) out.push({name:"Steam", url:"https://store.steampowered.com/feeds/news/app/" + meta.steam + "/?l=english"});
  if (meta.site){ const feed = await discoverFeed(meta.site); if (feed) out.push({name: host(meta.site), url: feed}); }
  return out.map(x => ({...x, cat, fav:fav.name, terms:fav.terms, search:true, official:true}));
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

/* ---------- release calendar (Wikipedia "List of video games released in YEAR") ---------- */
const MONTHS = {January:0, February:1, March:2, April:3, May:4, June:5, July:6, August:7, September:8, October:9, November:10, December:11};
async function wikiReleases(year){
  const page = await get("https://en.wikipedia.org/api/rest_v1/page/html/List_of_video_games_released_in_" + year,
    {ms:40000, headers:{"User-Agent":"DashboardBot/1.0 (github.com/orfainsteam-source/Home)"}});
  const { document } = parseHTML(page.text);
  const out = [];
  for (const t of document.querySelectorAll("table.wikitable")){
    const head = [...t.querySelectorAll("tr")][0];
    const cols = head ? [...head.querySelectorAll("th")].map(h => h.textContent.trim().toLowerCase()) : [];
    const dated = cols[0] && cols[0].startsWith("release");
    const tba = cols[0] && cols[0].startsWith("title");
    if (!dated && !tba) continue;
    let lastDate = "";
    for (const tr of [...t.querySelectorAll("tr")].slice(1)){
      const tds = [...tr.children].filter(c => c.tagName === "TD");
      if (!tds.length) continue;
      let i = 0, date = "";
      if (dated){
        const m = tds[0].textContent.trim().match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/);
        if (m){ date = m[0]; i = 1; lastDate = date; } else date = lastDate;   // rowspan: تاریخ ردیف قبل
      }
      const tcell = tds[i]; if (!tcell) continue;
      const a = tcell.querySelector("a[rel='mw:WikiLink']");
      const title = tcell.textContent.replace(/\[.*?\]/g, "").trim();
      const plat = (tds[i + (tba ? 2 : 1)] || {}).textContent || "";
      const type = ((tds[i + (tba ? 3 : 2)] || {}).textContent || "").trim();
      if (!title || !a || !/original|remake/i.test(type)) continue;   // فقط بازی‌های مهم (مقاله دارند) و اصلی/ریمیک
      let ts = 0, approx = "";
      if (dated && date){ const [mn, dd] = date.split(/\s+/); ts = Date.UTC(year, MONTHS[mn], +dd); }
      else approx = (tds[i + 1] || {}).textContent ? tds[i + 1].textContent.replace(/\[.*?\]/g, "").trim() : String(year);
      out.push({title, wiki: decodeURIComponent((a.getAttribute("href") || "").replace(/^\.\//, "")), ts, approx: approx || "",
                year, plat: plat.replace(/\[.*?\]/g, "").trim()});
    }
  }
  return out;
}
async function wikiCovers(list){
  for (let i = 0; i < list.length; i += 40){
    const part = list.slice(i, i + 40);
    try {
      const d = await json("https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=thumbnail&pithumbsize=480&pilicense=any&redirects=1&titles="
        + encodeURIComponent(part.map(x => x.wiki.replace(/_/g, " ")).join("|")), {headers:{"User-Agent":"DashboardBot/1.0"}});
      const map = {};
      for (const r of (d.query.redirects || [])) map[r.to] = r.from;
      for (const n of (d.query.normalized || [])) map[n.to] = map[n.to] || n.from;
      for (const pg of Object.values(d.query.pages || {})){
        const from = map[pg.title] || pg.title;
        for (const x of part) if (x.wiki.replace(/_/g, " ") === from || x.wiki.replace(/_/g, " ") === pg.title) x.img = (pg.thumbnail || {}).source || x.img || "";
      }
    } catch {}
  }
}
async function youtubeTrailer(title){
  const r = await get("https://www.youtube.com/results?search_query=" + encodeURIComponent(title + " official trailer") + "&hl=en", {tries:1, ms:15000});
  return (r.text.match(/"videoId":"([A-Za-z0-9_-]{11})"/) || [])[1] || "";
}
async function buildReleases(favNames){
  const prevRel = (await remoteJson("/data/releases.json")) || {};
  if (prevRel.ts && Date.now() - prevRel.ts < 6*3600e3 && prevRel.items) return prevRel;   // هر ۶ ساعت کافی است
  const now = Date.now(), y = new Date().getUTCFullYear();
  let list = [];
  for (const yr of [y, y + 1]) { try { list.push(...await wikiReleases(yr)); } catch(e){ console.log("releases failed", yr, e.message); } }
  const from = now - 8*864e5, to = now + 366*864e5;
  list = list.filter(x => x.ts ? (x.ts >= from && x.ts <= to) : x.year <= y + 1);
  const seenR = new Set(); list = list.filter(x => { const k = norm(x.title); if (seenR.has(k)) return false; seenR.add(k); return true; });
  const old = new Map((prevRel.items || []).map(x => [norm(x.title), x]));
  for (const x of list){ const o = old.get(norm(x.title)); if (o){ x.img = o.img; x.yt = o.yt; } }
  await wikiCovers(list.filter(x => !x.img));
  // تریلر: اول بازی‌های نزدیک‌تر و علاقه‌مندی‌ها
  const want = list.filter(x => x.yt === undefined).sort((a, b) => (favNames.has(norm(b.title)) - favNames.has(norm(a.title))) || ((a.ts || 9e15) - (b.ts || 9e15))).slice(0, 60);
  await pool(want, 3, async x => { try { x.yt = await youtubeTrailer(x.title); } catch { x.yt = ""; } });
  list.sort((a, b) => (a.ts || 9e15) - (b.ts || 9e15));
  console.log(`releases: ${list.length}, with cover: ${list.filter(x => x.img).length}, trailers: ${list.filter(x => x.yt).length}`);
  return {ts: Date.now(), items: list};
}

/* ---------- main ---------- */
async function loadJson(p, fallback){ try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return fallback; } }
async function remoteJson(u){ if (!SITE) return null; try { return JSON.parse((await get(SITE + u + "?t=" + Date.now(), {tries:1, ms:15000})).text); } catch { return null; } }

const config = await loadJson(path.join(ROOT, "config", "config.json"), {});
const feeds = (config.feeds && config.feeds.length ? config.feeds : DEFAULT_FEEDS).filter(f => f.on);
const favs = config.favs || {};
const FOREIGN = !!config.foreign;   // خبرهای انگلیسی (با ترجمه) هم بیاید؟
const prev = (await remoteJson("/data/news.json")) || {items:[]};
const prevById = new Map((prev.items || []).map(x => [x.id, x]));
const prevMeta = (await remoteJson("/data/meta.json")) || {};
console.log(`feeds: ${feeds.length}, favourites: ${Object.values(favs).flat().length}, foreign: ${FOREIGN}, previous items: ${prevById.size}`);

// اطلاعات هر علاقه‌مندی (اسم فارسی، Steam، سایت، کاور) — تا یک هفته از اجرای قبل استفاده می‌شود
const favList = [];
for (const [cat, list] of Object.entries(favs)) for (const f of list) if (f.terms && f.terms.length) favList.push([f, cat]);
const meta = {};
await pool(favList, 4, async ([f, cat]) => {
  const k = cat + ":" + f.name, old = prevMeta[k];
  meta[k] = old && Date.now() - (old.at || 0) < 7*864e5 ? old : {...await favMeta(f, cat), at: Date.now()};
});
console.log("persian names:", favList.map(([f, c]) => f.name + "=" + (meta[c + ":" + f.name].fa.join("/") || "-")).join(", "));

const searches = [];
for (const [f, cat] of favList){
  const m = meta[cat + ":" + f.name];
  searches.push(...persianSources(f, cat, m));
  if (FOREIGN){ searches.push(...searchSources(f, cat)); searches.push(...await officialSources(f, cat, m)); }
}
const sources = [...feeds, ...searches];
const results = await pool(sources, 5, async src => {
  if (!src.search && igName(src.url)) return (await fetchInstagram(src)).slice(0, PER_FEED);
  const tg = !src.search && tgName(src.url);
  let r;
  for (let t = 0; t < (src.persian ? 4 : 1); t++){   // بینگ گاهی صفحه‌ی خالی می‌دهد
    r = await get(tg ? "https://t.me/s/" + tg : src.url, {tries: src.search ? 3 : 2});
    if (!src.persian || /<item>/.test(r.text)) break;
    await sleep(1500 * (t + 1));
  }
  let items = tg ? parseTelegram(r.text, src) : parseFeed(r.text, src);
  if (src.official){
    items = items.sort((a, b) => b.ts - a.ts).slice(0, 10);
    const app = (src.url.match(/\/app\/(\d+)/) || [])[1];
    if (app) for (const x of items) if (!x.img) x.img = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/" + app + "/header.jpg";
  }
  else if (src.search){
    const terms = src.terms.map(norm).filter(t => t.trim());
    items = items.filter(x => (!src.persian || hasFa(x.title)) && terms.some(t => norm(x.title + " " + x.summary).includes(t)))
                 .sort((a, b) => b.ts - a.ts).slice(0, PER_SEARCH);
    if (src.persian) for (const x of items) x.lang = "fa";
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
// اگر برای علاقه‌مندی‌ای خبر فارسی کم بود (مثلاً یک انیمیشن یا استودیو خارجی)، از منابع خارجی کمک بگیر
if (!FOREIGN){
  const cnt = {}; for (const x of found) cnt[x.fav] = (cnt[x.fav] || 0) + 1;
  const weak = favList.filter(([f]) => (cnt[f.name] || 0) < 4);
  const extra = weak.flatMap(([f, cat]) => searchSources(f, cat));
  const more = await pool(extra, 4, async src => {
    const r = await get(src.url, {tries:3});
    const terms = src.terms.map(norm).filter(t => t.trim());
    return parseFeed(r.text, src).filter(x => terms.some(t => norm(x.title + " " + x.summary).includes(t)))
      .sort((a, b) => b.ts - a.ts).slice(0, 8).map(x => ({...x, fallback:true}));
  });
  for (const r of more) if (Array.isArray(r)) found.push(...r);
  console.log("foreign fallback for:", weak.map(([f]) => f.name).join(", ") || "none");
}
console.log("search results:", Object.entries(found.reduce((o, x) => (o[x.fav] = (o[x.fav] || 0) + 1, o), {})).map(e => e.join("=")).join(", "));

feedItems = feedItems.sort((a, b) => b.ts - a.ts).slice(0, MAX_FEED_ITEMS);

// خبرهای منابع عادی که به یک علاقه‌مندی مربوط‌اند (با اسم انگلیسی یا فارسی)
const favTerms = favList.map(([f, cat]) => ({cat, name:f.name,
  terms:[...f.terms, ...meta[cat + ":" + f.name].fa.flatMap(n => [n, toFaDigits(n), toEnDigits(n)])].map(norm).filter(t => t.trim().length >= 3)}));
for (const x of feedItems){
  const text = norm(x.title + " " + x.summary);
  const hit = favTerms.find(f => f.terms.some(t => text.includes(t)));
  if (hit){ x.fav = hit.name; x.favCat = hit.cat; }
}

const prevByGLink = new Map((prev.items || []).filter(x => x.glink).map(x => [x.glink, x.link]));
await pool(found.filter(x => /news\.google\.com/.test(x.link)), 4, async x => {
  x.glink = x.link;
  if (prevByGLink.has(x.link)){ x.link = prevByGLink.get(x.link); return; }
  try { x.link = await decodeGoogle(x.link); } catch {}
});
found = found.filter(x => !/news\.google\.com/.test(x.link) && !BLOCKED.test(host(x.link)));

let all = [...feedItems, ...found];
for (const x of all) x.id = hash(x.link);
const seen = new Set(), seenT = new Set();
all = all.filter(x => { const t = norm(x.title).trim(); if (seen.has(x.id) || seenT.has(t)) return false; seen.add(x.id); seenT.add(t); return true; })
         .sort((a, b) => b.ts - a.ts);

await fs.mkdir(path.join(OUT, "a"), {recursive:true});
const fresh = [];
for (const x of all){
  if (x._tg){
    const old = prevById.get(x.id);
    if (x._tg.length){ x.full = true; await fs.writeFile(path.join(OUT, "a", x.id + ".json"), JSON.stringify({id:x.id, url:x.link, blocks:x._tg})); }
    if (!x.img && old) x.img = old.img;
    x.checked = true; continue;
  }
  if (x.official){
    const blocks = cleanArticle(x._html || "", x.link);
    const words = blocks.filter(b => b.t !== "img").reduce((n, b) => n + b.x.split(" ").length, 0);
    if (words >= 30){ x.full = true; await fs.writeFile(path.join(OUT, "a", x.id + ".json"), JSON.stringify({id:x.id, url:x.link, blocks})); }
    if (!x.img){ const im = blocks.find(b => b.t === "img"); if (im) x.img = im.s; }
    x.checked = true; continue;
  }
  // سایت‌های ایرانی از خارج باز نمی‌شوند؛ عکس و خلاصه‌ی بینگ کافی است
  if (x.lang === "fa"){ if (x.img && /bing\.com\/th/.test(x.img)) x.img = x.img.replace(/&w=\d+&h=\d+/, "&w=960&h=540"); x.checked = true; continue; }
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
    if (a.blocks.length){ x.full = true; await fs.writeFile(path.join(OUT, "a", x.id + ".json"), JSON.stringify({id:x.id, url:a.url, blocks:a.blocks})); }
    enriched++;
  } catch {}
  x.checked = true;
});

// هر خبر باید کاور داشته باشد: عکس خودش، وگرنه کاور علاقه‌مندی‌اش، وگرنه کنار گذاشته می‌شود
for (const x of all){
  if (!x.img && x.fav){ const m = meta[(x.favCat || x.cat) + ":" + x.fav]; const f = (favs[x.favCat || x.cat] || []).find(y => y.name === x.fav);
    x.img = (m && m.art) || (f && f.img) || ""; if (x.img) x.cover = "fav"; }
  delete x.terms; delete x._html; delete x._tg;
}
const noCover = all.filter(x => !x.img).length;
all = all.filter(x => x.img);
console.log(`enriched: ${enriched}, dropped without cover: ${noCover}, kept: ${all.length}, full text: ${all.filter(x => x.full).length}`);

await fs.writeFile(path.join(OUT, "meta.json"), JSON.stringify(meta));
try {
  const favNames = new Set((favs.game || []).map(f => norm(f.name)));
  await fs.writeFile(path.join(OUT, "releases.json"), JSON.stringify(await buildReleases(favNames)));
} catch(e){ console.log("releases error", e.message); }
await fs.writeFile(path.join(OUT, "news.json"), JSON.stringify({ts: Date.now(), items: all, failed}));
