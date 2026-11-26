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

const flush = () => new Promise((r) => setTimeout(r, 0));

function loadUserJs() {
  const userJs = fs.readFileSync(path.join(publicDir, 'js/user.js'), 'utf-8');
  const { getEl, document, windowObj } = createDomHarness();
  const pending = new Map<string, (data: any) => void>();
  const failures = new Map<string, (err: Error) => void>();
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
      get: (url: string) =>
        new Promise((resolve, reject) => {
          const id = decodeURIComponent(url.split('/divorce/preview/')[1].split('?')[0]);
          pending.set(id, resolve);
          failures.set(id, reject);
        }),
      showToast: () => {},
      escapeHtml: (s: string) => String(s),
    },
  });
  vm.runInContext(userJs, ctx);
  vm.runInContext(`userSessionToken = 'tok_user'; userPublicId = 'pub_user';`, ctx);
  return { ctx, getEl, pending, failures };
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

  it('user.html possui #sell-modal-keys-warning e todos os HTML usam a mesma versão de cada arquivo alterado', () => {
    const userHtml = fs.readFileSync(path.join(publicDir, 'user.html'), 'utf-8');
    expect(userHtml).toContain('id="sell-modal-keys-warning"');

    const assets = ['/css/retro-theme.css', '/js/user.js', '/js/sell-modal.js', '/js/character.js'];
    const htmlFiles = fs.readdirSync(publicDir).filter((f) => f.endsWith('.html'));
    for (const asset of assets) {
      const versions = new Map<string, string[]>();
      for (const file of htmlFiles) {
        const html = fs.readFileSync(path.join(publicDir, file), 'utf-8');
        const re = new RegExp(`${asset.replace(/\./g, '\\.')}\\?v=([^"']+)`, 'g');
        for (const m of html.matchAll(re)) {
          versions.set(m[1], [...(versions.get(m[1]) || []), file]);
        }
      }
      expect(versions.size, `${asset}: ${JSON.stringify(Object.fromEntries(versions))}`).toBe(1);
    }
  });

  it('user.js ignora a resposta do preview de um personagem que não é mais o do modal', async () => {
    const { ctx, getEl, pending, failures } = loadUserJs();
    vm.runInContext(
      `
      haremEntryCache.set('alpha-01', { character: { id: 'alpha-01', name: 'Alpha' }, keys: 1, isSoulmate: false });
      haremEntryCache.set('beta-01', { character: { id: 'beta-01', name: 'Beta' }, keys: 12, isSoulmate: true });
      openSellModal('alpha-01', 'Alpha', '/media/a.jpg', 'Série A');
      openSellModal('beta-01', 'Beta', '/media/b.jpg', 'Série B');
      `,
      ctx
    );
    const warnEl = getEl('sell-modal-keys-warning');
    const interestEl = getEl('sell-modal-interest');

    pending.get('beta-01')!({ success: true, data: { refundedKakera: 9000, currentKeys: 12, isSoulmate: true } });
    await flush();
    expect(warnEl.innerHTML).toContain('Você tem 12 chaves');
    expect(interestEl.value).toBe('Valor mínimo: 9.000z');

    pending.get('alpha-01')!({ success: true, data: { refundedKakera: 100, currentKeys: 1, isSoulmate: false } });
    await flush();
    expect(warnEl.classList.contains('hidden')).toBe(false);
    expect(warnEl.innerHTML).toContain('Você tem 12 chaves');
    expect(interestEl.value).toBe('Valor mínimo: 9.000z');

    vm.runInContext(
      `
      haremEntryCache.set('gama-01', { character: { id: 'gama-01', name: 'Gama' }, keys: 12, isSoulmate: true });
      haremEntryCache.set('delta-01', { character: { id: 'delta-01', name: 'Delta' }, keys: 1, isSoulmate: false });
      openSellModal('gama-01', 'Gama', '/media/g.jpg', 'Série G');
      openSellModal('delta-01', 'Delta', '/media/d.jpg', 'Série D');
      `,
      ctx
    );
    pending.get('gama-01')!({ success: true, data: { refundedKakera: 9000, currentKeys: 12, isSoulmate: true } });
    await flush();
    expect(warnEl.classList.contains('hidden')).toBe(true);
    expect(interestEl.value).toBe('Valor mínimo: calculando...');

    vm.runInContext(
      `
      haremEntryCache.set('epsilon-01', { character: { id: 'epsilon-01', name: 'Epsilon' }, keys: 1, isSoulmate: false });
      openSellModal('epsilon-01', 'Epsilon', '/media/e.jpg', 'Série E');
      openSellModal('delta-01', 'Delta', '/media/d.jpg', 'Série D');
      `,
      ctx
    );
    failures.get('epsilon-01')!(new Error('timeout'));
    await flush();
    expect(interestEl.value).toBe('Valor mínimo: calculando...');
  });

  it('user.js usa as chaves do harém recarregado ao reabrir o anúncio', async () => {
    const { ctx, getEl, pending } = loadUserJs();
    vm.runInContext(
      `
      haremEntryCache.set('alpha-01', { character: { id: 'alpha-01', name: 'Alpha' }, keys: 1, isSoulmate: false });
      openSellModal('alpha-01', 'Alpha', '/media/a.jpg', 'Série A');
      `,
      ctx
    );
    pending.get('alpha-01')!({ success: true, data: { refundedKakera: 100, currentKeys: 1, isSoulmate: false } });
    await flush();
    const warnEl = getEl('sell-modal-keys-warning');
    expect(warnEl.classList.contains('hidden')).toBe(true);

    vm.runInContext(
      `
      haremEntryCache.set('alpha-01', { character: { id: 'alpha-01', name: 'Alpha' }, keys: 8, isSoulmate: false });
      openSellModal('alpha-01', 'Alpha', '/media/a.jpg', 'Série A');
      `,
      ctx
    );
    expect(warnEl.classList.contains('hidden')).toBe(false);
    expect(warnEl.innerHTML).toContain('Você tem 8 chaves');
  });

  it('sell-modal.js ignora a resposta do preview de um personagem que não é mais o do modal', async () => {
    const sellModalJs = fs.readFileSync(path.join(publicDir, 'js/sell-modal.js'), 'utf-8');
    const { getEl, document, windowObj } = createDomHarness();
    getEl('modal-quick-sell').classList.add('hidden');
    const pending = new Map<string, (data: any) => void>();
    const failures = new Map<string, (err: Error) => void>();
    const ctx = vm.createContext({
      window: windowObj,
      document,
      URL,
      URLSearchParams,
      console,
      requestAnimationFrame: (cb: () => void) => cb(),
      fetch: (url: string) =>
        new Promise((resolve, reject) => {
          const id = decodeURIComponent(url.split('/divorce/preview/')[1].split('?')[0]);
          pending.set(id, (data) => resolve({ json: async () => data }));
          failures.set(id, reject);
        }),
    });
    vm.runInContext(sellModalJs, ctx);
    const modal = windowObj.MarketSellModal;
    const warnEl = getEl('quick-sell-keys-warning');
    const interestEl = getEl('quick-sell-interest');

    modal.open({ character: { id: 'alpha-01', name: 'Alpha' }, keys: 1, token: 'tok_1', publicId: 'pub_1' });
    modal.close();
    modal.open({ character: { id: 'beta-01', name: 'Beta' }, keys: 12, isSoulmate: true, token: 'tok_1', publicId: 'pub_1' });

    pending.get('beta-01')!({ success: true, data: { refundedKakera: 9000, currentKeys: 12, isSoulmate: true } });
    await flush();
    expect(warnEl.innerHTML).toContain('Você tem 12 chaves');

    pending.get('alpha-01')!({ success: true, data: { refundedKakera: 100, currentKeys: 1, isSoulmate: false } });
    await flush();
    expect(warnEl.classList.contains('hidden')).toBe(false);
    expect(warnEl.innerHTML).toContain('Você tem 12 chaves');
    expect(interestEl.value).toBe('Valor mínimo: 9.000z');

    modal.open({ character: { id: 'gama-01', name: 'Gama' }, keys: 12, isSoulmate: true, token: 'tok_1', publicId: 'pub_1' });
    modal.close();
    modal.open({ character: { id: 'delta-01', name: 'Delta' }, keys: 1, token: 'tok_1', publicId: 'pub_1' });
    pending.get('gama-01')!({ success: true, data: { refundedKakera: 9000, currentKeys: 12, isSoulmate: true } });
    await flush();
    expect(warnEl.classList.contains('hidden')).toBe(true);
    expect(interestEl.value).toBe('Valor mínimo: calculando...');

    modal.open({ character: { id: 'epsilon-01', name: 'Epsilon' }, keys: 1, token: 'tok_1', publicId: 'pub_1' });
    modal.close();
    modal.open({ character: { id: 'zeta-01', name: 'Zeta' }, keys: 1, token: 'tok_1', publicId: 'pub_1' });
    failures.get('epsilon-01')!(new Error('timeout'));
    await flush();
    expect(interestEl.value).toBe('Valor mínimo: calculando...');
  });
});
