import QRCode from 'qrcode';
import { config } from '../config.js';
import type { VietQRPaymentInfo } from '../../../shared/types.js';

function tlv(id: string, value: string): string {
  const len = Buffer.byteLength(value, 'utf8').toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

/**
 * CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) as required by EMVCo QR & NAPAS VietQR 2.0
 */
function crc16CcittFalse(input: string): string {
  let crc = 0xffff;
  const bytes = Buffer.from(input, 'utf8');
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function sanitizeAscii(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9 .\-_]/g, '')
    .trim();
}

/**
 * Builds an EMVCo / NAPAS 247 VietQR payload string scannable by all Vietnamese banking apps.
 */
export function buildVietQrPayload(params: {
  bankBin: string;
  accountNo: string;
  amount: number;
  content: string;
}): string {
  const bin = params.bankBin.replace(/\D/g, '');
  const acc = params.accountNo.replace(/\s+/g, '');
  const amountStr = Math.max(0, Math.round(params.amount)).toString();
  const cleanContent = sanitizeAscii(params.content).slice(0, 50);

  // Tag 38: Merchant Account Information (NAPAS VietQR)
  //   00: AID = A000000727
  //   01: Beneficiary org (00: Bank BIN, 01: Account No)
  //   02: Service code = QRIBFTTA (fast transfer to account)
  const beneficiary = tlv('00', bin) + tlv('01', acc);
  const merchantAccountInfo =
    tlv('00', 'A000000727') + tlv('01', beneficiary) + tlv('02', 'QRIBFTTA');

  const parts: string[] = [
    tlv('00', '01'), // Payload Format Indicator
    tlv('01', amountStr !== '0' ? '12' : '11'), // 12 = Dynamic QR (with amount)
    tlv('38', merchantAccountInfo),
    tlv('53', '704'), // Currency: VND
  ];

  if (amountStr !== '0') {
    parts.push(tlv('54', amountStr));
  }

  parts.push(tlv('58', 'VN')); // Country code

  if (cleanContent) {
    // Tag 62: Additional Data Field Template -> Subtag 08: Purpose of Transaction
    parts.push(tlv('62', tlv('08', cleanContent)));
  }

  const withoutCrc = parts.join('') + '6304';
  const crc = crc16CcittFalse(withoutCrc);
  return withoutCrc + crc;
}

export async function generateOrderVietQr(
  orderCode: string,
  amount: number
): Promise<VietQRPaymentInfo | undefined> {
  if (!config.vietqr.accountNo) {
    return undefined;
  }

  const emvPayload = buildVietQrPayload({
    bankBin: config.vietqr.bankBin,
    accountNo: config.vietqr.accountNo,
    amount,
    content: orderCode,
  });

  const qrDataUrl = await QRCode.toDataURL(emvPayload, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 440,
    color: {
      dark: '#0B4A53', // Nâng Café deep teal (high contrast on white)
      light: '#FFFFFF',
    },
  });

  return {
    bankBin: config.vietqr.bankBin,
    bankName: config.vietqr.bankName,
    accountNo: config.vietqr.accountNo,
    accountName: config.vietqr.accountName,
    amount,
    content: orderCode,
    emvPayload,
    qrDataUrl,
  };
}
