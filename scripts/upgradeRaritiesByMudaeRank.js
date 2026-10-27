import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const RARITY_VALUE = {
  COMMON: 1,
  UNCOMMON: 2,
  RARE: 3,
  EPIC: 4,
  LEGENDARY: 5,
};

function getTargetRarity(rank) {
  if (!rank || rank <= 0) return null;
  if (rank <= 1000) return 'LEGENDARY';
  if (rank <= 3000) return 'EPIC';
  if (rank <= 10000) return 'RARE';
  return null;
}

async function run() {
  const isApply = process.argv.includes('--apply');
  console.log(`\n======================================================`);
  console.log(`🚀 SCRIPT DE ATUALIZAÇÃO DE RARIDADES (RANKS MUDAE)`);
  console.log(`MODO: ${isApply ? '🔥 APLICAÇÃO REAL (--apply)' : '🔍 DRY-RUN (Apenas Simulação)'}`);
  console.log(`REGRAS:`);
  console.log(`  - Rank 1..1000: Lendário`);
  console.log(`  - Rank 1001..3000: Épico`);
  console.log(`  - Rank 3001..10000: Raro`);
  console.log(`  - Apenas upgrades (sem downgrade)`);
  console.log(`======================================================\n`);

  try {
    const characters = await prisma.character.findMany({
      where: {
        rank: {
          gte: 1,
          lte: 10000,
        },
      },
      select: {
        id: true,
        name: true,
        series: true,
        rank: true,
        baseRarity: true,
      },
      orderBy: { rank: 'asc' },
    });

    console.log(`Total de personagens com rank entre 1 e 10000 encontrados: ${characters.length}`);

    let upgradeCount = 0;
    let unchangedCount = 0;
    let protectedDowngradeCount = 0;

    const transitions = {};
    const protectedDetails = {};
    const sampleUpgrades = [];
    const upgradesToExecute = [];

    for (const char of characters) {
      const currentRarity = char.baseRarity;
      const currentVal = RARITY_VALUE[currentRarity] || 1;
      const targetRarity = getTargetRarity(char.rank);
      if (!targetRarity) {
        unchangedCount++;
        continue;
      }
      const targetVal = RARITY_VALUE[targetRarity] || 1;

      if (targetVal > currentVal) {
        // Upgrade válido
        upgradeCount++;
        const key = `${currentRarity} ➔ ${targetRarity}`;
        transitions[key] = (transitions[key] || 0) + 1;
        upgradesToExecute.push({
          id: char.id,
          targetRarity,
        });

        if (sampleUpgrades.length < 10) {
          sampleUpgrades.push({
            rank: char.rank,
            name: char.name,
            series: char.series,
            from: currentRarity,
            to: targetRarity,
          });
        }
      } else if (targetVal < currentVal) {
        // Protegido contra downgrade
        protectedDowngradeCount++;
        unchangedCount++;
        const key = `${currentRarity} mantido (alvo seria ${targetRarity})`;
        protectedDetails[key] = (protectedDetails[key] || 0) + 1;
      } else {
        // Já possui a raridade alvo
        unchangedCount++;
      }
    }

    console.log(`\n📊 ESTATÍSTICAS DO PROCESSAMENTO:`);
    console.log(`------------------------------------------------------`);
    console.log(`Total Analisado: ${characters.length}`);
    console.log(`Personagens a serem UPGRADADOS: ${upgradeCount}`);
    console.log(`Personagens INALTERADOS: ${unchangedCount}`);
    console.log(`  ↳ Dos quais estão protegidos de downgrade: ${protectedDowngradeCount}`);
    console.log(`  ↳ Já estavam na raridade alvo ou superior: ${unchangedCount - protectedDowngradeCount}`);

    console.log(`\n📈 TRANSIÇÕES DETALHADAS DE UPGRADE:`);
    for (const [trans, count] of Object.entries(transitions)) {
      console.log(`  • ${trans.padEnd(25)}: ${count} personagens`);
    }

    console.log(`\n🛡️ PROTEÇÕES DE DOWNGRADE ATIVAS:`);
    for (const [prot, count] of Object.entries(protectedDetails)) {
      console.log(`  • ${prot.padEnd(45)}: ${count} personagens mantidos`);
    }

    console.log(`\n🌟 EXEMPLOS DE PERSONAGENS QUE SERÃO UPGRADADOS:`);
    sampleUpgrades.forEach((s) => {
      console.log(`  [Rank #${String(s.rank).padStart(4, ' ')}] ${s.name} (${s.series}) | ${s.from} ➔ ${s.to}`);
    });

    if (isApply) {
      console.log(`\n⏳ Aplicando atualizações no banco de dados via transação SQL atômica...`);

      const [resLegendary, resEpic, resRare] = await prisma.$transaction([
        // 1. Upgrade para Lendário (Rank 1..1000)
        prisma.$executeRawUnsafe(`
          UPDATE characters
          SET "baseRarity" = 'LEGENDARY', "updatedAt" = NOW()
          WHERE rank >= 1 AND rank <= 1000
            AND "baseRarity" IN ('COMMON', 'UNCOMMON', 'RARE', 'EPIC')
        `),
        // 2. Upgrade para Épico (Rank 1001..3000)
        prisma.$executeRawUnsafe(`
          UPDATE characters
          SET "baseRarity" = 'EPIC', "updatedAt" = NOW()
          WHERE rank > 1000 AND rank <= 3000
            AND "baseRarity" IN ('COMMON', 'UNCOMMON', 'RARE')
        `),
        // 3. Upgrade para Raro (Rank 3001..10000)
        prisma.$executeRawUnsafe(`
          UPDATE characters
          SET "baseRarity" = 'RARE', "updatedAt" = NOW()
          WHERE rank > 3000 AND rank <= 10000
            AND "baseRarity" IN ('COMMON', 'UNCOMMON')
        `),
      ]);

      const totalUpdated = resLegendary + resEpic + resRare;
      console.log(`\n✅ SUCESSO! Banco de dados atualizado.`);
      console.log(`  - Lendários atualizados (1..1000): ${resLegendary}`);
      console.log(`  - Épicos atualizados (1001..3000): ${resEpic}`);
      console.log(`  - Raros atualizados (3001..10000): ${resRare}`);
      console.log(`  - Total de registros afetados no banco: ${totalUpdated}`);
    } else {
      console.log(`\nℹ️ Modo Dry Run finalizado com sucesso. Nenhuma alteração foi gravada.`);
      console.log(`Para aplicar as mudanças no banco, execute com a flag --apply.`);
    }

    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ ERRO durante execução do script:`, err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

run();
