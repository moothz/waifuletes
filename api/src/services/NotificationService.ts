import { PrismaClient, NotificationType } from '@prisma/client';

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: any;
}

export class NotificationService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Cria uma notificação individual para um usuário
   */
  async createNotification(params: CreateNotificationParams) {
    return this.prisma.userNotification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        metadata: params.metadata || null,
      },
    });
  }

  /**
   * Notifica todos os jogadores casados e com o personagem na wishlist
   * sobre alterações aprovadas na waifu (raridade, nome, série, tags, fotos, etc.)
   */
  async notifyCharacterModification(characterId: string, changes: string[]) {
    if (!changes || changes.length === 0) return;

    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true, name: true },
    });

    if (!character) return;

    // 1. Busca quem é casado com o personagem
    const marriedEntries = await this.prisma.haremEntry.findMany({
      where: { characterId },
      select: { userId: true },
    });
    const marriedUserIds = new Set(marriedEntries.map((m) => m.userId));

    // 2. Busca quem possui o personagem na wishlist
    const wishlistEntries = await this.prisma.wishlistEntry.findMany({
      where: { characterId },
      select: { userId: true },
    });

    const notificationsData: Array<{
      userId: string;
      type: NotificationType;
      title: string;
      message: string;
      metadata: any;
    }> = [];

    const changesText = changes.join(' • ');

    // Notificações para casados
    for (const userId of marriedUserIds) {
      notificationsData.push({
        userId,
        type: 'CHARACTER_UPDATED',
        title: `💍 Sua waifu ${character.name} foi atualizada!`,
        message: `Modificações aprovadas: ${changesText}`,
        metadata: {
          characterId: character.id,
          characterName: character.name,
          context: 'married',
          changes,
        },
      });
    }

    // Notificações para wishlist (evita duplicar se já for casado)
    for (const entry of wishlistEntries) {
      if (!marriedUserIds.has(entry.userId)) {
        notificationsData.push({
          userId: entry.userId,
          type: 'CHARACTER_UPDATED',
          title: `⭐ ${character.name} da sua Wishlist foi atualizada!`,
          message: `Modificações aprovadas: ${changesText}`,
          metadata: {
            characterId: character.id,
            characterName: character.name,
            context: 'wishlist',
            changes,
          },
        });
      }
    }

    if (notificationsData.length > 0) {
      await this.prisma.userNotification.createMany({
        data: notificationsData,
      });
    }
  }

  /**
   * Notifica o autor de uma sugestão sobre o veredito da moderação
   */
  async notifySuggestionReview(
    userId: string,
    characterName: string,
    status: 'APPROVED' | 'REJECTED',
    typeDesc: string,
    rejectionReason?: string
  ) {
    if (!userId) return;

    const isApproved = status === 'APPROVED';
    const title = isApproved
      ? `✅ Sua sugestão para ${characterName} foi aprovada!`
      : `❌ Sua sugestão para ${characterName} foi recusada`;

    const message = isApproved
      ? `A alteração de ${typeDesc} foi aprovada e já está em vigor no jogo!`
      : `Motivo da recusa: ${rejectionReason || 'Não atendeu aos critérios da moderação.'}`;

    return this.createNotification({
      userId,
      type: isApproved ? 'SUGGESTION_APPROVED' : 'SUGGESTION_REJECTED',
      title,
      message,
      metadata: { characterName, status, typeDesc, rejectionReason },
    });
  }

  /**
   * Notifica eventos de mercado / classificados
   */
  async notifyMarketEvent(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    metadata?: any
  ) {
    return this.createNotification({
      userId,
      type,
      title,
      message,
      metadata,
    });
  }

  /**
   * Lista notificações paginadas com contagem de não lidas
   */
  async getUserNotifications(
    userId: string,
    options: { page?: number; limit?: number; unreadOnly?: boolean } = {}
  ) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(50, Math.max(1, options.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (options.unreadOnly) {
      where.isRead = false;
    }

    const [total, unreadCount, notifications] = await Promise.all([
      this.prisma.userNotification.count({ where }),
      this.prisma.userNotification.count({ where: { userId, isRead: false } }),
      this.prisma.userNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      notifications,
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Marca notificações como lidas (específicas ou todas)
   */
  async markAsRead(userId: string, notificationIds?: string[]) {
    if (notificationIds && notificationIds.length > 0) {
      return this.prisma.userNotification.updateMany({
        where: {
          userId,
          id: { in: notificationIds },
        },
        data: { isRead: true },
      });
    }

    return this.prisma.userNotification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.markAsRead(userId);
  }
}
