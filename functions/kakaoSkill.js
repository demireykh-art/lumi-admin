/**
 * 카카오 오픈빌더 스킬서버 (챗봇) — docs/kakao-chatbot.md Phase 1
 *
 *  · 카카오채널 오픈빌더 봇의 "스킬 서버"로 연결되는 HTTPS 엔드포인트.
 *    오픈빌더가 사용자 발화(utterance)를 이 함수로 보내면, 우리가 응답 JSON을
 *    만들어 돌려준다(= 자동응대). 동시에 대화·태그를 chatThreads 에 적재한다.
 *
 *  · 상담톡 웹훅(index.js webhookKakao)과는 다른 통합/스펙이라 별도 파일·엔드포인트.
 *    이 파일은 카카오 챗봇(통합앱) 세션 소유. index.js 의 webhookKakao/sendChatReply
 *    (상담챗 세션 담당)는 건드리지 않는다.
 *
 *  요청(오픈빌더 SkillPayload):
 *    { userRequest: { utterance, user: { id } }, action: { params }, bot: {...} }
 *  응답(오픈빌더 SkillResponse 2.0):
 *    { version:'2.0', template:{ outputs:[{ simpleText:{ text } }], quickReplies:[...] } }
 *
 *  ⚠️ 카카오는 스킬 응답을 ~5초 내로 요구 → 무거운 작업 금지, 항상 200 + 유효 응답.
 */
const {onRequest} = require('firebase-functions/v2/https');
const {logger} = require('firebase-functions');
const admin = require('firebase-admin');   // index.js 에서 initializeApp() 됨 (핸들러 내에서만 사용)

// ── 기본 봇 설정 (settings/chatBotConfig 로 덮어쓰기 가능) ──────────────
//    실제 병원 정보·시나리오는 관리자에서 수정. 아래는 시작용 시드.
const DEFAULT_CONFIG = {
  // 인텐트 미매칭 시 폴백
  fallback: '문의 주셔서 감사합니다 😊 담당 상담원이 확인 후 안내드릴게요. 급하시면 아래 [상담원 연결]을 눌러주세요.',
  // 상담원 연결 요청 시 응답
  agentReply: '상담원 연결을 요청하셨어요 🙏 순차적으로 확인 후 답변드리겠습니다.',
  agentKeywords: ['상담원', '상담사', '사람', '직원', '연결', '전화'],
  // 모든 응답에 붙는 기본 퀵버튼
  defaultQuickReplies: ['상담원 연결'],
  // 인텐트: keywords 중 하나라도 발화에 포함되면 매칭 (공백 무시, 부분일치)
  //   reply(응답) · tags(스레드 태그) · interests(관심사) · procInterest(procId) · quickReplies
  intents: [
    {
      key: 'hours',
      keywords: ['영업', '운영', '시간', '몇시', '오픈', '마감', '휴무', '주말', '일요일', '토요일'],
      reply: '평일 오전 10시~오후 7시 / 토요일 오전 10시~오후 4시 진료합니다. (일·공휴일 휴무)\n※ 실제 진료시간에 맞게 관리자에서 수정해 주세요.',
      tags: ['영업시간문의'],
    },
    {
      key: 'location',
      keywords: ['위치', '주소', '어디', '오시는', '주차', '지하철', '역', '길'],
      reply: '오시는 길·주차 안내입니다. (관리자에서 실제 정보로 수정해 주세요)',
      tags: ['위치문의'],
    },
    {
      key: 'price',
      keywords: ['가격', '비용', '얼마', '금액', '견적', '할인', '이벤트', '프로모션'],
      reply: '시술 가격은 피부 상태에 따라 달라 상담이 필요해요. 관심 있는 시술을 알려주시면 안내해 드릴게요!',
      tags: ['가격문의'],
      quickReplies: ['보톡스', '필러', '리프팅', '색소·기미'],
    },
    {
      key: 'botox',
      keywords: ['보톡스', '보툴', '사각턱', '승모근', '이마', '미간'],
      reply: '보톡스 상담 도와드릴게요. 원하시는 부위를 알려주시면 맞춤 안내해 드립니다.',
      tags: ['시술관심'],
      interests: ['보톡스'],
      quickReplies: ['예약 문의', '상담원 연결'],
    },
    {
      key: 'filler',
      keywords: ['필러', '팔자', '입술', '코필러', '볼륨'],
      reply: '필러 상담 도와드릴게요. 원하시는 부위를 알려주세요.',
      tags: ['시술관심'],
      interests: ['필러'],
      quickReplies: ['예약 문의', '상담원 연결'],
    },
    {
      key: 'lifting',
      keywords: ['리프팅', '울쎄라', '슈링크', '탄력', '쳐짐', '처짐'],
      reply: '리프팅 상담 도와드릴게요. 고민 부위(볼·턱선·목 등)를 알려주세요.',
      tags: ['시술관심'],
      interests: ['쳐짐'],
      quickReplies: ['예약 문의', '상담원 연결'],
    },
    {
      key: 'pigment',
      keywords: ['색소', '기미', '잡티', '주근깨', '토닝', '레이저'],
      reply: '색소·기미 상담 도와드릴게요. 피부 상태를 알려주시면 안내해 드립니다.',
      tags: ['시술관심'],
      interests: ['색소'],
      quickReplies: ['예약 문의', '상담원 연결'],
    },
    {
      key: 'reserve',
      keywords: ['예약', '방문', '스케줄', '가능한 날', '언제 되'],
      reply: '예약 도와드릴게요 📅 성함과 원하시는 날짜/시간을 남겨주시면 확인 후 연락드립니다.',
      tags: ['예약의향'],
      quickReplies: ['상담원 연결'],
    },
  ],
};

// ── 유틸 ───────────────────────────────────────────────────────────────
function _norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}

