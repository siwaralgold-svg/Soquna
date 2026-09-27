/**
 * Starting list of cities. Admins will manage cities and neighbourhoods from the admin
 * screens (Phase 6); until then, edit this file and run `pnpm db:seed` again.
 * Neighbourhoods are left empty on purpose until the launch city's list is confirmed.
 */
export const SEED_CITIES: ReadonlyArray<{
  slug: string;
  nameAr: string;
  nameEn: string;
  neighbourhoods?: ReadonlyArray<{ slug: string; nameAr: string; nameEn: string }>;
}> = [
  { slug: 'port-sudan', nameAr: 'بورتسودان', nameEn: 'Port Sudan' },
  { slug: 'kassala', nameAr: 'كسلا', nameEn: 'Kassala' },
  { slug: 'atbara', nameAr: 'عطبرة', nameEn: 'Atbara' },
  { slug: 'omdurman', nameAr: 'أم درمان', nameEn: 'Omdurman' },
  { slug: 'khartoum', nameAr: 'الخرطوم', nameEn: 'Khartoum' },
  { slug: 'khartoum-north', nameAr: 'الخرطوم بحري', nameEn: 'Khartoum North (Bahri)' },
  { slug: 'wad-madani', nameAr: 'ود مدني', nameEn: 'Wad Madani' },
  { slug: 'el-obeid', nameAr: 'الأبيض', nameEn: 'El Obeid' },
];

type SeedCategory = {
  slug: string;
  nameAr: string;
  nameEn: string;
  children?: ReadonlyArray<{ slug: string; nameAr: string; nameEn: string }>;
};

/**
 * Starting category tree (two levels). Listings go in a leaf category. Admins will edit this
 * from the admin screens (Phase 6); until then, edit here and run `pnpm db:seed`.
 */
