"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const adapter_better_sqlite3_1 = require("@prisma/adapter-better-sqlite3");
const crypto_1 = require("crypto");
const path = __importStar(require("path"));
function createAdapter() {
    const dbUrl = process.env.DATABASE_URL ?? 'file:./dev.db';
    const dbPath = dbUrl.replace(/^file:/, '');
    const resolvedPath = path.isAbsolute(dbPath)
        ? dbPath
        : path.join(process.cwd(), dbPath);
    return new adapter_better_sqlite3_1.PrismaBetterSqlite3({ url: resolvedPath });
}
const prisma = new client_1.PrismaClient({ adapter: createAdapter() });
function generateCode() {
    return (0, crypto_1.randomBytes)(8).toString('hex').toUpperCase();
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
//# sourceMappingURL=seed.js.map