function _matchIntent(utterance, cfg) {
  const u = _norm(utterance);
  if (!u) return null;
  for (const it of (cfg.intents || [])) {
    for (const kw of (it.keywords || [])) {
      if (u.includes(_norm(kw))) return it;
    }
  }
  return null;
}

function _isAgentRequest(utterance, cfg) {
  const u = _norm(utterance);
  return (cfg.agentKeywords || []).some((k) => u.includes(_norm(k)));
}

// 오픈빌더 SkillResponse 2.0 빌더
function _skillResponse(text, quickLabels) {
  const resp = {
    version: '2.0',
    template: {outputs: [{simpleText: {text: String(text || '').slice(0, 990)}}]},
  };
  const labels = (quickLabels || []).filter(Boolean).slice(0, 10);
  if (labels.length) {
    resp.template.quickReplies = labels.map((label) => ({
      label: String(label).slice(0, 14),
      action: 'message',
      messageText: String(label),
    }));
  }
  return resp;
}

// 설정 로드 (Firestore 우선, 없으면 기본 시드)
async function _loadConfig(db) {
  try {
    const snap = await db.collection('settings').doc('chatBotConfig').get();
    if (snap.exists && snap.data()) return {...DEFAULT_CONFIG, ...snap.data()};
  } catch (e) {
    logger.warn('chatBotConfig load failed, using default', e);
  }
  return DEFAULT_CONFIG;
}

// 스레드 upsert (결정적 doc id — 조회 비용 없이 동일 사용자 1스레드 유지)
function _threadId(userId) {
  return 'kakao_ob_' + String(userId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
}

// ── 엔드포인트 ─────────────────────────────────────────────────────────
exports.kakaoSkill = onRequest(
  {region: 'asia-northeast3', cors: false},
  async (req, res) => {
    const db = admin.firestore();
    let cfg = DEFAULT_CONFIG;
    try {
      const body = req.body || {};
      const ur = body.userRequest || {};
      const utterance = ur.utterance || '';
      const userId = (ur.user && ur.user.id) || body.userId || '';

      if (!userId) {
        logger.warn('kakaoSkill: missing user id', {hasBody: !!req.body});
        // 유효한 스킬 응답은 돌려줘야 봇이 멈추지 않음
        return res.status(200).json(_skillResponse('일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.'));
      }

      cfg = await _loadConfig(db);

      // 선택적 시크릿 검증 (settings/chatBotConfig.skillSecret 설정 시에만 적용)
      if (cfg.skillSecret && req.get('x-skill-secret') !== cfg.skillSecret) {
        logger.warn('kakaoSkill: bad skill secret');
        return res.status(401).send('unauthorized');
      }

      const now = new Date().toISOString();
      const tRef = db.collection('chatThreads').doc(_threadId(userId));

      // 1) 판정: 상담원 연결 vs 인텐트 vs 폴백
      const agent = _isAgentRequest(utterance, cfg);
      const intent = agent ? null : _matchIntent(utterance, cfg);
      let replyText; let quick = [];
      const addTags = new Set();
      const addInterests = new Set();
      const addProc = new Set();

      if (agent) {
        replyText = cfg.agentReply;
        addTags.add('상담원연결요청');
      } else if (intent) {
        replyText = intent.reply;
        quick = intent.quickReplies || [];
        (intent.tags || []).forEach((t) => addTags.add(t));
        (intent.interests || []).forEach((t) => addInterests.add(t));
        (intent.procInterest || []).forEach((t) => addProc.add(t));
      } else {
        replyText = cfg.fallback;
      }
      // 기본 퀵버튼 보강 (중복 제거)
      quick = Array.from(new Set([...(quick || []), ...(cfg.defaultQuickReplies || [])]));

      // 2) 스레드/메시지/태그 적재
      const snap = await tRef.get();
      const threadUpdate = {
        provider: 'kakao',
        source: 'openbuilder',                 // 상담톡 스레드와 구분
        externalThreadId: userId,
        lastMessageAt: now,
        lastMessagePreview: String(utterance || '').slice(0, 60),
        updatedAt: now,
        unreadCount: admin.firestore.FieldValue.increment(1),
      };
      if (!snap.exists) threadUpdate.createdAt = now;   // 신규 스레드에만
      if (agent) {                                       // 상담원 연결 요청 시에만 표시
        threadUpdate.status = 'needs_human';
        threadUpdate.agentRequested = true;
      }
      // 태그 병합 (arrayUnion — 중복 없이 누적)
      if (addTags.size) threadUpdate.tags = admin.firestore.FieldValue.arrayUnion(...addTags);
      if (addInterests.size) threadUpdate.interests = admin.firestore.FieldValue.arrayUnion(...addInterests);
      if (addProc.size) threadUpdate.procInterest = admin.firestore.FieldValue.arrayUnion(...addProc);

      await tRef.set(threadUpdate, {merge: true});

      // 메시지 2건(사용자 발화 / 봇 응답) 기록
      const msgs = tRef.collection('messages');
      await Promise.all([
        msgs.add({direction: 'in', kind: 'user', text: String(utterance), createdAt: now}),
        msgs.add({direction: 'out', kind: 'bot', text: String(replyText), intent: intent ? intent.key : (agent ? 'agent' : 'fallback'), createdAt: now}),
      ]);

      // 3) 오픈빌더로 응답 반환
      return res.status(200).json(_skillResponse(replyText, quick));
    } catch (e) {
      logger.error('kakaoSkill error', e);
      // 어떤 경우에도 유효한 스킬 응답 (봇이 침묵하지 않도록)
      return res.status(200).json(
        _skillResponse((cfg && cfg.fallback) || '잠시 후 다시 시도해 주세요 🙏'),
      );
    }
  },
);
