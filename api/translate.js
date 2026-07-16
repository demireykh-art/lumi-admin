// Vercel 서버리스 — DeepL 번역 프록시
// 환경변수: DEEPL_KEY (DeepL Authentication Key)
//   무료 키는 끝이 ':fx' → api-free 엔드포인트 자동 사용
// 선택: DEEPL_URL (엔드포인트 강제 지정 시)
export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    const { text, source, target } = body || {};
    if (!text || !String(text).trim()) { res.status(400).json({ error: 'text 필요' }); return; }
    const key = (process.env.DEEPL_KEY || '').trim();
    if (!key) { res.status(500).json({ error: 'DEEPL_KEY 미설정 — Vercel 환경변수 DEEPL_KEY 등록 필요' }); return; }
    const endpoint = process.env.DEEPL_URL || (key.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate');
    const map = { ko: 'KO', ja: 'JA', en: 'EN-US', zh: 'ZH' };
    const tgt = map[(target || 'ja').toLowerCase()] || 'JA';
    const src = map[(source || '').toLowerCase()]; // 없으면 DeepL 자동감지
    try {
        const params = new URLSearchParams();
        params.append('text', String(text));
        params.append('target_lang', tgt);
        if (src) params.append('source_lang', src.split('-')[0]); // source는 KO/JA/EN/ZH
        const r = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': 'DeepL-Auth-Key ' + key,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { res.status(r.status).json({ error: 'deepl 오류(' + r.status + ')', detail: data }); return; }
        const translated = (data && data.translations && data.translations[0] && data.translations[0].text) || '';
        res.status(200).json({ translated });
    } catch (e) { res.status(500).json({ error: String(e) }); }
}
