import { sql } from 'drizzle-orm';
import type { Database } from './index';
import { categories, cities, neighbourhoods, prohibitedTerms } from './schema';
import { SEED_CATEGORIES, SEED_CITIES, SEED_PROHIBITED_TERMS } from './seed-data';

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

    for (const [index, category] of SEED_CATEGORIES.entries()) {
      const [parent] = await tx
        .insert(categories)
        .values({ ...pick(category), sortOrder: index })
        .onConflictDoUpdate({
          target: categories.slug,
          set: { ...pick(category), sortOrder: index, parentId: null },
        })
        .returning({ id: categories.id });

      for (const [childIndex, child] of (category.children ?? []).entries()) {
        await tx
          .insert(categories)
          .values({ ...pick(child), parentId: parent!.id, sortOrder: childIndex })
          .onConflictDoUpdate({
            target: categories.slug,
            set: { ...pick(child), parentId: parent!.id, sortOrder: childIndex },
          });
      }
    }

    await tx
      .insert(prohibitedTerms)
      .values([...SEED_PROHIBITED_TERMS])
      .onConflictDoNothing();
  });
}

const pick = (c: { slug: string; nameAr: string; nameEn: string }) => ({
  slug: c.slug,
  nameAr: c.nameAr,
  nameEn: c.nameEn,
});
