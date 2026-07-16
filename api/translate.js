// Vercel 서버리스 — 번역 프록시
// DEEPL_KEY 있으면 DeepL(고품질), 없으면 MyMemory(무료·키 불필요)로 자동 폴백
export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    const { text, source, target } = body || {};
    if (!text || !String(text).trim()) { res.status(400).json({ error: 'text 필요' }); return; }
    const src = (source || 'ko').toLowerCase();
    const tgt = (target || 'ja').toLowerCase();
    const key = (process.env.DEEPL_KEY || '').trim();
    try {
        // 1) DeepL (키 있을 때)
        if (key) {
            const endpoint = process.env.DEEPL_URL || (key.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate');
            const map = { ko: 'KO', ja: 'JA', en: 'EN-US', zh: 'ZH' };
            const params = new URLSearchParams();
            params.append('text', String(text));
            params.append('target_lang', map[tgt] || 'JA');
            if (map[src]) params.append('source_lang', (map[src]).split('-')[0]);
            const r = await fetch(endpoint, { method: 'POST', headers: { 'Authorization': 'DeepL-Auth-Key ' + key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
            const data = await r.json().catch(() => ({}));
            if (r.ok && data.translations && data.translations[0]) { res.status(200).json({ translated: data.translations[0].text, engine: 'deepl' }); return; }
            // 실패 시 무료 폴백으로 진행
        }
        // 2) MyMemory (무료·키 불필요, 익명 요청당 500자)
        const langpair = `${src}|${tgt}`;
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(String(text).slice(0, 500))}&langpair=${encodeURIComponent(langpair)}`;
        const r2 = await fetch(url);
        const d2 = await r2.json().catch(() => ({}));
        const translated = (d2 && d2.responseData && d2.responseData.translatedText) || '';
        if (!translated) { res.status(502).json({ error: '번역 실패', detail: d2 }); return; }
        res.status(200).json({ translated, engine: 'mymemory' });
    } catch (e) { res.status(500).json({ error: String(e) }); }
}
