import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const publicDir = path.resolve(process.cwd(), 'public');

function createMockElement(tagName = 'div', id = '') {
  const classes = new Set<string>();
  const children: any[] = [];
  return {
    tagName: tagName.toUpperCase(),
    id,
    value: '',
    href: '',
    src: '',
    alt: '',
    disabled: false,
    textContent: '',
    innerHTML: '',
    dataset: {},
    style: { setProperty: () => {} },
    className: '',
    children,
    classList: {
      add: (...c: string[]) => c.forEach((x) => classes.add(x)),
      remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
      contains: (c: string) => classes.has(c),
    },
    appendChild: (c: any) => {
      children.push(c);
      return c;
    },
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    focus: () => {},
    select: () => {},
  };
}

function createDomHarness() {
  const elements = new Map<string, any>();
  const getEl = (id: string) => {
    if (!elements.has(id)) elements.set(id, createMockElement('div', id));
    return elements.get(id);
  };
  const body = createMockElement('body');
  const document: any = {
    body,
    cookie: '',
    getElementById: (id: string) => getEl(id),
    createElement: (tag: string) => createMockElement(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  const windowObj: any = {
    location: { origin: 'https://waifuletes.test', pathname: '/user/pub_test', search: '', hash: '' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    history: { replaceState: () => {} },
    addEventListener: () => {},
    requestAnimationFrame: (cb: () => void) => cb(),
  };
  return { getEl, document, windowObj };
}

describe('🔑 Aviso de chaves acumuladas ao anunciar nos classificados', () => {
  it('sell-modal.js exibe badge vermelho para keys > 1 e informa transferência com apenas 1 chave', async () => {
    const sellModalJs = fs.readFileSync(path.join(publicDir, 'js/sell-modal.js'), 'utf-8');
    const { getEl, document, windowObj } = createDomHarness();

    // Pré-cria #modal-quick-sell para simplificar _ensureDom
    getEl('modal-quick-sell').classList.add('hidden');

    const ctx = vm.createContext({
      window: windowObj,
      document,
      URL,
      URLSearchParams,
      console,
      requestAnimationFrame: (cb: () => void) => cb(),
      fetch: vi.fn(async () => ({
        json: async () => ({
          success: true,
          data: { refundedKakera: 5000, currentKeys: 5, isSoulmate: false },
        }),
      })),
    });
    windowObj.fetch = ctx.fetch;

    vm.runInContext(sellModalJs, ctx);
    const modal = windowObj.MarketSellModal;
    expect(modal).toBeDefined();

    // Caso 1: 5 chaves informadas diretamente
    modal.open({
      character: { id: 'asuka', name: 'Asuka Langley', series: 'Evangelion', keys: 5 },
      token: 'tok_123',
      publicId: 'pub_123',
    });

    const warnEl = getEl('quick-sell-keys-warning');
    expect(warnEl.classList.contains('hidden')).toBe(false);
    expect(warnEl.innerHTML).toContain('ATENÇÃO! Você tem 5 chaves deste personagem que está anunciando');
    expect(warnEl.innerHTML).toContain('1 chave');

    // Caso 2: 10 chaves (Soulmate) via preview do backend
    ctx.fetch = vi.fn(async () => ({
      json: async () => ({
        success: true,
        data: { refundedKakera: 12000, currentKeys: 10, isSoulmate: true },
      }),
    }));
    modal.open({
      character: { id: 'rei', name: 'Rei Ayanami', series: 'Evangelion' },
      token: 'tok_123',
      publicId: 'pub_123',
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(warnEl.classList.contains('hidden')).toBe(false);
    expect(warnEl.innerHTML).toContain('ATENÇÃO! Você tem 10 chaves deste personagem que está anunciando');
    expect(warnEl.innerHTML).toContain('1 chave');
    expect(warnEl.innerHTML).toContain('Soulmate');

    // Caso 3: 1 chave -> oculto
    ctx.fetch = vi.fn(async () => ({
      json: async () => ({
        success: true,
        data: { refundedKakera: 1000, currentKeys: 1, isSoulmate: false },
      }),
    }));
    modal.open({
      character: { id: 'shinji', name: 'Shinji Ikari', series: 'Evangelion', keys: 1 },
      token: 'tok_123',
      publicId: 'pub_123',
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(warnEl.classList.contains('hidden')).toBe(true);
    expect(warnEl.innerHTML).toBe('');
  });

  it('user.js openSellModal exibe #sell-modal-keys-warning para personagem com >1 chaves e oculta quando tem 1 chave', async () => {
    const userJs = fs.readFileSync(path.join(publicDir, 'js/user.js'), 'utf-8');
    const { getEl, document, windowObj } = createDomHarness();

    const ctx = vm.createContext({
      window: windowObj,
      document,
      localStorage: windowObj.localStorage,
      history: windowObj.history,
      navigator: { userAgent: 'vitest' },
      Notification: { permission: 'default' },
      URL,
      URLSearchParams,
      console,
      requestAnimationFrame: (cb: () => void) => cb(),
      Api: {
        get: vi.fn(async (url: string) => ({
          success: true,
          data: url.includes('luka-01')
            ? { refundedKakera: 1000, currentKeys: 1, isSoulmate: false }
            : { refundedKakera: 4500, currentKeys: 4, isSoulmate: false },
        })),
        showToast: () => {},
        escapeHtml: (s: string) => String(s),
      },
    });

    vm.runInContext(userJs, ctx);
    vm.runInContext(
      `
      userSessionToken = 'tok_user';
      userPublicId = 'pub_user';
      haremEntryCache.set('miku-01', { character: { id: 'miku-01', name: 'Hatsune Miku' }, keys: 4, isSoulmate: false });
      haremEntryCache.set('luka-01', { character: { id: 'luka-01', name: 'Megurine Luka' }, keys: 1, isSoulmate: false });
      `,
      ctx
    );

    vm.runInContext(`openSellModal('miku-01', 'Hatsune Miku', '/media/miku.jpg', 'Vocaloid')`, ctx);
    const warnEl = getEl('sell-modal-keys-warning');
    expect(warnEl.classList.contains('hidden')).toBe(false);
    expect(warnEl.innerHTML).toContain('ATENÇÃO! Você tem 4 chaves deste personagem que está anunciando');
    expect(warnEl.innerHTML).toContain('1 chave');

    vm.runInContext(`openSellModal('luka-01', 'Megurine Luka', '/media/luka.jpg', 'Vocaloid')`, ctx);
    await Promise.resolve();
    expect(warnEl.classList.contains('hidden')).toBe(true);
    expect(warnEl.innerHTML).toBe('');
  });

  it('character.js passa keys e isSoulmate do harem para MarketSellModal.open', () => {
    const charJs = fs.readFileSync(path.join(publicDir, 'js/character.js'), 'utf-8');
    const { document, windowObj } = createDomHarness();
    const openSpy = vi.fn();
    windowObj.MarketSellModal = { open: openSpy };

    const ctx = vm.createContext({
      window: windowObj,
      document,
      localStorage: windowObj.localStorage,
      URL,
      URLSearchParams,
      console,
      Api: { showToast: () => {} },
    });

    vm.runInContext(charJs, ctx);
    vm.runInContext(
      `
      CharacterPage.isAuthenticated = true;
      CharacterPage.userToken = 'tok_c';
      CharacterPage.userPublicId = 'pub_c';
      CharacterPage.charId = 'zero-two';
      CharacterPage.charData = { id: 'zero-two', name: 'Zero Two', isMythic: false };
      CharacterPage.userSessionData = {
        harem: [{ characterId: 'zero-two', keys: 7, isSoulmate: false }]
      };
      CharacterPage.openAnnounceModal(null);
      `,
      ctx
    );

    expect(openSpy).toHaveBeenCalledTimes(1);
    const callArg = openSpy.mock.calls[0][0];
    expect(callArg.keys).toBe(7);
    expect(callArg.isSoulmate).toBe(false);
  });

  it('user.html possui #sell-modal-keys-warning e HTMLs possuem cachebusters atualizados', () => {
    const version = '20261124-sell-keys-warning';
    const userHtml = fs.readFileSync(path.join(publicDir, 'user.html'), 'utf-8');
    const characterHtml = fs.readFileSync(path.join(publicDir, 'character.html'), 'utf-8');
    const catalogoHtml = fs.readFileSync(path.join(publicDir, 'catalogo.html'), 'utf-8');

    expect(userHtml).toContain('id="sell-modal-keys-warning"');
    expect(userHtml).toContain(`/css/retro-theme.css?v=${version}`);
    expect(userHtml).toContain(`/js/user.js?v=${version}`);
    expect(characterHtml).toContain(`/js/sell-modal.js?v=${version}`);
    expect(characterHtml).toContain(`/js/character.js?v=${version}`);
    expect(catalogoHtml).toContain(`/js/sell-modal.js?v=${version}`);
  });
});
