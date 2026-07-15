// Vercel 서버리스 — Papago(NCP) 번역 프록시
// 환경변수: PAPAGO_ID (X-NCP-APIGW-API-KEY-ID), PAPAGO_SECRET (X-NCP-APIGW-API-KEY)
// 선택: PAPAGO_URL (기본 NCP 텍스트번역 엔드포인트)
export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    const { text, source, target } = body || {};
    if (!text || !String(text).trim()) { res.status(400).json({ error: 'text 필요' }); return; }
    const id = process.env.PAPAGO_ID, secret = process.env.PAPAGO_SECRET;
    if (!id || !secret) { res.status(500).json({ error: 'PAPAGO 키 미설정 — Vercel 환경변수 PAPAGO_ID / PAPAGO_SECRET 등록 필요' }); return; }
    const url = process.env.PAPAGO_URL || 'https://naveropenapi.apigw.ntruss.com/nmt/v1/translation';
    try {
        const params = new URLSearchParams({ source: source || 'ko', target: target || 'ja', text: String(text) });
        const r = await fetch(url, {
            method: 'POST',
            headers: {
                'X-NCP-APIGW-API-KEY-ID': id,
                'X-NCP-APIGW-API-KEY': secret,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { res.status(r.status).json({ error: 'papago 오류', detail: data }); return; }
        const translated = (data && data.message && data.message.result && data.message.result.translatedText) || '';
        res.status(200).json({ translated });
    } catch (e) { res.status(500).json({ error: String(e) }); }
}
