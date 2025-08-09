const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const INPUT = path.resolve(__dirname, 'index.html');
const OUTPUT = path.resolve(__dirname, 'INDEX.HTML');

function shouldSkipNode(node) {
  if (!node) return true;
  const nodeName = node.nodeName ? node.nodeName.toLowerCase() : '';
  return nodeName === 'script' || nodeName === 'style' || nodeName === 'noscript';
}

function isMeaningfulText(text) {
  if (!text) return false;
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return false;
  if (/^[\p{P}\p{S}0-9]+$/u.test(trimmed)) return false;
  return true;
}

function collectTextNodes(document) {
  const textNodes = [];
  const walker = document.createTreeWalker(document, document.defaultView.NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || shouldSkipNode(parent)) continue;
    if (isMeaningfulText(node.nodeValue)) textNodes.push(node);
  }
  return textNodes;
}

function collectAttrNodes(document) {
  const attrs = [];
  const candidates = ['title', 'alt', 'placeholder', 'aria-label', 'aria-title', 'aria-placeholder'];
  document.querySelectorAll('*').forEach((el) => {
    if (shouldSkipNode(el)) return;
    for (const attr of candidates) {
      if (el.hasAttribute(attr)) {
        const val = el.getAttribute(attr);
        if (isMeaningfulText(val)) attrs.push({ el, attr, val });
      }
    }
  });
  return attrs;
}

async function libreTranslate(text, endpoint) {
  const res = await fetch(`${endpoint}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: 'ru', target: 'en', format: 'text' })
  });
  if (!res.ok) {
    throw new Error(`LibreTranslate error ${res.status}`);
  }
  const data = await res.json();
  if (typeof data.translatedText !== 'string') throw new Error('Invalid response');
  return data.translatedText;
}

async function translateChunk(chunk) {
  const delimiter = '\n@@SEP@@\n';
  const joined = chunk.join(delimiter);
  const endpoints = [
    'https://translate.astian.org',
    'https://libretranslate.com'
  ];
  for (const ep of endpoints) {
    try {
      const translated = await libreTranslate(joined, ep);
      const parts = translated.split('@@SEP@@');
      if (parts.length === chunk.length) return parts.map((s) => s.replace(/^\n|\n$/g, ''));
    } catch (e) {
      // try next endpoint
    }
  }
  // Fallback: return originals
  return chunk;
}

async function main() {
  const html = fs.readFileSync(INPUT, 'utf8');
  const dom = new JSDOM(html);
  const { document } = dom.window;

  const htmlEl = document.documentElement;
  if (htmlEl && htmlEl.getAttribute('lang') === 'ru') htmlEl.setAttribute('lang', 'en');

  const textNodes = collectTextNodes(document);
  const attrNodes = collectAttrNodes(document);

  const toTranslate = new Map();
  const add = (s) => { const k = s.replace(/\s+/g, ' ').trim(); if (!toTranslate.has(k)) toTranslate.set(k, null); };
  textNodes.forEach((n) => add(n.nodeValue));
  attrNodes.forEach(({ val }) => add(val));

  const originals = Array.from(toTranslate.keys());

  const CHUNK_SIZE = 8;
  for (let i = 0; i < originals.length; i += CHUNK_SIZE) {
    const chunk = originals.slice(i, i + CHUNK_SIZE);
    const translated = await translateChunk(chunk);
    translated.forEach((t, idx) => toTranslate.set(chunk[idx], t));
    // small delay to be polite
    await new Promise((r) => setTimeout(r, 500));
  }

  textNodes.forEach((n) => {
    const orig = n.nodeValue;
    const key = orig.replace(/\s+/g, ' ').trim();
    const tr = toTranslate.get(key);
    if (tr && tr !== key) {
      const leading = orig.match(/^\s*/)[0];
      const trailing = orig.match(/\s*$/)[0];
      n.nodeValue = leading + tr + trailing;
    }
  });

  attrNodes.forEach(({ el, attr, val }) => {
    const key = val.replace(/\s+/g, ' ').trim();
    const tr = toTranslate.get(key);
    if (tr && tr !== key) el.setAttribute(attr, tr);
  });

  fs.writeFileSync(OUTPUT, dom.serialize(), 'utf8');
  console.log('Translated file written to', OUTPUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});