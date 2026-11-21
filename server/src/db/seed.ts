import { getDb } from './index.js';
import type { DrinkType } from '../../../shared/types.js';

interface SeedCategory {
  slug: string;
  name: string;
  subtitle: string;
  sortOrder: number;
}

interface SeedItem {
  categorySlug: string;
  slug: string;
  name: string;
  nameEn: string;
  description: string;
  price: number;
  imageUrl: string;
  imageFit: 'contain' | 'cover';
  isFeatured?: boolean;
  badge?: string;
  drinkType: DrinkType;
  variants?: string[];
  allowSize?: boolean;
  allowSugar?: boolean;
  allowIce?: boolean;
  allowToppings?: boolean;
}

const CATEGORIES: SeedCategory[] = [
  { slug: 'signature', name: 'Đặc biệt của Nâng', subtitle: 'Mác kham · Hạt dẻ · Thạch đen Cao Bằng', sortOrder: 1 },
  { slug: 'ca-phe', name: 'Cà phê', subtitle: 'Robusta Gia Lai · Arabica Blend', sortOrder: 2 },
  { slug: 'tra', name: 'Trà trái cây', subtitle: 'Trà xanh · Shan tuyết · Trái cây tươi', sortOrder: 3 },
  { slug: 'matcha', name: 'Matcha', subtitle: 'Matcha Nhật đánh tay', sortOrder: 4 },
  { slug: 'tra-sua', name: 'Trà sữa', subtitle: 'Hồng trà · Ô long · Đặc sản Cao Bằng', sortOrder: 5 },
  { slug: 'tra-nong', name: 'Trà nóng', subtitle: 'Ấm bụng ngày gió Cao Bằng', sortOrder: 6 },
  { slug: 'sinh-to', name: 'Sinh tố · Sữa chua', subtitle: 'Trái cây tươi xay mịn', sortOrder: 7 },
  { slug: 'nuoc-ep', name: 'Nước ép', subtitle: 'Ép tươi nguyên chất', sortOrder: 8 },
  { slug: 'do-uong-khac', name: 'Đồ uống khác', subtitle: 'Sữa tươi · Cacao · Dừa xiêm', sortOrder: 9 },
  { slug: 'do-an-nhe', name: 'Đồ ăn nhẹ', subtitle: 'Nhâm nhi cùng cà phê', sortOrder: 10 },
];

