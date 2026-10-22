function iso(value) {
  return value === null || value === undefined ? null : new Date(value).toISOString();
}

// Porcentaje con dos decimales calculado con enteros grandes; null si no hay capacidad.
function percent(part, whole) {
  const p = BigInt(part);
  const w = whole === null || whole === undefined ? 0n : BigInt(whole);
  if (w <= 0n) return null;
  const hundredths = (p * 10000n + w / 2n) / w;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
}

function user(row) {
  return { id: row.user_id, name: row.user_name, email: row.user_email, active: row.user_active };
}

function page(rows, { limit, offset }) {
  return { total: rows.length ? rows[0].total : '0', limit, offset };
}

const JOB_STATUSES = ['queued', 'processing', 'converted', 'published', 'failed'];

export function createAdminService(repository) {
  return {
    async listSubscriptions(filters) {
      const rows = await repository.listSubscriptions(filters);
      return {
        items: rows.map((row) => ({
          id: row.id,
          status: row.status,
          current: row.current,
          startedAt: iso(row.started_at),
          expiresAt: iso(row.expires_at),
          user: user(row),
          plan: { code: row.plan_code, name: row.plan_name, capacityBytes: row.capacity_bytes },
        })),
        ...page(rows, filters),
      };
    },

    async listUsage(filters) {
      const rows = await repository.listUsage(filters);
      return {
        items: rows.map((row) => {
          const committed = (BigInt(row.used_bytes) + BigInt(row.reserved_bytes)).toString();
          const available = row.capacity_bytes === null ? null
            : (() => { const a = BigInt(row.capacity_bytes) - BigInt(committed); return (a > 0n ? a : 0n).toString(); })();
          return {
            user: user(row),
            plan: row.plan_code === null ? null
              : { code: row.plan_code, name: row.plan_name, capacityBytes: row.capacity_bytes },
            usedBytes: row.used_bytes,
            reservedBytes: row.reserved_bytes,
            availableBytes: available,
            usedPercent: percent(committed, row.capacity_bytes),
            imageCount: row.image_count,
            trashCount: row.trash_count,
          };
        }),
        ...page(rows, filters),
      };
    },

    async summary() {
      const { users, plans, storage, jobs } = await repository.summary();
      const logical = BigInt(storage.logical_bytes);
      const unique = BigInt(storage.unique_original_bytes);
      const jobCounts = Object.fromEntries(JOB_STATUSES.map((status) => [status, '0']));
      for (const row of jobs) jobCounts[row.status] = row.count;
      return {
        users: { total: users.total, active: users.active, verified: users.verified, admins: users.admins },
        plans: plans.map((row) => ({
          code: row.code, name: row.name, capacityBytes: row.capacity_bytes, currentSubscriptions: row.current_subscriptions,
        })),
        storage: {
          logicalBytes: storage.logical_bytes,
          reservedBytes: storage.reserved_bytes,
          uniqueOriginalBytes: storage.unique_original_bytes,
          deduplicatedBytes: (logical - unique).toString(),
          deduplicatedPercent: percent(logical - unique, logical) ?? '0.00',
          imageCount: storage.image_count,
          trashCount: storage.trash_count,
          uniqueObjectCount: storage.unique_object_count,
        },
        jobs: jobCounts,
      };
    },
  };
}
