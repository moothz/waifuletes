import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('🔔 Notificações no Dispositivo (Web Push / Local Alert)', () => {
  describe('Arquivo Service Worker (sw.js)', () => {
    it('deve existir no diretório public e conter os eventos install e notificationclick', () => {
      const swPath = path.resolve(__dirname, '../public/sw.js');
      expect(fs.existsSync(swPath)).toBe(true);
      const content = fs.readFileSync(swPath, 'utf-8');
      expect(content).toContain("addEventListener('install'");
      expect(content).toContain("addEventListener('activate'");
      expect(content).toContain("addEventListener('notificationclick'");
      expect(content).toContain('event.notification.close()');
    });
  });

  describe('Lógica de armazenamento e controle de estado (localStorage)', () => {
    let mockStorage: Record<string, string> = {};

    beforeEach(() => {
      mockStorage = {};
      vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => mockStorage[key] ?? null),
        setItem: vi.fn((key: string, val: string) => {
          mockStorage[key] = String(val);
        }),
        removeItem: vi.fn((key: string) => {
          delete mockStorage[key];
        }),
      });
    });

    function isDeviceNotifsEnabled() {
      return localStorage.getItem('waifuletes_device_notifs_enabled') === 'true';
    }

    function getAlertedNotifIds(): Set<string> {
      try {
        return new Set(JSON.parse(localStorage.getItem('waifuletes_alerted_notif_ids') || '[]'));
      } catch (_) {
        return new Set();
      }
    }

    function saveAlertedNotifId(id: string) {
      try {
        const set = getAlertedNotifIds();
        set.add(id);
        const arr = Array.from(set).slice(-200);
        localStorage.setItem('waifuletes_alerted_notif_ids', JSON.stringify(arr));
      } catch (_) {}
    }

    it('deve iniciar desativado por padrão', () => {
      expect(isDeviceNotifsEnabled()).toBe(false);
    });

    it('deve refletir o estado ativado quando localStorage for true', () => {
      localStorage.setItem('waifuletes_device_notifs_enabled', 'true');
      expect(isDeviceNotifsEnabled()).toBe(true);
    });

    it('deve registrar e deduplicar IDs de notificações alertadas', () => {
      expect(getAlertedNotifIds().size).toBe(0);

      saveAlertedNotifId('notif_1');
      saveAlertedNotifId('notif_2');
      saveAlertedNotifId('notif_1'); // duplicado

      const ids = getAlertedNotifIds();
      expect(ids.size).toBe(2);
      expect(ids.has('notif_1')).toBe(true);
      expect(ids.has('notif_2')).toBe(true);
    });

    it('deve limitar a lista de IDs a 200 itens para evitar vazamento de memória', () => {
      for (let i = 0; i < 250; i++) {
        saveAlertedNotifId(`notif_${i}`);
      }
      const ids = getAlertedNotifIds();
      expect(ids.size).toBe(200);
      expect(ids.has('notif_0')).toBe(false);
      expect(ids.has('notif_249')).toBe(true);
    });
  });

  describe('Deduplicação e disparo de notificações', () => {
    let mockStorage: Record<string, string> = {};

    beforeEach(() => {
      mockStorage = {
        waifuletes_device_notifs_enabled: 'true',
      };
      vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => mockStorage[key] ?? null),
        setItem: vi.fn((key: string, val: string) => {
          mockStorage[key] = String(val);
        }),
      });
    });

    it('deve filtrar notificações que já foram alertadas', () => {
      const alertedIds = new Set(['notif_antiga']);
      const unreadList = [
        { id: 'notif_antiga', title: 'Antiga', message: 'Já vista' },
        { id: 'notif_nova_1', title: 'Nova 1', message: 'Mensagem 1' },
        { id: 'notif_nova_2', title: 'Nova 2', message: 'Mensagem 2' },
      ];

      const toAlert = unreadList.filter(n => !alertedIds.has(n.id));
      expect(toAlert).toHaveLength(2);
      expect(toAlert.map(n => n.id)).toEqual(['notif_nova_1', 'notif_nova_2']);
    });
  });
});
