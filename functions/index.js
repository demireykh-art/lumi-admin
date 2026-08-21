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

/**
 * updateUserEmail (HTTPS Callable):
 *   직원의 로그인 이메일(Firebase Auth email)을 변경한다.
 *   예) lee@lumi.local → kilno2@naver.com (본인 실제 이메일로 로그인)
 *   - 호출자가 settings/bizAdmins 화이트리스트의 관리자인지 검증
 *   - Auth 사용자 email 변경 (비밀번호는 그대로 유지)
 *   - settings/employees(개인) · settings/staff(공용) 화이트리스트 갱신
 *   - employees 문서(email==old)의 email 필드 갱신
 *   - payslips 문서(authEmail==old)의 authEmail 갱신 → 본인 급여명세서 조회 유지
 */
exports.updateUserEmail = onCall(
  {region: 'asia-northeast3', cors: true},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    }
    const callerEmail = String(request.auth.token.email || '').toLowerCase();
    if (!callerEmail) {
      throw new HttpsError('permission-denied', '이메일이 확인되지 않습니다.');
    }
    const adminsDoc = await admin.firestore().collection('settings').doc('bizAdmins').get();
    const allowed = (adminsDoc.exists && Array.isArray(adminsDoc.data().emails))
      ? adminsDoc.data().emails.map((e) => String(e).toLowerCase())
      : [];
    if (!allowed.includes(callerEmail)) {
      logger.warn(`Unauthorized email change attempt by ${callerEmail}`);
      throw new HttpsError('permission-denied', '경영관리자 권한이 없습니다.');
    }

    const oldEmail = String((request.data && request.data.oldEmail) || '').trim().toLowerCase();
    const newEmail = String((request.data && request.data.newEmail) || '').trim().toLowerCase();
    if (!oldEmail || !newEmail) {
      throw new HttpsError('invalid-argument', '기존/신규 이메일이 모두 필요합니다.');
    }
    if (oldEmail === newEmail) {
      throw new HttpsError('failed-precondition', '기존 이메일과 신규 이메일이 동일합니다.');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) {
      throw new HttpsError('invalid-argument', '신규 이메일 형식이 올바르지 않습니다.');
    }

    // 신규 이메일이 이미 다른 Auth 계정에서 사용 중이면 거부
    try {
      const existing = await admin.auth().getUserByEmail(newEmail);
      if (existing) {
        throw new HttpsError('already-exists', `${newEmail} 은 이미 사용 중인 계정입니다.`);
      }
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      // auth/user-not-found → 사용 가능. 그 외는 통과시키되 아래 update에서 처리.
    }

    // 대상 Auth 계정 조회 + 이메일 변경
    let user;
    try {
      user = await admin.auth().getUserByEmail(oldEmail);
    } catch (e) {
      throw new HttpsError('not-found', `Firebase Auth에 ${oldEmail} 계정이 없습니다.`);
    }
    try {
      await admin.auth().updateUser(user.uid, {email: newEmail});
    } catch (e) {
      logger.error('updateUser email failed:', e);
      throw new HttpsError('internal', '이메일 변경 실패: ' + (e.message || e.code || String(e)));
    }

    const dbx = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;

    // 화이트리스트 갱신 (개인/공용 모두: old 제거, new 추가)
    for (const docId of ['employees', 'staff']) {
      try {
        await dbx.collection('settings').doc(docId).set(
          {emails: FieldValue.arrayRemove(oldEmail)}, {merge: true});
        // 기존에 old가 있었던 화이트리스트에만 new 추가 (개인계정이면 employees에)
      } catch (we) {
        logger.warn(`whitelist ${docId} arrayRemove failed:`, we);
      }
    }
    // 개인계정 화이트리스트에 new 추가
    try {
      await dbx.collection('settings').doc('employees').set(
        {emails: FieldValue.arrayUnion(newEmail)}, {merge: true});
    } catch (we) {
      logger.warn('whitelist employees arrayUnion failed:', we);
    }

    // employees 문서 email 필드 갱신 (old로 등록된 모든 문서)
    let empUpdated = 0;
    try {
      const empSnap = await dbx.collection('employees').where('email', '==', oldEmail).get();
      const batch = dbx.batch();
      empSnap.forEach((d) => {
        batch.update(d.ref, {email: newEmail});
        empUpdated++;
      });
      if (empUpdated > 0) await batch.commit();
    } catch (e) {
      logger.warn('employees email update failed:', e);
    }

    // payslips 문서 authEmail 갱신 (본인 급여명세서 조회 규칙 유지)
    let payslipUpdated = 0;
    try {
      const psSnap = await dbx.collection('payslips').where('authEmail', '==', oldEmail).get();
      const batch = dbx.batch();
      psSnap.forEach((d) => {
        batch.update(d.ref, {authEmail: newEmail});
        payslipUpdated++;
      });
      if (payslipUpdated > 0) await batch.commit();
    } catch (e) {
      logger.warn('payslips authEmail update failed:', e);
    }

    logger.info(`Email changed by ${callerEmail}: ${oldEmail} → ${newEmail} (uid=${user.uid}, emp=${empUpdated}, payslip=${payslipUpdated})`);
    return {success: true, oldEmail, newEmail, uid: user.uid, empUpdated, payslipUpdated};
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