export const SEED_CATEGORIES: ReadonlyArray<SeedCategory> = [
  {
    slug: 'phones-tablets',
    nameAr: 'موبايلات وتابلت',
    nameEn: 'Phones & tablets',
    children: [
      { slug: 'mobile-phones', nameAr: 'موبايلات', nameEn: 'Mobile phones' },
      { slug: 'tablets', nameAr: 'تابلت', nameEn: 'Tablets' },
      { slug: 'phone-accessories', nameAr: 'إكسسوارات موبايل', nameEn: 'Phone accessories' },
    ],
  },
  {
    slug: 'electronics',
    nameAr: 'إلكترونيات',
    nameEn: 'Electronics',
    children: [
      { slug: 'computers', nameAr: 'كمبيوتر ولابتوب', nameEn: 'Computers & laptops' },
      { slug: 'tv-audio', nameAr: 'تلفزيونات وصوتيات', nameEn: 'TVs & audio' },
      { slug: 'gaming', nameAr: 'ألعاب فيديو', nameEn: 'Video games & consoles' },
      { slug: 'cameras', nameAr: 'كاميرات', nameEn: 'Cameras' },
    ],
  },
  {
    slug: 'home-appliances',
    nameAr: 'أجهزة منزلية',
    nameEn: 'Home appliances',
    children: [
      { slug: 'kitchen-appliances', nameAr: 'أجهزة مطبخ', nameEn: 'Kitchen appliances' },
      { slug: 'fridges-freezers', nameAr: 'ثلاجات وفريزرات', nameEn: 'Fridges & freezers' },
      { slug: 'cooling-fans', nameAr: 'مكيفات ومراوح', nameEn: 'ACs & fans' },
      { slug: 'washing-machines', nameAr: 'غسالات', nameEn: 'Washing machines' },
      { slug: 'solar-power', nameAr: 'طاقة شمسية وبطاريات', nameEn: 'Solar & batteries' },
    ],
  },
  {
    slug: 'furniture-home',
    nameAr: 'أثاث ومنزل',
    nameEn: 'Furniture & home',
    children: [
      { slug: 'furniture', nameAr: 'أثاث', nameEn: 'Furniture' },
      { slug: 'kitchenware', nameAr: 'أواني منزلية', nameEn: 'Kitchenware' },
      { slug: 'home-decor', nameAr: 'ديكور ومفروشات', nameEn: 'Decor & furnishings' },
    ],
  },
  {
    slug: 'fashion',
    nameAr: 'أزياء',
    nameEn: 'Fashion',
    children: [
      { slug: 'womens-clothing', nameAr: 'ملابس نسائية', nameEn: "Women's clothing" },
      { slug: 'tobes-abayas', nameAr: 'توب وعبايات', nameEn: 'Tobes & abayas' },
      { slug: 'mens-clothing', nameAr: 'ملابس رجالية', nameEn: "Men's clothing" },
      { slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' },
      { slug: 'bags', nameAr: 'شنط', nameEn: 'Bags' },
      { slug: 'watches-accessories', nameAr: 'ساعات وإكسسوارات', nameEn: 'Watches & accessories' },
    ],
  },
  {
    slug: 'beauty',
    nameAr: 'جمال وعناية',
    nameEn: 'Beauty & care',
    children: [
      { slug: 'skincare', nameAr: 'عناية بالبشرة', nameEn: 'Skincare' },
      { slug: 'makeup', nameAr: 'مكياج', nameEn: 'Makeup' },
      { slug: 'perfumes-incense', nameAr: 'عطور وبخور', nameEn: 'Perfumes & incense' },
      { slug: 'hair-care', nameAr: 'عناية بالشعر', nameEn: 'Hair care' },
    ],
  },
  {
    slug: 'baby-kids',
    nameAr: 'أطفال',
    nameEn: 'Baby & kids',
    children: [
      { slug: 'kids-clothing', nameAr: 'ملابس أطفال', nameEn: "Kids' clothing" },
      { slug: 'baby-gear', nameAr: 'مستلزمات أطفال', nameEn: 'Baby gear' },
      { slug: 'toys', nameAr: 'ألعاب أطفال', nameEn: 'Toys' },
    ],
  },
  {
    slug: 'vehicles',
    nameAr: 'مركبات وقطع غيار',
    nameEn: 'Vehicles & parts',
    children: [
      { slug: 'cars', nameAr: 'عربات', nameEn: 'Cars' },
      { slug: 'motorbikes-rickshaws', nameAr: 'مواتر وركشات', nameEn: 'Motorbikes & rickshaws' },
      { slug: 'spare-parts', nameAr: 'قطع غيار', nameEn: 'Spare parts' },
    ],
  },
  { slug: 'books-education', nameAr: 'كتب وتعليم', nameEn: 'Books & education' },
  { slug: 'sports', nameAr: 'رياضة', nameEn: 'Sports' },
  { slug: 'handmade', nameAr: 'أشغال يدوية', nameEn: 'Handmade & crafts' },
  { slug: 'other', nameAr: 'أخرى', nameEn: 'Other' },
];

/**
 * Starting keyword list for the prohibited-items policy. `block` stops a listing; `review`
 * sends it to a moderator. Admins will manage this list (Phase 6). The seed never overwrites
 * a term that already exists, so admin changes survive re-seeding.
 */
export const SEED_PROHIBITED_TERMS: ReadonlyArray<{ term: string; action: 'block' | 'review' }> = [
  // Weapons
  ...['سلاح', 'أسلحة', 'مسدس', 'بندقية', 'كلاشنكوف', 'ذخيرة', 'قنبلة'].map((term) => ({
    term,
    action: 'block' as const,
  })),
  ...['gun', 'pistol', 'rifle', 'ammunition', 'ammo', 'grenade'].map((term) => ({
    term,
    action: 'block' as const,
  })),
  // Drugs and alcohol
  ...['مخدرات', 'حشيش', 'بنقو', 'ترامادول', 'كبتاجون', 'هيروين', 'كوكايين', 'عرقي', 'خمر'].map(
    (term) => ({ term, action: 'block' as const }),
  ),
  ...['cocaine', 'heroin', 'hashish', 'cannabis', 'marijuana', 'tramadol', 'captagon'].map(
    (term) => ({ term, action: 'block' as const }),
  ),
  ...['alcohol', 'whisky', 'whiskey'].map((term) => ({ term, action: 'block' as const })),
  // Identity documents, stolen and counterfeit goods
  ...['جواز سفر', 'رقم وطني', 'بطاقة شخصية', 'مسروق', 'مسروقة', 'مزور', 'مزورة'].map((term) => ({
    term,
    action: 'block' as const,
  })),
  ...['passport', 'stolen', 'counterfeit'].map((term) => ({ term, action: 'block' as const })),
  // Needs a human look: medicines, animals, currency exchange, replicas
  ...['دواء', 'أدوية', 'حقن', 'medicine', 'pills'].map((term) => ({
    term,
    action: 'review' as const,
  })),
  ...['حيوان', 'خروف', 'ماعز', 'كلب', 'قطة', 'animal', 'puppy', 'kitten'].map((term) => ({
    term,
    action: 'review' as const,
  })),
  ...['دولار', 'عملة', 'تقليد', 'replica'].map((term) => ({ term, action: 'review' as const })),
];
