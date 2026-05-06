/**
 * Cloud Functions for lumiclinic-c1a95
 *
 * resetUserPassword (HTTPS Callable):
 *   - 호출자가 settings/bizAdmins.emails 화이트리스트의 비즈관리자인지 검증
 *   - 대상 이메일의 Firebase Auth 비밀번호를 새 값으로 설정
 *   - employees doc(같은 이메일)에 mustChangePassword:true 플래그 설정 →
 *     직원이 임시 비번으로 첫 로그인 시 본인이 직접 새 비번 설정 강제
 */
const {onCall, HttpsError} = require('firebase-functions/v2/https');
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

    // 5) 사용자 조회 + 비밀번호 갱신
    let user;
    try {
      user = await admin.auth().getUserByEmail(targetEmail);
    } catch (e) {
      logger.warn(`User not found for password reset: ${targetEmail}`, e);
      throw new HttpsError('not-found', `Firebase Auth에 ${targetEmail} 사용자가 없습니다.`);
    }
    await admin.auth().updateUser(user.uid, {password: newPassword});

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

    logger.info(`Password reset by ${callerEmail} for ${targetEmail} (uid=${user.uid})`);
    return {success: true, email: targetEmail, uid: user.uid, mustChangePasswordSet: flagSet};
  }
);
