import { AudioNotifier } from './audio.js';

const audio = new AudioNotifier(true);
console.log('Đang phát chuông + giọng đọc tiếng Việt "Đơn mới"...');
audio
  .announceNewOrder('new_order')
  .then(() => console.log('Hoàn tất kiểm tra loa!'))
  .catch((err) => {
    console.error('Lỗi phát loa:', err);
    process.exit(1);
  });
