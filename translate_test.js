(async () => {
  async function libreTranslate(text, endpoint) {
    const res = await fetch(`${endpoint}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: 'ru', target: 'en', format: 'text' })
    });
    const data = await res.json();
    return data.translatedText;
  }
  const endpoints = ['https://translate.astian.org', 'https://libretranslate.com'];
  for (const ep of endpoints) {
    try {
      const t = await libreTranslate('Здравствуйте! Как дела?', ep);
      console.log(ep, '=>', t);
    } catch (e) {
      console.log(ep, 'failed', e.message);
    }
  }
})();