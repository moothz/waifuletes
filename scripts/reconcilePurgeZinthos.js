import fs from 'fs';
import path from 'path';

// Carregar .env do waifuletes
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...rest] = trimmed.split('=');
      const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
      const k = key.trim();
      if (k && !process.env[k]) {
        process.env[k] = val;
      }
    }
  }
}

// Ajustar URL do Banco para acesso local caso necessário (porta 5433 no host)
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL
    .replace('@postgres:5432', '@127.0.0.1:5433')
    .replace('@localhost:5432', '@127.0.0.1:5433');
}

const args = process.argv.slice(2);
const IS_EXECUTE = args.includes('--execute');
const IS_DRY_RUN = !IS_EXECUTE || args.includes('--dry-run');

const LOG_PURGE_PATH = path.resolve('/home/moothz/waifucleanup/purge_lolis.log');
const BACKUP_JSON_PATH = path.resolve('/home/moothz/waifucleanup/deleted_characters_backup.json');

const RARITY_DIVORCE_VALUES = {
  COMMON: 50,
  UNCOMMON: 150,
  RARE: 350,
  EPIC: 700,
  LEGENDARY: 1500,
};
const DIVORCE_PENALTY_RATE = 0.05;

function calculateDivorceRefund(baseRarity, keys = 0) {
  const baseValue = RARITY_DIVORCE_VALUES[baseRarity] || 50;
  const keysBonus = Math.max(0, keys) * 15;
  const rawValue = baseValue + keysBonus;
  const netKakera = Math.floor(rawValue * (1 - DIVORCE_PENALTY_RATE));
  return netKakera;
}

