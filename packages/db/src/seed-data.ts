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
