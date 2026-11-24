import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const publicDir = path.resolve(process.cwd(), 'public');

function createMockElement(tagName = 'div', id = '') {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  const classes = new Set<string>();
  const children: any[] = [];
  const el: any = {
    tagName: tagName.toUpperCase(),
    id,
    value: '',
    href: '',
    src: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    style: { setProperty: () => {} },
    className: '',
    children,
    classList: {
      add: (...c: string[]) => c.forEach((x) => classes.add(x)),
      remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
      toggle: (c: string, force?: boolean) => {
        if (force === undefined) {
          if (classes.has(c)) classes.delete(c);
          else classes.add(c);
        } else if (force) {
          classes.add(c);
        } else {
          classes.delete(c);
        }
      },
      contains: (c: string) => classes.has(c),
    },
    appendChild: (child: any) => {
      children.push(child);
      return child;
    },
    addEventListener: (ev: string, fn: (e: any) => void) => {
      if (!listeners[ev]) listeners[ev] = [];
      listeners[ev].push(fn);
    },
    dispatchEvent: (ev: any) => {
      const fns = listeners[ev.type] || [];
      fns.forEach((fn) => fn(ev));
    },
    querySelector: (selector: string) => {
      if (selector === '.card-img-wrapper') return createMockElement('div');
      if (selector === '.card-name') return createMockElement('div');
      if (selector === '.card-series a.series-filter-link') return el._seriesLink || null;
      if (selector === '.btn-card-report') return createMockElement('button');
      if (selector === '.badge-married') return createMockElement('div');
      if (selector.includes('.retro-subtab.active')) return null;
      return null;
    },
    querySelectorAll: () => [],
    closest: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    focus: () => {},
  };
  return el;
}

const mockEscapeHtml = (s: any) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

function createDomEnv(urlString: string) {
  const elements = new Map<string, any>();
  const docListeners: Record<string, Array<(e: any) => void>> = {};

  const getEl = (id: string) => {
    if (!elements.has(id)) {
      elements.set(id, createMockElement('div', id));
    }
    return elements.get(id);
  };

  const urlObj = new URL(urlString);
  const replacedUrls: string[] = [];

  const document: any = {
    title: '',
    cookie: '',
    body: createMockElement('body'),
    getElementById: (id: string) => getEl(id),
    createElement: (tag: string) => createMockElement(tag),
    querySelector: (sel: string) => {
      if (sel.startsWith('#')) return getEl(sel.slice(1));
      return null;
    },
    querySelectorAll: () => [],
    addEventListener: (ev: string, fn: (e: any) => void) => {
      if (!docListeners[ev]) docListeners[ev] = [];
      docListeners[ev].push(fn);
    },
    triggerDOMContentLoaded: () => {
      (docListeners['DOMContentLoaded'] || []).forEach((fn) => fn({ type: 'DOMContentLoaded' }));
    },
  };

  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
  };

  const windowObj: any = {
    location: {
      href: urlObj.href,
      origin: urlObj.origin,
      pathname: urlObj.pathname,
      search: urlObj.search,
      hash: urlObj.hash,
      replace: (u: string) => replacedUrls.push(u),
    },
    history: {
      replaceState: (_s: any, _t: string, u: string) => replacedUrls.push(u),
    },
    addEventListener: () => {},
    scrollTo: () => {},
    open: vi.fn(),
    localStorage,
    URLSearchParams,
    URL,
  };

  return { elements, getEl, document, windowObj, localStorage, replacedUrls };
}