const ITEMS: SeedItem[] = [
  // 1. SIGNATURE — Đặc biệt của Nâng (từ menu-special.html)
  {
    categorySlug: 'signature',
    slug: 'ca-phe-hat-de',
    name: 'Cà phê hạt dẻ',
    nameEn: 'Chestnut Coffee',
    description: 'Cà phê hòa quyện hương thơm bùi béo của hạt dẻ Cao Bằng',
    price: 55000,
    imageUrl: '/images/menu/sig-ca-phe-hat-de.jpg',
    imageFit: 'cover',
    isFeatured: true,
    badge: 'Hạt dẻ Cao Bằng',
    drinkType: 'iced_or_hot',
  },
  {
    categorySlug: 'signature',
    slug: 'matcha-hat-de',
    name: 'Matcha hạt dẻ',
    nameEn: 'Chestnut Matcha',
    description: 'Lớp matcha Nhật thơm dịu trên nền sữa hạt dẻ bùi béo',
    price: 60000,
    imageUrl: '/images/menu/sig-matcha-hat-de.jpg',
    imageFit: 'cover',
    isFeatured: true,
    badge: 'Hạt dẻ Cao Bằng',
    drinkType: 'iced_or_hot',
  },
  {
    categorySlug: 'signature',
    slug: 'ca-phe-mac-kham',
    name: 'Cà phê mác kham',
    nameEn: 'Mac Kham Coffee',
    description: 'Vị chua thanh, hậu ngọt của quả mác kham núi đá cùng cà phê',
    price: 50000,
    imageUrl: '/images/menu/sig-ca-phe-mac-kham.jpg',
    imageFit: 'cover',
    isFeatured: true,
    badge: 'Mác kham',
    drinkType: 'cold_only',
  },
  {
    categorySlug: 'signature',
    slug: 'tra-mac-kham',
    name: 'Trà mác kham',
    nameEn: 'Mac Kham Tea',
    description: 'Trà thanh mát pha mác kham rừng Cao Bằng, hậu vị ngọt dịu',
    price: 50000,
    imageUrl: '/images/menu/sig-tra-mac-kham.jpg',
    imageFit: 'cover',
    isFeatured: true,
    badge: 'Mác kham',
    drinkType: 'iced_or_hot',
  },
  {
    categorySlug: 'signature',
    slug: 'nuoc-ep-mac-kham',
    name: 'Nước ép mác kham',
    nameEn: 'Mac Kham Juice',
    description: 'Ép tươi từ quả mác kham bản địa, giải nhiệt sảng khoái',
    price: 45000,
    imageUrl: '/images/menu/sig-nuoc-ep-mac-kham.jpg',
    imageFit: 'cover',
    isFeatured: true,
    badge: 'Mác kham',
    drinkType: 'cold_only',
  },

  // 2. CÀ PHÊ (từ Menu-15-09.html)
  {
    categorySlug: 'ca-phe',
    slug: 'ca-phe-den',
    name: 'Cà phê đen',
    nameEn: 'Black Coffee',
    description: 'Robusta Gia Lai rang mộc, đậm đà',
    price: 25000,
    imageUrl: '/images/menu/ca-phe-den.png',
    imageFit: 'contain',
    drinkType: 'iced_or_hot',
  },
  {
    categorySlug: 'ca-phe',
    slug: 'ca-phe-nau',
    name: 'Cà phê nâu',
    nameEn: 'Milk Coffee',
    description: 'Robusta Gia Lai kết hợp sữa đặc béo ngậy',
    price: 30000,
    imageUrl: '/images/menu/ca-phe-nau.png',
    imageFit: 'contain',
    drinkType: 'iced_or_hot',
  },
  {
    categorySlug: 'ca-phe',
    slug: 'bac-siu',
    name: 'Bạc sỉu',
    nameEn: 'Bac Xiu',
    description: 'Sữa đặc, sữa tươi, điểm nhẹ cốt cà phê thơm',
    price: 35000,
    imageUrl: '/images/menu/bac-siu.png',
    imageFit: 'contain',
    drinkType: 'iced_or_hot',
  },
  {
    categorySlug: 'ca-phe',
    slug: 'ca-phe-muoi',
    name: 'Cà phê muối',
    nameEn: 'Salted Coffee',
    description: 'Robusta đậm vị phủ lớp kem muối mịn béo',
    price: 35000,
    imageUrl: '/images/menu/ca-phe-muoi.png',
    imageFit: 'contain',
    badge: 'Được yêu thích',
    drinkType: 'iced_or_hot',
  },
  {
    categorySlug: 'ca-phe',
    slug: 'espresso',
    name: 'Espresso',
    nameEn: 'Espresso',
    description: 'Arabica Blend chiết xuất máy, hương thơm tinh tế',
    price: 35000,
    imageUrl: '/images/menu/espresso.png',
    imageFit: 'contain',
    drinkType: 'iced_or_hot',
    allowToppings: false,
  },
  {
    categorySlug: 'ca-phe',
    slug: 'americano',
    name: 'Americano',
    nameEn: 'Americano',
    description: 'Arabica Blend thanh nhẹ, tỉnh táo',
    price: 35000,
    imageUrl: '/images/menu/americano.png',
    imageFit: 'contain',
    drinkType: 'iced_or_hot',
  },
  {
    categorySlug: 'ca-phe',
    slug: 'latte-cappu',
    name: 'Latte / Cappuccino',
    nameEn: 'Latte / Cappuccino',
    description: 'Arabica Blend đánh cùng sữa tươi thanh ngọt',
    price: 50000,
    imageUrl: '/images/menu/latte-cappu.png',
    imageFit: 'contain',
    drinkType: 'iced_or_hot',
    variants: ['Latte', 'Cappuccino'],
  },
  {
    categorySlug: 'ca-phe',
    slug: 'ame-cam',
    name: 'Ame cam',
    nameEn: 'Orange Americano',
    description: 'Espresso Arabica kết hợp nước cam tươi chua dịu',
    price: 50000,
    imageUrl: '/images/menu/ame-cam.png',
    imageFit: 'contain',
    drinkType: 'cold_only',
  },
  {
    categorySlug: 'ca-phe',
    slug: 'mocha',
    name: 'Mocha',
    nameEn: 'Mocha',
    description: 'Arabica Blend, cacao đậm và sữa tươi mềm mịn',
    price: 55000,
    imageUrl: '/images/menu/mocha.png',
    imageFit: 'contain',
    drinkType: 'iced_or_hot',
  },
  {
    categorySlug: 'ca-phe',
    slug: 'coldbrew-chanh-vang',
    name: 'Cold Brew Chanh vàng',
    nameEn: 'Lemon Cold Brew',
    description: 'Cà phê ủ lạnh 24 giờ thanh mượt cùng chanh vàng tươi',
    price: 50000,
    imageUrl: '/images/menu/coldbrew-chanh-vang.png',
    imageFit: 'contain',
    badge: 'Nên thử',
    drinkType: 'cold_only',
  },
  {
    categorySlug: 'ca-phe',
    slug: 'coldbrew-vai-sau',
    name: 'Cold Brew Vải / Sấu',
    nameEn: 'Lychee / Sau Cold Brew',
    description: 'Cà phê ủ lạnh 24 giờ hòa quyện hương trái cây tươi',
    price: 50000,
    imageUrl: '/images/menu/coldbrew-vai.png',
    imageFit: 'contain',
    drinkType: 'cold_only',
    variants: ['Vị Vải', 'Vị Sấu'],
  },

  // 3. TRÀ TRÁI CÂY
  {
    categorySlug: 'tra',
    slug: 'tra-vai-man-tam-hoa',
    name: 'Trà vải mận tam hoa',
    nameEn: 'Lychee Plum Tea',
    description: 'Trà xanh thanh mát kết hợp vải ngọt và mận tam hoa',
    price: 45000,
    imageUrl: '/images/menu/tra-vai-man-tam-hoa-glass.png',
    imageFit: 'contain',
    badge: 'Nên thử',
    drinkType: 'cold_only',
  },
  {
    categorySlug: 'tra',
    slug: 'tra-dao-atiso',
    name: 'Trà đào atisô',
    nameEn: 'Peach Artichoke Tea',
    description: 'Trà đào thanh dịu quyện vị hoa atisô đỏ',
    price: 45000,
    imageUrl: '/images/menu/tra-dao-atiso-glass.png',
    imageFit: 'contain',
    drinkType: 'cold_only',
  },
  {
    categorySlug: 'tra',
    slug: 'tra-dao-cam-sa',
    name: 'Trà đào cam sả',
    nameEn: 'Peach Orange Lemongrass',
    description: 'Hương sả tươi, cam vàng và đào miếng giòn ngọt',
    price: 45000,
    imageUrl: '/images/menu/tra-dao-cam-xa-glass.png',
    imageFit: 'contain',
    drinkType: 'iced_or_hot',
  },
  {
    categorySlug: 'tra',
    slug: 'tra-oi-hong',
    name: 'Trà ổi hồng',
    nameEn: 'Pink Guava Tea',
    description: 'Trà xanh ướp hương ổi hồng tươi giòn mát',
    price: 45000,
    imageUrl: '/images/menu/tra-oi-hong-glass.png',
    imageFit: 'contain',
    drinkType: 'cold_only',
  },
  {
    categorySlug: 'tra',
    slug: 'tra-mo-muoi',
    name: 'Trà mơ muối ô mai',
    nameEn: 'Salted Plum Tea',
    description: 'Trà shan tuyết cổ thụ cùng mơ muối chua mặn dịu ngọt',
    price: 45000,
    imageUrl: '/images/menu/tra-mo-muoi-glass.png',
    imageFit: 'contain',
    badge: 'Nên thử',
    drinkType: 'cold_only',
  },

  // 4. MATCHA
  {
    categorySlug: 'matcha',
    slug: 'matcha-dua-xiem',
    name: 'Matcha dừa xiêm',
    nameEn: 'Coconut Matcha',
    description: 'Matcha Nhật đánh mịn trên nền nước dừa xiêm ngọt thanh',
    price: 55000,
    imageUrl: '/images/menu/matcha-coco.png',
    imageFit: 'contain',
    drinkType: 'cold_only',
  },
  {
    categorySlug: 'matcha',
    slug: 'matcha-cold-whisk',
    name: 'Matcha cold whisk yến mạch',
    nameEn: 'Oat Cold Whisk Matcha',
    description: 'Matcha Nhật đánh lạnh trực tiếp với sữa yến mạch béo thanh',
    price: 55000,
    imageUrl: '/images/menu/matcha-coldwisk.png',
    imageFit: 'contain',
    badge: 'Nên thử',
    drinkType: 'cold_only',
  },
  {
    categorySlug: 'matcha',
    slug: 'matcha-latte',
    name: 'Matcha latte',
    nameEn: 'Matcha Latte',
    description: 'Matcha Nhật tuyển chọn cùng sữa tươi béo dịu',
    price: 50000,
    imageUrl: '/images/menu/matcha-latte-new.png',
    imageFit: 'contain',
    drinkType: 'iced_or_hot',
  },

  // 5. TRÀ SỮA
  {
    categorySlug: 'tra-sua',
    slug: 'tra-sua-hat-de',
    name: 'Trà sữa hạt dẻ',
    nameEn: 'Chestnut Milk Tea',
    description: 'Hồng trà ủ đậm vị quyện sốt hạt dẻ Cao Bằng thơm bùi',
    price: 50000,
    imageUrl: '/images/menu/tra-sua-hat-de.png',
    imageFit: 'contain',
    badge: 'Hạt dẻ Cao Bằng',
    drinkType: 'iced_or_hot',
  },
  {
    categorySlug: 'tra-sua',
    slug: 'o-long-hanh-nhan',
    name: 'Ô long hạnh nhân',
    nameEn: 'Almond Oolong',
    description: 'Trà ô long hương khói nhẹ kết hợp sữa hạnh nhân thơm dịu',
    price: 50000,
    imageUrl: '/images/menu/o-long-sua.png',
    imageFit: 'contain',
    drinkType: 'iced_or_hot',
  },
  {
    categorySlug: 'tra-sua',
    slug: 'hong-tra-thach-den',
    name: 'Hồng trà thạch đen',
    nameEn: 'Black Tea with Grass Jelly',
    description: 'Hồng trà sữa đi kèm thạch đen Cao Bằng mát lành, giòn dai',
    price: 50000,
    imageUrl: '/images/menu/hong-tra-thach-den.png',
    imageFit: 'contain',
    badge: 'Thạch đen Cao Bằng',
    drinkType: 'cold_only',
  },
  {
    categorySlug: 'tra-sua',
    slug: 'tra-sua-ca-phe',
    name: 'Trà sữa cà phê',
    nameEn: 'Coffee Milk Tea',
    description: 'Hồng trà sữa điểm cốt cà phê thơm đậm, cân bằng vị',
    price: 50000,
    imageUrl: '/images/menu/tra-sua-ca-phe.png',
    imageFit: 'contain',
    drinkType: 'iced_or_hot',
  },

  // 6. TRÀ NÓNG
  {
    categorySlug: 'tra-nong',
    slug: 'tra-gung-mat-ong',
    name: 'Trà gừng mật ong',
    nameEn: 'Honey Ginger Tea',
    description: 'Gừng tươi thái lát ấm nóng cùng mật ong rừng nguyên chất',
    price: 35000,
    imageUrl: '/images/menu/tra-gung-mat-ong.png',
    imageFit: 'contain',
    drinkType: 'hot_only',
    allowIce: false,
    allowToppings: false,
  },
  {
    categorySlug: 'tra-nong',
    slug: 'tra-hoa-cuc-tao-do',
    name: 'Trà hoa cúc táo đỏ',
    nameEn: 'Chrysanthemum Jujube Tea',
    description: 'Hoa cúc vàng, táo đỏ và kỷ tử hãm nóng dịu nhẹ',
    price: 40000,
    imageUrl: '/images/menu/tra-hoa-cuc-tao-do.png',
    imageFit: 'contain',
    drinkType: 'hot_only',
    allowIce: false,
    allowToppings: false,
  },

  // 7. SINH TỐ · SỮA CHUA
  {
    categorySlug: 'sinh-to',
    slug: 'sen-com-cot-dua',
    name: 'Sen cốm cốt dừa',
    nameEn: 'Lotus & Green Rice Coconut',
    description: 'Hạt sen bùi, cốm thơm và nước cốt dừa xay mịn mát lạnh',
    price: 55000,
    imageUrl: '/images/menu/sen-com-cot-dua.png',
    imageFit: 'contain',
    drinkType: 'blended',
    allowIce: false,
  },
  {
    categorySlug: 'sinh-to',
    slug: 'chanh-tuyet',
    name: 'Chanh tuyết',
    nameEn: 'Frosty Lemonade',
    description: 'Chanh tươi xay đá tuyết mịn, chua ngọt mát lạnh',
    price: 50000,
    imageUrl: '/images/menu/chanh-tuyet.png',
    imageFit: 'contain',
    drinkType: 'blended',
    allowIce: false,
  },
  {
    categorySlug: 'sinh-to',
    slug: 'sinh-to-xoai',
    name: 'Sinh tố xoài',
    nameEn: 'Mango Smoothie',
    description: 'Xoài chín tươi xay cùng sữa đặc sánh mịn',
    price: 45000,
    imageUrl: '/images/menu/sinh-to-xoai-glass.png',
    imageFit: 'contain',
    drinkType: 'blended',
    allowIce: false,
  },
  {
    categorySlug: 'sinh-to',
    slug: 'sinh-to-mang-cau',
    name: 'Sinh tố mãng cầu',
    nameEn: 'Soursop Smoothie',
    description: 'Mãng cầu tươi dầm sữa xay mịn, chua thanh ngọt dịu',
    price: 50000,
    imageUrl: '/images/menu/mang-cau-glass.png',
    imageFit: 'contain',
    drinkType: 'blended',
    allowIce: false,
  },
  {
    categorySlug: 'sinh-to',
    slug: 'sua-chua-chanh-leo',
    name: 'Sữa chua chanh leo',
    nameEn: 'Passion Fruit Yogurt',
    description: 'Sữa chua mịn đánh cùng sốt chanh leo tươi và hạt đác',
    price: 50000,
    imageUrl: '/images/menu/sua-chua-chanh-leo-glass.png',
    imageFit: 'contain',
    drinkType: 'cold_only',
  },

  // 8. NƯỚC ÉP
  {
    categorySlug: 'nuoc-ep',
    slug: 'nuoc-ep-dua-hau',
    name: 'Nước ép dưa hấu',
    nameEn: 'Watermelon Juice',
    description: 'Dưa hấu tươi ép nguyên chất, thanh mát tự nhiên',
    price: 40000,
    imageUrl: '/images/menu/dua-hau-glass.png',
    imageFit: 'contain',
    drinkType: 'cold_only',
  },
  {
    categorySlug: 'nuoc-ep',
    slug: 'nuoc-ep-luu',
    name: 'Nước ép lựu',
    nameEn: 'Pomegranate Juice',
    description: 'Lựu đỏ ép tươi nguyên chất, giàu vitamin',
    price: 50000,
    imageUrl: '/images/menu/nuoc-ep-luu-glass.png',
    imageFit: 'contain',
    drinkType: 'cold_only',
  },
  {
    categorySlug: 'nuoc-ep',
    slug: 'nuoc-ep-cam-tao',
    name: 'Nước ép Cam / Táo',
    nameEn: 'Orange / Apple Juice',
    description: 'Ép tươi nguyên chất từ cam vàng hoặc táo giòn',
    price: 45000,
    imageUrl: '/images/menu/nuoc-ep-tao-glass.png',
    imageFit: 'contain',
    drinkType: 'cold_only',
    variants: ['Nước ép Cam', 'Nước ép Táo', 'Mix Cam Táo'],
  },
  {
    categorySlug: 'nuoc-ep',
    slug: 'chanh-day',
    name: 'Chanh dây',
    nameEn: 'Passion Fruit',
    description: 'Chanh dây tươi đánh đường thanh mát',
    price: 40000,
    imageUrl: '/images/menu/chanh-day-glass.png',
    imageFit: 'contain',
    drinkType: 'cold_only',
  },
  {
    categorySlug: 'nuoc-ep',
    slug: 'chanh-tuoi',
    name: 'Chanh tươi',
    nameEn: 'Fresh Lime Juice',
    description: 'Chanh tươi vắt mát lạnh, giải khát tức thì',
    price: 30000,
    imageUrl: '/images/menu/chanh-tuoi-glass.png',
    imageFit: 'contain',
    drinkType: 'iced_or_hot',
  },

  // 9. ĐỒ UỐNG KHÁC
  {
    categorySlug: 'do-uong-khac',
    slug: 'sua-tuoi-tran-chau',
    name: 'Sữa tươi trân châu đường đen',
    nameEn: 'Brown Sugar Pearl Milk',
    description: 'Sữa tươi béo mát cùng trân châu nấu đường đen dẻo thơm',
    price: 45000,
    imageUrl: '/images/menu/sua-tuoi-tran-chau.png',
    imageFit: 'contain',
    drinkType: 'cold_only',
  },
  {
    categorySlug: 'do-uong-khac',
    slug: 'cacao-tbros',
    name: 'CaCao T-bros',
    nameEn: 'T-bros Cocoa',
    description: 'Cacao nguyên chất T-bros đậm vị sô-cô-la tự nhiên',
    price: 45000,
    imageUrl: '/images/menu/cacao-nong.png',
    imageFit: 'contain',
    drinkType: 'iced_or_hot',
  },
  {
    categorySlug: 'do-uong-khac',
    slug: 'dua-xiem',
    name: 'Dừa xiêm',
    nameEn: 'Fresh Coconut',
    description: 'Nước dừa xiêm tươi mát ngọt thanh',
    price: 35000,
    imageUrl: '/images/menu/dua-xiem.png',
    imageFit: 'contain',
    drinkType: 'cold_only',
    allowSugar: false,
  },

  // 10. ĐỒ ĂN NHẸ
  {
    categorySlug: 'do-an-nhe',
    slug: 'banh-chuoi',
    name: 'Bánh chuối',
    nameEn: 'Banana Cake',
    description: 'Bánh chuối nướng mềm thơm, hợp dùng kèm cà phê',
    price: 40000,
    imageUrl: '/images/menu/banh-chuoi.png',
    imageFit: 'contain',
    drinkType: 'snack',
    allowSize: false,
    allowSugar: false,
    allowIce: false,
    allowToppings: false,
  },
  {
    categorySlug: 'do-an-nhe',
    slug: 'croissant',
    name: 'Croissant',
    nameEn: 'Croissant',
    description: 'Bánh sừng bò nướng bơ giòn xốp nhiều lớp',
    price: 35000,
    imageUrl: '/images/menu/croissant.png',
    imageFit: 'contain',
    drinkType: 'snack',
    allowSize: false,
    allowSugar: false,
    allowIce: false,
    allowToppings: false,
  },
  {
    categorySlug: 'do-an-nhe',
    slug: 'kho-bo-ga',
    name: 'Khô bò · khô gà',
    nameEn: 'Beef / Chicken Jerky',
    description: 'Đồ nhâm nhi đậm vị cho buổi trò chuyện',
    price: 20000,
    imageUrl: '/images/menu/kho-bo.png',
    imageFit: 'contain',
    drinkType: 'snack',
    variants: ['Khô bò', 'Khô gà lá chanh'],
    allowSize: false,
    allowSugar: false,
    allowIce: false,
    allowToppings: false,
  },
  {
    categorySlug: 'do-an-nhe',
    slug: 'huong-duong',
    name: 'Hướng dương',
    nameEn: 'Sunflower Seeds',
    description: 'Hạt hướng dương rang thơm giòn',
    price: 15000,
    imageUrl: '/images/menu/huong-duong.png',
    imageFit: 'contain',
    drinkType: 'snack',
    allowSize: false,
    allowSugar: false,
    allowIce: false,
    allowToppings: false,
  },
  {
    categorySlug: 'do-an-nhe',
    slug: 'bim-bim',
    name: 'Bim bim',
    nameEn: 'Crispy Snack',
    description: 'Snack giòn rụm',
    price: 10000,
    imageUrl: '/images/menu/bim-bim.png',
    imageFit: 'contain',
    drinkType: 'snack',
    allowSize: false,
    allowSugar: false,
    allowIce: false,
    allowToppings: false,
  },
];

