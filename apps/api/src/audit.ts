import { auditLog, type Database } from '@souqna/db';

export interface AuditEntry {
  actorId: string | null;
  actorRole: 'user' | 'system' | 'admin' | 'finance' | 'moderator';
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  /** Must never contain PII (phone numbers, addresses, names). */
  metadata?: Record<string, unknown>;
}

export async function writeAudit(
  ctx: { db: Pick<Database, 'insert'>; hashIp?: (ip: string) => Buffer },
  entry: AuditEntry,
): Promise<void> {
  await ctx.db.insert(auditLog).values({
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    ipHash: entry.ip && ctx.hashIp ? ctx.hashIp(entry.ip) : undefined,
    metadata: entry.metadata ?? {},
  });
}
