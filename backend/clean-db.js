import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe('TRUNCATE "action_items", "decisions", "risks", "execution_plans", "meetings" CASCADE;');
  console.log('Database cleaned successfully!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());


  