// Official toppings from Menu-02-09.html & Menu-Bang-Ngang-Export.html (+8k each)
const TOPPINGS = [
  { slug: 'tran-chau-hoang-kim', name: 'Trân châu hoàng kim', price: 8000, sortOrder: 1 },
  { slug: 'tran-chau-o-long', name: 'Trân châu ô long', price: 8000, sortOrder: 2 },
  { slug: 'thach-den', name: 'Thạch đen Cao Bằng', price: 8000, sortOrder: 3 },
  { slug: 'thach-dao', name: 'Thạch đào', price: 8000, sortOrder: 4 },
  { slug: 'thach-vai', name: 'Thạch vải', price: 8000, sortOrder: 5 },
];

export async function seedDatabase(): Promise<void> {
  const db = getDb();

  // Seed categories
  const categoryIds = new Map<string, number>();
  for (const cat of CATEGORIES) {
    const res = await db.query<{ id: number }>(
      `INSERT INTO categories (slug, name, subtitle, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, subtitle = EXCLUDED.subtitle, sort_order = EXCLUDED.sort_order
       RETURNING id`,
      [cat.slug, cat.name, cat.subtitle, cat.sortOrder]
    );
    categoryIds.set(cat.slug, res.rows[0].id);
  }

  // Seed menu items (DO NOT overwrite is_available if item already exists!)
  let order = 1;
  for (const item of ITEMS) {
    const catId = categoryIds.get(item.categorySlug);
    if (!catId) continue;
    await db.query(
      `INSERT INTO menu_items (
         category_id, slug, name, name_en, description, price, image_url, image_fit,
         is_featured, badge, drink_type, variants,
         allow_size, allow_sugar, allow_ice, allow_toppings, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17)
       ON CONFLICT (slug) DO NOTHING`,
      [
        catId,
        item.slug,
        item.name,
        item.nameEn,
        item.description,
        item.price,
        item.imageUrl,
        item.imageFit,
        Boolean(item.isFeatured),
        item.badge || '',
        item.drinkType,
        JSON.stringify(item.variants || []),
        item.allowSize ?? true,
        item.allowSugar ?? true,
        item.allowIce ?? true,
        item.allowToppings ?? true,
        order++,
      ]
    );
  }

  // Seed toppings
  for (const t of TOPPINGS) {
    await db.query(
      `INSERT INTO toppings (slug, name, price, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO NOTHING`,
      [t.slug, t.name, t.price, t.sortOrder]
    );
  }

  // Seed initial settings
  await db.query(
    `INSERT INTO shop_settings (key, value)
     VALUES ('pause', $1::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify({ paused: false, message: '' })]
  );

  await db.query(
    `INSERT INTO shop_settings (key, value)
     VALUES ('store_info', $1::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [
      JSON.stringify({
        name: 'Nâng Café',
        tagline: 'Trong tiếng Tày – Nùng, Nâng là số một.',
        address: '075 tổ 10, P. Sông Hiến, Thục Phán, Cao Bằng',
        hours: '7:00 — 22:00',
      }),
    ]
  );

  console.log(`[DB] Seed verified (${CATEGORIES.length} categories, ${ITEMS.length} items, ${TOPPINGS.length} toppings)`);
}
