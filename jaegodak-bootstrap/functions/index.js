/* ═══════════════════════════════════════════════════════════════════════════
 *  재고닥 Functions — 테넌시
 *  ---------------------------------------------------------------------------
 *  이 파일이 하는 일은 하나다: **누가 어느 병원 사람인지 정한다.**
 *
 *  Rules 는 request.auth.token.clinicId 만 보고 판정한다. 그 값을 쓰는 곳이
 *  여기뿐이어야 보안이 성립한다. 클라이언트가 자기 소속을 쓸 수 있으면
 *  Rules 전체가 무의미해진다 — 그래서 users.clinicId / members/* 는
 *  firestore.rules 에서 클라이언트 쓰기를 전부 막아 두었다.
 *
 *  클레임과 Firestore 는 두 개의 진실이 되기 쉽다. 규칙을 하나 정해 둔다:
 *    **클레임이 정답이고, Firestore 문서는 그 사본이다.**
 *  setClaims() 는 항상 클레임 → 문서 순서로 쓴다. 중간에 죽으면 문서가
 *  낡은 채로 남는데, 그쪽이 반대(문서는 새것인데 권한이 없는 상태)보다 안전하다.
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {setGlobalOptions} = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

// 서울. Firestore 와 같은 지역에 둬야 왕복이 줄어든다.
setGlobalOptions({region: 'asia-northeast3', maxInstances: 10});

const ROLES = ['owner', 'manager', 'staff'];
const INVITE_TTL_DAYS = 14;

/* ───────────────────────────── 공통 ───────────────────────────── */

function requireAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  return request.auth;
}

/** 호출자의 소속·권한을 토큰에서 읽는다. Firestore 를 읽지 않는다. */
function callerTenancy(request) {
  const t = (request.auth && request.auth.token) || {};
  return {
    uid: request.auth.uid,
    clinicId: typeof t.clinicId === 'string' ? t.clinicId : null,
    role: typeof t.role === 'string' ? t.role : null,
  };
}

function requireRole(request, roles) {
  requireAuth(request);
  const me = callerTenancy(request);
  if (!me.clinicId) throw new HttpsError('failed-precondition', '소속 병원이 없습니다.');
  if (!roles.includes(me.role)) {
    throw new HttpsError('permission-denied', '권한이 없습니다.');
  }
  return me;
}

/**
 * 소속·권한을 정한다. **클레임이 먼저, 문서가 나중.**
 * 기존 클레임을 통째로 덮으므로, 나중에 다른 클레임이 생기면 여기서 보존해야 한다.
 */
async function setClaims(uid, clinicId, role) {
  if (!ROLES.includes(role)) throw new HttpsError('invalid-argument', '알 수 없는 권한입니다.');

  await auth.setCustomUserClaims(uid, {clinicId, role});

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(db.doc(`users/${uid}`), {clinicId, role, updatedAt: now}, {merge: true});
  batch.set(db.doc(`clinics/${clinicId}/members/${uid}`), {
    uid, role, joinedAt: now, updatedAt: now,
  }, {merge: true});
  await batch.commit();

  logger.info('클레임 설정', {uid, clinicId, role});
}

/** 추측 불가능한 초대 코드. 문서 id 를 아는 것이 곧 권한이므로 짧으면 안 된다. */
function newInviteCode() {
  return crypto.randomBytes(24).toString('base64url');   // 32자
}

/* ───────────────────────── 병원 생성 ───────────────────────── */

/**
 * 처음 가입한 사람이 자기 병원을 만든다.
 * 이미 소속이 있으면 거부한다 — 한 계정은 한 병원에만 속한다.
 * (여러 병원을 오가는 원장은 v1 범위 밖이다. 계정을 따로 만든다.)
 */
