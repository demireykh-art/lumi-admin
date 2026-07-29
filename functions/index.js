/**
 * Cloud Functions for lumiclinic-c1a95
 *
 * resetUserPassword (HTTPS Callable):
 *   - 호출자가 settings/bizAdmins.emails 화이트리스트의 비즈관리자인지 검증
 *   - 대상 이메일의 Firebase Auth 비밀번호를 새 값으로 설정
 *   - employees doc(같은 이메일)에 mustChangePassword:true 플래그 설정 →
 *     직원이 임시 비번으로 첫 로그인 시 본인이 직접 새 비번 설정 강제
 */
const {onCall, onRequest, HttpsError} = require('firebase-functions/v2/https');
const {logger} = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

exports.resetUserPassword = onCall(
  {region: 'asia-northeast3', cors: true},
  async (request) => {
    // 1) 인증 체크
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    }
    const callerEmail = String(request.auth.token.email || '').toLowerCase();
    if (!callerEmail) {
      throw new HttpsError('permission-denied', '이메일이 확인되지 않습니다.');
    }

    // 2) 비즈관리자 화이트리스트 확인
    const adminsDoc = await admin.firestore().collection('settings').doc('bizAdmins').get();
    const allowed = (adminsDoc.exists && Array.isArray(adminsDoc.data().emails))
      ? adminsDoc.data().emails.map((e) => String(e).toLowerCase())
      : [];
    if (!allowed.includes(callerEmail)) {
      logger.warn(`Unauthorized password reset attempt by ${callerEmail}`);
      throw new HttpsError('permission-denied', '경영관리자 권한이 없습니다.');
    }

    // 3) 입력 검증
    const targetEmail = String((request.data && request.data.email) || '').trim().toLowerCase();
    const newPassword = String((request.data && request.data.newPassword) || '');
    if (!targetEmail) {
      throw new HttpsError('invalid-argument', '대상 이메일이 필요합니다.');
    }
    if (newPassword.length < 6) {
      throw new HttpsError('invalid-argument', '비밀번호는 6자 이상이어야 합니다.');
    }

    // 4) 자기 자신은 거부 (본인 비번은 staff 앱/Firebase Auth로 직접 변경)
    if (targetEmail === callerEmail) {
      throw new HttpsError('failed-precondition', '본인 비밀번호는 이 기능으로 변경할 수 없습니다.');
    }

    // 5) 사용자 조회 + 비밀번호 갱신 (없으면 옵션에 따라 생성)
    const createIfMissing = !!(request.data && request.data.createIfMissing);
    const addToStaffWhitelist = !!(request.data && request.data.addToStaffWhitelist);
    let user;
    let created = false;
    try {
      user = await admin.auth().getUserByEmail(targetEmail);
    } catch (e) {
      if (createIfMissing) {
        try {
          user = await admin.auth().createUser({email: targetEmail, password: newPassword});
          created = true;
          logger.info(`New user created by ${callerEmail}: ${targetEmail} (uid=${user.uid})`);
        } catch (ce) {
          logger.error('createUser failed:', ce);
          throw new HttpsError('internal', '계정 생성 실패: ' + (ce.message || ce.code || String(ce)));
        }
      } else {
        logger.warn(`User not found for password reset: ${targetEmail}`, e);
        throw new HttpsError('not-found', `Firebase Auth에 ${targetEmail} 사용자가 없습니다.`);
      }
    }
    if (!created) {
      await admin.auth().updateUser(user.uid, {password: newPassword});
    }

    // 5-1) 공용 staff 화이트리스트에 추가 (신규 계정 등록 시)
    let whitelistAdded = false;
    if (addToStaffWhitelist) {
      try {
        const staffDoc = await admin.firestore().collection('settings').doc('staff').get();
        const cur = (staffDoc.exists && Array.isArray(staffDoc.data().emails))
          ? staffDoc.data().emails.slice() : [];
        const lower = cur.map((e) => String(e).toLowerCase());
        if (!lower.includes(targetEmail)) {
          cur.push(targetEmail);
          await admin.firestore().collection('settings').doc('staff')
            .set({emails: cur}, {merge: true});
          whitelistAdded = true;
        }
      } catch (we) {
        logger.warn('whitelist add failed:', we);
      }
    }

    // 6) employees doc에 mustChangePassword:true 플래그 설정
    let flagSet = false;
    try {
      const empSnap = await admin.firestore()
        .collection('employees')
        .where('email', '==', targetEmail)
        .limit(1)
        .get();
      if (!empSnap.empty) {
        await empSnap.docs[0].ref.update({mustChangePassword: true});
        flagSet = true;
      }
    } catch (e) {
      logger.warn(`mustChangePassword flag set failed for ${targetEmail}`, e);
    }

    logger.info(`Password reset by ${callerEmail} for ${targetEmail} (uid=${user.uid}, created=${created}, whitelistAdded=${whitelistAdded})`);
    return {success: true, email: targetEmail, uid: user.uid, mustChangePasswordSet: flagSet, created, whitelistAdded};
  }
);

