// Firebase コンソール → プロジェクトの設定 → マイアプリ（ウェブ）の firebaseConfig を貼り付ける。
// apiKey 等は公開される前提の値（アクセス制御は firestore.rules で行う）。
// apiKey が 'YOUR_' で始まる間はクラウド同期を無効にし、ローカルのみで動作する。
export const firebaseConfig = {
  apiKey:            'AIzaSyBdQNP_KIOgrwdpVI8xMjBnvwBi0qHCJ3M',
  authDomain:        'conbini-shift.firebaseapp.com',
  projectId:         'conbini-shift',
  storageBucket:     'conbini-shift.firebasestorage.app',
  messagingSenderId: '378981984761',
  appId:             '1:378981984761:web:05f8f4e6a406e3e1d73528',
};
