import { prisma } from '../services/prisma.js';

const args = process.argv.slice(2);
const uid = args[0];
const role = args[1];

if (!uid || !role) {
  console.error('Usage: npm run auth:set-role <uid> <role>');
  process.exit(1);
}

const uidStr = uid as string;
const roleStr = role as string;

const allowedRoles = ['ADMIN', 'PROJECT_MANAGER', 'ENGINEER_LEAD', 'EXECUTIVE', 'VIEWER'];
if (!allowedRoles.includes(roleStr.toUpperCase())) {
  console.error(`Invalid role: ${roleStr}. Allowed roles: ${allowedRoles.join(', ')}`);
  process.exit(1);
}

async function setRole() {
  try {
    // Update user's role across their workspace memberships in Supabase DB via Prisma
    const res = await prisma.workspaceMember.updateMany({
      where: {
        userId: uidStr,
      },
      data: {
        role: roleStr.toUpperCase() as any,
      },
    });

    console.log(`Successfully set database workspace role '${roleStr.toUpperCase()}' for user ${uidStr}. Updated ${res.count} memberships.`);
    process.exit(0);
  } catch (error) {
    console.error('Error updating user role in database:', error);
    process.exit(1);
  }
}

setRole();