describe('🔗 Filtros de busca por série via links & Links para cônjuge', () => {
  it('home.js lê ?q= / ?search= / ?serie= na inicialização, preenche #search-input e busca personagens', async () => {
    const homeJs = fs.readFileSync(path.join(publicDir, 'js/home.js'), 'utf-8');
    const apiCalls: string[] = [];

    for (const queryParam of ['?q=Bleach', '?search=One%20Piece', '?serie=Naruto%20Shippuden']) {
      const env = createDomEnv(`https://waifuletes.test/${queryParam}`);
      const ctx = vm.createContext({
        window: env.windowObj,
        document: env.document,
        localStorage: env.localStorage,
        URLSearchParams,
        URL,
        console,
        setTimeout,
        clearTimeout,
        Api: {
          get: async (endpoint: string) => {
            apiCalls.push(endpoint);
            return { success: true, data: { data: [], total: 0, totalPages: 1, page: 1 } };
          },
          getShareUrl: (p: string) => p,
          showToast: () => {},
          escapeHtml: mockEscapeHtml,
        },
        escapeHtml: mockEscapeHtml,
      });

      vm.runInContext(homeJs, ctx);
      env.document.triggerDOMContentLoaded();
      await Promise.resolve();

      const expectedTerm = new URLSearchParams(queryParam).values().next().value;
      expect(env.getEl('search-input').value).toBe(expectedTerm);
      expect(vm.runInContext('state.search', ctx)).toBe(expectedTerm);
      const matchingCall = apiCalls.find((u) => u.startsWith('/characters?'));
      expect(matchingCall).toBeDefined();
      const sentParams = new URLSearchParams(matchingCall!.split('?')[1]);
      expect(sentParams.get('search')).toBe(expectedTerm);
      apiCalls.length = 0;
    }
  });

  it('home.js preserva ?q= ao redirecionar usuário logado para /user/:publicId', () => {
    const homeJs = fs.readFileSync(path.join(publicDir, 'js/home.js'), 'utf-8');
    const env = createDomEnv('https://waifuletes.test/?q=Re%3AZero');
    env.localStorage.setItem('waifu_user_public_id', 'pub_user_123');
    env.localStorage.setItem('waifu_session', 'tok_secret_123');

    const ctx = vm.createContext({
      window: env.windowObj,
      document: env.document,
      localStorage: env.localStorage,
      history: env.windowObj.history,
      navigator: { userAgent: 'vitest' },
      Notification: { permission: 'default' },
      URLSearchParams,
      URL,
      console,
      setTimeout,
      clearTimeout,
      Api: {
        get: async () => ({ success: true, data: {} }),
        getShareUrl: (p: string) => p,
      },
      escapeHtml: (s: string) => String(s),
    });

    vm.runInContext(homeJs, ctx);
    env.document.triggerDOMContentLoaded();

    expect(env.replacedUrls.length).toBeGreaterThan(0);
    expect(env.replacedUrls[0]).toBe('https://waifuletes.test/user/pub_user_123?q=Re%3AZero#catalogo/personagens');
  });

  it('character.js renderiza nome da série como link para busca (/?q=...) e nome do cônjuge como link para perfil (/user/:publicId)', () => {
    const charJs = fs.readFileSync(path.join(publicDir, 'js/character.js'), 'utf-8');
    const env = createDomEnv('https://waifuletes.test/c/rem-rezero');

    const ctx = vm.createContext({
      window: env.windowObj,
      document: env.document,
      localStorage: env.localStorage,
      history: env.windowObj.history,
      navigator: { userAgent: 'vitest' },
      Notification: { permission: 'default' },
      URLSearchParams,
      URL,
      console,
      setTimeout,
      clearTimeout,
      Api: {
        get: async () => ({ success: true, data: {} }),
        getShareUrl: (p: string) => p,
        showToast: () => {},
      },
    });

    vm.runInContext(charJs, ctx);
    vm.runInContext(
      `
      CharacterPage.charId = 'rem-rezero';
      CharacterPage.charData = {
        id: 'rem-rezero',
        name: 'Rem',
        series: 'Re:Zero kara Hajimeru',
        baseRarity: 'LEGENDARY',
        gender: 'FEMALE',
        imageUrls: ['/media/characters/default.jpg'],
        isClaimed: true,
        owner: { name: 'João Cabrito', publicId: 'pub_joao_99' },
        likeCount: 5,
        wishlistCount: 3,
        popularityScore: 100
      };
      CharacterPage.render();
      `,
      ctx
    );

    const seriesHtml = env.getEl('char-series').innerHTML;
    expect(seriesHtml).toContain('href="/?q=Re%3AZero%20kara%20Hajimeru"');
    expect(seriesHtml).toContain('class="series-filter-link"');
    expect(seriesHtml).toContain('Re:Zero kara Hajimeru');

    const marriageHtml = env.getEl('char-marriage-line').innerHTML;
    expect(marriageHtml).toContain('href="/user/pub_joao_99"');
    expect(marriageHtml).toContain('class="spouse-profile-link"');
    expect(marriageHtml).toContain('João Cabrito');
  });

  it('user.js processa ?q= na URL, renderiza link de série no popup modal com filtro interno e link para perfil do cônjuge', async () => {
    const userJs = fs.readFileSync(path.join(publicDir, 'js/user.js'), 'utf-8');
    const env = createDomEnv('https://waifuletes.test/user/pub_me?q=Chainsaw%20Man');

    const ctx = vm.createContext({
      window: env.windowObj,
      document: env.document,
      localStorage: env.localStorage,
      history: env.windowObj.history,
      navigator: { userAgent: 'vitest' },
      Notification: { permission: 'default' },
      URLSearchParams,
      URL,
      console,
      setTimeout,
      clearTimeout,
      Api: {
        get: async (url: string) => {
          if (url.startsWith('/characters/')) {
            return {
              success: true,
              data: {
                id: 'makima',
                name: 'Makima',
                series: 'Chainsaw Man',
                baseRarity: 'LEGENDARY',
                gender: 'FEMALE',
                imageUrls: ['/media/characters/default.jpg'],
                isClaimed: true,
                owner: { name: 'Maria Waifu', publicId: 'pub_maria_77' },
              },
            };
          }
          return { success: true, data: { data: [], total: 0, totalPages: 1 } };
        },
        getShareUrl: (p: string) => p,
        showToast: () => {},
        centerActiveTab: () => {},
        escapeHtml: mockEscapeHtml,
      },
    });

    vm.runInContext(userJs, ctx);
    expect(typeof vm.runInContext('renderSeriesFilterLinkHtml', ctx)).toBe('function');
    expect(typeof vm.runInContext('filterCatalogBySeries', ctx)).toBe('function');

    env.document.triggerDOMContentLoaded();
    await Promise.resolve();
    expect(vm.runInContext('catalogState.search', ctx)).toBe('Chainsaw Man');
    expect(env.getEl('catalog-search-input').value).toBe('Chainsaw Man');

    await vm.runInContext(`openWaifuPreview('makima')`, ctx);

    const previewSeriesHtml = env.getEl('waifu-preview-series').innerHTML;
    expect(previewSeriesHtml).toContain('href="/?q=Chainsaw%20Man"');
    expect(previewSeriesHtml).toContain('class="series-filter-link"');
    expect(previewSeriesHtml).toContain('Chainsaw Man');

    const previewMarriageHtml = env.getEl('waifu-preview-marriage-line').innerHTML;
    expect(previewMarriageHtml).toContain('href="/user/pub_maria_77"');
    expect(previewMarriageHtml).toContain('class="spouse-profile-link"');
    expect(previewMarriageHtml).toContain('Maria Waifu');

    // Simula filtro interno ao clicar na série dentro do painel privado
    env.getEl('private-panel').classList.remove('hidden');
    vm.runInContext(`filterCatalogBySeries('Chainsaw Man')`, ctx);
    expect(env.getEl('catalog-search-input').value).toBe('Chainsaw Man');
    expect(vm.runInContext('catalogState.search', ctx)).toBe('Chainsaw Man');
    expect(env.getEl('modal-waifu-preview').classList.contains('hidden')).toBe(true);
  });

  it('arquivos HTML possuem cachebusters atualizados para retro-theme.css, home.js, character.js e user.js', () => {
    const version = '20261124-series-spouse-links';
    const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf-8');
    const characterHtml = fs.readFileSync(path.join(publicDir, 'character.html'), 'utf-8');
    const userHtml = fs.readFileSync(path.join(publicDir, 'user.html'), 'utf-8');

    expect(indexHtml).toContain(`/css/retro-theme.css?v=${version}`);
    expect(indexHtml).toContain(`/js/home.js?v=${version}`);
    expect(characterHtml).toContain(`/css/retro-theme.css?v=${version}`);
    expect(characterHtml).toContain(`/js/character.js?v=${version}`);
    expect(userHtml).toContain(`/css/retro-theme.css?v=${version}`);
    expect(userHtml).toContain(`/js/user.js?v=${version}`);
  });
});
