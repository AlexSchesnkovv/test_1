const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const translate = require('google-translate-api-x');

const INPUT = path.resolve(__dirname, 'index.html');
const OUTPUT = path.resolve(__dirname, 'INDEX.HTML');

function shouldSkipNode(node) {
  if (!node) return true;
  // Skip script/style and their descendants
  const nodeName = node.nodeName ? node.nodeName.toLowerCase() : '';
  if (nodeName === 'script' || nodeName === 'style' || nodeName === 'noscript') return true;
  return false;
}

function isMeaningfulText(text) {
  if (!text) return false;
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return false;
  // Skip pure punctuation or numbers
  if (/^[\p{P}\p{S}0-9]+$/u.test(trimmed)) return false;
  return true;
}

function collectTextNodes(root) {
  const textNodes = [];
  const walker = root.createTreeWalker(root, root.defaultView.NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || shouldSkipNode(parent)) continue;
    const text = node.nodeValue;
    if (isMeaningfulText(text)) {
      textNodes.push(node);
    }
  }
  return textNodes;
}

function collectAttrNodes(document) {
  const attrs = [];
  const candidates = [
    'title', 'alt', 'placeholder', 'aria-label', 'aria-title', 'aria-placeholder'
  ];
  document.querySelectorAll('*').forEach((el) => {
    if (shouldSkipNode(el)) return;
    for (const attr of candidates) {
      if (el.hasAttribute(attr)) {
        const val = el.getAttribute(attr);
        if (isMeaningfulText(val)) {
          attrs.push({ el, attr, val });
        }
      }
    }
  });
  return attrs;
}

async function main() {
  const html = fs.readFileSync(INPUT, 'utf8');
  const dom = new JSDOM(html);
  const { document } = dom.window;

  // Update lang attribute
  const htmlEl = document.documentElement;
  if (htmlEl && htmlEl.getAttribute('lang') === 'ru') {
    htmlEl.setAttribute('lang', 'en');
  }

  const textNodes = collectTextNodes(document);
  const attrNodes = collectAttrNodes(document);

  // Build a unique list of strings to translate to reduce API calls
  const toTranslateSet = new Map();
  const pushUnique = (s) => {
    const key = s.replace(/\s+/g, ' ').trim();
    if (!toTranslateSet.has(key)) toTranslateSet.set(key, null);
  };

  textNodes.forEach((n) => pushUnique(n.nodeValue));
  attrNodes.forEach(({ val }) => pushUnique(val));

  const originals = Array.from(toTranslateSet.keys());

  // Chunk requests to avoid rate limits; translate only Russian to English
  async function translateChunk(chunk) {
    // Join with delimiter to keep positions
    const delimiter = '\n@@SEP@@\n';
    const text = chunk.join(delimiter);
    try {
      const res = await translate(text, { from: 'ru', to: 'en' });
      const out = res.text.split('@@SEP@@');
      if (out.length !== chunk.length) {
        // Fallback: try per-string
        const per = [];
        for (const s of chunk) {
          try {
            const r = await translate(s, { from: 'ru', to: 'en' });
            per.push(r.text);
          } catch (e) {
            per.push(s);
          }
        }
        return per;
      }
      return out.map((s) => s.replace(/^\n|\n$/g, ''));
    } catch (e) {
      // On error, return originals for this chunk
      return chunk;
    }
  }

  const CHUNK_SIZE = 25;
  for (let i = 0; i < originals.length; i += CHUNK_SIZE) {
    const chunk = originals.slice(i, i + CHUNK_SIZE);
    const translated = await translateChunk(chunk);
    translated.forEach((t, idx) => {
      toTranslateSet.set(chunk[idx], t);
    });
  }

  // Apply translations back
  textNodes.forEach((n) => {
    const key = n.nodeValue.replace(/\s+/g, ' ').trim();
    const tr = toTranslateSet.get(key);
    if (tr && tr !== key) {
      // Preserve leading/trailing whitespace from original
      const leading = n.nodeValue.match(/^\s*/)[0];
      const trailing = n.nodeValue.match(/\s*$/)[0];
      n.nodeValue = leading + tr + trailing;
    }
  });

  attrNodes.forEach(({ el, attr, val }) => {
    const key = val.replace(/\s+/g, ' ').trim();
    const tr = toTranslateSet.get(key);
    if (tr && tr !== key) {
      el.setAttribute(attr, tr);
    }
  });

  // Write output
  fs.writeFileSync(OUTPUT, dom.serialize(), 'utf8');
  console.log('Translated file written to', OUTPUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});