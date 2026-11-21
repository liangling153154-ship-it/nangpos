import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { printReceipt, type PrinterMode } from './printer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(agentRoot, '.env') });

const mode = (process.env.PRINTER_MODE || 'mock') as PrinterMode;
const printerName = process.env.PRINTER_NAME || '';
const paperMm = Number(process.env.PRINTER_PAPER_MM) === 58 ? 58 : 80;

printReceipt(
  {
    orderCode: 'NC8888',
    createdAt: new Date().toISOString(),
    isReprint: false,
    isTest: true,
    customerName: 'Nguyễn Minh Anh',
    customerPhone: '0912 345 678',
    customerAddress: 'Số 24 đường Kim Đồng, P. Hợp Giang, Cao Bằng',
    note: 'Gọi trước khi giao 5 phút giúp mình nhé',
    items: [
      {
        menuItemId: 1,
        name: 'Cà phê hạt dẻ',
        basePrice: 55000,
        size: 'L',
        sizeLabel: 'Lớn (L)',
        sizePrice: 10000,
        ice: 'Ít đá',
        sugar: '70% đường',
        toppings: [{ slug: 'thach-den', name: 'Thạch đen Cao Bằng', price: 8000 }],
        note: 'Ít kem hơn chút',
        quantity: 1,
        unitPrice: 73000,
        lineTotal: 73000,
      },
      {
        menuItemId: 17,
        name: 'Trà vải mận tam hoa',
        basePrice: 45000,
        size: 'M',
        sizeLabel: 'Tiêu chuẩn (M)',
        sizePrice: 0,
        ice: 'Đá bình thường',
        sugar: '50% đường',
        toppings: [],
        quantity: 2,
        unitPrice: 45000,
        lineTotal: 90000,
      },
    ],
    totalAmount: 163000,
    paymentMethod: 'cod',
    paymentStatus: 'cod',
  },
  {
    mode,
    printerName,
    paperMm,
    host: process.env.PRINTER_HOST || '192.168.1.200',
    port: Number(process.env.PRINTER_PORT || 9100),
    mockOutputDir: path.join(agentRoot, 'printed-receipts'),
  },
  'test'
)
  .then(() => console.log('Hoàn tất in thử!'))
  .catch((err) => {
    console.error('Lỗi in thử:', err);
    process.exit(1);
  });
