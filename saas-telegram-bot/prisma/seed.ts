import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { randomBytes } from 'crypto';
import * as path from 'path';

function createAdapter() {
  const dbUrl = process.env.DATABASE_URL ?? 'file:./dev.db';
  const dbPath = dbUrl.replace(/^file:/, '');
  const resolvedPath = path.isAbsolute(dbPath)
    ? dbPath
    : path.join(process.cwd(), dbPath);
  return new PrismaBetterSqlite3({ url: resolvedPath });
}

const prisma = new PrismaClient({ adapter: createAdapter() });

function generateCode(): string {
  return randomBytes(8).toString('hex').toUpperCase();
}

async function main() {
  console.log('🌱 Seeding database...');

  const codes = [
    { code: generateCode(), duration_days: 30 },
    { code: generateCode(), duration_days: 90 },
    { code: generateCode(), duration_days: 365 },
    { code: 'DEMO-ACTIVATE-30D', duration_days: 30 },
    { code: 'DEMO-ACTIVATE-90D', duration_days: 90 },
  ];

  for (const c of codes) {
    await prisma.activationCode.upsert({
      where: { code: c.code },
      create: c,
      update: {},
    });
  }

  console.log('✅ Activation codes created:');
  codes.forEach((c) => console.log(`   ${c.code} → ${c.duration_days} days`));

  const demoUser = await prisma.user.upsert({
    where: { telegram_id: '000000000' },
    create: {
      telegram_id: '000000000',
      username: 'demo_user',
      first_name: 'Demo',
      is_active: false,
    },
    update: {},
  });

  console.log(`\n✅ Demo user: telegram_id=${demoUser.telegram_id}`);
  console.log('\n🎉 Seed complete!');
  console.log('\n📝 To activate demo user, use code: DEMO-ACTIVATE-30D');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