// ================================================================
//  💬 고객 채팅 웹훅 (카카오 상담톡 · 네이버 톡톡)
//   · 실제 페이로드 구조는 심사 통과 후 각 플랫폼 문서로 확정
//   · 아래는 예상 필드 기준 스텁 — 심사 통과 시 필드 매핑만 조정
// ================================================================

// 스레드 찾거나 생성
async function _findOrCreateThread(provider, externalId, displayName, text) {
  const q = await admin.firestore().collection('chatThreads')
    .where('provider', '==', provider)
    .where('externalThreadId', '==', externalId).limit(1).get();
  const now = new Date().toISOString();
  if (!q.empty) {
    const ref = q.docs[0].ref;
    await ref.update({
      unreadCount: admin.firestore.FieldValue.increment(1),
      lastMessageAt: now,
      lastMessagePreview: String(text || '').slice(0, 60),
      updatedAt: now,
    });
    return ref;
  }
  const ref = admin.firestore().collection('chatThreads').doc();
  await ref.set({
    provider,
    externalThreadId: externalId,
    displayName: displayName || externalId,
    status: 'active',
    unreadCount: 1,
    lastMessageAt: now,
    lastMessagePreview: String(text || '').slice(0, 60),
    createdAt: now,
  });
  return ref;
}

// 카카오 상담톡 웹훅
// 실제 payload 예시(심사 통과 시 확정): { user_key, content, message_id, user_name, ... }
exports.webhookKakao = onRequest(
  {region: 'asia-northeast3', cors: false},
  async (req, res) => {
    try {
      // TODO: 서명 검증 — 심사 통과 후 카카오 시크릿으로 HMAC 확인
      // const signature = req.headers['x-kakao-signature'];
      // if (!_verifyKakaoSig(req.rawBody, signature)) return res.status(401).send('bad sig');

      const body = req.body || {};
      const externalId = body.user_key || body.userId || body.senderId;
      const text = body.content || body.text || body.message;
      if (!externalId || !text) {
        logger.warn('Kakao webhook missing fields', body);
        return res.status(400).send('missing fields');
      }
      const ref = await _findOrCreateThread('kakao', externalId, body.user_name || body.senderName, text);
      await ref.collection('messages').add({
        direction: 'in',
        text: String(text),
        externalMsgId: body.message_id || null,
        createdAt: new Date().toISOString(),
      });
      // TODO: 자동응답 (오프타임) — settings/chatConfig 참고
      res.status(200).send('ok');
    } catch (e) {
      logger.error('webhookKakao error', e);
      res.status(500).send('error');
    }
  }
);

// 네이버 톡톡 웹훅
// 실제 payload 예시(심사 통과 시 확정): { event, user, textContent, ... }
exports.webhookNaver = onRequest(
  {region: 'asia-northeast3', cors: false},
  async (req, res) => {
    try {
      const body = req.body || {};
      // 네이버는 event 종류가 여러가지 — send 만 처리
      if (body.event && body.event !== 'send') {
        return res.status(200).send('ignored');
      }
      const externalId = body.user || body.userId;
      const text = (body.textContent && body.textContent.text) || body.text || body.message;
      if (!externalId || !text) {
        logger.warn('Naver webhook missing fields', body);
        return res.status(400).send('missing fields');
      }
      const ref = await _findOrCreateThread('naver', externalId, body.userName || externalId, text);
      await ref.collection('messages').add({
        direction: 'in',
        text: String(text),
        externalMsgId: body.messageId || null,
        createdAt: new Date().toISOString(),
      });
      res.status(200).send('ok');
    } catch (e) {
      logger.error('webhookNaver error', e);
      res.status(500).send('error');
    }
  }
);

// 스태프 답변 전송 (통합앱 → 카카오/네이버)
exports.sendChatReply = onCall(
  {region: 'asia-northeast3', cors: true},
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '로그인 필요');
    const {threadId, text} = request.data || {};
    if (!threadId || !text) throw new HttpsError('invalid-argument', 'threadId·text 필요');

    const doc = await admin.firestore().collection('chatThreads').doc(threadId).get();
    if (!doc.exists) throw new HttpsError('not-found', '스레드 없음');
    const thread = doc.data();

    // TODO: 심사 통과 후 실제 API 호출로 대체
    // if (thread.provider === 'kakao') { await _kakaoSendReply(thread.externalThreadId, text); }
    // else if (thread.provider === 'naver') { await _naverSendReply(thread.externalThreadId, text); }
    // else { logger.info('mock provider — skip real send'); }

    logger.info(`sendChatReply stub: provider=${thread.provider} thread=${threadId} text.len=${text.length}`);
    return {ok: true, provider: thread.provider, sent: false, stub: true};
  }
);
