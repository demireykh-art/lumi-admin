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
