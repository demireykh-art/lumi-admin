/* 🌙 퇴근 마감 미완료 — 관리자 백그라운드 푸시 서비스워커 (Phase 2)
   staff.lumiclinic.co.kr / lumi-staff.vercel.app 루트에서 서빙됨 (scope: '/'). */
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDnkKNXNnDVlcPd5Y1fl59YysdeEZi7uJU',
  authDomain: 'lumiclinic-c1a95.firebaseapp.com',
  projectId: 'lumiclinic-c1a95',
  storageBucket: 'lumiclinic-c1a95.firebasestorage.app',
  messagingSenderId: '901456209944',
  appId: '1:901456209944:web:f287418cd0541f324d3b6d',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = (payload && payload.notification) || {};
  self.registration.showNotification(n.title || '🌙 마감 미완료', {
    body: n.body || '',
    icon: '/favicon.png',
    badge: '/favicon.png',
    data: {link: 'https://staff.lumiclinic.co.kr/staff.html'},
  });
});

// 알림 클릭 시 통합앱 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) ||
    'https://staff.lumiclinic.co.kr/staff.html';
  event.waitUntil(clients.openWindow(link));
});