async function main() {
  console.log('======================================================================');
  console.log(`⚖️  RECONCILIAÇÃO ECONÔMICA ESTRITA DO PURGE (WAIFULETES)`);
  console.log(`- Modo de Execução: ${IS_EXECUTE ? '🚀 EXECUÇÃO REAL NO BANCO' : '🔍 SIMULAÇÃO (DRY-RUN)'}`);
  console.log('======================================================================\n');

  if (!fs.existsSync(LOG_PURGE_PATH)) {
    console.error(`❌ Arquivo de log não encontrado: ${LOG_PURGE_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(BACKUP_JSON_PATH)) {
    console.error(`❌ Arquivo de backup não encontrado: ${BACKUP_JSON_PATH}`);
    process.exit(1);
  }

  // 1. Parse dos créditos concedidos nas 2 execuções do purge
  const logContent = fs.readFileSync(LOG_PURGE_PATH, 'utf-8');
  const creditMatches = Array.from(logContent.matchAll(/Credito de (\d+) Kakeras aplicado ao usuario (\S+)/g));

  const userReceivedMap = new Map();
  for (const m of creditMatches) {
    const amount = parseInt(m[1], 10);
    const userId = m[2];
    userReceivedMap.set(userId, (userReceivedMap.get(userId) || 0) + amount);
  }

  console.log(`📋 Total de créditos capturados no log: ${creditMatches.length}`);
  console.log(`👥 Total de usuários que receberam créditos: ${userReceivedMap.size}`);
  const totalGivenLog = Array.from(userReceivedMap.values()).reduce((a, b) => a + b, 0);
  console.log(`💰 Total injetado pelo bug do purge: ${totalGivenLog.toLocaleString()} Zinthos\n`);

  // 2. Parse das waifus deletadas do backup para obter raridade real
  const backupData = JSON.parse(fs.readFileSync(BACKUP_JSON_PATH, 'utf-8'));
  const purgedItems = backupData.purgedItems || [];

  const userFairRefundMap = new Map();
  const userMarriagesCountMap = new Map();

  for (const item of purgedItems) {
    const owners = item.haremOwners || [];
    const rarity = item.baseRarity || 'COMMON';
    const fairVal = calculateDivorceRefund(rarity, 0);

    for (const owner of owners) {
      const uid = owner.userId;
      userFairRefundMap.set(uid, (userFairRefundMap.get(uid) || 0) + fairVal);
      userMarriagesCountMap.set(uid, (userMarriagesCountMap.get(uid) || 0) + 1);
    }
  }

  // 3. Conectar ao PostgreSQL via Prisma
  const prismaPath = path.resolve(process.cwd(), 'api/node_modules/@prisma/client/default.js');
  const { PrismaClient } = await import(prismaPath);
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  const dbUsers = await prisma.user.findMany();
  const dbUserMap = new Map();
  for (const u of dbUsers) {
    dbUserMap.set(u.id, u);
  }

  // Estatísticas antes do reajuste
  const initialCirculation = dbUsers.reduce((acc, u) => acc + u.kakera, 0);
  console.log(`🏦 Saldo total em circulação no banco antes do reajuste: ${initialCirculation.toLocaleString()} Zinthos\n`);

  let totalFairPayout = 0;
  let totalDeduction = 0;
  const reconciliations = [];

  for (const [userId, received] of userReceivedMap.entries()) {
    // Normalizar ID de busca
    let targetUser = dbUserMap.get(userId);
    let matchedId = userId;
    if (!targetUser && userId.includes('@')) {
      const stripped = userId.split('@')[0];
      targetUser = dbUserMap.get(stripped);
      if (targetUser) matchedId = stripped;
    } else if (!targetUser) {
      const withDomain = `${userId}@s.whatsapp.net`;
      targetUser = dbUserMap.get(withDomain);
      if (targetUser) matchedId = withDomain;
    }

    const currentBalance = targetUser ? targetUser.kakera : 0;
    const marriagesCount = userMarriagesCountMap.get(userId) || (received >= 2000 ? Math.floor(received / 2000) : 1);
    const fairRefund = userFairRefundMap.get(userId) || (marriagesCount * calculateDivorceRefund('COMMON', 0));
    const excess = Math.max(0, received - fairRefund);
    const targetBalance = Math.max(0, currentBalance - excess);
    const actualDeducted = currentBalance - targetBalance;

    totalFairPayout += fairRefund;
    totalDeduction += actualDeducted;

    reconciliations.push({
      userId: matchedId,
      name: targetUser ? targetUser.name : 'Desconhecido',
      existsInDb: !!targetUser,
      marriagesCount,
      received,
      fairRefund,
      currentBalance,
      excess,
      actualDeducted,
      newBalance: targetBalance,
    });
  }

  reconciliations.sort((a, b) => b.excess - a.excess);

  console.log('-------------------------------------------------------------------------------------------------------');
  console.log(
    `| ${'Pos'.padEnd(3)} | ${'Nome'.padEnd(17)} | ${'Waifus'.padStart(6)} | ${'Recebeu'.padStart(7)} | ${'Justo'.padStart(7)} | ${'Saldo Atual'.padStart(11)} | ${'Estorno'.padStart(9)} | ${'Novo Saldo'.padStart(10)} |`
  );
  console.log('-------------------------------------------------------------------------------------------------------');

  for (let i = 0; i < Math.min(20, reconciliations.length); i++) {
    const r = reconciliations[i];
    console.log(
      `| ${(i + 1).toString().padEnd(3)} | ${r.name.slice(0, 17).padEnd(17)} | ${r.marriagesCount.toString().padStart(6)} | ${r.received.toLocaleString().padStart(7)} | ${r.fairRefund.toLocaleString().padStart(7)} | ${r.currentBalance.toLocaleString().padStart(11)} | ${r.actualDeducted.toLocaleString().padStart(9)} | ${r.newBalance.toLocaleString().padStart(10)} |`
    );
  }
  console.log('-------------------------------------------------------------------------------------------------------\n');

  console.log(`📊 RESUMO DA RECONCILIAÇÃO:`);
  console.log(`- Usuários reconciliados: ${reconciliations.length}`);
  console.log(`- Total que foi recebido no purge: ${totalGivenLog.toLocaleString()} Zinthos`);
  console.log(`- Total justo pelo valor real de divórcio: ${totalFairPayout.toLocaleString()} Zinthos`);
  console.log(`- Total de excesso a estornar: ${totalDeduction.toLocaleString()} Zinthos`);
  console.log(`- Nova circulação prevista: ${(initialCirculation - totalDeduction).toLocaleString()} Zinthos\n`);

  if (!IS_EXECUTE) {
    console.log('⚠️  MODO SIMULAÇÃO CONCLUÍDO. Nenhuma alteração foi gravada no banco.');
    console.log('👉 Para aplicar as alterações permanentemente, execute com a flag: --execute\n');
    await prisma.$disconnect();
    return;
  }

  console.log('🚀 APLICANDO TRANSAÇÕES NO POSTGRESQL...');
  let updatedCount = 0;

  for (const r of reconciliations) {
    if (!r.existsInDb || r.actualDeducted <= 0) continue;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: r.userId },
        data: { kakera: r.newBalance },
      });

      await tx.kakeraTransaction.create({
        data: {
          userId: r.userId,
          amount: -r.actualDeducted,
          reason: 'ADMIN_GRANT',
          metadata: {
            type: 'PURGE_STRICT_RECONCILIATION',
            purgedMarriagesCount: r.marriagesCount,
            receivedInPurge: r.received,
            legitimateDivorceRefund: r.fairRefund,
            excessDeducted: r.actualDeducted,
            appliedAt: new Date().toISOString(),
          },
        },
      });
    });

    updatedCount++;
  }

  const finalUsers = await prisma.user.findMany();
  const finalCirculation = finalUsers.reduce((acc, u) => acc + u.kakera, 0);

  console.log(`✅ SUCESSO! ${updatedCount} usuários atualizados atomicamente.`);
  console.log(`🏦 Saldo total em circulação agora: ${finalCirculation.toLocaleString()} Zinthos.`);
  console.log('======================================================================\n');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Erro fatal durante reconciliação:', err);
  process.exit(1);
});
