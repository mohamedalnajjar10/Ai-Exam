import { PrismaClient, BranchName, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const branchesData: { name: BranchName; subjects: string[] }[] = [
  {
    name: BranchName.Scientific,
    subjects: [
      'Mathematics',
      'Physics',
      'Chemistry',
      'Biology',
      'English',
      'Arabic',
      'French',
      'National Education',
      'Religious Education',
    ],
  },
  {
    name: BranchName.Literary,
    subjects: [
      'History',
      'Geography',
      'Philosophy',
      'Sociology',
      'Psychology',
      'English',
      'Arabic',
      'French',
      'National Education',
      'Religious Education',
    ],
  },
  {
    name: BranchName.Industrial,
    subjects: [
      'Industrial Mechanics',
      'Electrical Engineering',
      'Electronics',
      'Technical Drawing',
      'Mathematics',
      'English',
      'Arabic',
    ],
  },
  {
    name: BranchName.Sharia,
    subjects: [
      'Islamic Jurisprudence',
      'Quran Interpretation',
      'Hadith',
      'Islamic Creed',
      'Arabic',
      'English',
      'National Education',
    ],
  },
];

async function main() {
  console.log('Seeding database...');

  for (const branchData of branchesData) {
    const branch = await prisma.branch.create({
      data: {
        name: branchData.name,
        subjects: {
          create: branchData.subjects.map((name) => ({ name })),
        },
      },
    });
    console.log(`Created branch: ${branch.name} with ${branchData.subjects.length} subjects`);
  }

  const adminEmail = 'admin@example.com';
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    const adminPassword = await bcrypt.hash('admin123', 12);
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: adminPassword,
        name: 'Admin',
        role: Role.ADMIN,
      },
    });
    console.log('Created admin user: admin@example.com / admin123');
  } else {
    console.log('Admin user already exists');
  }

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