// ================================================================
//  📊 Google Drive 매출 파일 자동 파싱
//   · Service Account (secrets: DRIVE_SERVICE_KEY) 로 인증
//   · 폴더 내 '오더판매내역및환자내역_YYYYMM.xlsx' 파일 목록/파싱
//   · 파싱 결과 → Firestore revenue/{YYYY-MM} 저장
// ================================================================
const {defineSecret} = require('firebase-functions/params');
const DRIVE_SERVICE_KEY = defineSecret('DRIVE_SERVICE_KEY');
const REVENUE_FOLDER_ID = '1BLzrDhy8mvWUa27RsKlwhYV9sOYhG5iI';

async function _getDriveClient() {
  const {google} = require('googleapis');
  const raw = process.env.DRIVE_SERVICE_KEY;
  if (!raw) throw new HttpsError('failed-precondition', 'DRIVE_SERVICE_KEY 시크릿 미설정');
  let key;
  try { key = JSON.parse(raw); }
  catch (e) { throw new HttpsError('failed-precondition', 'DRIVE_SERVICE_KEY JSON 파싱 실패'); }
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  await auth.authorize();
  return google.drive({version: 'v3', auth});
}

async function _checkAdminHigh(email) {
  const e = String(email || '').toLowerCase();
  if (!e) return false;
  try {
    const doc = await admin.firestore().collection('settings').doc('adminHigh').get();
    const list = (doc.exists && Array.isArray(doc.data().emails))
      ? doc.data().emails.map(x => String(x).toLowerCase()) : [];
    return list.includes(e);
  } catch (_) { return false; }
}

