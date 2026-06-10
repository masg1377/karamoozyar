/**
 * KarAmoozYar — Seed Managers
 * Adds Mahdi Asghari and MohammadReza Asghari as ADMIN users.
 * Run: pnpm --filter api exec ts-node prisma/seed-managers.ts
 */

import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const MANAGERS = [
  {
    nationalId: '2080828691',
    firstName: 'مهدی',
    lastName: 'اصغری',
    phoneNumber: '09301826338',
    password: 'Mahdi@Asghari1404',
    judicialDomain: 'مرکزی',
    expertiseField: 'مدیریت',
    role: Role.ADMIN,
  },
  {
    nationalId: '0000000003',
    firstName: 'محمدرضا',
    lastName: 'اصغری',
    phoneNumber: '09395404737',
    password: 'MohReza@Asghari1404',
    judicialDomain: 'مرکزی',
    expertiseField: 'مدیریت',
    role: Role.ADMIN,
  },
  {
    nationalId: '2092108018',
    firstName: 'فرشته',
    lastName: 'خداشناس',
    phoneNumber: '09910262500',
    password: 'Fereshteh@1404',
    judicialDomain: 'مرکزی',
    expertiseField: 'عمومی',
    role: Role.USER,
  },
];

async function main(): Promise<void> {
  console.log('🌱 Adding manager accounts...\n');

  for (const m of MANAGERS) {
    const hash = await bcrypt.hash(m.password, 10);
    const user = await prisma.user.upsert({
      where: { nationalId: m.nationalId },
      update: {
        firstName: m.firstName,
        lastName: m.lastName,
        phoneNumber: m.phoneNumber,
        role: m.role,
        isActive: true,
        passwordHash: hash,
      },
      create: {
        nationalId: m.nationalId,
        firstName: m.firstName,
        lastName: m.lastName,
        phoneNumber: m.phoneNumber,
        judicialDomain: m.judicialDomain,
        expertiseField: m.expertiseField,
        role: m.role,
        isActive: true,
        passwordHash: hash,
      },
    });

    // Create conversation for USER role (needed for chat)
    if (m.role === Role.USER) {
      await prisma.conversation.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
    }

    console.log(`✅ ${user.firstName} ${user.lastName}`);
    console.log(`   کد ملی  : ${m.nationalId}`);
    console.log(`   موبایل  : ${m.phoneNumber}`);
    console.log(`   پسورد   : ${m.password}`);
    console.log(`   نقش     : ${m.role}\n`);
  }

  console.log('🎉 Done.');
}

main()
  .catch((e) => { console.error('❌ Failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