exports.bootstrapClinic = onCall(async (request) => {
  const {uid} = requireAuth(request);
  const me = callerTenancy(request);
  if (me.clinicId) {
    throw new HttpsError('failed-precondition', '이미 소속된 병원이 있습니다.');
  }

  const name = String((request.data && request.data.clinicName) || '').trim();
  if (!name) throw new HttpsError('invalid-argument', '병원 이름을 입력해주세요.');
  if (name.length > 100) throw new HttpsError('invalid-argument', '병원 이름이 너무 깁니다.');

  // 클레임이 아직 없더라도, 이미 병원을 만든 계정인지 문서로 한 번 더 확인한다.
  // 클레임 설정 직후 재호출되면 토큰이 아직 낡아 있을 수 있다.
  const existing = await db.collection('clinics').where('ownerUid', '==', uid).limit(1).get();
  if (!existing.empty) {
    throw new HttpsError('already-exists', '이미 만든 병원이 있습니다. 다시 로그인해주세요.');
  }

  const ref = db.collection('clinics').doc();
  await ref.set({
    name,
    ownerUid: uid,
    plan: 'pilot',                 // 파일럿은 무료. 결제는 P6
    planExpiresAt: null,
    timezone: 'Asia/Seoul',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await setClaims(uid, ref.id, 'owner');
  return {clinicId: ref.id, role: 'owner'};
});

/* ───────────────────────── 초대 ───────────────────────── */

exports.createInvite = onCall(async (request) => {
  const me = requireRole(request, ['owner', 'manager']);

  const role = String((request.data && request.data.role) || 'staff');
  if (!ROLES.includes(role)) throw new HttpsError('invalid-argument', '알 수 없는 권한입니다.');
  // manager 가 owner 를 만들 수는 없다.
  if (role === 'owner' && me.role !== 'owner') {
    throw new HttpsError('permission-denied', 'owner 초대는 owner 만 할 수 있습니다.');
  }

  const code = newInviteCode();
  const expiresAt = admin.firestore.Timestamp.fromMillis(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  await db.doc(`invites/${code}`).set({
    clinicId: me.clinicId,
    role,
    createdBy: me.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    usedBy: null,
    usedAt: null,
  });

  return {code, role, expiresAt: expiresAt.toMillis()};
});

/**
 * 초대 수락. 코드 소진과 클레임 부여가 한 번에 일어나야 한다.
 * 트랜잭션으로 usedBy 를 먼저 잠근 뒤에 클레임을 준다 — 순서가 반대면
 * 동시에 두 사람이 같은 코드로 들어올 수 있다.
 */
exports.acceptInvite = onCall(async (request) => {
  const {uid} = requireAuth(request);
  const me = callerTenancy(request);
  if (me.clinicId) throw new HttpsError('failed-precondition', '이미 소속된 병원이 있습니다.');

  const code = String((request.data && request.data.code) || '').trim();
  if (!code) throw new HttpsError('invalid-argument', '초대 코드가 없습니다.');

  const ref = db.doc(`invites/${code}`);
  const invite = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', '초대 코드를 찾을 수 없습니다.');
    const d = snap.data();
    if (d.usedBy) throw new HttpsError('failed-precondition', '이미 사용된 초대입니다.');
    if (d.expiresAt && d.expiresAt.toMillis() < Date.now()) {
      throw new HttpsError('deadline-exceeded', '만료된 초대입니다.');
    }
    tx.update(ref, {
      usedBy: uid,
      usedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return d;
  });

  await setClaims(uid, invite.clinicId, invite.role);
  return {clinicId: invite.clinicId, role: invite.role};
});

/* ───────────────────────── 구성원 관리 ───────────────────────── */

exports.setMemberRole = onCall(async (request) => {
  const me = requireRole(request, ['owner']);
  const targetUid = String((request.data && request.data.uid) || '');
  const role = String((request.data && request.data.role) || '');
  if (!targetUid) throw new HttpsError('invalid-argument', '대상이 없습니다.');
  if (!ROLES.includes(role)) throw new HttpsError('invalid-argument', '알 수 없는 권한입니다.');
  if (targetUid === me.uid) {
    // owner 가 스스로를 강등하면 그 병원에 owner 가 없어진다.
    throw new HttpsError('failed-precondition', '자기 권한은 바꿀 수 없습니다.');
  }

  const target = await auth.getUser(targetUid).catch(() => null);
  if (!target) throw new HttpsError('not-found', '사용자를 찾을 수 없습니다.');
  const tc = target.customClaims || {};
  if (tc.clinicId !== me.clinicId) {
    throw new HttpsError('permission-denied', '다른 병원 사용자입니다.');
  }

  await setClaims(targetUid, me.clinicId, role);
  return {ok: true};
});

exports.removeMember = onCall(async (request) => {
  const me = requireRole(request, ['owner']);
  const targetUid = String((request.data && request.data.uid) || '');
  if (!targetUid) throw new HttpsError('invalid-argument', '대상이 없습니다.');
  if (targetUid === me.uid) throw new HttpsError('failed-precondition', '자기 자신은 뺄 수 없습니다.');

  const target = await auth.getUser(targetUid).catch(() => null);
  if (!target) throw new HttpsError('not-found', '사용자를 찾을 수 없습니다.');
  if ((target.customClaims || {}).clinicId !== me.clinicId) {
    throw new HttpsError('permission-denied', '다른 병원 사용자입니다.');
  }

  // 클레임을 지우면 그 순간부터 Rules 가 전부 막는다.
  // 계정과 users 문서는 남긴다 — 지우면 과거 movements 의 createdBy 가 미아가 된다.
  await auth.setCustomUserClaims(targetUid, {});
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(db.doc(`users/${targetUid}`), {
    clinicId: null, role: null, updatedAt: now,
  }, {merge: true});
  batch.delete(db.doc(`clinics/${me.clinicId}/members/${targetUid}`));
  await batch.commit();

  // ⚠️ 이미 발급된 토큰은 최대 1시간 살아 있다. 즉시 끊어야 하면 아래를 켠다.
  //    켜면 그 사용자의 모든 기기가 재로그인해야 한다.
  // await auth.revokeRefreshTokens(targetUid);

  return {ok: true};
});

/** 내 소속을 확인한다. 클레임이 낡았을 때 클라이언트가 대조할 기준. */
exports.whoami = onCall(async (request) => {
  const {uid} = requireAuth(request);
  const user = await auth.getUser(uid);
  const c = user.customClaims || {};
  return {uid, clinicId: c.clinicId || null, role: c.role || null};
});
