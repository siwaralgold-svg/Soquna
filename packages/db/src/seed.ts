import { sql } from 'drizzle-orm';
import type { Database } from './index';
import { cities, neighbourhoods } from './schema';
import { SEED_CITIES } from './seed-data';

/** Idempotent: safe to run on every deploy. Updates names, never deletes. */
export async function seed(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [index, city] of SEED_CITIES.entries()) {
      const [row] = await tx
        .insert(cities)
        .values({ slug: city.slug, nameAr: city.nameAr, nameEn: city.nameEn, sortOrder: index })
        .onConflictDoUpdate({
          target: cities.slug,
          set: { nameAr: city.nameAr, nameEn: city.nameEn, sortOrder: index },
        })
        .returning({ id: cities.id });

      for (const n of city.neighbourhoods ?? []) {
        await tx
          .insert(neighbourhoods)
          .values({ cityId: row!.id, slug: n.slug, nameAr: n.nameAr, nameEn: n.nameEn })
          .onConflictDoUpdate({
            target: [neighbourhoods.cityId, neighbourhoods.slug],
            set: { nameAr: sql`excluded.name_ar`, nameEn: sql`excluded.name_en` },
          });
      }
    }
  });
}
