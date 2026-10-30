import dotenv from 'dotenv';
import path from 'node:path';
import dns from 'node:dns/promises';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { TelegramNotificationService, SuggestionNotifyData } from '../src/services/TelegramNotificationService.js';
import { CharacterService } from '../src/services/CharacterService.js';
import { config } from '../src/config.js';

// Carrega variáveis de ambiente (.env na raiz ou local)
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

async function resolveDatabaseUrl(): Promise<string> {
  let dbUrl = process.env.DATABASE_URL || config.DATABASE_URL;
  try {
    const parsed = new URL(dbUrl);
    if (parsed.hostname === 'postgres') {
      try {
        await dns.lookup('postgres');
      } catch {
        const hostPort = process.env.POSTGRES_PORT || '5433';
        parsed.hostname = '127.0.0.1';
        parsed.port = hostPort;
        dbUrl = parsed.toString();
      }
    }
  } catch (_) {}
  return dbUrl;
}

async function resolveRedisUrl(): Promise<string> {
  let redisUrl = process.env.REDIS_URL || config.REDIS_URL;
  try {
    const parsed = new URL(redisUrl);
    if (parsed.hostname === 'redis') {
      try {
        await dns.lookup('redis');
      } catch {
        const hostPort = process.env.REDIS_PORT || '6380';
        parsed.hostname = '127.0.0.1';
        parsed.port = hostPort;
        redisUrl = parsed.toString();
      }
    }
  } catch (_) {}
  return redisUrl;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   REENCAMINHAR SUGESTÕES PENDENTES PARA O TELEGRAM         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const dbUrl = await resolveDatabaseUrl();
  const redisUrl = await resolveRedisUrl();

  const prisma = new PrismaClient({
    datasources: {
      db: { url: dbUrl },
    },
  });

  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    retryStrategy: () => null, // não trava indefinidamente se offline
  });

  redis.on('error', (err) => {
    // Silencia erros de redis para não poluir logs se opcional
  });

  const telegramService = new TelegramNotificationService(redis);
  const characterService = new CharacterService(prisma, redis);

  if (!telegramService.isConfigured) {
    console.error('❌ Telegram não está configurado!');
    console.error('Verifique se TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID estão definidos no arquivo .env.');
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(1);
  }

  console.log(`🔌 Conectando ao Banco de Dados...`);
  try {
    const pendingCount = await prisma.characterSuggestion.count({
      where: { status: 'PENDING' },
    });

    console.log(`📋 Total de sugestões pendentes encontradas: ${pendingCount}\n`);

    if (pendingCount === 0) {
      console.log('✨ Nenhuma sugestão pendente para reencaminhar.');
      await prisma.$disconnect();
      redis.disconnect();
      process.exit(0);
    }

    const suggestions = await prisma.characterSuggestion.findMany({
      where: { status: 'PENDING' },
      include: {
        character: {
          select: {
            id: true,
            name: true,
            series: true,
            baseRarity: true,
            gender: true,
            description: true,
            tags: true,
            imageUrls: true,
            rank: true,
            waifuRank: true,
            haremEntries: {
              select: {
                user: {
                  select: { id: true, name: true, publicId: true },
                },
              },
            },
          },
        },
        user: {
          select: { id: true, publicId: true, name: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      const index = i + 1;

      let actionData: { action?: 'ADD' | 'DELETE' | 'REPLACE'; targetPhoto?: string } | null = null;
      if (s.type === 'IMAGE' && s.description) {
        try {
          actionData = JSON.parse(s.description);
        } catch (_) {}
      }

      const marriedUser = s.character?.haremEntries?.[0]?.user || null;
      const isMarriedToSuggester = Boolean(marriedUser && s.userId && marriedUser.id === s.userId);
      const photoAction = actionData?.action || (s.type === 'IMAGE' ? 'ADD' : null);
      const targetPhoto = actionData?.targetPhoto || null;

      const charName = s.characterName || s.character?.name || 'Personagem Desconhecido';
      console.log(`[${index}/${pendingCount}] Enviando ${s.type} ${photoAction ? `(${photoAction}) ` : ''}para "${charName}" (ID: ${s.id})...`);

      const notifyPayload: SuggestionNotifyData = {
        id: s.id,
        type: s.type as any,
        characterId: s.characterId,
        characterName: s.characterName || s.character?.name,
        series: s.series || s.character?.series,
        description: s.description,
        currentRarity: (s.currentRarity as any) || (s.character?.baseRarity as any),
        suggestedRarity: s.suggestedRarity as any,
        suggestedName: s.suggestedName,
        suggestedSeries: s.suggestedSeries,
        suggestedGender: s.suggestedGender as any,
        suggestedDescription: s.suggestedDescription,
        suggestedTags: s.suggestedTags,
        photoAction,
        targetPhoto,
        reason: s.reason,
        imageUrl: s.imageUrl,
        userName: s.user?.name || s.userId || 'Anônimo na Web',
        userId: s.userId,
        character: s.character
          ? {
              id: s.character.id,
              name: s.character.name,
              series: s.character.series,
              baseRarity: s.character.baseRarity,
              gender: s.character.gender,
              description: s.character.description,
              tags: s.character.tags,
              imageUrl: characterService.getRandomImageUrl(s.character.id, s.character.imageUrls),
              rank: s.character.rank,
              waifuRank: s.character.waifuRank,
            }
          : null,
        marriedUser: marriedUser ? { id: marriedUser.id, name: marriedUser.name } : null,
        isMarriedToSuggester,
        forceNotificationForTest: true,
      };

      try {
        await telegramService.notifySuggestion(notifyPayload);
        console.log(`   ✅ Enviado com sucesso!`);
        successCount++;
      } catch (err: any) {
        console.error(`   ❌ Falha ao enviar sugestão ${s.id}:`, err?.message || err);
        failureCount++;
      }

      // Intervalo de 1 segundo para respeitar o rate limit do Telegram (1 msg/segundo por chat)
      if (i < suggestions.length - 1) {
        await sleep(1000);
      }
    }

    console.log('\n======================================================');
    console.log(`🎉 Concluído!`);
    console.log(`   Total processadas: ${suggestions.length}`);
    console.log(`   Enviadas: ${successCount}`);
    if (failureCount > 0) {
      console.log(`   Falhas: ${failureCount}`);
    }
    console.log('======================================================\n');
  } catch (err: any) {
    console.error('❌ Erro durante o reencaminhamento:', err?.message || err);
  } finally {
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  }
}

main();