// 폴더 파일 목록 (오더판매내역및환자내역_YYYYMM.xlsx)
exports.listRevenueFiles = onCall(
  {region: 'asia-northeast3', cors: true, secrets: [DRIVE_SERVICE_KEY]},
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '로그인 필요');
    const email = String(request.auth.token.email || '').toLowerCase();
    if (!(await _checkAdminHigh(email))) {
      throw new HttpsError('permission-denied', '대표원장 권한 필요');
    }
    const drive = await _getDriveClient();
    const res = await drive.files.list({
      q: `'${REVENUE_FOLDER_ID}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id,name,modifiedTime,size,mimeType)',
      pageSize: 100,
      orderBy: 'name desc',
    });
    const files = (res.data.files || []).map(f => {
      const m = String(f.name || '').match(/오더판매내역및환자내역_(\d{6})\.xlsx/);
      return {
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime,
        size: Number(f.size || 0),
        ym: m ? `${m[1].slice(0,4)}-${m[1].slice(4,6)}` : null,
      };
    }).filter(f => f.ym);
    return {files};
  }
);

// 특정 파일 다운로드 + 파싱 + Firestore 저장
exports.parseRevenueFile = onCall(
  {region: 'asia-northeast3', cors: true, timeoutSeconds: 300, memory: '1GiB', secrets: [DRIVE_SERVICE_KEY]},
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '로그인 필요');
    const email = String(request.auth.token.email || '').toLowerCase();
    if (!(await _checkAdminHigh(email))) {
      throw new HttpsError('permission-denied', '대표원장 권한 필요');
    }
    const {fileId, ym} = request.data || {};
    if (!fileId || !ym) throw new HttpsError('invalid-argument', 'fileId·ym 필요');

    // Drive 파일 다운로드 (버퍼)
    const drive = await _getDriveClient();
    const fileRes = await drive.files.get(
      {fileId, alt: 'media'},
      {responseType: 'arraybuffer'}
    );
    const buffer = Buffer.from(fileRes.data);

    // xlsx 파싱
    const XLSX = require('xlsx');
    const wb = XLSX.read(buffer, {type: 'buffer'});
    const sheetName = wb.SheetNames.find(n => n.includes('오더별환자')) || wb.SheetNames[1] || wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    // 2행이 헤더, 3행부터 데이터
    const rows = XLSX.utils.sheet_to_json(sheet, {header: 1, range: 1, defval: ''});
    if (!rows || rows.length < 2) {
      throw new HttpsError('failed-precondition', '시트에서 데이터를 찾지 못했습니다.');
    }
    const header = rows[0];
    const colIdx = (label) => header.findIndex(h => String(h || '').trim() === label);
    const COL = {
      chartNo: colIdx('차트번호'),
      name: colIdx('이름'),
      doctor: colIdx('진료의명'),
      staff: colIdx('담당직원'),
      code: colIdx('코드'),
      orderName: colIdx('오더명'),
      amount: colIdx('금액'),
      nationality: colIdx('국적'),
      vat: colIdx('부가세'),
      division: colIdx('구분'),
    };
    if (COL.amount < 0) throw new HttpsError('failed-precondition', "'금액' 컬럼 미발견");

    // 데이터 행 (마지막 '합계' 행 제외)
    const dataRows = [];
    let totalFromSum = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const chartVal = String(r[COL.chartNo] || '').trim();
      const first = String(r[0] || '').trim();
      if (String(r[COL.name] || '').includes('합') || first === '합계') {
        totalFromSum = Number(r[COL.amount]) || 0;
        continue;
      }
      if (!chartVal && !r[COL.name]) continue;
      dataRows.push(r);
    }

    // 집계 — admin(revenue.js) 스키마 그대로
    let totalRevenue = 0;
    let totalJapan = 0;
    let totalNonInsurance = 0;
    let transactions = 0;
    const patientsSet = new Set();
    const nonInsurancePatientsSet = new Set();
    const japanPatientsSet = new Set();
    const doctorSales = {};       // {name: {count, amount, patients:Set}}
    const staffSales = {};        // {name: {count, amount, patients:Set, niAmount, niPatients:Set}}
    const japanStaffSales = {};   // {name: {amount}} — patients 는 나중에 총 일본인 방문객으로 채움
    const treatmentCounts = {};   // {orderName: count}
    const codeSales = {};         // {code: {amount, count}} — 대분류 매핑 원천 (통합앱 신규)

    for (const r of dataRows) {
      const amt = Number(r[COL.amount]) || 0;
      if (amt <= 0) continue; // admin 과 동일: 0 이하 스킵

      totalRevenue += amt;
      transactions++;

      const staff = String(r[COL.staff] || '').trim();
      const doctor = String(r[COL.doctor] || '').trim();
      const nation = String(r[COL.nationality] || '').trim();
      const chart = String(r[COL.chartNo] || '').trim();
      const code = String(r[COL.code] || '').trim();
      const vat = COL.vat >= 0 ? String(r[COL.vat] || '').trim() : '';
      const isNonInsurance = (vat === 'O');
      const orderName = COL.orderName >= 0 ? String(r[COL.orderName] || '').trim() : '';

      if (chart) patientsSet.add(chart);
      if (isNonInsurance) {
        totalNonInsurance += amt;
        if (chart) nonInsurancePatientsSet.add(chart);
      }

      // 진료의별
      if (doctor && doctor !== '빠른예약') {
        doctorSales[doctor] = doctorSales[doctor] || {count: 0, amount: 0, patients: new Set()};
        doctorSales[doctor].count++;
        doctorSales[doctor].amount += amt;
        if (chart) doctorSales[doctor].patients.add(chart);
      }

      // 담당직원별
      if (staff) {
        staffSales[staff] = staffSales[staff] || {count: 0, amount: 0, patients: new Set(), niAmount: 0, niPatients: new Set()};
        staffSales[staff].count++;
        staffSales[staff].amount += amt;
        if (chart) staffSales[staff].patients.add(chart);
        if (isNonInsurance) {
          staffSales[staff].niAmount += amt;
          if (chart) staffSales[staff].niPatients.add(chart);
        }
      }

      // 일본인 매출 (admin 과 동일 로직)
      if (nation.includes('일본')) {
        totalJapan += amt;
        if (chart) japanPatientsSet.add(chart);
        const staffKey = staff || '미지정';
        japanStaffSales[staffKey] = japanStaffSales[staffKey] || {amount: 0};
        japanStaffSales[staffKey].amount += amt;
      }

      // 오더명별 카운트 (재고 차감·손익 계산용)
      if (orderName) {
        treatmentCounts[orderName] = (treatmentCounts[orderName] || 0) + 1;
      }

      // 코드별 (대분류 매핑용 - 통합앱 신규)
      if (code) {
        codeSales[code] = codeSales[code] || {amount: 0, count: 0};
        codeSales[code].amount += amt;
        codeSales[code].count += 1;
      }
    }

    // 오더 대분류 매핑 (초기 룰) — settings/orderCategoryMap 문서에서 오버라이드 가능
    const defaultMap = {
      '색소': ['색소', '흑자', '검버섯', '기미', '잡티', '오타모반'],
      '톤':   ['톤', 'BB토닝', 'BBL', '라라BBL', '피코토닝', '라비앙', '라라필'],
      '주름': ['주름', '보톡스', '리투오PN'],
      '리프팅': ['리프팅', '실리프팅', '쥬브젠', '리투오볼륨'],
      '스킨부스터': ['리쥬란', '리투오물광', '엑소좀', '스킨부스터'],
      '모공': ['모공', '실펌'],
      '여드름': ['여드름', '클리어밸런스'],
      '돌출': ['돌출', '편평사마귀', '피지선증식증', '한관종', '모낭상피종'],
      '흉터': ['흉터', '흉터01'],
      '리팟': ['리팟'],
      '제모': ['제모'],
      '진료': ['진료', '보험진료'],
      '약품': ['670', '657'],
    };
    let mapDoc;
    try { mapDoc = await admin.firestore().collection('settings').doc('orderCategoryMap').get(); } catch (_) {}
    const catMap = (mapDoc && mapDoc.exists && mapDoc.data() && mapDoc.data().map) || defaultMap;

    const categorySales = {};
    for (const [code, val] of Object.entries(codeSales)) {
      let matched = null;
      for (const [cat, keywords] of Object.entries(catMap)) {
        if (keywords.some(k => code.includes(k))) { matched = cat; break; }
      }
      const cat = matched || '기타';
      categorySales[cat] = categorySales[cat] || {amount: 0, count: 0};
      categorySales[cat].amount += val.amount;
      categorySales[cat].count += val.count;
    }

    // Set → size 변환 (Firestore 저장용)
    const doctorSalesForDB = {};
    for (const [d, v] of Object.entries(doctorSales)) {
      doctorSalesForDB[d] = {count: v.count, amount: v.amount, patients: v.patients.size};
    }
    const staffSalesForDB = {};
    for (const [s, v] of Object.entries(staffSales)) {
      staffSalesForDB[s] = {
        count: v.count, amount: v.amount, patients: v.patients.size,
        niAmount: v.niAmount || 0, niPatients: v.niPatients ? v.niPatients.size : 0
      };
    }
    // japanStaffSales: 모든 staff 에 총 일본인 방문객 수 저장 (admin 동일)
    const japanVisitors = japanPatientsSet.size;
    const japanStaffSalesForDB = {};
    for (const [s, v] of Object.entries(japanStaffSales)) {
      japanStaffSalesForDB[s] = {patients: japanVisitors, amount: v.amount};
    }

    // ─── revenue/{ym} : 요약 ─── (admin 스키마와 동일)
    const revenueDoc = {
      total: totalRevenue,
      japan: totalJapan,
      nonInsurance: totalNonInsurance,
      nonInsurancePatients: nonInsurancePatientsSet.size,
      japanVisitors,
      transactions,
      patients: patientsSet.size,
      // 통합앱 전용 추가 필드
      totalRevenue: totalFromSum || totalRevenue,
      totalRevenueByRows: totalRevenue,
      sourceFile: {fileId, ym},
      parsedAt: new Date().toISOString(),
      parsedBy: email,
    };
    await admin.firestore().collection('revenue').doc(ym).set(revenueDoc, {merge: true});

    // ─── salesDetail/{ym} : 상세 ─── (admin 스키마와 동일 + 통합앱 신규 필드)
    const salesDetailDoc = {
      doctorSales: doctorSalesForDB,
      staffSales: staffSalesForDB,
      japanStaffSales: japanStaffSalesForDB,
      treatmentCounts,
      totalTreatments: transactions,
      // 통합앱 신규
      codeSales,
      categorySales,
      updatedAt: new Date().toISOString(),
    };
    await admin.firestore().collection('salesDetail').doc(ym).set(salesDetailDoc, {merge: true});

    logger.info(`parseRevenueFile ${ym}: total=${totalRevenue} japan=${totalJapan} japanVisitors=${japanVisitors} staff=${Object.keys(staffSales).length}`);
    return {
      ok: true,
      totalRevenue: revenueDoc.totalRevenue,
      total: totalRevenue,
      japan: totalJapan,
      japanVisitors,
      nonInsurance: totalNonInsurance,
      patients: patientsSet.size,
      transactions,
      doctorSales: doctorSalesForDB,
      staffSales: staffSalesForDB,
      japanStaffSales: japanStaffSalesForDB,
      categorySales,
      parsedAt: revenueDoc.parsedAt,
      parsedBy: email,
      sourceFile: revenueDoc.sourceFile,
    };
  }
);

/* ═══════════════════════════════════════════════════════════════════
 * ocrReceipt (HTTPS Callable)
 *   배달앱(배민 등) 주문상세 스크린샷에서 결제 금액을 읽어 식대 입력을 자동화.
 *   - 로그인한 직원이면 호출 가능
 *   - Google Cloud Vision DOCUMENT_TEXT_DETECTION 으로 텍스트 추출
 *     ※ 사전 준비(1회): GCP 콘솔에서 lumiclinic-c1a95 프로젝트에
 *       Cloud Vision API 활성화 필요 (월 1,000건 무료)
 *   - 이미지 자체는 저장하지 않고 인식 후 버린다
 *
 *   [배포 권한 메모]
 *   GitHub Actions(deploy-functions.yml)로 배포하려면 FIREBASE_SERVICE_ACCOUNT
 *   서비스 계정에 아래 역할이 모두 필요하다. 하나씩 빠질 때마다 배포가
 *   다른 지점에서 멈추므로, 신규 환경을 셋업할 땐 한 번에 부여할 것.
 *
 *     · 서비스 계정 사용자      roles/iam.serviceAccountUser
 *         없으면: "Missing permissions required for functions deploy.
 *                 You must have permission iam.serviceAccounts.ActAs on
 *                 service account lumiclinic-c1a95@appspot.gserviceaccount.com"
 *         ※ 편집자(Editor)에 actAs 가 포함되지 않으므로 반드시 별도 부여.
 *
 *     · Secret Manager 관리자   roles/secretmanager.admin
 *         없으면: "Permission 'secretmanager.secrets.get' denied on
 *                 .../secrets/DRIVE_SERVICE_KEY"
 *         ※ 배포 시 코드베이스 전체의 시크릿을 검사하므로, ocrReceipt 처럼
 *           시크릿을 안 쓰는 함수만 올릴 때도 필요하다.
 *
 *     · 편집자                  roles/editor
 *         없으면: "Permissions denied enabling cloudbilling.googleapis.com"
 *         (API 활성화 · Cloud Build · Artifact Registry · Cloud Run 용)
 *
 *   Firestore 규칙 배포(deploy-firestore-rules.yml)는 위 권한이 하나도
 *   필요 없어서, 규칙 배포가 잘 된다고 해서 함수 배포도 되는 건 아니다.
 * ═══════════════════════════════════════════════════════════════════ */

// "14,800원" / "-2,700" 같은 토큰에서 정수 금액을 뽑는다. 실패하면 null.
/**
 * 한 줄에서 금액 토큰을 순서대로 뽑는다.
 *
 * 주의 두 가지:
 *  · 공백을 먼저 지우면 "2,900 1 2,900"(단가·수량·금액) 이 하나의 거대한
 *    수로 뭉친다. 그래서 원문에서 토큰 단위로 뽑는다.
 *  · 반대로 OCR 이 천 단위 콤마 뒤를 띄워 "2, 900" 으로 읽는 일이 잦다.
 *    이때 그냥 쪼개면 900 이 금액이 되어버리므로, 콤마(+선택적 공백)로
 *    이어지는 3자리 묶음은 하나의 수로 합친다.
 */
function moneyTokens(line) {
  // ① 천 단위 구분자로 이어진 3자리 묶음  ② 그 외 연속 숫자
  // 구분자는 콤마뿐 아니라 마침표·아포스트로피까지 받는다. 감열지 영수증은
  // 콤마가 흐려 OCR 이 "2.900" / "2'900" / "2, 900" 으로 읽는 일이 잦은데,
  // 원화는 소수점을 쓰지 않으므로 전부 천 단위로 봐도 안전하다.
  const re = /-?\d{1,3}(?:[,.'，·]\s?\d{3})+|-?\d+/g;
  return String(line || '').match(re) || [];
}

function tokenToWon(tok) {
  const n = parseInt(String(tok).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function parseWon(token) {
  const tokens = moneyTokens(token);
  if (!tokens.length) return null;
  // 영수증 금액은 오른쪽 정렬이라 마지막 토큰이 우리가 찾는 값이다.
  return tokenToWon(tokens[tokens.length - 1]);
}

/**
 * 라벨 줄에서 금액을 찾는다. {value, distance} 또는 null.
 *
 * 종이 영수증은 라벨이 왼쪽, 금액이 오른쪽에 정렬돼 있어 Vision 이
 * 라벨 묶음과 금액 묶음을 따로 읽어내는 일이 있다.
 *   청구금액: / 받은금액: / 거스름돈: / 2,900 / 2,900 / 0
 * 그래서 뒤쪽 줄까지 훑되, 몇 줄 떨어져서 찾았는지(distance)를 함께 돌려
 * 호출부가 확신도를 낮출 수 있게 한다.
 */
// 금액만 적힌 줄인지 (라벨 없이 숫자만 있는 오른쪽 컬럼).
// "원"이 줄 안에 여러 번 나올 수 있다 — 배민은 할인 전/후 금액을 한 줄에
// 나란히 찍는다: "17,800원 11,700원" (앞은 취소선, 뒤가 실제 결제금액).
function isAmountOnlyLine(line) {
  const s = String(line || '');
  return /^[^\d]{0,2}(?:[\d,.'，·\s]|원|-)+$/.test(s) && /\d/.test(s);
}

/**
 * @param {string} prefer 같은 줄에 숫자가 여럿일 때 어느 것을 쓸지
 *   'last'  총액용. 오른쪽 정렬이라 맨 오른쪽이 최종 금액이다.
 *           배민 "총 결제금액  35,900원  29,880원" → 할인 후 29,880.
 *   'first' 항목용. 값 뒤에 홍보 문구가 붙는 줄이 있다.
 *           배민 "배달팁 0원! 배민클럽 6,020원 할인" → 배달팁은 0.
 */
/**
 * 금액이 확실한 줄인지 — 천 단위 구분자가 있거나 "원"이 붙어 있는 줄.
 * 주문번호(222)·수량(1)처럼 맨숫자만 있는 줄과 구분하기 위한 기준이다.
 */
function isMoneyLikeLine(line) {
  return /[,.'，·]\s?\d{3}|원/.test(String(line || ''));
}

function amountFromLine(line, {strict, prefer}) {
  if (!isAmountOnlyLine(line)) return null;
  if (strict && !isMoneyLikeLine(line)) return null;
  const toks = moneyTokens(line);
  if (!toks.length) return null;
  return tokenToWon(prefer === 'first' ? toks[0] : toks[toks.length - 1]);
}

/**
 * 라벨 줄 주변에서 금액을 찾는다.
 *
 * 기울어져 찍은 사진은 Vision 이 줄 순서를 뒤섞어 읽는다. 실제 예:
 *   [주문(대기)번호] / 주문내역 / 상품명 / 222 / [포장](ICE)카페라떼 /
 *   총주문금액 / [포장하기] / 수량 / 구분 / 1 / 신규 / 2,900원 / 2026-08-19
 * "총주문금액" 바로 앞줄이 주문번호 222, 뒷줄이 수량 1 이라 가까운 순서로만
 * 찾으면 엉뚱한 수를 집는다. 그래서 두 번에 나눠 훑는다.
 *   1차 — 구분자나 "원"이 붙어 금액이 확실한 줄만
 *   2차 — 그래도 없으면 맨숫자 줄까지 허용
 */
function amountNear(lines, idx, {prefer = 'last', maxAhead = 8, maxBack = 4, min = null,
  strictOnly = false} = {}) {
  const okValue = (v) => v !== null && (min === null || v >= min);

  // 같은 줄에 있으면 그게 답
  const ownTokens = moneyTokens(lines[idx]);
  if (ownTokens.length) {
    const tok = prefer === 'first' ? ownTokens[0] : ownTokens[ownTokens.length - 1];
    const v = tokenToWon(tok);
    if (okValue(v)) return {value: v, distance: 0};
  }

  // 금액 줄이 연달아 나오면 하나만 보고 끝내지 않는다.
  //   배민 세로 배치 : 제금액 / 17,800원 / 11,700원   → 뒤(할인 후)가 정답
  //   POS 컬럼 배치  : 청구금액·받은금액·거스름돈 / 2,900 / 2,900 / 0
  //                    → 0 은 하한선에서 걸러지고 2,900 이 남는다
  // 그래서 연속 구간을 모아 prefer 에 따라 앞/뒤를 고른다.
  const runFrom = (start, step) => {
    let k = start;
    const vals = [];
    while (k >= 0 && k < lines.length && Math.abs(k - idx) <= (step > 0 ? maxAhead : maxBack)) {
      if (!isAmountOnlyLine(lines[k])) break;
      const v = amountFromLine(lines[k], {strict: false, prefer});
      if (okValue(v)) vals.push({v, k});
      k += step;
    }
    return vals;
  };

  for (const strict of (strictOnly ? [true] : [true, false])) {
    // 아래쪽 먼저 (라벨 다음에 금액이 오는 일반적인 배치)
    const fwdEnd = Math.min(idx + maxAhead, lines.length - 1);
    for (let k = idx + 1; k <= fwdEnd; k++) {
      const v = amountFromLine(lines[k], {strict, prefer});
      if (!okValue(v)) continue;
      const run = runFrom(k, 1);
      const hit = (prefer === 'first' || !run.length) ? {v, k} : run[run.length - 1];
      return {value: hit.v, distance: hit.k - idx};
    }
    // 그다음 위쪽 (CU 처럼 "결제금액:" 라벨이 값보다 아래 찍히는 형식)
    const backEnd = Math.max(idx - maxBack, 0);
    for (let k = idx - 1; k >= backEnd; k--) {
      const v = amountFromLine(lines[k], {strict, prefer});
      if (okValue(v)) return {value: v, distance: idx - k};
    }
  }
  return null;
}

// 식사 영수증의 총액으로 볼 수 있는 최소 금액.
// 이보다 작으면 수량(1)·거스름돈(0)·개수 같은 다른 숫자를 집은 것이다.
const MIN_TOTAL_WON = 100;

/**
 * 라벨을 못 찾고 반복도 없을 때의 마지막 추정 —
 * 영수증 전체에서 천 단위 구분자가 붙은 금액이 딱 하나뿐이면 그게 총액이다.
 *
 * 주문번호표처럼 항목이 하나뿐인 간이 영수증이 여기 해당한다.
 *   [포장](ICE)카페라떼 / 2,900 원 / 총주문금액
 * 수량·주문번호·날짜는 구분자가 없으므로 자연히 걸러진다.
 */
function guessSingleCommaAmount(lines) {
  const found = new Set();
  for (const line of lines) {
    if (RECEIPT_EXCLUDE.some((re) => re.test(line))) continue;
    for (const tok of moneyTokens(line)) {
      if (!/[,.'，·]/.test(tok)) continue;
      const n = tokenToWon(tok);
      if (n === null || n < MIN_TOTAL_WON || n > 1000000) continue;
      found.add(n);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

// 금액을 읽어서는 안 되는 줄 — 세부 내역·세액·거스름돈 등
// (예: "부가세 과세물품가액 2,636" 을 결제금액으로 오인하면 안 된다)
const RECEIPT_EXCLUDE = [
  /부가\s*세/, /과세/, /면세/, /공급\s*가/, /봉사료/,
  /거스름/, /받은\s*금액/, /잔액/, /포인트/, /적립/, /마일리지/,
  /할인/, /쿠폰/, /단가/, /수량/,
];

/**
 * 라벨을 하나도 못 찾았을 때의 추정 — 같은 금액이 3번 이상 반복되면 그게 총액.
 *
 * POS 종이 영수증은 같은 값이 단가·금액·청구금액·카드승인액에 반복 인쇄된다.
 * (예: 카페라떼 2,900 → 단가/금액/청구금액/신용카드 에 각각 2,900)
 * 세액·거스름돈·받은금액 줄은 제외하고 센다. 확신이 낮으므로 호출부에서
 * confidence:'low' 로 표시해 사람이 반드시 확인하게 한다.
 */
function guessTotalByRepetition(lines) {
  const counts = new Map();
  for (const line of lines) {
    if (RECEIPT_EXCLUDE.some((re) => re.test(line))) continue;
    for (const tok of moneyTokens(line)) {
      const n = tokenToWon(tok);
      // 식대로 볼 수 있는 범위만 — 전화번호·사업자번호·승인번호 배제
      if (n === null || n < 500 || n > 1000000) continue;
      if (!/[,，]/.test(tok) && n >= 10000) continue;  // 콤마 없는 큰 수는 번호일 확률이 높다
      counts.set(n, (counts.get(n) || 0) + 1);
    }
  }
  // 같은 횟수라면 큰 금액을 택한다 — 총액이 항목 금액보다 작을 수 없다
  let best = null;
  let bestCount = 0;
  counts.forEach((c, n) => {
    if (c > bestCount || (c === bestCount && n > (best || 0))) {
      best = n;
      bestCount = c;
    }
  });
  return bestCount >= 3 ? best : null;
}

/**
 * 영수증 텍스트에서 음식/배달비/결제금액을 뽑는다.
 *
 * 1) 배달앱(배민 등) — 메뉴금액 / 배달팁 / 할인 / 결제금액
 *    예: 메뉴 14,500 + 배달팁 3,400 − 할인 4,400 = 결제 13,500
 *    결제금액이 실제로 나간 돈이므로 이를 기준으로 삼고
 *    배달비 = 결제금액 − 메뉴금액 으로 역산한다(할인이 반영된 실질 배달비).
 *    그래야 음식+배달 합계가 항상 결제금액과 일치한다.
 *
 * 2) POS 종이 영수증 — 합계 / 청구금액 / 신용카드 / 승인금액
 *    배달비 개념이 없으므로 전액을 음식값으로 잡는다.
 *
 * 3) 라벨을 못 찾으면 반복 금액으로 추정하고 confidence:'low' 로 알린다.
 */
function parseReceiptText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 라벨에서 몇 줄 떨어진 금액을 끌어다 쓴 적이 있으면 확신도를 낮춘다
  let farMatch = false;
  let matchedLabel = null;

  // 위에서부터 첫 매치 — 메뉴금액·배달팁·할인처럼 상단에 한 번 나오는 항목용
  const pick = (patterns) => {
    for (const re of patterns) {
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        const hit = amountNear(lines, i, {prefer: 'first', maxAhead: 2, maxBack: 0});
        if (hit) return hit.value;
      }
    }
    return null;
  };

  // 총액은 아래에서부터 찾는다.
  // 영수증은 항목 → 소계 → 세액 → 결제금액 → 카드승인 순으로 인쇄되므로
  // 같은 라벨이 여러 번 나와도 "맨 아래 것"이 실제 결제금액이다.
  const pickBottomUp = (tiers, {strictOnly = false} = {}) => {
    for (const {re, name} of tiers) {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!re.test(lines[i])) continue;
        if (RECEIPT_EXCLUDE.some((x) => x.test(lines[i]))) continue;
        const hit = amountNear(lines, i, {min: MIN_TOTAL_WON, strictOnly});
        if (hit) {
          if (hit.distance >= 2) farMatch = true;
          matchedLabel = name;
          return hit.value;
        }
      }
    }
    return null;
  };

  // 총액 라벨 — 확실한 것부터. 마지막 단계는 앞글자가 잘려도 잡히도록
  // "…금액" 으로만 끝나는 줄을 본다(제외 목록이 받은금액·할인금액 등을 걸러준다).
  const TOTAL_TIERS = [
    {re: /결제\s*금\s*액/, name: '결제금액'},
    {re: /청구\s*금\s*액/, name: '청구금액'},
    {re: /승인\s*금\s*액/, name: '승인금액'},
    {re: /받을\s*금\s*액/, name: '받을금액'},
    {re: /총\s*구\s*매\s*액/, name: '총구매액'},
    {re: /판매\s*총액/, name: '판매총액'},
    {re: /총\s*합\s*계|합\s*계\s*금\s*액|^\s*합\s*계/, name: '합계'},
    {re: /신\s*용\s*카\s*드/, name: '신용카드'},
    {re: /체\s*크\s*카\s*드/, name: '체크카드'},
    {re: /현\s*금\s*(결제|승인)/, name: '현금결제'},
    {re: /총\s*주문\s*금\s*액|주문\s*금\s*액|총\s*금\s*액/, name: '총주문금액'},
    {re: /금\s*액\s*[:：]?\s*$|금\s*액/, name: '금액'},
  ];

  // 1차 — 라벨 주변에서 "금액이 확실한 줄"(구분자·원 표기)만 본다.
  // 기울어진 사진처럼 줄 순서가 뒤섞여도 주문번호·수량을 집지 않는다.
  const total = pickBottomUp(TOTAL_TIERS, {strictOnly: true});

  const menu = pick([/메뉴\s*금액/, /메뉴금액/, /상품\s*금액/, /음식\s*금액/]);
  const tip = pick([/배달\s*팁/, /배달팁/, /배달\s*비/, /배달\s*요금/, /배달\s*료/]);
  const discount = pick([/총\s*할인\s*받은\s*금액/, /할인\s*금액/, /총\s*할인/]);

  // 결제금액 확정 — 라벨 → 메뉴+배달팁-할인 추정 → 반복 금액 추정
  let confidence = 'high';
  let totalAmount = total;
  if (totalAmount === null && menu !== null) {
    totalAmount = menu + (tip || 0) - Math.abs(discount || 0);
  }
  // 라벨에서 멀리 떨어진 금액을 끌어온 경우(줄 순서가 뒤섞인 사진)에는
  // 인접성을 믿기 어렵다. 같은 금액이 3번 이상 인쇄된 POS 영수증이라면
  // 그쪽이 더 확실하므로 바꿔 쓴다.
  //
  // confidence 는 "값을 어떻게 얻었는가"만 본다. 총액 라벨을 찾았고 금액이
  // 확실한 줄에서 읽었다면 몇 줄 떨어져 있었는지는 따지지 않는다(high).
  // 라벨 없이 추측했거나 다른 값으로 바꿔 쓴 때만 low 로 내려 화면에
  // "확인 필요"를 띄운다.
  if (totalAmount !== null && farMatch) {
    const repeated = guessTotalByRepetition(lines);
    if (repeated !== null && repeated !== totalAmount) {
      totalAmount = repeated;
      matchedLabel = '반복 금액 추정';
      confidence = 'low';
    }
  }

  // 2차 — 영수증에 구분자 붙은 금액이 딱 하나면 그것. 항목 하나짜리 간이
  // 영수증은 라벨을 못 찾아도 이 단계에서 정확히 잡힌다.
  if (totalAmount === null || totalAmount < MIN_TOTAL_WON) {
    totalAmount = guessSingleCommaAmount(lines);
    matchedLabel = totalAmount !== null ? '유일한 금액 추정' : matchedLabel;
    confidence = 'low';
  }
  // 3차 — 같은 금액이 여러 번 인쇄된 POS 영수증
  if (totalAmount === null || totalAmount < MIN_TOTAL_WON) {
    totalAmount = guessTotalByRepetition(lines);
    matchedLabel = totalAmount !== null ? '반복 금액 추정' : matchedLabel;
    confidence = 'low';
  }
  // 4차 — 여기까지 오면 구분자 없는 맨숫자라도 라벨 옆에서 찾아본다
  if (totalAmount === null || totalAmount < MIN_TOTAL_WON) {
    totalAmount = pickBottomUp(TOTAL_TIERS);
    confidence = 'low';
  }
  if (totalAmount === null || totalAmount < MIN_TOTAL_WON) {
    return {ok: false, confidence: null, matchedLabel: null, foodAmount: null,
      deliveryFee: null, totalAmount: null, menuAmount: menu, deliveryTip: tip,
      discount, lines};
  }

  // 음식/배달비 배분 — 합계가 항상 결제금액과 정확히 맞도록.
  //
  // 실질 배달비 = 결제금액 − 메뉴금액. 다만 할인이 음식값에도 걸리면
  // 메뉴금액이 결제금액보다 커져 음수가 나오므로 0 으로 깎고,
  // 원래 배달팁보다 클 수는 없으므로 배달팁으로도 한 번 더 깎는다.
  //   예) 메뉴 14,500 + 배달팁 3,400 − 할인 4,400 = 결제 13,500
  //       → 13,500 − 14,500 = −1,000 → 배달비 0, 음식 13,500
  let deliveryFee;
  if (menu !== null && menu >= 0) {
    deliveryFee = Math.max(0, totalAmount - menu);
    if (tip !== null && tip >= 0) deliveryFee = Math.min(deliveryFee, tip);
  } else if (tip !== null && tip > 0) {
    deliveryFee = tip;
  } else {
    deliveryFee = 0;
  }
  deliveryFee = Math.min(deliveryFee, totalAmount);
  const foodAmount = totalAmount - deliveryFee;

  return {ok: true, confidence, matchedLabel, foodAmount, deliveryFee, totalAmount,
    menuAmount: menu, deliveryTip: tip, discount, lines};
}

exports.ocrReceipt = onCall(
  {region: 'asia-northeast3', cors: true, memory: '512MiB', timeoutSeconds: 60},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    }
    const b64 = String((request.data && request.data.imageBase64) || '')
      .replace(/^data:image\/\w+;base64,/, '');
    if (!b64) {
      throw new HttpsError('invalid-argument', '이미지가 없습니다.');
    }
    // 대략 8MB 원본까지 (base64 는 약 4/3 배)
    if (b64.length > 11 * 1024 * 1024) {
      throw new HttpsError('invalid-argument', '이미지가 너무 큽니다. 더 작게 잘라서 올려주세요.');
    }

    let token;
    try {
      const {GoogleAuth} = require('google-auth-library');
      const auth = new GoogleAuth({scopes: ['https://www.googleapis.com/auth/cloud-platform']});
      token = await auth.getAccessToken();
    } catch (e) {
      logger.error('ocrReceipt auth 실패', e);
      throw new HttpsError('internal', 'OCR 인증에 실패했습니다.');
    }

    let visionJson;
    try {
      const res = await fetch('https://vision.googleapis.com/v1/images:annotate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
        body: JSON.stringify({
          requests: [{
            image: {content: b64},
            features: [{type: 'DOCUMENT_TEXT_DETECTION'}],
            imageContext: {languageHints: ['ko', 'en']},
          }],
        }),
      });
      visionJson = await res.json();
      if (!res.ok) {
        const msg = (visionJson && visionJson.error && visionJson.error.message) || `HTTP ${res.status}`;
        logger.error('Vision API 오류', msg);
        if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) {
          throw new HttpsError('failed-precondition',
            'Cloud Vision API 가 아직 활성화되지 않았습니다. GCP 콘솔에서 lumiclinic-c1a95 프로젝트에 Vision API 를 켜주세요.');
        }
        throw new HttpsError('internal', 'OCR 실패: ' + msg);
      }
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error('ocrReceipt 호출 실패', e);
      throw new HttpsError('internal', 'OCR 호출에 실패했습니다: ' + e.message);
    }

    const r = (visionJson.responses && visionJson.responses[0]) || {};
    if (r.error && r.error.message) {
      throw new HttpsError('internal', 'OCR 실패: ' + r.error.message);
    }
    const text = (r.fullTextAnnotation && r.fullTextAnnotation.text) || '';
    if (!text.trim()) {
      return {ok: false, reason: '이미지에서 글자를 찾지 못했습니다.', text: '', parsed: null};
    }

    const parsed = parseReceiptText(text);
    logger.info(`ocrReceipt by ${request.auth.token.email || request.auth.uid}: ` +
      `total=${parsed.totalAmount} food=${parsed.foodAmount} delivery=${parsed.deliveryFee}`);
    return {
      ok: parsed.ok,
      reason: parsed.ok ? null : '결제 금액을 찾지 못했습니다. 직접 입력해주세요.',
      text,
      parsed: {
        confidence: parsed.confidence,
        matchedLabel: parsed.matchedLabel,
        foodAmount: parsed.foodAmount,
        deliveryFee: parsed.deliveryFee,
        totalAmount: parsed.totalAmount,
        menuAmount: parsed.menuAmount,
        deliveryTip: parsed.deliveryTip,
        discount: parsed.discount,
      },
    };
  }
);
