import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const publicDir = path.resolve(process.cwd(), 'public');

function createMockElement(tagName = 'div', id = '') {
  const classes = new Set<string>();
  return {
    tagName: tagName.toUpperCase(),
    id,
    value: '',
    checked: false,
    disabled: false,
    src: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    style: { display: '', setProperty: () => {} },
    className: '',
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

function createHarness() {
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

describe('📢 Novo Classificado — Picker de waifus não bloqueadas', () => {
  it('getEligibleUnlockedHaremEntries exclui bloqueadas, coleção bloqueada, míticas e já anunciadas', () => {
    const userJs = fs.readFileSync(path.join(publicDir, 'js/user.js'), 'utf-8');
    const { document, windowObj } = createHarness();

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
      Api: { get: vi.fn(), showToast: () => {}, escapeHtml: (s: string) => String(s) },
    });

    vm.runInContext(userJs, ctx);
    vm.runInContext(
      `
      globalThis.__eligible = getEligibleUnlockedHaremEntries([
        { character: { id: 'ok-1', name: 'Rem', baseRarity: 'LEGENDARY' }, isLocked: false, keys: 2 },
        { character: { id: 'locked-1', name: 'Asuka', baseRarity: 'EPIC' }, isLocked: true, keys: 1 },
        { character: { id: 'col-locked-1', name: 'Mikasa', baseRarity: 'RARE' }, isLocked: false, collection: { isLocked: true }, keys: 1 },
        { character: { id: 'mythic-1', name: 'Mítico', baseRarity: 'MYTHIC', isMythic: true }, isLocked: false, keys: 1 },
        { character: { id: 'listed-1', name: 'Makima', baseRarity: 'LEGENDARY' }, isLocked: false, keys: 1 },
      ], new Set(['listed-1']));
      `,
      ctx
    );

    const eligible = vm.runInContext('globalThis.__eligible', ctx);
    expect(eligible.map((e: any) => e.character.id)).toEqual(['ok-1']);
  });

  it('openNewMarketListingPicker popula cards, filtra por texto/raridade/cobiçadas e avança para openSellModal', async () => {
    const userJs = fs.readFileSync(path.join(publicDir, 'js/user.js'), 'utf-8');
    const { getEl, document, windowObj } = createHarness();

    const mockCards: any[] = [
      (() => {
        const c = createMockElement('label');
        c.dataset = { charId: 'rem', name: 'Rem', series: 'Re:Zero', rarity: 'LEGENDARY', coveted: '1' };
        return c;
      })(),
      (() => {
        const c = createMockElement('label');
        c.dataset = { charId: 'nezuko', name: 'Nezuko', series: 'Demon Slayer', rarity: 'EPIC', coveted: '0' };
        return c;
      })(),
    ];

    const listEl = getEl('new-listing-waifus-list');
    listEl.querySelectorAll = (sel: string) => (sel === '.offer-waifu-card' ? mockCards : []);

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
        get: vi.fn(async () => ({ success: true, data: { refundedKakera: 3500 } })),
        showToast: () => {},
        escapeHtml: (s: string) => String(s),
      },
    });

    vm.runInContext(userJs, ctx);
    vm.runInContext(
      `
      userSessionToken = 'tok_qol';
      userPublicId = 'pub_qol';
      userSessionData = {
        listedCharacterIds: ['already-listed'],
        harem: [
          { character: { id: 'rem', name: 'Rem', series: 'Re:Zero', baseRarity: 'LEGENDARY', imageUrl: '/media/rem.jpg' }, isLocked: false, keys: 3, activeCovetsCount: 2 },
          { character: { id: 'nezuko', name: 'Nezuko', series: 'Demon Slayer', baseRarity: 'EPIC', imageUrl: '/media/nezuko.jpg' }, isLocked: false, keys: 1, activeCovetsCount: 0 },
          { character: { id: 'already-listed', name: 'Mai', series: 'Bunny Girl', baseRarity: 'EPIC' }, isLocked: false, keys: 1 },
          { character: { id: 'locked-char', name: 'Saber', series: 'Fate', baseRarity: 'LEGENDARY' }, isLocked: true, keys: 1 },
        ]
      };
      userSessionData.harem.forEach(item => haremEntryCache.set(item.character.id, item));
      openNewMarketListingPicker();
      `,
      ctx
    );

    expect(getEl('modal-market-new-listing-picker').classList.contains('hidden')).toBe(false);
    expect(getEl('btn-proceed-new-listing').disabled).toBe(true);
    expect(listEl.innerHTML).toContain('Rem');
    expect(listEl.innerHTML).toContain('Nezuko');
    expect(listEl.innerHTML).not.toContain('Saber');
    expect(listEl.innerHTML).not.toContain('already-listed');

    // Filtro por texto "demon"
    getEl('new-listing-waifus-search-input').value = 'demon';
    vm.runInContext('filterNewListingWaifus()', ctx);
    expect(mockCards[0].style.display).toBe('none');
    expect(mockCards[1].style.display).toBe('');

    // Filtro por cobiçadas
    getEl('new-listing-waifus-search-input').value = '';
    getEl('new-listing-waifus-coveted-checkbox').checked = true;
    vm.runInContext('filterNewListingWaifus()', ctx);
    expect(mockCards[0].style.display).toBe('');
    expect(mockCards[1].style.display).toBe('none');

    // Filtro por raridade EPIC (sem cobiçadas)
    getEl('new-listing-waifus-coveted-checkbox').checked = false;
    getEl('new-listing-waifus-rarity-select').value = 'EPIC';
    vm.runInContext('filterNewListingWaifus()', ctx);
    expect(mockCards[0].style.display).toBe('none');
    expect(mockCards[1].style.display).toBe('');

    // Seleciona Rem e prossegue para tela de criar classificado
    vm.runInContext(`selectNewListingCandidate('rem')`, ctx);
    expect(getEl('btn-proceed-new-listing').disabled).toBe(false);
    expect(mockCards[0].classList.contains('is-selected')).toBe(true);

    vm.runInContext(`proceedNewMarketListing()`, ctx);
    expect(getEl('modal-market-new-listing-picker').classList.contains('hidden')).toBe(true);
    expect(getEl('modal-market-sell').classList.contains('hidden')).toBe(false);
    expect(getEl('sell-modal-char-name').textContent).toBe('Rem');
  });

  it('user.html possui botão Novo Classificado, modal picker e cachebuster atualizado', () => {
    const userHtml = fs.readFileSync(path.join(publicDir, 'user.html'), 'utf-8');
    expect(userHtml).toContain('id="btn-market-new-listing"');
    expect(userHtml).toContain('id="modal-market-new-listing-picker"');
    expect(userHtml).toContain('id="new-listing-waifus-search-input"');
    expect(userHtml).toContain('id="new-listing-waifus-rarity-select"');
    expect(userHtml).toContain('id="new-listing-waifus-coveted-checkbox"');
    expect(userHtml).toContain('id="btn-proceed-new-listing"');
    expect(userHtml).toContain('/js/user.js?v=20261124-classificados-picker');
  });
});
