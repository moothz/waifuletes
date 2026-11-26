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

  const location: any = {
    href: urlObj.href,
    origin: urlObj.origin,
    pathname: urlObj.pathname,
    search: urlObj.search,
    hash: urlObj.hash,
    replace: (u: string) => replacedUrls.push(u),
  };
  const windowObj: any = {
    location,
    history: {
      replaceState: (_s: any, _t: string, u: string) => {
        replacedUrls.push(u);
        const next = new URL(u, location.href);
        location.href = next.href;
        location.pathname = next.pathname;
        location.search = next.search;
        location.hash = next.hash;
      },
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


  it('arquivos HTML usam a mesma versão de cachebuster para retro-theme.css, home.js, character.js e user.js', () => {
    const assets = ['/css/retro-theme.css', '/js/home.js', '/js/character.js', '/js/user.js'];
    const versions = new Map<string, Set<string>>();
    for (const file of fs.readdirSync(publicDir).filter((f) => f.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(publicDir, file), 'utf-8');
      for (const m of html.matchAll(/(?:src|href)="(\/[^"?#]+)\?v=([^"&#]+)"/g)) {
        if (!versions.has(m[1])) versions.set(m[1], new Set());
        versions.get(m[1])!.add(m[2]);
      }
    }
    for (const asset of assets) {
      expect([...(versions.get(asset) ?? [])], asset).toHaveLength(1);
    }
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const emptyPage = (total = 0) => ({ success: true, data: { data: [], total, totalPages: 1, page: 1 } });

function loadScript(file: string, env: ReturnType<typeof createDomEnv>, get: (url: string) => Promise<any>, overrides: Record<string, any> = {}) {
  const ctx = vm.createContext({
    window: env.windowObj,
    document: env.document,
    localStorage: env.localStorage,
    history: env.windowObj.history,
    navigator: { userAgent: 'vitest' },
    Notification: { permission: 'default' },
    URLSearchParams,
    URL,
    console: { ...console, error: () => {} },
    setTimeout,
    clearTimeout,
    Api: {
      get,
      getShareUrl: (p: string) => p,
      showToast: () => {},
      centerActiveTab: () => {},
      escapeHtml: mockEscapeHtml,
    },
    escapeHtml: mockEscapeHtml,
    ...overrides,
  });
  vm.runInContext(fs.readFileSync(path.join(publicDir, file), 'utf-8'), ctx);
  return ctx;
}

const searchOf = (url: string) => new URLSearchParams(url.split('?')[1]).get('search');

describe('🔗 Filtros por série: URL, corrida de carregamento e armazenamento bloqueado', () => {
  it('user.js tira q/search/serie/series da URL depois de ler, mantendo token e hash, e o F5 seguinte respeita o hash', async () => {
    const env = createDomEnv('https://waifuletes.test/user/pub_me?token=tok_fake&q=Naruto&serie=Bleach#harem/casados');
    const ctx = loadScript('js/user.js', env, async () => emptyPage());
    env.document.triggerDOMContentLoaded();
    await flush();

    expect(vm.runInContext('catalogState.search', ctx)).toBe('Naruto');
    const url = new URL(env.windowObj.location.href);
    expect(['q', 'search', 'serie', 'series'].filter((k) => url.searchParams.has(k))).toEqual([]);
    expect(url.searchParams.get('token')).toBe('tok_fake');
    expect(url.hash).toBe('#harem/casados');

    const reload = createDomEnv(env.windowObj.location.href);
    const ctx2 = loadScript('js/user.js', reload, async () => emptyPage());
    reload.document.triggerDOMContentLoaded();
    await flush();
    expect(vm.runInContext('catalogState.search', ctx2)).toBe('');
    expect(vm.runInContext('hasInitialCatalogSearch', ctx2)).toBe(false);
  });

  it('user.js refaz a busca quando a série é clicada com o catálogo ainda carregando', async () => {
    const env = createDomEnv('https://waifuletes.test/user/pub_me');
    const calls: Array<{ url: string; d: ReturnType<typeof deferred<any>> }> = [];
    const ctx = loadScript('js/user.js', env, (url: string) => {
      if (!url.startsWith('/characters?')) return Promise.resolve(emptyPage());
      const d = deferred<any>();
      calls.push({ url, d });
      return d.promise;
    });

    vm.runInContext('catalogState.page = 3; loadCatalogCharacters()', ctx);
    vm.runInContext(`filterCatalogBySeries('Naruto')`, ctx);
    expect(calls.length).toBe(1);

    calls[0].d.resolve({ success: true, data: { data: [], total: 999, totalPages: 50, page: 3 } });
    await flush();
    expect(calls.length).toBe(2);
    expect(searchOf(calls[1].url)).toBe('Naruto');
    expect(new URLSearchParams(calls[1].url.split('?')[1]).get('page')).toBe('1');

    calls[1].d.resolve(emptyPage(7));
    await flush();
    expect(vm.runInContext('catalogState.total', ctx)).toBe(7);
    expect(calls.length).toBe(2);
  });

  it('home.js refaz a busca quando o filtro muda com a lista ainda carregando', async () => {
    const env = createDomEnv('https://waifuletes.test/');
    const calls: Array<{ url: string; d: ReturnType<typeof deferred<any>> }> = [];
    const ctx = loadScript('js/home.js', env, (url: string) => {
      if (!url.startsWith('/characters?')) return Promise.resolve({ success: true, data: {} });
      const d = deferred<any>();
      calls.push({ url, d });
      return d.promise;
    });
    env.document.triggerDOMContentLoaded();
    expect(calls.length).toBe(1);
    vm.runInContext(`state.page = 3`, ctx);

    vm.runInContext(`state.search = 'Bleach'; state.page = 1; loadCharacters();`, ctx);
    expect(calls.length).toBe(1);

    calls[0].d.resolve({ success: true, data: { data: [], total: 999, totalPages: 50, page: 3 } });
    await flush();
    expect(calls.length).toBe(2);
    expect(searchOf(calls[1].url)).toBe('Bleach');
    expect(new URLSearchParams(calls[1].url.split('?')[1]).get('page')).toBe('1');

    calls[1].d.resolve(emptyPage(3));
    await flush();
    expect(vm.runInContext('state.total', ctx)).toBe(3);
    expect(calls.length).toBe(2);
  });

  it('home.js mantém ?q= da URL igual à busca: normaliza apelidos e remove ao apagar o campo', async () => {
    const env = createDomEnv('https://waifuletes.test/?serie=Bleach&stay=1');
    const ctx = loadScript('js/home.js', env, async () => emptyPage());
    env.document.triggerDOMContentLoaded();
    await flush();
    let url = new URL(env.windowObj.location.href);
    expect(url.searchParams.get('q')).toBe('Bleach');
    expect(url.searchParams.has('serie')).toBe(false);
    expect(url.searchParams.get('stay')).toBe('1');

    env.getEl('search-input').dispatchEvent({ type: 'input', target: { value: '  ' } });
    await new Promise((r) => setTimeout(r, 350));
    url = new URL(env.windowObj.location.href);
    expect(url.searchParams.has('q')).toBe(false);
    expect(vm.runInContext('state.search', ctx)).toBe('');

    env.getEl('search-input').dispatchEvent({ type: 'input', target: { value: 'One Piece' } });
    await new Promise((r) => setTimeout(r, 350));
    expect(new URL(env.windowObj.location.href).searchParams.get('q')).toBe('One Piece');
  });

  it('home.js carrega o catálogo mesmo com o armazenamento do navegador bloqueado', async () => {
    const env = createDomEnv('https://waifuletes.test/?q=Naruto');
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError: The operation is insecure.');
      },
      setItem: () => {
        throw new Error('SecurityError: The operation is insecure.');
      },
      removeItem: () => {},
    };
    const calls: string[] = [];
    loadScript(
      'js/home.js',
      env,
      async (url: string) => {
        calls.push(url);
        return emptyPage();
      },
      { localStorage: blocked }
    );
    expect(() => env.document.triggerDOMContentLoaded()).not.toThrow();
    await flush();
    const charCalls = calls.filter((u) => u.startsWith('/characters?'));
    expect(charCalls.length).toBe(1);
    expect(searchOf(charCalls[0])).toBe('Naruto');
  });
});
