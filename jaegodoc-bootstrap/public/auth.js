/* ═══════════════════════════════════════════════════════════════════════════
 *  auth.js — 로그인 · 소속 판정
 *  ---------------------------------------------------------------------------
 *  클레임(소속·권한)은 **최대 1시간 묵을 수 있다.** 병원을 만들거나 초대를
 *  수락한 직후에는 토큰이 아직 옛것이라 Rules 가 전부 막는다. 그래서
 *  소속이 바뀌는 모든 지점에서 getIdToken(true) 로 강제 갱신해야 한다.
 *  그 일을 여기 한 곳에 모아 둔다.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* global firebase, Repo */

const Auth = (() => {
  'use strict';

  let _user = null;
  let _tenancy = {clinicId: null, role: null};
  const listeners = [];

  function onChange(fn) {
    listeners.push(fn);
    if (_user !== null) fn(state());
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function state() {
    return {
      user: _user,
      clinicId: _tenancy.clinicId,
      role: _tenancy.role,
      signedIn: !!_user,
      hasClinic: !!_tenancy.clinicId,
    };
  }

  function emit() {
    const s = state();
    listeners.forEach((fn) => {
      try { fn(s); } catch (e) { console.error('Auth 리스너 오류:', e); }
    });
  }

  /** 토큰에서 소속을 읽는다. force=true 면 서버에서 새로 받는다. */
  async function readTenancy(user, force) {
    if (!user) return {clinicId: null, role: null};
    const res = await user.getIdTokenResult(!!force);
    const c = res.claims || {};
    return {
      clinicId: typeof c.clinicId === 'string' ? c.clinicId : null,
      role: typeof c.role === 'string' ? c.role : null,
    };
  }

  /**
   * 클레임을 강제로 새로 받는다.
   * 병원 생성·초대 수락·권한 변경 뒤에 반드시 부른다.
   * 서버가 클레임을 쓴 직후라도 전파가 한 박자 늦을 수 있어 한 번 재시도한다.
   */
  async function refreshClaims() {
    if (!_user) return state();
    _tenancy = await readTenancy(_user, true);
    if (!_tenancy.clinicId) {
      await new Promise((r) => setTimeout(r, 800));
      _tenancy = await readTenancy(_user, true);
    }
    wireRepo();
    emit();
    return state();
  }

  function wireRepo() {
    if (_user && _tenancy.clinicId && typeof Repo !== 'undefined') {
      Repo.init(firebase.firestore(), _tenancy.clinicId, {
        uid: _user.uid,
        displayName: _user.displayName || _user.email || '',
      });
    }
  }

  function start() {
    firebase.auth().onAuthStateChanged(async (user) => {
      _user = user;
      _tenancy = await readTenancy(user, false);
      wireRepo();
      emit();
    });
  }

  const fn = (name) => firebase.app().functions('asia-northeast3').httpsCallable(name);

  async function signUp(email, password, displayName) {
    const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
    if (displayName) await cred.user.updateProfile({displayName});
    // users/{uid} 는 본인만 만들 수 있고, 소속·권한 필드는 넣을 수 없다 (Rules).
    await firebase.firestore().doc(`users/${cred.user.uid}`).set({
      email, displayName: displayName || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    return cred.user;
  }

  const signIn = (email, password) =>
    firebase.auth().signInWithEmailAndPassword(email, password);

  const signOut = () => firebase.auth().signOut();

  async function createClinic(clinicName) {
    const res = await fn('bootstrapClinic')({clinicName});
    await refreshClaims();               // ★ 없으면 방금 만든 병원이 안 보인다
    return res.data;
  }

  async function acceptInvite(code) {
    const res = await fn('acceptInvite')({code});
    await refreshClaims();               // ★ 같은 이유
    return res.data;
  }

  const createInvite = (role) => fn('createInvite')({role: role || 'staff'}).then((r) => r.data);

  const can = (roles) => !!_tenancy.role && roles.indexOf(_tenancy.role) >= 0;

  return {
    start, onChange, state, refreshClaims,
    signUp, signIn, signOut,
    createClinic, acceptInvite, createInvite,
    can,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Auth;
