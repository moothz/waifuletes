// js/user.js - Lógica da Página do Usuário (Harém Público & Painel Privado com Sugestões e Recorte)

const RARITY_CONFIG = {
  COMMON:    { emoji: '⚪', label: 'Comum',    color: '#94a3b8' },
  UNCOMMON:  { emoji: '🟢', label: 'Incomum',  color: '#22c55e' },
  RARE:      { emoji: '🔵', label: 'Raro',     color: '#3b82f6' },
  EPIC:      { emoji: '🟣', label: 'Épico',    color: '#a855f7' },
  LEGENDARY: { emoji: '⭐', label: 'Lendário', color: '#eab308' }
};

const RARITY_LABELS = {
  COMMON: 'Comum',
  UNCOMMON: 'Incomum',
  RARE: 'Raro',
  EPIC: 'Épico',
  LEGENDARY: 'Lendário'
};

window.DEFAULT_CHAR_IMG = window.DEFAULT_CHAR_IMG || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='400' viewBox='0 0 300 400'%3E%3Cdefs%3E%3ClinearGradient id='bgGrad' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%231a1410'/%3E%3Cstop offset='100%25' stop-color='%23100a06'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='100%25' height='100%25' fill='url(%23bgGrad)'/%3E%3Crect x='10' y='10' width='280' height='380' fill='%23221a14' stroke='%23ec4899' stroke-width='2' stroke-dasharray='4,4' rx='8'/%3E%3Ccircle cx='150' cy='135' r='54' fill='%2332241c' stroke='%23ec4899' stroke-width='2.5'/%3E%3Cg transform='translate(118, 100) scale(2.6)'%3E%3Cpath d='M 12,21.35 C 7.5,17.2 2,12.8 2,8.5 C 2,5.42 4.42,3 7.5,3 C 9.24,3 10.91,3.81 12,5.09 L 10.5,8.5 L 13,11.5 L 10,14.5 L 12,17.5 Z' fill='%23ec4899'/%3E%3Cpath d='M 12.5,5.09 C 13.59,3.81 15.26,3 17,3 C 20.08,3 22.5,5.42 22.5,8.5 C 22.5,12.8 17,17.2 12.5,21.35 L 12.5,17.5 L 10.5,14.5 L 13.5,11.5 L 11,8.5 Z' fill='%23f43f5e' transform='translate(2.5, -1)'/%3E%3C/g%3E%3Ctext x='150' y='225' font-family='sans-serif' font-weight='800' font-size='22' fill='%23ec4899' text-anchor='middle'%3EWaifuletes%3C/text%3E%3Ctext x='150' y='255' font-family='sans-serif' font-weight='700' font-size='15' fill='%23ffffff' text-anchor='middle'%3ESem imagem disponível%3C/text%3E%3Crect x='30' y='278' width='240' height='50' rx='6' fill='%232d1f18' stroke='%23f43f5e' stroke-width='1.5' stroke-dasharray='2,2'/%3E%3Ctext x='150' y='299' font-family='sans-serif' font-weight='700' font-size='13' fill='%23fca5a5' text-anchor='middle'%3EEnvie uma sugestão%3C/text%3E%3Ctext x='150' y='317' font-family='sans-serif' font-weight='800' font-size='13' fill='%23ec4899' text-anchor='middle'%3Ede imagem no site!%3C/text%3E%3C/svg%3E";
window.handleImgError = window.handleImgError || function(img) {
  if (!img) return;
  img.onerror = function() {
    img.onerror = null;
    img.src = window.DEFAULT_CHAR_IMG;
  };
  img.src = '/media/characters/default.jpg';
};

let userPublicId = '';
let userSessionToken = '';
let userSessionData = null;
let pendingDivorceTarget = null;
let activeReportCharacter = null;
let activeSellCharacter = null;
let activeOfferListing = null;
const marketListingsMap = new Map();
window.marketListingsMap = marketListingsMap;

// Estado de busca e paginação do Harém (Casados) e Wishlist
let haremFilterState = {
  search: '',
  rarity: '',
  page: 1,
  pageSize: 30,
};

let publicHaremFilterState = {
  search: '',
  rarity: '',
  page: 1,
  pageSize: 30,
};

let wishlistFilterState = {
  search: '',
  onlyMarried: false,
  page: 1,
  pageSize: 50,
};

function normalizeSearchText(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function matchesTextFilter(textSearch, ...fields) {
  if (!textSearch) return true;
  const tokens = normalizeSearchText(textSearch).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const combined = normalizeSearchText(fields.join(' '));
  return tokens.every(token => combined.includes(token));
}

function matchesHaremCard(entry, searchText, rarityFilter) {
  const char = entry?.character;
  if (!char) return false;

  if (rarityFilter) {
    const normFilter = rarityFilter.toUpperCase();
    if (normFilter === 'COVETED') {
      // Cobiças ativas = PENDING + SEEN (IGNORED não conta). O backend ainda não envia
      // essa contagem (totalCovetsCount inclui IGNORED); enquanto activeCovetsCount não
      // existir, só é possível usar as não vistas (PENDING).
      const activeCovets = entry.activeCovetsCount !== undefined && entry.activeCovetsCount !== null
        ? Number(entry.activeCovetsCount)
        : Number(entry.unseenCovetsCount || 0);
      if (!(activeCovets > 0)) return false;
    } else {
      const r = (char.baseRarity || char.rarity || 'COMMON').toUpperCase();
      if (r !== normFilter) return false;
    }
  }

  if (searchText) {
    return matchesTextFilter(searchText, char.name, char.series, char.id);
  }

  return true;
}

// Controle do modal de sugestão de personagem existente vive em js/suggestion-modal.js (SuggestionModal).
let activeCovetsChar = null;
let userCovetedSet = new Set();
let visitorSessionData = null;
let visitorWishlistSet = new Set();
let haremEntryCache = new Map();
let currentChoosePhotoCharId = null;
let draggedColIndex = null;

function getActiveAuthUser() {
  const isOwner = Boolean(userSessionData?.isAdmin);
  if (isOwner) {
    const ownerWishlist = Array.isArray(userSessionData?.wishlist) ? userSessionData.wishlist : [];
    return {
      token: userSessionToken,
      publicId: userPublicId,
      isOwner: true,
      data: userSessionData,
      wishlistSet: new Set(ownerWishlist.map(w => w.character?.id || w.characterId)),
    };
  }

  // Visitante em harém público de outro usuário
  const savedToken = getCookie('waifu_session') || localStorage.getItem('waifu_session') || '';
  const savedPublicId = getCookie('waifu_user_public_id') || getCookie('waifu_public_id') || localStorage.getItem('waifu_user_public_id') || '';

  return {
    token: savedToken,
    publicId: savedPublicId,
    isOwner: false,
    data: visitorSessionData,
    wishlistSet: visitorWishlistSet,
  };
}

// Helpers de Cookies para Persistência de Sessão (3 dias)
function setCookie(name, value, days = 3) {
  let expires = '';
  if (days) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    expires = '; expires=' + d.toUTCString();
  }
  document.cookie = `${name}=${encodeURIComponent(value || '')}${expires}; path=/; SameSite=Lax`;
}

function getCookie(name) {
  const nameEQ = name + '=';
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
  }
  return null;
}

function deleteCookie(name) {
  document.cookie = `${name}=; Max-Age=-99999999; path=/; SameSite=Lax`;
}

function performFullLogout() {
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    const c = cookies[i].trim();
    const eq = c.indexOf('=');
    if (eq !== -1) {
      const name = c.substring(0, eq).trim();
      if (name.startsWith('waifu_')) {
        deleteCookie(name);
      }
    }
  }
  deleteCookie('waifu_session');
  deleteCookie('waifu_user_public_id');
  deleteCookie('waifu_public_id');
  if (userPublicId) {
    deleteCookie(`waifu_session_${userPublicId}`);
    deleteCookie(`waifu_session_${userPublicId.replace(/^=+/, '')}`);
  }
  try {
    localStorage.removeItem('waifu_session');
    localStorage.removeItem('waifu_user_public_id');
    localStorage.removeItem('waifu_public_id');
  } catch (_) {}
}

let marketState = {
  search: '',
  rarity: '',
  sortBy: 'rarity',
  page: 1,
  limit: 12,
  total: 0,
  totalPages: 1,
  loading: false
};

let catalogState = {
  search: '',
  gender: '',
  maritalStatus: '',
  rarity: '',
  sort: 'wishlist',
  page: 1,
  limit: 18,
  total: 0,
  totalPages: 1,
  loading: false
};

document.addEventListener('DOMContentLoaded', () => {
  // Extrai publicId da URL (/user/:publicId)
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const userIdx = pathParts.indexOf('user');
  if (userIdx !== -1 && pathParts[userIdx + 1]) {
    const rawId = decodeURIComponent(pathParts[userIdx + 1]);
    userPublicId = rawId.replace(/^=+/, '').trim();
    // Limpa a URL no navegador caso tenha entrado com %3D ou =
    if (pathParts[userIdx + 1].includes('=') || pathParts[userIdx + 1].startsWith('%3D')) {
      const cleanPath = `/user/${encodeURIComponent(userPublicId)}${window.location.search}`;
      window.history.replaceState(null, '', cleanPath);
    }
  }

  // Se não foi fornecido publicId na URL (ex: acessou /user diretamente), tenta redirecionar para a própria sessão salva
  if (!userPublicId) {
    const savedPublicId = getCookie('waifu_user_public_id') || getCookie('waifu_public_id') || localStorage.getItem('waifu_user_public_id');
    if (savedPublicId) {
      window.location.replace(`/user/${encodeURIComponent(savedPublicId)}${window.location.search}`);
      return;
    }
  }

  // Extrai token da query string (?token=...)
  const params = new URLSearchParams(window.location.search);
  userSessionToken = params.get('token') || '';

  // Se não houver token na URL, recupera token salvo no cookie apenas se a sessão pertencer a este perfil
  if (!userSessionToken && userPublicId) {
    const savedUserPublicId = getCookie('waifu_user_public_id') || getCookie('waifu_public_id') || localStorage.getItem('waifu_user_public_id');
    const savedToken = getCookie(`waifu_session_${userPublicId}`) || (savedUserPublicId === userPublicId ? (getCookie('waifu_session') || localStorage.getItem('waifu_session')) : null);
    if (savedToken) {
      userSessionToken = savedToken;
    }
  }

  if (!userPublicId) {
    document.getElementById('user-title').textContent = 'Usuário não especificado';
    return;
  }

  setupEventListeners();
  loadUserData();
});

function setupEventListeners() {
  // Navegação de coleções do harém (hover no desktop com debounce de 1s, toque no mobile)
  setupHaremCollectionsNavEvents(false);
  setupHaremCollectionsNavEvents(true);

  // Pausa todos os slideshows quando a aba do navegador for minimizada ou estiver em segundo plano
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (typeof activeSlideshowCards !== 'undefined') {
        activeSlideshowCards.forEach(card => pauseCardSlideshow(card));
      }
    }
  });

  // Compartilhar Harém (Link limpo sem token com suporte a tema)
  const btnShare = document.getElementById('btn-share-public');
  if (btnShare) {
    btnShare.addEventListener('click', () => {
      const cleanUrl = Api.getShareUrl(`${window.location.origin}/user/${userPublicId}`);
      Api.copyToClipboard(cleanUrl, 'Link público do harém copiado!');
    });
  }

  // Alternância de abas principais do painel privado
  const mainTabs = document.querySelectorAll('#private-panel .retro-tabs:not(.retro-subtabs) .retro-tab[data-tab]');
  mainTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab;
      switchTab(targetId);
    });
  });

  // Alternância de subabas do painel privado (Catálogo, Harém e Classificados)
  const privateSubtabs = document.querySelectorAll('#private-panel .retro-subtabs .retro-subtab[data-subtab]');
  privateSubtabs.forEach(subtab => {
    subtab.addEventListener('click', () => {
      const parentContainer = subtab.closest('.retro-subtabs');
      const targetId = subtab.dataset.subtab;
      if (parentContainer) {
        activateSubTab(parentContainer.id, targetId, true);
      }
      if (targetId === 'subtab-catalog-characters') {
        loadCatalogCharacters();
      } else if (targetId === 'subtab-catalog-suggestions') {
        loadUserSuggestions();
      } else if (targetId === 'subtab-harem-summary') {
        loadHaremSummary();
      } else if (targetId === 'subtab-harem-mythics') {
        loadUserMythics();
      } else if (targetId === 'subtab-market-browse') {
        loadWishlistMarket();
        loadGlobalMarket();
      } else if (targetId === 'subtab-market-my-listings') {
        loadMyListings();
      } else if (targetId === 'subtab-market-sent-offers') {
        loadMySentOffers();
      }
    });
  });

  // Listener para navegação por histórico/hash (F5, favoritos, botões avançar/voltar)
  window.addEventListener('hashchange', () => {
    navigateToHash(window.location.hash);
  });

  // Busca em tempo real na aba de Rankings
  const rankingSearchInput = document.getElementById('ranking-search-input');
  if (rankingSearchInput) {
    let rankingSearchTimer = null;
    rankingSearchInput.addEventListener('input', (e) => {
      clearTimeout(rankingSearchTimer);
      const val = e.target.value;
      rankingSearchTimer = setTimeout(() => {
        loadRankings(val);
      }, 300);
    });
  }

  // Ajuste dinâmico de cards nos classificados em caso de resize da tela
  let marketResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(marketResizeTimer);
    marketResizeTimer = setTimeout(() => {
      if (typeof getMarketPageLimit === 'function' && getMarketPageLimit() !== marketState.limit) {
        // loadGlobalMarket aplica o novo limite e volta para a página 1
        loadGlobalMarket();
      }
    }, 250);
  });

  // Alternância de abas do painel público (Harém e Classificados)
  const publicTabs = document.querySelectorAll('#public-panel .retro-tab[data-publictab]');
  publicTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      publicTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.dataset.publictab;
      document.querySelectorAll('#public-panel .public-tab-content').forEach(c => c.classList.add('hidden'));
      const activeContent = document.getElementById(targetId);
      if (activeContent) activeContent.classList.remove('hidden');

      if (targetId === 'public-tab-market') {
        loadPublicUserListings();
      }
    });
  });

  // Filtros e busca da aba Catálogo
  let searchTimer = null;
  const catalogSearchInput = document.getElementById('catalog-search-input');
  if (catalogSearchInput) {
    catalogSearchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        catalogState.search = catalogSearchInput.value.trim();
        catalogState.page = 1;
        loadCatalogCharacters();
      }, 300);
    });
  }

  const catalogGenderPills = document.querySelectorAll('#catalog-gender-pills .retro-pill');
  const catalogGenderSelect = document.getElementById('catalog-gender-select');
  catalogGenderPills.forEach(pill => {
    pill.addEventListener('click', () => {
      catalogGenderPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      catalogState.gender = pill.dataset.gender || '';
      if (catalogGenderSelect) catalogGenderSelect.value = catalogState.gender;
      catalogState.page = 1;
      loadCatalogCharacters();
    });
  });

  if (catalogGenderSelect) {
    catalogGenderSelect.addEventListener('change', () => {
      catalogState.gender = catalogGenderSelect.value || '';
      catalogGenderPills.forEach(p => {
        p.classList.toggle('active', (p.dataset.gender || '') === catalogState.gender);
      });
      catalogState.page = 1;
      loadCatalogCharacters();
    });
  }

  const catalogMaritalPills = document.querySelectorAll('#catalog-marital-pills .retro-pill');
  catalogMaritalPills.forEach(pill => {
    pill.addEventListener('click', () => {
      catalogMaritalPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      catalogState.maritalStatus = pill.dataset.status || '';
      catalogState.page = 1;
      loadCatalogCharacters();
    });
  });

  const catalogRaritySelect = document.getElementById('catalog-rarity-select');
  if (catalogRaritySelect) {
    catalogRaritySelect.addEventListener('change', () => {
      catalogState.rarity = catalogRaritySelect.value;
      catalogState.page = 1;
      loadCatalogCharacters();
    });
  }

  const catalogSortSelect = document.getElementById('catalog-sort-select');
  if (catalogSortSelect) {
    catalogSortSelect.addEventListener('change', () => {
      catalogState.sort = catalogSortSelect.value;
      catalogState.page = 1;
      loadCatalogCharacters();
    });
  }

  // Paginação do Catálogo
  const catalogBtnPrev = document.getElementById('catalog-btn-prev');
  if (catalogBtnPrev) {
    catalogBtnPrev.addEventListener('click', () => {
      if (catalogState.page > 1) {
        catalogState.page--;
        loadCatalogCharacters();
      }
    });
  }

  const catalogBtnNext = document.getElementById('catalog-btn-next');
  if (catalogBtnNext) {
    catalogBtnNext.addEventListener('click', () => {
      if (catalogState.page < catalogState.totalPages) {
        catalogState.page++;
        loadCatalogCharacters();
      }
    });
  }

  // Confirmação de denúncia (🔞)
  const btnConfirmReport = document.getElementById('btn-confirm-report');
  if (btnConfirmReport) {
    btnConfirmReport.addEventListener('click', submitReport);
  }

  // Confirmação de divórcio
  const btnDivorce = document.getElementById('btn-confirm-divorce');
  if (btnDivorce) {
    btnDivorce.addEventListener('click', executeDivorce);
  }

  // Limpar Wishlist (Apenas Casadas Comigo)
  const btnClearWishlistSelf = document.getElementById('btn-clear-wishlist-self');
  if (btnClearWishlistSelf) {
    btnClearWishlistSelf.addEventListener('click', async () => {
      const confirmed = await Api.showConfirm({
        icon: '🧹',
        title: 'Limpar Wishlist',
        message: 'Deseja remover da sua Wishlist apenas as personagens que já são casadas com você?',
        confirmText: 'Limpar Casadas Comigo',
        confirmClass: 'btn-primary'
      });
      if (!confirmed) return;
      try {
        const res = await Api.delete(`/api/web/user/${userPublicId}/wishlist/married?token=${encodeURIComponent(userSessionToken)}&onlySelf=true`);
        if (res.success) {
          Api.showToast(res.data?.message || 'Wishlist limpa com sucesso!', '🧹');
          loadUserData();
        } else {
          Api.showToast(res.error?.message || 'Falha ao limpar wishlist.', '❌');
        }
      } catch (err) {
        Api.showToast('Erro de comunicação ao limpar wishlist.', '❌');
      }
    });
  }

  // Limpar Wishlist (Todas as Casadas)
  const btnClearWishlist = document.getElementById('btn-clear-wishlist');
  if (btnClearWishlist) {
    btnClearWishlist.addEventListener('click', async () => {
      const confirmed = await Api.showConfirm({
        icon: '🧹',
        title: 'Limpar Wishlist',
        message: 'Deseja remover todas as personagens casadas da sua Wishlist?',
        confirmText: 'Limpar Casadas',
        confirmClass: 'btn-danger'
      });
      if (!confirmed) return;
      try {
        const res = await Api.delete(`/api/web/user/${userPublicId}/wishlist/married?token=${encodeURIComponent(userSessionToken)}`);
        if (res.success) {
          Api.showToast(res.data?.message || 'Wishlist limpa com sucesso!', '🧹');
          loadUserData();
        } else {
          Api.showToast(res.error?.message || 'Falha ao limpar wishlist.', '❌');
        }
      } catch (err) {
        Api.showToast('Erro de comunicação ao limpar wishlist.', '❌');
      }
    });
  }

  // Busca e Filtros do Harém (Casados)
  let haremSearchTimer = null;
  const haremSearchInput = document.getElementById('harem-search-input');
  const btnClearHaremSearch = document.getElementById('btn-clear-harem-search');
  if (haremSearchInput) {
    haremSearchInput.addEventListener('input', () => {
      clearTimeout(haremSearchTimer);
      if (btnClearHaremSearch) {
        if (haremSearchInput.value.trim()) btnClearHaremSearch.classList.remove('hidden');
        else btnClearHaremSearch.classList.add('hidden');
      }
      haremSearchTimer = setTimeout(() => {
        haremFilterState.search = haremSearchInput.value.trim();
        haremFilterState.page = 1;
        renderPrivateHarem(userSessionData?.harem || []);
      }, 300);
    });
  }

  if (btnClearHaremSearch) {
    btnClearHaremSearch.addEventListener('click', () => {
      if (haremSearchInput) haremSearchInput.value = '';
      btnClearHaremSearch.classList.add('hidden');
      haremFilterState.search = '';
      haremFilterState.page = 1;
      renderPrivateHarem(userSessionData?.harem || []);
    });
  }

  const haremRaritySelect = document.getElementById('harem-rarity-select');
  if (haremRaritySelect) {
    haremRaritySelect.addEventListener('change', () => {
      haremFilterState.rarity = haremRaritySelect.value;
      haremFilterState.page = 1;
      renderPrivateHarem(userSessionData?.harem || []);
    });
  }

  // Paginação do Harém Geral
  const haremBtnPrev = document.getElementById('harem-btn-prev');
  if (haremBtnPrev) {
    haremBtnPrev.addEventListener('click', () => {
      if (haremFilterState.page > 1) {
        haremFilterState.page--;
        renderPrivateHarem(userSessionData?.harem || []);
      }
    });
  }

  const haremBtnNext = document.getElementById('harem-btn-next');
  if (haremBtnNext) {
    haremBtnNext.addEventListener('click', () => {
      haremFilterState.page++;
      renderPrivateHarem(userSessionData?.harem || []);
    });
  }

  // Busca e Paginação do Harém Público
  let publicHaremSearchTimer = null;
  const publicHaremSearchInput = document.getElementById('public-harem-search-input');
  const btnClearPublicHaremSearch = document.getElementById('btn-clear-public-harem-search');
  if (publicHaremSearchInput) {
    publicHaremSearchInput.addEventListener('input', () => {
      clearTimeout(publicHaremSearchTimer);
      if (btnClearPublicHaremSearch) {
        if (publicHaremSearchInput.value.trim()) btnClearPublicHaremSearch.classList.remove('hidden');
        else btnClearPublicHaremSearch.classList.add('hidden');
      }
      publicHaremSearchTimer = setTimeout(() => {
        publicHaremFilterState.search = publicHaremSearchInput.value.trim();
        publicHaremFilterState.page = 1;
        renderPublicHarem(userSessionData?.harem || []);
      }, 300);
    });
  }

  if (btnClearPublicHaremSearch) {
    btnClearPublicHaremSearch.addEventListener('click', () => {
      if (publicHaremSearchInput) publicHaremSearchInput.value = '';
      btnClearPublicHaremSearch.classList.add('hidden');
      publicHaremFilterState.search = '';
      publicHaremFilterState.page = 1;
      renderPublicHarem(userSessionData?.harem || []);
    });
  }

  const publicHaremRaritySelect = document.getElementById('public-harem-rarity-select');
  if (publicHaremRaritySelect) {
    publicHaremRaritySelect.addEventListener('change', () => {
      publicHaremFilterState.rarity = publicHaremRaritySelect.value;
      publicHaremFilterState.page = 1;
      renderPublicHarem(userSessionData?.harem || []);
    });
  }

  const publicHaremBtnPrev = document.getElementById('public-harem-btn-prev');
  if (publicHaremBtnPrev) {
    publicHaremBtnPrev.addEventListener('click', () => {
      if (publicHaremFilterState.page > 1) {
        publicHaremFilterState.page--;
        renderPublicHarem(userSessionData?.harem || []);
        document.getElementById('public-harem-section-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  const publicHaremBtnNext = document.getElementById('public-harem-btn-next');
  if (publicHaremBtnNext) {
    publicHaremBtnNext.addEventListener('click', () => {
      publicHaremFilterState.page++;
      renderPublicHarem(userSessionData?.harem || []);
      document.getElementById('public-harem-section-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Busca e Paginação da Wishlist
  let wishlistSearchTimer = null;
  const wishlistSearchInput = document.getElementById('wishlist-search-input');
  const btnClearWishlistSearch = document.getElementById('btn-clear-wishlist-search');
  if (wishlistSearchInput) {
    wishlistSearchInput.addEventListener('input', () => {
      clearTimeout(wishlistSearchTimer);
      if (btnClearWishlistSearch) {
        if (wishlistSearchInput.value.trim()) btnClearWishlistSearch.classList.remove('hidden');
        else btnClearWishlistSearch.classList.add('hidden');
      }
      wishlistSearchTimer = setTimeout(() => {
        wishlistFilterState.search = wishlistSearchInput.value.trim();
        wishlistFilterState.page = 1;
        renderPrivateWishlist(userSessionData?.wishlist || []);
      }, 300);
    });
  }

  if (btnClearWishlistSearch) {
    btnClearWishlistSearch.addEventListener('click', () => {
      if (wishlistSearchInput) wishlistSearchInput.value = '';
      btnClearWishlistSearch.classList.add('hidden');
      wishlistFilterState.search = '';
      wishlistFilterState.page = 1;
      renderPrivateWishlist(userSessionData?.wishlist || []);
    });
  }

  const wishlistFilterMarriedOnly = document.getElementById('wishlist-filter-married-only');
  if (wishlistFilterMarriedOnly) {
    wishlistFilterMarriedOnly.addEventListener('change', () => {
      wishlistFilterState.onlyMarried = Boolean(wishlistFilterMarriedOnly.checked);
      wishlistFilterState.page = 1;
      renderPrivateWishlist(userSessionData?.wishlist || []);
    });
  }

  const wishlistBtnPrev = document.getElementById('wishlist-btn-prev');
  if (wishlistBtnPrev) {
    wishlistBtnPrev.addEventListener('click', () => {
      if (wishlistFilterState.page > 1) {
        wishlistFilterState.page--;
        renderPrivateWishlist(userSessionData?.wishlist || []);
      }
    });
  }

  const wishlistBtnNext = document.getElementById('wishlist-btn-next');
  if (wishlistBtnNext) {
    wishlistBtnNext.addEventListener('click', () => {
      wishlistFilterState.page++;
      renderPrivateWishlist(userSessionData?.wishlist || []);
    });
  }

  // Abrir modal de sugestão de novo personagem
  const btnOpenSuggestChar = document.getElementById('btn-open-suggest-char');
  if (btnOpenSuggestChar) {
    btnOpenSuggestChar.addEventListener('click', () => {
      document.getElementById('form-new-character').reset();
      document.getElementById('new-char-preview-container').classList.add('hidden');
      openModal('modal-suggest-character');
    });
  }

  // Pré-visualização da foto do novo personagem
  const newCharPhoto = document.getElementById('new-char-photo');
  if (newCharPhoto) {
    newCharPhoto.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        Api.showToast('A imagem enviada é muito grande! Compacte ela antes', '⚠️');
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        const img = document.getElementById('new-char-img-preview');
        img.src = evt.target.result;
        document.getElementById('new-char-preview-container').classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    });
  }

  // Submissão do formulário de novo personagem
  const formNewChar = document.getElementById('form-new-character');
  if (formNewChar) {
    formNewChar.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-submit-new-char');
      const progressContainer = document.getElementById('new-char-progress-container');
      const progressBar = document.getElementById('new-char-progress-bar');
      const progressText = document.getElementById('new-char-progress-text');

      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
      }
      if (progressContainer) progressContainer.classList.remove('hidden');
      if (progressBar) progressBar.style.width = '0%';
      if (progressText) progressText.textContent = 'Aguarde... 0%';

      const name = document.getElementById('new-char-name').value.trim();
      const series = document.getElementById('new-char-series').value.trim();
      const gender = document.getElementById('new-char-gender')?.value || 'FEMALE';
      const rarity = document.getElementById('new-char-rarity').value;
      const tags = document.getElementById('new-char-tags')?.value.trim() || '';
      const description = document.getElementById('new-char-description').value.trim();
      const reason = document.getElementById('new-char-reason').value.trim();
      const photoFile = document.getElementById('new-char-photo').files?.[0];

      let fileToSend = photoFile;
      if (photoFile) {
        try {
          fileToSend = await Api.compressImageFile(photoFile, 900, 1400, 0.85);
        } catch (_) {
          fileToSend = photoFile;
        }
      }

      const formData = new FormData();
      formData.append('token', userSessionToken);
      formData.append('type', 'NEW_CHARACTER');
      formData.append('name', name);
      formData.append('series', series);
      formData.append('gender', gender);
      formData.append('suggestedGender', gender);
      formData.append('rarity', rarity);
      formData.append('tags', tags);
      formData.append('description', description);
      formData.append('reason', reason);
      if (fileToSend) {
        formData.append('photo', fileToSend);
      }

      const onProgress = (percent) => {
        if (progressBar) progressBar.style.width = `${percent}%`;
        if (progressText) {
          if (percent < 100) {
            progressText.textContent = `Aguarde... ${percent}%`;
          } else {
            progressText.textContent = 'Processando no servidor... 100%';
          }
        }
      };

      try {
        const res = await (Api.uploadWithProgress
          ? Api.uploadWithProgress(`/api/web/user/${userPublicId}/suggestions`, formData, onProgress)
          : Api.post(`/api/web/user/${userPublicId}/suggestions`, formData));

        if (res.success) {
          closeModal('modal-suggest-character');
          Api.showToast('Sugestão enviada com sucesso! A moderação e o Telegram foram notificados.', '✨');
          loadUserSuggestions();
        } else {
          Api.showToast(res.error?.message || 'Falha ao enviar sugestão.', '❌');
        }
      } catch (err) {
        Api.showToast(err?.message || 'Erro de comunicação ao enviar sugestão.', '❌');
      } finally {
        if (progressContainer) progressContainer.classList.add('hidden');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Sugestão de Personagem';
        }
      }
    });
  }

  // Alternância de subabas do modal de fazer oferta
  const offerTabs = document.querySelectorAll('#modal-market-offer .retro-tab[data-offertab]');
  offerTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      offerTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.dataset.offertab;
      document.querySelectorAll('#modal-market-offer .offertab-content').forEach(c => c.classList.add('hidden'));
      const activeContent = document.getElementById(targetId);
      if (activeContent) activeContent.classList.remove('hidden');
    });
  });

  // Botões de abrir picker de Novo Classificado
  document.getElementById('btn-market-new-listing')?.addEventListener('click', () => {
    openNewMarketListingPicker();
  });
  document.getElementById('btn-market-new-from-harem')?.addEventListener('click', () => {
    openNewMarketListingPicker();
  });
  document.getElementById('new-listing-waifus-search-input')?.addEventListener('input', () => {
    filterNewListingWaifus();
  });
  document.getElementById('btn-clear-new-listing-search')?.addEventListener('click', () => {
    clearNewListingWaifusSearch();
  });
  document.getElementById('new-listing-waifus-rarity-select')?.addEventListener('change', () => {
    filterNewListingWaifus();
  });
  document.getElementById('new-listing-waifus-coveted-checkbox')?.addEventListener('change', () => {
    filterNewListingWaifus();
  });
  document.getElementById('btn-proceed-new-listing')?.addEventListener('click', () => {
    proceedNewMarketListing();
  });

  // Busca nos classificados globais
  let marketSearchTimer = null;
  const marketSearchInput = document.getElementById('market-search-input');
  if (marketSearchInput) {
    marketSearchInput.addEventListener('input', () => {
      clearTimeout(marketSearchTimer);
      marketSearchTimer = setTimeout(() => {
        marketState.search = marketSearchInput.value.trim();
        marketState.page = 1;
        loadGlobalMarket();
      }, 350);
    });
  }

  // Filtro de raridade nos classificados globais
  const marketRaritySelect = document.getElementById('market-rarity-select');
  if (marketRaritySelect) {
    marketRaritySelect.addEventListener('change', () => {
      marketState.rarity = marketRaritySelect.value;
      marketState.page = 1;
      loadGlobalMarket();
    });
  }

  // Ordenação nos classificados globais
  const marketSortSelect = document.getElementById('market-sort-select');
  if (marketSortSelect) {
    marketSortSelect.addEventListener('change', () => {
      marketState.sortBy = marketSortSelect.value;
      marketState.page = 1;
      loadGlobalMarket();
    });
  }

  // Botão de atualizar mercado
  document.getElementById('btn-refresh-market')?.addEventListener('click', () => {
    loadWishlistMarket();
    loadGlobalMarket();
  });

  // Paginação nos classificados globais
  document.getElementById('btn-market-prev')?.addEventListener('click', () => {
    if (marketState.page > 1) {
      marketState.page--;
      loadGlobalMarket();
    }
  });

  document.getElementById('btn-market-next')?.addEventListener('click', () => {
    if (marketState.page < marketState.totalPages) {
      marketState.page++;
      loadGlobalMarket();
    }
  });

  // Botão de confirmar publicação do anúncio
  document.getElementById('btn-confirm-sell')?.addEventListener('click', confirmPublishListing);

  // Botão de submeter proposta de oferta
  document.getElementById('btn-submit-offer')?.addEventListener('click', submitMarketOffer);

  // Input de Zinthos no modal de oferta
  const offerZinthosInput = document.getElementById('offer-zinthos-input');
  if (offerZinthosInput) {
    offerZinthosInput.addEventListener('input', () => {
      if (typeof updateOfferZinthosSpreadNote === 'function') {
        updateOfferZinthosSpreadNote();
      }
    });
  }

  // Busca de waifus no modal de oferta
  const offerWaifusSearchInput = document.getElementById('offer-waifus-search-input');
  if (offerWaifusSearchInput) {
    offerWaifusSearchInput.addEventListener('input', () => {
      filterOfferWaifus();
    });
  }
  document.getElementById('btn-clear-offer-waifus-search')?.addEventListener('click', () => {
    clearOfferWaifusSearch();
  });
  document.getElementById('offer-waifus-rarity-select')?.addEventListener('change', () => {
    filterOfferWaifus();
  });
  document.getElementById('offer-waifus-coveted-checkbox')?.addEventListener('change', () => {
    filterOfferWaifus();
  });

  // Filtro de pastas no modal de atribuir coleção
  const assignColFilterInput = document.getElementById('assign-col-filter-input');
  if (assignColFilterInput) {
    assignColFilterInput.addEventListener('input', () => {
      if (typeof filterAssignCollectionSelect === 'function') {
        filterAssignCollectionSelect();
      }
    });
  }
  document.getElementById('btn-clear-assign-col-filter')?.addEventListener('click', () => {
    if (assignColFilterInput) {
      assignColFilterInput.value = '';
      assignColFilterInput.focus();
    }
    if (typeof filterAssignCollectionSelect === 'function') {
      filterAssignCollectionSelect();
    }
  });

  // Paginação e atualização de ofertas enviadas
  document.getElementById('btn-my-offers-prev')?.addEventListener('click', () => {
    if (mySentOffersState.page > 1) {
      mySentOffersState.page--;
      renderMySentOffersPage();
    }
  });

  document.getElementById('btn-my-offers-next')?.addEventListener('click', () => {
    const totalPages = Math.ceil(mySentOffersState.items.length / (mySentOffersState.pageSize || 20));
    if (mySentOffersState.page < totalPages) {
      mySentOffersState.page++;
      renderMySentOffersPage();
    }
  });

  document.getElementById('btn-refresh-my-offers')?.addEventListener('click', () => {
    loadMySentOffers();
  });

  // Notificações: Marcar todas como lidas e filtro não lidas
  document.getElementById('btn-notifications-mark-read')?.addEventListener('click', markAllNotificationsAsRead);
  document.getElementById('btn-mark-all-read')?.addEventListener('click', markAllNotificationsAsRead);
  document.getElementById('btn-notifications-filter-unread')?.addEventListener('click', () => {
    notificationsFilterUnreadOnly = !notificationsFilterUnreadOnly;
    const btn = document.getElementById('btn-notifications-filter-unread');
    if (btn) {
      btn.className = notificationsFilterUnreadOnly ? 'btn-retro btn-sm btn-gold active' : 'btn-retro btn-sm';
    }
    renderNotificationsList();
  });
  document.getElementById('btn-toggle-device-notifs')?.addEventListener('click', toggleDeviceNotifs);
  updateDeviceNotifButtonUI();

  // Registra Service Worker e monitora notificações do dispositivo
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isDeviceNotifsEnabled()) {
      checkNewDeviceNotifications();
    }
  });
  if (isDeviceNotifsEnabled()) {
    initDeviceNotifPolling();
  }

  // Fechar modais ao clicar fora (fundo overlay escuro)
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal(overlay.id);
      }
    });
  });

  // Fechar modal ao pressionar tecla Escape (Esc)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      const openOverlays = Array.from(document.querySelectorAll('.modal-overlay:not(.hidden)'));
      if (openOverlays.length > 0) {
        const topModal = openOverlays[openOverlays.length - 1];
        closeModal(topModal.id);
      }
    }
  });
}

async function loadUserData() {
  try {
    const url = `/api/web/user/${encodeURIComponent(userPublicId)}${userSessionToken ? `?token=${encodeURIComponent(userSessionToken)}` : ''}`;
    const res = await Api.get(url);

    if (!res.success) {
      document.getElementById('user-title').textContent = 'Usuário não encontrado';
      const subEl = document.getElementById('user-subtitle');
      if (subEl) subEl.textContent = res.error?.message || 'Link inválido ou expirado.';

      let errContainer = document.getElementById('user-error-container');
      if (!errContainer) {
        errContainer = document.createElement('div');
        errContainer.id = 'user-error-container';
        errContainer.style.cssText = 'margin-top: 20px; display: flex; justify-content: center; gap: 12px;';
        const userHeader = document.getElementById('user-header');
        if (userHeader) userHeader.appendChild(errContainer);
      }
      errContainer.innerHTML = `
        <button id="btn-error-logout-home" class="btn-retro" style="background: #ec4899; color: #fff; font-weight: 800; padding: 10px 20px; font-size: 15px; border-color: #db2777; cursor: pointer;">
          <i class="fas fa-home"></i> Voltar para a Home (Limpar Sessão)
        </button>
      `;
      const btnLogoutHome = document.getElementById('btn-error-logout-home');
      if (btnLogoutHome) {
        btnLogoutHome.onclick = () => {
          performFullLogout();
          window.location.href = '/?stay=1';
        };
      }
      return;
    }

    userSessionData = res.data;
    const isOwner = Boolean(userSessionData.isAdmin);
    userCovetedSet = new Set(userSessionData.covetedCharacterIds || []);

    const haremNameDisplay = userSessionData.haremName ? ` — "${userSessionData.haremName}"` : '';
    document.getElementById('user-title').textContent = isOwner
      ? `Painel de ${userSessionData.name}`
      : `Harém de ${userSessionData.name}${haremNameDisplay}`;

    document.title = userSessionData.haremName
      ? `"${userSessionData.haremName}" • Harém de ${userSessionData.name} • Waifuletes ✨`
      : `${isOwner ? 'Painel de' : 'Harém de'} ${userSessionData.name} • Waifuletes ✨`;

    const displayHaremNameEl = document.getElementById('display-harem-name');
    if (displayHaremNameEl) {
      if (userSessionData.haremName) {
        displayHaremNameEl.innerHTML = `"${escapeHtml(userSessionData.haremName)}"`;
      } else {
        displayHaremNameEl.innerHTML = `<em>(Sem nome definido)</em>`;
      }
    }

    const harem = userSessionData.harem || [];
    const totalHaremCount = userSessionData.totalHarem !== undefined ? userSessionData.totalHarem : harem.length;
    const subEl = document.getElementById('user-subtitle');
    if (subEl) subEl.textContent = `${totalHaremCount} personagens colecionados no harém`;

    const zinthos = Number(userSessionData.kakera || 0).toLocaleString('pt-BR');
    const zinthosEl = document.getElementById('user-zinthos');
    if (zinthosEl) {
      if (isOwner) {
        zinthosEl.innerHTML = `<i class="fas fa-coins"></i> ${zinthos} zinthos`;
        zinthosEl.classList.remove('hidden');
      } else {
        zinthosEl.textContent = '';
        zinthosEl.classList.add('hidden');
      }
    }

    if (isOwner) {
      // Auto-manter login de forma transparente e persistente por 3 dias
      if (!userSessionData.isPersistent) {
        userSessionData.isPersistent = true;
        Api.post(`/api/web/user/${encodeURIComponent(userPublicId)}/persist-session`, { token: userSessionToken }).catch(() => {});
      }
      if (userSessionToken) {
        setCookie(`waifu_session_${userPublicId}`, userSessionToken, 3);
        setCookie('waifu_session', userSessionToken, 3);
        setCookie('waifu_user_public_id', userPublicId, 3);
        setCookie('waifu_public_id', userPublicId, 3);
        try {
          localStorage.setItem('waifu_session', userSessionToken);
          localStorage.setItem('waifu_user_public_id', userPublicId);
          localStorage.setItem('waifu_public_id', userPublicId);
        } catch (_) {}
      }

      // Inicia contador de sessão ativa
      renderSessionTimer(userSessionData.expiresIn);

      // Renderiza botão de Logout (Manter Login é mantido automático)
      renderSessionAuthButton();

      // Atualiza link do Waifinder com sessão ativa
      const btnWaifinder = document.getElementById('btn-open-waifinder');
      if (btnWaifinder) {
        btnWaifinder.href = `/catalogo?publicId=${encodeURIComponent(userPublicId)}&token=${encodeURIComponent(userSessionToken)}`;
      }

      // Atualiza badge de notificações não lidas
      const unreadNotifs = Number(userSessionData.unreadNotificationsCount || 0);
      const notifBadge = document.getElementById('notifications-count-badge');
      if (notifBadge) {
        if (unreadNotifs > 0) {
          notifBadge.textContent = unreadNotifs > 99 ? '99+' : unreadNotifs;
          notifBadge.classList.remove('hidden');
        } else {
          notifBadge.classList.add('hidden');
        }
      }

      // Exibe botão de compartilhar apenas para o dono
      document.getElementById('btn-share-public')?.classList.remove('hidden');

      // Atualiza badge de privacidade nas configurações do harém
      const privacyBadge = document.getElementById('harem-privacy-status-badge');
      if (privacyBadge) {
        if (userSessionData.haremPrivate) {
          privacyBadge.textContent = 'Privado';
          privacyBadge.style.background = '#ef4444';
        } else {
          privacyBadge.textContent = 'Público';
          privacyBadge.style.background = '#22c55e';
        }
      }

      document.getElementById('private-panel').classList.remove('hidden');
      document.getElementById('public-panel').classList.add('hidden');

      loadCatalogCharacters();
      renderHostingCostBadge(userSessionData.hostingCost, false);
      renderPrivateHarem(harem);

      if (Array.isArray(userSessionData.wishlist)) {
        window.marketWishlistCharIds = new Set(
          userSessionData.wishlist
            .filter(w => w.isForSale || w.character?.isForSale)
            .map(w => w.character?.id || w.characterId)
        );
      }

      renderPrivateWishlist(userSessionData.wishlist || []);
      loadUserSuggestions();
      loadUserMythics();
      updateMarketPendingBadge();

      // Navegação por Hash inicial (restauração de rota salva, favorito ou F5)
      if (window.location.hash) {
        navigateToHash(window.location.hash);
      } else {
        updateUrlHash('catalogo', 'personagens');
      }
    } else {
      document.getElementById('btn-session-auth')?.classList.add('hidden');
      document.getElementById('btn-share-public')?.classList.add('hidden');
      document.getElementById('private-panel').classList.add('hidden');
      document.getElementById('public-panel').classList.remove('hidden');

      if (userSessionData.isPrivate) {
        document.getElementById('public-private-harem-notice')?.classList.remove('hidden');
        document.getElementById('public-content-wrapper')?.classList.add('hidden');
        const noticeEl = document.getElementById('public-private-notice-text');
        if (noticeEl) {
          noticeEl.textContent = userSessionData.message || `O usuário ${userSessionData.name} decidiu privar seu harém.`;
        }
        const subEl = document.getElementById('user-subtitle');
        if (subEl) subEl.textContent = 'Harém Privado';
        return;
      } else {
        document.getElementById('public-private-harem-notice')?.classList.add('hidden');
        document.getElementById('public-content-wrapper')?.classList.remove('hidden');
      }

      // Se o visitante tiver sessão salva em cookie, valida e ativa seus dados
      const savedPublicId = getCookie('waifu_user_public_id') || getCookie('waifu_public_id') || localStorage.getItem('waifu_user_public_id');
      const savedToken = getCookie('waifu_session') || localStorage.getItem('waifu_session');
      const headerActions = document.querySelector('.header-actions');
      if (savedPublicId && savedToken && savedPublicId !== userPublicId) {
        try {
          const vRes = await Api.get(`/api/web/user/${encodeURIComponent(savedPublicId)}?token=${encodeURIComponent(savedToken)}`);
          if (vRes?.success && vRes.data?.isAdmin) {
            visitorSessionData = vRes.data;
            const vWishlist = visitorSessionData.wishlist || [];
            visitorWishlistSet = new Set(vWishlist.map(w => w.character?.id || w.characterId));
            userCovetedSet = new Set(visitorSessionData.covetedCharacterIds || []);

            if (headerActions && !document.getElementById('btn-my-harem-nav')) {
              const btnHarem = document.createElement('a');
              btnHarem.id = 'btn-my-harem-nav';
              btnHarem.href = `/user/${encodeURIComponent(savedPublicId)}`;
              btnHarem.className = 'btn-retro btn-sm';
              btnHarem.style.cssText = 'background: #22c55e; color: #ffffff; border-color: #16a34a; font-weight: 800;';
              btnHarem.innerHTML = '<i class="fas fa-heart"></i> Meu Harém';
              const themeBtn = document.getElementById('btn-toggle-theme');
              if (themeBtn && themeBtn.parentElement === headerActions) {
                headerActions.insertBefore(btnHarem, themeBtn);
              } else {
                headerActions.appendChild(btnHarem);
              }
            }
          }
        } catch (_) {}
      }

      const marketUserNameEl = document.getElementById('public-market-user-name');
      if (marketUserNameEl) marketUserNameEl.textContent = userSessionData.name || 'Jogador';

      renderHostingCostBadge(userSessionData.hostingCost, true);
      renderPublicHarem(harem);
      renderPublicMarketListings(userSessionData.listings || []);
    }
  } catch (err) {
    console.error('Erro ao carregar dados do usuário:', err);
    document.getElementById('user-title').textContent = 'Erro ao carregar dados';
    const subEl = document.getElementById('user-subtitle');
    if (subEl) subEl.textContent = err?.message || 'Tente recarregar a página.';

    let errContainer = document.getElementById('user-error-container');
    if (!errContainer) {
      errContainer = document.createElement('div');
      errContainer.id = 'user-error-container';
      errContainer.style.cssText = 'margin-top: 20px; display: flex; justify-content: center; gap: 12px;';
      const userHeader = document.getElementById('user-header');
      if (userHeader) userHeader.appendChild(errContainer);
    }
    errContainer.innerHTML = `
      <button id="btn-error-logout-home" class="btn-retro" style="background: #ec4899; color: #fff; font-weight: 800; padding: 10px 20px; font-size: 15px; border-color: #db2777; cursor: pointer;">
        <i class="fas fa-home"></i> Voltar para a Home (Limpar Sessão)
      </button>
    `;
    const btnLogoutHome = document.getElementById('btn-error-logout-home');
    if (btnLogoutHome) {
      btnLogoutHome.onclick = () => {
        performFullLogout();
        window.location.href = '/?stay=1';
      };
    }
  }
}

function renderSessionAuthButton() {
  const btn = document.getElementById('btn-session-auth');
  if (!btn) return;

  btn.classList.remove('hidden', 'btn-keep-login');
  btn.classList.add('btn-logout');
  btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
  btn.title = 'Encerrar sessão (Logout)';
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      await Api.post(`/api/web/user/${userPublicId}/logout`, { token: userSessionToken });
    } catch (_) {}
    performFullLogout();
    window.location.href = `/user/${userPublicId}`;
  };
}

function renderSessionTimer(remainingSeconds) {
  const container = document.getElementById('session-badge-container');
  if (!container) return;

  if (userSessionData?.isPersistent) {
    container.innerHTML = '';
    return;
  }

  if (!remainingSeconds || remainingSeconds <= 0) {
    container.innerHTML = '<span class="badge-rarity" style="position: static; background: #ef4444; color: #fff;">Sessão Expirada</span>';
    return;
  }

  let sec = remainingSeconds;
  const updateBadge = () => {
    if (userSessionData?.isPersistent) return;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    container.innerHTML = `
      <span class="badge-rarity" style="position: static; background: #22c55e; color: #fff; font-size: 13px;">
        <i class="fas fa-unlock"></i> Painel Ativo (${m}m ${s < 10 ? '0' : ''}${s}s restantes)
      </span>
    `;
    sec--;
    if (sec < 0) {
      container.innerHTML = '<span class="badge-rarity" style="position: static; background: #ef4444; color: #fff;">Sessão Expirada</span>';
    } else {
      setTimeout(updateBadge, 1000);
    }
  };
  updateBadge();
}

const RARITY_WEIGHT = { MYTHIC: 6, LEGENDARY: 5, EPIC: 4, RARE: 3, UNCOMMON: 2, COMMON: 1 };

function isHaremSoulmate(entry) {
  if (!entry) return false;
  const isMythic = Boolean(entry.character?.isMythic || String(entry.character?.rarity || '').toUpperCase() === 'MYTHIC');
  if (isMythic) return false;
  return Boolean(entry.isSoulmate || entry.character?.isSoulmate || ((entry.keys || 0) >= 10));
}

function sortHaremCards(harem) {
  return harem.sort((a, b) => {
    // 1. Míticos sempre no topo se estiverem na mesma lista
    const mythicA = Boolean(a.character?.isMythic || String(a.character?.rarity || '').toUpperCase() === 'MYTHIC');
    const mythicB = Boolean(b.character?.isMythic || String(b.character?.rarity || '').toUpperCase() === 'MYTHIC');
    if (mythicB !== mythicA) return (mythicB ? 1 : 0) - (mythicA ? 1 : 0);

    // 2. Soulmates sempre em primeiro lugar (Soulmates > Lendário > Épico > Raro > Incomum > Comum)
    const soulA = isHaremSoulmate(a);
    const soulB = isHaremSoulmate(b);
    if (soulB !== soulA) return (soulB ? 1 : 0) - (soulA ? 1 : 0);

    // 3. Favorita em destaque dentro de cada grupo
    if (b.isFavorite !== a.isFavorite) return (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0);

    // 4. Raridade (Lendário > Épico > Raro > Incomum > Comum)
    const rA = mythicA ? RARITY_WEIGHT.MYTHIC : (RARITY_WEIGHT[a.character?.baseRarity || a.character?.rarity] || 0);
    const rB = mythicB ? RARITY_WEIGHT.MYTHIC : (RARITY_WEIGHT[b.character?.baseRarity || b.character?.rarity] || 0);
    if (rB !== rA) return rB - rA;

    // 5. Chaves
    if ((b.keys || 0) !== (a.keys || 0)) return (b.keys || 0) - (a.keys || 0);

    // 6. Popularidade
    const popA = a.character?.claimCount || a.character?.likeCount || (100000 - (a.character?.rank || 100000));
    const popB = b.character?.claimCount || b.character?.likeCount || (100000 - (b.character?.rank || 100000));
    if (popB !== popA) return popB - popA;

    // 7. Wishlist
    return (b.character?.wishlistCount || 0) - (a.character?.wishlistCount || 0);
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* ────────────────────────────────────────────────────────────────────────── */
/* SLIDESHOW ESCALONADO E OTIMIZADO (INTERSECTION OBSERVER)                    */
/* ────────────────────────────────────────────────────────────────────────── */

let slideshowObserver = null;
const activeSlideshowCards = new Set();
let slideshowStaggerOffset = 0;

function getSlideshowObserver() {
  if (slideshowObserver) return slideshowObserver;
  if (typeof IntersectionObserver === 'undefined') return null;

  slideshowObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const card = entry.target;
      if (entry.isIntersecting) {
        startCardSlideshow(card);
      } else {
        pauseCardSlideshow(card);
      }
    });
  }, { rootMargin: '120px 0px' });

  return slideshowObserver;
}

function clearAllCardSlideshows() {
  activeSlideshowCards.forEach(card => {
    pauseCardSlideshow(card);
    if (slideshowObserver) slideshowObserver.unobserve(card);
    card._slideshowData = null;
  });
  activeSlideshowCards.clear();
  slideshowStaggerOffset = 0;
}

function pauseCardSlideshow(card) {
  const data = card._slideshowData;
  if (data) {
    if (data.timer) {
      clearTimeout(data.timer);
      data.timer = null;
    }
    if (data.imgEl) {
      data.imgEl.classList.remove('card-img-fading');
    }
  }
}

function startCardSlideshow(card) {
  const data = card._slideshowData;
  if (!data || data.timer) return;
  if (!card.isConnected) {
    pauseCardSlideshow(card);
    activeSlideshowCards.delete(card);
    return;
  }

  // Se o card pertencer a um container oculto (display: none), não rodar
  if (card.closest('.hidden')) return;

  const step = 1100 + ((slideshowStaggerOffset * 173) % 800);
  slideshowStaggerOffset = (slideshowStaggerOffset + step) % 5000;
  const initialDelay = 1500 + (slideshowStaggerOffset % 3000);

  function cycle() {
    if (!card.isConnected || document.hidden || card.closest('.hidden')) {
      data.timer = null;
      return;
    }

    const { imgEl, imageUrls } = data;
    data.currentIndex = (data.currentIndex + 1) % imageUrls.length;
    const nextUrl = imageUrls[data.currentIndex];

    // Fade-out suave
    imgEl.classList.add('card-img-fading');
    data.timer = setTimeout(() => {
      if (!card.isConnected || card.closest('.hidden')) {
        data.timer = null;
        return;
      }

      imgEl.src = nextUrl;

      let restored = false;
      const restore = () => {
        if (restored) return;
        restored = true;
        imgEl.classList.remove('card-img-fading');
      };

      imgEl.onload = restore;
      imgEl.onerror = restore;
      setTimeout(restore, 120);

      // Próxima foto a cada 6 segundos apenas enquanto visível na tela
      data.timer = setTimeout(cycle, 6000);
    }, 320);
  }

  data.timer = setTimeout(cycle, initialDelay);
}

function initCardSlideshow(card, imgEl, imageUrls, isPinned) {
  // Não fazer slideshow em personagens com foto fixada nos haréns ou com apenas 1 foto
  if (isPinned) return;
  if (!Array.isArray(imageUrls) || imageUrls.length <= 1) return;

  let currentIndex = 0;
  const currentSrc = imgEl.getAttribute('src') || imgEl.src || '';
  const matchIdx = imageUrls.findIndex(u => u && currentSrc.includes(u));
  if (matchIdx !== -1) currentIndex = matchIdx;

  card._slideshowData = {
    imgEl,
    imageUrls,
    currentIndex,
    timer: null,
  };

  activeSlideshowCards.add(card);

  const observer = getSlideshowObserver();
  if (observer) {
    observer.observe(card);
  } else {
    startCardSlideshow(card);
  }
}

function createPrivateHaremCard(entry, options = {}) {
  const char = entry.character;
  const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
  const isMythic = Boolean(char.isMythic);
  const isSoulmate = !isMythic && Boolean(entry.isSoulmate || char.isSoulmate || (entry.keys && entry.keys >= 10));
  const card = document.createElement('div');
  
  if (isMythic) {
    const cust = char.mythicCustomization || {};
    const animType = cust.animationType || 'spin';
    card.className = `waifu-card mythic-card anim-${animType}`;
    card.style.setProperty('--mythic-border-color', cust.borderColor || '#ffd700');
    card.style.setProperty('--mythic-glow-color', cust.glowColor || '#c084fc');
  } else {
    card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}${isSoulmate ? ' soulmate-card' : ''}`;
    if (!isSoulmate) {
      card.style.borderColor = (char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color;
    }
  }
  card.id = `harem-card-${char.id}`;

  const unseenCovets = Number(entry.unseenCovetsCount || 0);

  if (entry.collectionId) {
    try { localStorage.setItem(`waifu_last_col_${char.id}`, entry.collectionId); } catch (_) {}
  }

  // Oculta badge de coleção nos favoritos e dentro de categorias (pastas)
  const showCollectionBadge = !options.hideCollectionBadge && Boolean(entry.collection);
  const colBadgeHtml = showCollectionBadge
    ? `<div class="badge-collection-tag" style="bottom: ${unseenCovets > 0 ? '34px' : '8px'};" title="Coleção: ${escapeHtml(entry.collection.name)}">📁 ${escapeHtml(entry.collection.name)}</div>`
    : '';

  const isInCollection = Boolean(entry.collectionId);
  const colBtnHtml = isInCollection
    ? `<button class="btn-retro btn-sm" style="width: 100%; border-color: #3b82f6; color: #3b82f6; font-weight: 800;" data-action="assign-collection">
        📁 ${entry.collection ? `Pasta: ${escapeHtml(entry.collection.name)}` : 'Mover Pasta'}
      </button>`
    : '';

  const rarityBadgeHtml = `<div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
      ${rarity.emoji} ${rarity.label}
    </div>`;

  const lockBadgeHtml = (entry.isLocked || entry.collection?.isLocked)
    ? `<div class="badge-locked" style="position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.75); color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; z-index: 2;" title="${entry.isLocked ? 'Personagem bloqueado contra divórcio e anúncios' : 'Coleção bloqueada contra divórcio e anúncios'}">🔒</div>`
    : '';

  if (isMythic) {
    card.innerHTML = `
      <div class="card-img-wrapper" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="Clique para ver detalhes e fotos">
        <img decoding="async" src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)" loading="lazy">
        ${lockBadgeHtml}
      </div>
      <div class="card-info">
        <div class="card-name" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="${escapeHtml(char.name)}">${escapeHtml(char.name)}</div>
        <div class="mythic-bottom-badge" onclick="openWaifuPreview('${char.id}')" title="🔮 Personagem Mítico">🔮 Mítico</div>
        <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
        <div class="card-actions" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
          <button class="btn-retro btn-sm btn-gold" style="width: 100%; font-weight: 800;" onclick="openCardOptionsModal('${char.id}')">
            ⚙️ Opções
          </button>
        </div>
      </div>
    `;
  } else if (isSoulmate) {
    card.innerHTML = `
      <div class="card-img-wrapper" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="Clique para ver detalhes e fotos">
        <img decoding="async" src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)" loading="lazy">
        ${lockBadgeHtml}
      </div>
      <div class="card-info">
        <div class="card-name" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="${escapeHtml(char.name)}">${escapeHtml(char.name)}</div>
        <div class="soulmate-bottom-badge" onclick="openWaifuPreview('${char.id}')" title="💖 Alma Gêmea (Vínculo Máximo)">💖 Soulmate</div>
        <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
        <div class="card-actions" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
          ${colBtnHtml}
          <button class="btn-retro btn-sm btn-gold" style="width: 100%; font-weight: 800;" onclick="openCardOptionsModal('${char.id}')">
            ⚙️ Opções
          </button>
        </div>
      </div>
    `;
  } else {
    card.innerHTML = `
      <div class="card-img-wrapper" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="Clique para ver detalhes e fotos">
        <img decoding="async" src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)" loading="lazy">
        ${lockBadgeHtml}
        ${rarityBadgeHtml}
        ${entry.keys ? `<div class="badge-keys"><span>🔑</span> <span>${entry.keys}</span></div>` : ''}
        ${entry.isFavorite ? `<div class="badge-married" style="background: #ec4899; color: white; top: 8px; right: ${entry.keys ? '56px' : '8px'};">💖</div>` : ''}
        ${unseenCovets > 0 ? `<div class="badge-covets" data-action="open-covets" title="${unseenCovets} jogador(es) interessados">👀 ${unseenCovets}</div>` : ''}
        ${colBadgeHtml}
      </div>
      <div class="card-info">
        <div class="card-name" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')">${escapeHtml(char.name)}</div>
        <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
        <div class="card-actions" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
          ${colBtnHtml}
          <button class="btn-retro btn-sm btn-gold" style="width: 100%; font-weight: 800;" onclick="openCardOptionsModal('${char.id}')">
            ⚙️ Opções
          </button>
        </div>
      </div>
    `;
  }

  bindDataActions(card, {
    'assign-collection': () => openAssignCollectionModal(char.id, char.name, char.imageUrl || '/media/characters/default.jpg', entry.collectionId || ''),
    'open-covets': (event) => {
      event.stopPropagation();
      openHaremCovetsModal(char.id, char.name, char.imageUrl || '/media/characters/default.jpg', char.series || '');
    },
  });

  const imgEl = card.querySelector('.card-img-wrapper img');
  if (imgEl) {
    initCardSlideshow(card, imgEl, char.imageUrls, Boolean(entry.pinnedPhoto));
  }

  return card;
}

const divorcePreviewCache = new Map();
const sellKeysPreviewCache = new Map();

function updateSellModalKeysWarning(keys, isSoulmate = false) {
  const warnEl = document.getElementById('sell-modal-keys-warning');
  if (!warnEl) return;
  const count = Number(keys || 0);
  if (count > 1) {
    const soulmateNote = (isSoulmate || count >= 10)
      ? ' e o vínculo de Soulmate serão perdidos'
      : ' não são transferidas';
    warnEl.innerHTML = `
      <div class="sell-keys-warning-title">⚠️ ATENÇÃO! Você tem ${count} chaves deste personagem que está anunciando</div>
      <div class="sell-keys-warning-desc">Se alguém comprar ou trocar por este anúncio, a pessoa receberá o personagem com apenas <strong>1 chave</strong> (suas chaves extras${soulmateNote}).</div>
    `;
    warnEl.classList.remove('hidden');
  } else {
    warnEl.innerHTML = '';
    warnEl.classList.add('hidden');
  }
}

function formatZinthosValue(val) {
  return Number(val || 0).toLocaleString('pt-BR') + 'z';
}

function formatListingAge(createdAt) {
  if (!createdAt) return null;
  const postDate = new Date(createdAt);
  if (isNaN(postDate.getTime())) return null;

  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - postDate.getTime());
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const dateFormatted = postDate.toLocaleDateString('pt-BR');

  let daysText = '';
  if (diffDays <= 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    daysText = diffHours <= 0 ? 'hoje' : `hoje (há ${diffHours}h)`;
  } else if (diffDays === 1) {
    daysText = 'há 1 dia';
  } else {
    daysText = `há ${diffDays} dias`;
  }

  const timeFormatted = postDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return {
    dateFormatted,
    timeFormatted,
    daysText,
    diffDays,
    html: `<div style="font-size: 11.5px; color: var(--text-muted); margin-top: 3px;" title="Postado em ${dateFormatted} às ${timeFormatted}"><i class="fas fa-clock"></i> Anunciado em <strong>${dateFormatted}</strong> • <strong>${daysText}</strong></div>`
  };
}
window.formatListingAge = formatListingAge;

function getRarityDailyDivorceInfo(rarity) {
  if (!haremSummaryData?.divorces?.rarities) return null;
  return haremSummaryData.divorces.rarities[rarity] || null;
}

async function loadLockedDivorcePreview(characterId, btnElement) {
  if (divorcePreviewCache.has(characterId)) {
    const val = divorcePreviewCache.get(characterId);
    if (btnElement && btnElement.isConnected) {
      btnElement.innerHTML = `<i class="fas fa-lock"></i> 🔒 Divórcio Bloqueado (${formatZinthosValue(val)})`;
    }
    return val;
  }

  const auth = typeof getActiveAuthUser === 'function' ? getActiveAuthUser() : { isOwner: true, token: userSessionData?.token, publicId: userPublicId };
  const token = auth?.token || userSessionData?.token;
  const pId = auth?.publicId || userPublicId || 'token-session';
  if (!token) return null;

  try {
    const res = await Api.get(`/api/web/user/${encodeURIComponent(pId)}/divorce/preview/${encodeURIComponent(characterId)}?token=${encodeURIComponent(token)}`);
    if (res && res.success && res.data) {
      const val = res.data.refundedKakera ?? res.data.fullRefundKakera ?? 0;
      divorcePreviewCache.set(characterId, val);
      if (btnElement && btnElement.isConnected) {
        btnElement.innerHTML = `<i class="fas fa-lock"></i> 🔒 Divórcio Bloqueado (${formatZinthosValue(val)})`;
      }
      return val;
    }
  } catch (err) {
    // Falha silenciosa no preview do botão bloqueado
  }
  return null;
}

function openCardOptionsModal(charId) {
  const entry = haremEntryCache.get(charId);
  if (!entry) return;

  const char = entry.character;
  const nameEl = document.getElementById('card-options-char-name');
  const seriesEl = document.getElementById('card-options-char-series');
  const imgEl = document.getElementById('card-options-char-img');
  const listEl = document.getElementById('card-options-buttons-list');

  if (nameEl) nameEl.textContent = char.name;
  if (seriesEl) seriesEl.textContent = char.series || 'Sem série';
  if (imgEl) imgEl.src = char.imageUrl || '/media/characters/default.jpg';

  if (char.isMythic || char.baseRarity === 'MYTHIC' || char.rarity === 'MYTHIC') {
    if (listEl) {
      listEl.innerHTML = `
        <button class="btn-retro btn-sm" style="width: 100%; border-color: ${entry.isLocked ? '#ef4444' : '#10b981'}; color: ${entry.isLocked ? '#ef4444' : '#10b981'}; font-weight: 800;" onclick="closeModal('modal-card-options'); toggleCharacterLock('${char.id}')">
          ${entry.isLocked ? '🔓 Desbloquear Personagem' : '🔒 Bloquear Personagem'}
        </button>
        <button class="btn-retro btn-sm" style="width: 100%; background: #ec4899; color: white; border-color: #db2777;" onclick="closeModal('modal-card-options'); toggleFavorite('${char.id}')">
          💖 ${entry.isFavorite ? 'Desfavoritar' : 'Favoritar'}
        </button>
        <button class="btn-retro btn-sm" style="width: 100%; border-color: #3b82f6; color: #3b82f6; font-weight: 800;" data-action="assign-collection">
          📁 ${entry.collection ? `Mudar de Pasta (${escapeHtml(entry.collection.name)})` : 'Mover para Coleção'}
        </button>
        <button class="btn-retro btn-sm btn-purple" style="width: 100%; font-weight: 800;" onclick="closeModal('modal-card-options'); openChoosePhotoModal('${char.id}')">
          📷 Escolher Foto Fixa
        </button>
        <button class="btn-retro btn-sm btn-gold" style="width: 100%; font-weight: 800;" onclick="closeModal('modal-card-options'); openEditMythicModalById('${char.id}')">
          🔮 Editar Criação Mítica
        </button>
        <button class="btn-retro btn-sm btn-danger" style="width: 100%; font-weight: 800;" data-action="delete-mythic">
          🗑️ Excluir Mítico & Liberar Slot
        </button>
      `;
      bindCardOptionsActions(listEl, entry);
    }
    openModal('modal-card-options');
    return;
  }

  const unseenCovets = Number(entry.unseenCovetsCount || 0);
  const totalCovets = Number(entry.totalCovetsCount || 0);
  const covetsCount = unseenCovets > 0 ? unseenCovets : totalCovets;
  const covetsLabel = covetsCount > 0 ? `Interessados (${covetsCount})` : 'Interessados';
  const covetsBtnClass = unseenCovets > 0 ? 'btn-gold' : '';
  const covetsBtnStyle = unseenCovets > 0 ? 'border-color: #f59e0b; font-weight: 800;' : '';
  const isSoulmate = Boolean(entry.isSoulmate || char.isSoulmate || (entry.keys && entry.keys >= 10));
  const isCardLocked = Boolean(entry.isLocked || entry.collection?.isLocked);

  let html = `
    <!-- Bloqueio (Toggle) -->
    <button class="btn-retro btn-sm" style="width: 100%; border-color: ${entry.isLocked ? '#ef4444' : '#10b981'}; color: ${entry.isLocked ? '#ef4444' : '#10b981'}; font-weight: 800;" onclick="closeModal('modal-card-options'); toggleCharacterLock('${char.id}')">
      ${entry.isLocked ? '🔓 Desbloquear Personagem' : '🔒 Bloquear Personagem'}
    </button>
    <!-- 1. Favoritar -->
    <button class="btn-retro btn-sm" style="width: 100%; background: #ec4899; color: white; border-color: #db2777;" onclick="closeModal('modal-card-options'); toggleFavorite('${char.id}')">
      💖 ${entry.isFavorite ? 'Desfavoritar' : 'Favoritar'}
    </button>
    <!-- 2. Coleção -->
    <button class="btn-retro btn-sm" style="width: 100%; border-color: #3b82f6; color: #3b82f6; font-weight: 800;" data-action="assign-collection">
      📁 ${entry.collection ? `Mudar de Pasta (${escapeHtml(entry.collection.name)})` : 'Mover para Coleção'}
    </button>
    <!-- 3. Escolher Foto -->
    <button class="btn-retro btn-sm btn-purple" style="width: 100%; font-weight: 800;" onclick="closeModal('modal-card-options'); openChoosePhotoModal('${char.id}')">
      📷 Escolher Foto
    </button>
    <!-- 4. Investir Cotas -->
    ${!isSoulmate ? `
      <button class="btn-retro btn-sm btn-gold" style="width: 100%; font-weight: 800; border-color: #d97706; color: #92400e; background: #fef3c7;" onclick="closeModal('modal-card-options'); openInvestModal('${char.id}')">
        <i class="fas fa-coins"></i> 📈 Investir Cotas (80% OFF)
      </button>
    ` : `
      <button class="btn-retro btn-sm" style="width: 100%; border-color: #ec4899; color: #ec4899; opacity: 0.7; cursor: default;" disabled>
        💖 Soulmate (Vínculo Máximo)
      </button>
    `}
    <!-- 5. Vender -->
    ${isCardLocked ? `
      <button class="btn-retro btn-sm" style="width: 100%; opacity: 0.5; cursor: not-allowed;" title="Personagem ou coleção bloqueada" disabled>
        <i class="fas fa-lock"></i> 🔒 Venda Bloqueada
      </button>
    ` : `
      <button class="btn-retro btn-sm btn-gold" style="width: 100%;" data-action="sell">
        <i class="fas fa-tag"></i> 💰 Vender
      </button>
    `}
    <!-- 6. Divorciar -->
    ${isCardLocked ? `
      <button id="btn-card-options-locked-divorce" class="btn-retro btn-sm" style="width: 100%; opacity: 0.5; cursor: not-allowed;" title="Personagem ou coleção bloqueada" disabled>
        <i class="fas fa-lock"></i> 🔒 Divórcio Bloqueado ${divorcePreviewCache.has(char.id) ? `(${formatZinthosValue(divorcePreviewCache.get(char.id))})` : '(...)'}
      </button>
    ` : (() => {
      const divInfo = getRarityDailyDivorceInfo(char.baseRarity);
      const drText = divInfo
        ? (divInfo.count > 0 ? ` (${divInfo.count} hoje • DR ${Math.round(divInfo.nextRate * 100)}%)` : ' (100% líq.)')
        : '';
      return `
        <button class="btn-retro btn-sm btn-danger" style="width: 100%;" data-action="divorce" data-rarity="${char.baseRarity}">
          <i class="fas fa-heart-crack"></i> Divorciar${drText}
        </button>
      `;
    })()}
    <!-- 7. Sugerir Mudança -->
    <button class="btn-retro btn-sm" style="width: 100%;" data-action="suggest">
      <i class="fas fa-lightbulb"></i> Sugerir Alterações
    </button>
  `;

  // 8. Interessados: Mostrar só se >0
  if (unseenCovets > 0 || totalCovets > 0) {
    html += `
      <button class="btn-retro btn-sm ${covetsBtnClass}" style="width: 100%; ${covetsBtnStyle}" data-action="open-covets">
        <i class="fas fa-eye"></i> 👀 ${covetsLabel}
      </button>
    `;
  }

  if (listEl) {
    listEl.innerHTML = html;
    bindCardOptionsActions(listEl, entry);
    if (isCardLocked) {
      const lockedDivBtn = document.getElementById('btn-card-options-locked-divorce');
      loadLockedDivorcePreview(char.id, lockedDivBtn);
    }
  }
  openModal('modal-card-options');
}

function bindCardOptionsActions(listEl, entry) {
  const char = entry.character;
  const img = char.imageUrl || '/media/characters/default.jpg';
  const closeThen = (fn) => () => {
    closeModal('modal-card-options');
    fn();
  };
  bindDataActions(listEl, {
    'assign-collection': closeThen(() => openAssignCollectionModal(char.id, char.name, img, entry.collectionId || '')),
    'delete-mythic': closeThen(() => confirmDeleteMythic(char.id, char.name)),
    'sell': closeThen(() => openSellModal(char.id, char.name, img, char.series || '')),
    'divorce': closeThen(() => openDivorceModal(char.id, char.name)),
    'suggest': closeThen(() => openSuggestModal(char.id, char.name, char.baseRarity, char)),
    'open-covets': closeThen(() => openHaremCovetsModal(char.id, char.name, img, char.series || '')),
  });
}

let currentChoosePhotoCanUndo = false;
let currentChoosePhotoData = null;
let currentChoosePhotoBusy = false;

function renderChoosePhotoMarriageContainer(charId, marriageData) {
  const marriageContainer = document.getElementById('choose-photo-marriage-container');
  const marriageBadge = document.getElementById('choose-photo-marriage-badge');
  if (!marriageContainer) return;

  if (marriageData?.isPinned) {
    marriageBadge?.classList.remove('hidden');
  } else {
    marriageBadge?.classList.add('hidden');
  }

  if (marriageData?.exists) {
    const rawUrl = marriageData.url || '';
    const hasCacheBust = /[?&](?:t|v)=/.test(rawUrl);
    const marriageImgUrl = rawUrl
      ? (hasCacheBust ? rawUrl : `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}t=${Date.now()}`)
      : '';
    marriageContainer.innerHTML = `
      <div style="display: flex; gap: 14px; align-items: center; flex-wrap: wrap;">
        <img id="choose-photo-marriage-preview-img" decoding="async" src="${marriageImgUrl}" style="width: 100px; height: 100px; object-fit: cover; border-radius: 6px; border: 2.5px solid ${marriageData.isPinned ? '#ec4899' : 'var(--border-retro)'}; box-shadow: var(--shadow-retro-sm);" onerror="handleImgError(this)">
        <div style="flex: 1; min-width: 160px;">
          <div style="font-weight: 800; font-size: 13px; color: #ec4899;">Foto Oficial do Casal 💍</div>
          <p style="font-size: 11px; color: var(--text-muted); margin: 3px 0 8px 0;">
            Gerada pelas Ravenas no momento do casamento ou via comando <code>!mu-foto</code>.
          </p>
          <button class="btn-retro btn-sm ${marriageData.isPinned ? 'btn-pink' : 'btn-gold'}" style="font-weight: 800;" onclick="submitPinnedPhoto('marriage')">
            ${marriageData.isPinned ? '✓ Foto Fixa Atual' : 'Fixar Foto do Casamento'}
          </button>
        </div>
      </div>
    `;
  } else {
    marriageContainer.innerHTML = `
      <div style="text-align: center; padding: 14px; border: 1.5px dashed var(--border-retro); border-radius: 6px; background: var(--bg-card);">
        <div style="font-size: 24px; margin-bottom: 4px;">💍</div>
        <div style="font-size: 13px; font-weight: 800; margin-bottom: 4px;">Ainda não há foto de casamento gerada!</div>
        <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">
          Clique em <b>Nova foto</b> abaixo ou envie no WhatsApp para as Ravenas gerarem a foto do casal:
        </p>
        <button class="btn-retro btn-sm btn-pink" data-action="copy-request-command">
          <i class="fas fa-copy"></i> Copiar ${escapeHtml(marriageData?.requestCommand || `!mu-foto ${charId}`)}
        </button>
      </div>
    `;
    bindDataActions(marriageContainer, {
      'copy-request-command': () => copyTextToClipboard(marriageData?.requestCommand || `!mu-foto ${charId}`),
    });
  }
}

function updateChoosePhotoGenerateButton() {
  const btn = document.getElementById('btn-generate-new-marriage-photo');
  if (!btn) return;
  btn.disabled = currentChoosePhotoBusy;
  if (currentChoosePhotoCanUndo) {
    btn.className = 'btn-retro btn-sm btn-danger';
    btn.style.cssText = 'font-size: 11px; padding: 3px 9px; font-weight: 800;';
    btn.innerHTML = '<i class="fas fa-undo"></i> Desfazer';
    btn.title = 'Cancela a troca restaurando a foto anterior do casamento';
  } else {
    btn.className = 'btn-retro btn-sm btn-gold';
    btn.style.cssText = 'font-size: 11px; padding: 3px 9px; font-weight: 800;';
    btn.innerHTML = '<i class="fas fa-magic"></i> Nova foto';
    btn.title = 'Gerar uma nova foto oficial de casamento com a Ravena AI (pode demorar alguns segundos)';
  }
}

async function handleChoosePhotoGenerateOrUndo() {
  const charId = currentChoosePhotoCharId;
  if (!charId || currentChoosePhotoBusy) return;

  currentChoosePhotoBusy = true;
  updateChoosePhotoGenerateButton();

  if (currentChoosePhotoCanUndo) {
    Api.showLoading('🔙 Desfazendo Foto...', 'Restaurando a foto de casamento anterior...');
    try {
      const res = await Api.post(
        `/api/web/user/${encodeURIComponent(userPublicId)}/harem/${encodeURIComponent(charId)}/marriage-photo/revert`,
        { token: userSessionToken },
        {},
        { loading: false }
      );
      if (res?.success && res.data?.photoUrl) {
        currentChoosePhotoCanUndo = false;
        if (!currentChoosePhotoData) currentChoosePhotoData = { marriage: {} };
        if (!currentChoosePhotoData.marriage) currentChoosePhotoData.marriage = {};
        currentChoosePhotoData.marriage.exists = true;
        currentChoosePhotoData.marriage.url = res.data.photoUrl;
        renderChoosePhotoMarriageContainer(charId, currentChoosePhotoData.marriage);
        Api.showToast('🔙 Troca cancelada! Foto anterior restaurada.', '✨');
        if (currentChoosePhotoData.marriage.isPinned) {
          loadUserData();
        }
      } else {
        Api.showToast(res?.error?.message || 'Não foi possível desfazer a foto.', '❌');
      }
    } catch (_) {
      Api.showToast('Erro de comunicação ao desfazer foto.', '❌');
    } finally {
      Api.hideLoading(true);
      currentChoosePhotoBusy = false;
      updateChoosePhotoGenerateButton();
    }
    return;
  }

  Api.showToast('⏳ Solicitando nova foto do casamento à Ravena AI! Pode demorar alguns segundos...', '📸');
  Api.showLoading(
    '🎨 Gerando Nova Foto...',
    'A Ravena AI está criando uma nova foto de casamento. Isso pode demorar alguns segundos!'
  );

  try {
    const res = await Api.post(
      `/api/web/user/${encodeURIComponent(userPublicId)}/harem/${encodeURIComponent(charId)}/marriage-photo/generate`,
      { token: userSessionToken },
      {},
      { loading: false }
    );
    if (res?.success && res.data?.photoUrl) {
      if (!currentChoosePhotoData) currentChoosePhotoData = { marriage: {} };
      if (!currentChoosePhotoData.marriage) currentChoosePhotoData.marriage = {};
      currentChoosePhotoData.marriage.exists = true;
      currentChoosePhotoData.marriage.url = res.data.photoUrl;
      renderChoosePhotoMarriageContainer(charId, currentChoosePhotoData.marriage);

      if (res.data.hasPrevious) {
        currentChoosePhotoCanUndo = true;
        Api.showToast('✨ Nova foto gerada! Clique em "Desfazer" se quiser voltar à anterior.', '📸');
      } else {
        currentChoosePhotoCanUndo = false;
        Api.showToast('💍 Foto do casamento gerada com sucesso!', '📸');
      }

      if (currentChoosePhotoData.marriage.isPinned) {
        loadUserData();
      }
    } else {
      Api.showToast(res?.error?.message || 'Não foi possível gerar a nova foto agora.', '⚠️');
    }
  } catch (_) {
    Api.showToast('Erro ao comunicar com a Ravena AI para gerar foto.', '❌');
  } finally {
    Api.hideLoading(true);
    currentChoosePhotoBusy = false;
    updateChoosePhotoGenerateButton();
  }
}

async function openChoosePhotoModal(charId) {
  currentChoosePhotoCharId = charId;
  currentChoosePhotoCanUndo = false;
  currentChoosePhotoData = null;
  currentChoosePhotoBusy = false;
  updateChoosePhotoGenerateButton();

  const entry = haremEntryCache.get(charId);
  const char = entry?.character;
  const titleEl = document.getElementById('choose-photo-title');
  if (titleEl && char) titleEl.textContent = `📷 Escolher Foto • ${char.name}`;

  const marriageContainer = document.getElementById('choose-photo-marriage-container');
  const gridEl = document.getElementById('choose-photo-grid');

  if (marriageContainer) marriageContainer.innerHTML = '<div style="text-align: center; padding: 12px; font-size: 12px; color: var(--text-muted);">Carregando opções...</div>';
  if (gridEl) gridEl.innerHTML = '<div style="text-align: center; padding: 12px; font-size: 12px; color: var(--text-muted); grid-column: 1 / -1;">Buscando fotos...</div>';

  openModal('modal-choose-photo');

  try {
    const res = await Api.get(`/api/web/user/${encodeURIComponent(userPublicId)}/harem/${encodeURIComponent(charId)}/photos?token=${encodeURIComponent(userSessionToken)}`);
    if (!res?.success) {
      Api.showToast(res?.error?.message || 'Falha ao buscar opções de fotos.', '❌');
      closeModal('modal-choose-photo');
      return;
    }

    const data = res.data;
    currentChoosePhotoData = data;

    // Foto do casamento
    renderChoosePhotoMarriageContainer(charId, data.marriage);

    // Botão Nova foto / Desfazer e Copiar !mu-foto nova
    const btnGeneratePhoto = document.getElementById('btn-generate-new-marriage-photo');
    if (btnGeneratePhoto) {
      btnGeneratePhoto.onclick = () => handleChoosePhotoGenerateOrUndo();
    }
    const btnNewPhoto = document.getElementById('btn-copy-new-photo-cmd');
    if (btnNewPhoto) {
      btnNewPhoto.onclick = () => copyTextToClipboard(data.marriage?.newPhotoCommand || `!mu-foto nova ${charId}`);
    }

    // Fotos do catálogo
    if (gridEl) {
      gridEl.innerHTML = '';
      if (!data.photos || data.photos.length === 0) {
        gridEl.innerHTML = '<div style="grid-column: 1 / -1; font-size: 12px; color: var(--text-muted); text-align: center;">Nenhuma foto adicional cadastrada.</div>';
      } else {
        data.photos.forEach(photo => {
          const item = document.createElement('div');
          item.style.cssText = `cursor: pointer; position: relative; border-radius: 6px; overflow: hidden; border: 2.5px solid ${photo.isPinned ? '#22c55e' : 'var(--border-retro)'}; background: #000; box-shadow: var(--shadow-retro-sm);`;
          item.innerHTML = `
            <img loading="lazy" decoding="async" src="${photo.url}" style="width: 100%; height: 130px; object-fit: cover; display: block;" onerror="handleImgError(this)">
            <div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.75); color: #fff; font-size: 10px; font-weight: 800; text-align: center; padding: 3px 2px;">
              Foto ${photo.index} ${photo.isPinned ? '✓' : ''}
            </div>
            ${photo.isPinned ? '<div style="position: absolute; top: 4px; right: 4px; background: #22c55e; color: #fff; font-size: 10px; font-weight: 800; padding: 1px 5px; border-radius: 3px;">Fixa</div>' : ''}
          `;
          item.onclick = () => submitPinnedPhoto(photo.id);
          gridEl.appendChild(item);
        });
      }
    }
  } catch (err) {
    Api.showToast('Erro ao carregar opções de fotos.', '❌');
    closeModal('modal-choose-photo');
  }
}

async function submitPinnedPhoto(photo) {
  if (!currentChoosePhotoCharId) return;
  try {
    const res = await Api.put(`/api/web/user/${encodeURIComponent(userPublicId)}/harem/${encodeURIComponent(currentChoosePhotoCharId)}/photo`, {
      token: userSessionToken,
      photo: photo,
    });
    if (res?.success) {
      Api.showToast(res.data?.message || 'Foto fixa atualizada!', '📷');
      closeModal('modal-choose-photo');
      loadUserData();
    } else {
      Api.showToast(res?.error?.message || 'Falha ao atualizar foto fixa.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao salvar foto fixa.', '❌');
  }
}

function copyTextToClipboard(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    Api.showToast(`Copiado: ${text}`, '📋');
  }).catch(() => {
    Api.showToast(`Comando: ${text}`, '📋');
  });
}

async function toggleHaremPrivacy() {
  const currentPrivacy = Boolean(userSessionData?.haremPrivate);
  const nextPrivacy = !currentPrivacy;
  const btn = document.getElementById('btn-toggle-harem-privacy');
  if (btn) btn.disabled = true;

  try {
    const res = await Api.patch(`/api/web/user/${encodeURIComponent(userPublicId)}/harem-privacy`, {
      token: userSessionToken,
      isPrivate: nextPrivacy,
    });
    if (res?.success) {
      userSessionData.haremPrivate = nextPrivacy;
      const badge = document.getElementById('harem-privacy-status-badge');
      if (badge) {
        if (nextPrivacy) {
          badge.textContent = 'Privado';
          badge.style.background = '#ef4444';
        } else {
          badge.textContent = 'Público';
          badge.style.background = '#22c55e';
        }
      }
      Api.showToast(res.data?.message || 'Privacidade do harém atualizada!', nextPrivacy ? '🔒' : '🔓');
    } else {
      Api.showToast(res?.error?.message || 'Falha ao alterar privacidade.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao alterar privacidade.', '❌');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function toggleCollectionPrivacy(collectionId) {
  try {
    const res = await Api.patch(`/api/web/user/${encodeURIComponent(userPublicId)}/collections/${encodeURIComponent(collectionId)}/privacy`, {
      token: userSessionToken,
    });
    if (res?.success) {
      Api.showToast(res.data?.message || 'Privacidade da coleção atualizada!', res.data?.isPrivate ? '🔒' : '👁️');
      loadUserData();
    } else {
      Api.showToast(res?.error?.message || 'Falha ao atualizar coleção.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao atualizar privacidade da pasta.', '❌');
  }
}

async function toggleCollectionLock(collectionId) {
  try {
    const res = await Api.patch(`/api/web/user/${encodeURIComponent(userPublicId)}/collections/${encodeURIComponent(collectionId)}/lock`, {
      token: userSessionToken,
    });
    if (res?.success) {
      divorcePreviewCache.clear();
      Api.showToast(res.data?.message || 'Bloqueio da coleção atualizado!', res.data?.isLocked ? '🔒' : '🔓');
      loadUserData();
    } else {
      Api.showToast(res?.error?.message || 'Falha ao atualizar bloqueio da coleção.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao atualizar bloqueio da pasta.', '❌');
  }
}
window.toggleCollectionLock = toggleCollectionLock;

function renderCollectionsReorderList(collections) {
  const listEl = document.getElementById('collections-reorder-list');
  if (!listEl) return;

  if (!collections || collections.length === 0) {
    listEl.innerHTML = `
      <div style="text-align: center; padding: 14px; border: 1.5px dashed var(--border-retro); border-radius: var(--radius-retro); font-size: 12px; color: var(--text-muted); background: var(--bg-card-subtle);">
        Nenhuma coleção criada ainda. Clique em "+ Nova Coleção" para organizar seu harém!
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';
  collections.forEach((col, idx) => {
    const item = document.createElement('div');
    item.className = 'collection-reorder-item';
    item.draggable = true;
    item.dataset.id = col.id;
    item.dataset.index = idx;
    item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; background: var(--bg-card-subtle); border: var(--border-retro); border-radius: 6px; padding: 8px 12px; gap: 8px; user-select: none; transition: background 0.2s;';

    const isPriv = Boolean(col.isPrivate);
    const eyeIcon = isPriv ? 'fa-eye-slash' : 'fa-eye';
    const eyeTitle = isPriv ? 'Coleção Privada (oculta no harém público)' : 'Coleção Pública (visível no harém público)';
    const eyeBtnClass = isPriv ? 'btn-danger' : '';

    const isLocked = Boolean(col.isLocked);
    const lockIcon = isLocked ? 'fa-lock' : 'fa-lock-open';
    const lockTitle = isLocked ? 'Coleção Bloqueada (divórcio e anúncios impedidos)' : 'Coleção Desbloqueada';
    const lockBtnClass = isLocked ? 'btn-danger' : '';

    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; flex: 1; overflow: hidden;">
        <span class="drag-handle" style="cursor: grab; color: var(--text-muted); font-size: 14px;" title="Arraste para reordenar">
          <i class="fas fa-grip-vertical"></i>
        </span>
        <span style="font-weight: 800; font-size: 12px; color: var(--text-muted); width: 18px;">${idx + 1}.</span>
        <span style="font-weight: 800; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          📂 ${escapeHtml(col.name)}
        </span>
        <span class="badge-tag" style="background: #3b82f6; color: #fff; font-size: 10px; font-weight: 800; padding: 2px 6px;">
          ${col.characterCount || 0} waifus
        </span>
        ${isPriv ? '<span class="badge-tag" style="background: #ef4444; color: #fff; font-size: 10px; font-weight: 800; padding: 2px 6px;"><i class="fas fa-eye-slash"></i> Privada</span>' : ''}
        ${isLocked ? '<span class="badge-tag" style="background: #ef4444; color: #fff; font-size: 10px; font-weight: 800; padding: 2px 6px;"><i class="fas fa-lock"></i> Bloqueada</span>' : ''}
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <!-- Botão Cadeado (Bloqueio) -->
        <button class="btn-retro btn-sm ${lockBtnClass}" style="padding: 4px 8px; font-size: 11px;" onclick="toggleCollectionLock('${col.id}')" title="${lockTitle}">
          <i class="fas ${lockIcon}"></i>
        </button>
        <!-- Botão Editar Nome da Pasta -->
        <button class="btn-retro btn-sm" style="padding: 4px 8px; font-size: 11px;" data-action="edit-collection" title="Editar nome da pasta">
          <i class="fas fa-edit"></i>
        </button>
        <!-- Botão Olho (Privacidade) -->
        <button class="btn-retro btn-sm ${eyeBtnClass}" style="padding: 4px 8px; font-size: 11px;" onclick="toggleCollectionPrivacy('${col.id}')" title="${eyeTitle}">
          <i class="fas ${eyeIcon}"></i>
        </button>
        <!-- Botões Subir / Descer (Fallback mobile) -->
        <button class="btn-retro btn-sm" style="padding: 4px 7px; font-size: 10px;" onclick="moveCollectionOrder(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} title="Subir">
          ▲
        </button>
        <button class="btn-retro btn-sm" style="padding: 4px 7px; font-size: 10px;" onclick="moveCollectionOrder(${idx}, 1)" ${idx === collections.length - 1 ? 'disabled' : ''} title="Descer">
          ▼
        </button>
        <!-- Adicionar waifus -->
        <button class="btn-retro btn-sm btn-primary" style="padding: 4px 8px; font-size: 11px;" data-action="batch-add-collection" title="Adicionar personagens">
          <i class="fas fa-plus"></i>
        </button>
        <!-- Excluir pasta -->
        <button class="btn-retro btn-sm btn-danger" style="padding: 4px 8px; font-size: 11px;" data-action="delete-collection" title="Excluir pasta">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;

    bindDataActions(item, {
      'edit-collection': () => openEditCollectionModal(col.id, col.name),
      'batch-add-collection': () => openBatchAddCharactersModal(col.id, col.name),
      'delete-collection': () => confirmDeleteCollection(col.id, col.name),
    });

    // HTML5 Drag and Drop events
    item.addEventListener('dragstart', (e) => {
      draggedColIndex = idx;
      item.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    });

    item.addEventListener('dragend', () => {
      item.style.opacity = '1';
      document.querySelectorAll('.collection-reorder-item').forEach(el => el.style.borderTop = '');
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.style.borderTop = '2px solid #ec4899';
    });

    item.addEventListener('dragleave', () => {
      item.style.borderTop = '';
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.style.borderTop = '';
      const sourceIndex = draggedColIndex;
      const targetIndex = idx;
      if (sourceIndex !== null && sourceIndex !== targetIndex) {
        applyCollectionReorder(sourceIndex, targetIndex);
      }
    });

    listEl.appendChild(item);
  });
}

async function moveCollectionOrder(index, delta) {
  const collections = userSessionData?.collections || [];
  const targetIndex = index + delta;
  if (targetIndex < 0 || targetIndex >= collections.length) return;
  applyCollectionReorder(index, targetIndex);
}

async function applyCollectionReorder(sourceIndex, targetIndex) {
  const collections = [...(userSessionData?.collections || [])];
  const [moved] = collections.splice(sourceIndex, 1);
  collections.splice(targetIndex, 0, moved);

  userSessionData.collections = collections;
  renderCollectionsReorderList(collections);

  // Envia a nova ordem para o backend
  try {
    const orderedIds = collections.map(c => c.id);
    const res = await Api.put(`/api/web/user/${encodeURIComponent(userPublicId)}/collections/order`, {
      token: userSessionToken,
      order: orderedIds,
    });
    if (res?.success) {
      Api.showToast('Ordem das coleções salva!', '📁');
      loadUserData();
    } else {
      Api.showToast(res?.error?.message || 'Falha ao salvar nova ordem.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao salvar ordem.', '❌');
  }
}

function renderPrivateHarem(harem) {
  clearAllCardSlideshows();

  const grid = document.getElementById('harem-grid');
  const favSection = document.getElementById('private-favorites-section');
  const favGrid = document.getElementById('private-favorites-grid');
  const colContainer = document.getElementById('private-collections-container');
  const colBadge = document.getElementById('collections-count-badge');
  const generalTitle = document.getElementById('private-harem-general-title');
  const haremPagination = document.getElementById('harem-pagination');

  // Atualiza cache de entradas para acesso rápido nas opções
  haremEntryCache.clear();
  harem.forEach(e => haremEntryCache.set(e.character.id, e));

  // 1. Filtrar míticos fora da aba Casados (exibidos exclusivamente na aba Míticos)
  const isMythic = (e) => Boolean(e.character?.isMythic || String(e.character?.rarity || '').toUpperCase() === 'MYTHIC');
  const marriedHarem = harem.filter(e => !isMythic(e));

  const totalCount = marriedHarem.length;
  const haremCountEl = document.getElementById('harem-count');
  if (haremCountEl) haremCountEl.textContent = totalCount;
  const haremCountSub = document.getElementById('harem-count-sub');
  if (haremCountSub) haremCountSub.textContent = totalCount;

  // Renderiza lista reordenável de coleções no container Configurações do Harém
  const collections = userSessionData?.collections || [];
  if (colBadge) colBadge.textContent = `${collections.length}/100`;
  const btnNewCol = document.getElementById('btn-open-new-collection');
  if (btnNewCol) btnNewCol.disabled = collections.length >= 100;
  renderCollectionsReorderList(collections);

  if (marriedHarem.length === 0) {
    if (favSection) favSection.classList.add('hidden');
    if (generalTitle) generalTitle.style.display = 'none';
    if (haremPagination) haremPagination.classList.add('hidden');
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; font-weight: bold;">Seu harém ainda está vazio. Jogue no WhatsApp usando !mu-roll para casar com waifus!</div>';
    return;
  }

  sortHaremCards(marriedHarem);

  const searchText = (haremFilterState.search || '').trim();
  const rarityFilter = (haremFilterState.rarity || '').trim();
  const hasFilter = Boolean(searchText || rarityFilter);
  const filterLabel = rarityFilter === 'COVETED' ? 'Cobiçados' : (RARITY_CONFIG[rarityFilter]?.label || rarityFilter);
  const searchSummary = searchText || (rarityFilter ? filterLabel : '');

  // 2. Favoritas em Destaque
  const allFavorites = marriedHarem.filter(e => e.isFavorite);
  const matchingFavorites = allFavorites.filter(e => matchesHaremCard(e, searchText, rarityFilter));

  if (favSection && favGrid) {
    favSection.style.scrollMarginTop = '70px';
    if (hasFilter) {
      favSection.classList.remove('hidden');
      favGrid.innerHTML = '';
      if (matchingFavorites.length > 0) {
        matchingFavorites.forEach(entry => favGrid.appendChild(createPrivateHaremCard(entry, { hideCollectionBadge: true })));
      } else {
        favGrid.innerHTML = `<div style="width: 100%; text-align: center; padding: 14px; font-size: 13px; color: var(--text-muted); font-style: italic;">Nenhum favorito encontrado para "${escapeHtml(searchSummary)}"</div>`;
      }
    } else {
      if (allFavorites.length > 0) {
        favSection.classList.remove('hidden');
        favGrid.innerHTML = '';
        allFavorites.slice(0, 5).forEach(entry => favGrid.appendChild(createPrivateHaremCard(entry, { hideCollectionBadge: true })));
      } else {
        favSection.classList.add('hidden');
      }
    }
  }

  // 3. Coleções (blocos com grid de waifus)
  if (colContainer) {
    colContainer.innerHTML = '';
    collections.forEach(col => {
      const colCard = document.createElement('div');
      colCard.id = `collection-block-${col.id}`;
      colCard.style.cssText = 'background: var(--bg-card); border: var(--border-retro); border-radius: var(--radius-retro); padding: 14px; box-shadow: var(--shadow-retro-sm); scroll-margin-top: 70px;';

      const allColChars = marriedHarem.filter(e => e.collectionId === col.id);
      const matchingColChars = allColChars.filter(e => matchesHaremCard(e, searchText, rarityFilter));

      colCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px; font-weight: 800;">📂 ${escapeHtml(col.name)}</span>
            <span class="badge-tag" style="background: #3b82f6; color: #fff; font-weight: 800;">${allColChars.length} waifus</span>
            ${col.isPrivate ? '<span class="badge-tag" style="background: #ef4444; color: #fff; font-weight: 800;"><i class="fas fa-eye-slash"></i> Privada</span>' : ''}
            ${col.isLocked ? '<span class="badge-tag" style="background: #ef4444; color: #fff; font-weight: 800;"><i class="fas fa-lock"></i> Bloqueada</span>' : ''}
          </div>
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <button class="btn-retro btn-sm ${col.isLocked ? 'btn-danger' : ''}" onclick="toggleCollectionLock('${col.id}')" title="${col.isLocked ? 'Bloqueada contra divórcio e anúncios' : 'Desbloqueada'}">
              <i class="fas ${col.isLocked ? 'fa-lock' : 'fa-lock-open'}"></i> ${col.isLocked ? 'Bloqueada' : 'Bloquear'}
            </button>
            <button class="btn-retro btn-sm btn-primary" data-action="batch-add-collection">
              <i class="fas fa-plus"></i> + Adicionar Personagens
            </button>
            <button class="btn-retro btn-sm" data-action="edit-collection" title="Editar nome da pasta">
              <i class="fas fa-edit"></i> Editar Nome
            </button>
            <button class="btn-retro btn-sm ${col.isPrivate ? 'btn-danger' : ''}" onclick="toggleCollectionPrivacy('${col.id}')" title="${col.isPrivate ? 'Privada (oculta no público)' : 'Pública'}">
              <i class="fas ${col.isPrivate ? 'fa-eye-slash' : 'fa-eye'}"></i> ${col.isPrivate ? 'Privada' : 'Pública'}
            </button>
            <button class="btn-retro btn-sm btn-danger" data-action="delete-collection">
              <i class="fas fa-trash"></i> Excluir Pasta
            </button>
          </div>
        </div>
        ${col.description ? `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">${escapeHtml(col.description)}</div>` : ''}
        <div class="waifu-grid" id="col-grid-${col.id}"></div>
      `;

      // Liga antes de anexar os cards (que têm seus próprios data-action)
      bindDataActions(colCard, {
        'batch-add-collection': () => openBatchAddCharactersModal(col.id, col.name),
        'edit-collection': () => openEditCollectionModal(col.id, col.name),
        'delete-collection': () => confirmDeleteCollection(col.id, col.name),
      });

      const subGrid = colCard.querySelector(`#col-grid-${col.id}`);
      if (matchingColChars.length > 0) {
        matchingColChars.forEach(entry => subGrid.appendChild(createPrivateHaremCard(entry, { hideCollectionBadge: true })));
      } else if (hasFilter) {
        subGrid.innerHTML = `<div style="grid-column: 1 / -1; padding: 14px; text-align: center; font-size: 13px; color: var(--text-muted); font-style: italic;">Nenhum personagem nesta pasta encontrado para "${escapeHtml(searchSummary)}"</div>`;
      } else {
        subGrid.innerHTML = `<div style="grid-column: 1 / -1; padding: 14px; text-align: center; font-size: 13px; color: var(--text-muted); font-style: italic;">Esta pasta está vazia. Clique em "📁 Coleção" em qualquer waifu abaixo para movê-la para cá.</div>`;
      }

      colContainer.appendChild(colCard);
    });
  }

  // 4. Harém Geral com Paginação
  const allGeneralEntries = marriedHarem.filter(e => !e.collectionId);
  const matchingGeneralEntries = allGeneralEntries.filter(e => matchesHaremCard(e, searchText, rarityFilter));
  if (generalTitle) {
    generalTitle.style.display = 'block';
    generalTitle.style.scrollMarginTop = '70px';
  }

  const totalGeneral = matchingGeneralEntries.length;
  const pageSize = haremFilterState.pageSize || 30;
  const totalGeneralPages = Math.max(1, Math.ceil(totalGeneral / pageSize));
  haremFilterState.page = Math.min(Math.max(1, haremFilterState.page), totalGeneralPages);

  const startIndex = (haremFilterState.page - 1) * pageSize;
  const pagedGeneral = matchingGeneralEntries.slice(startIndex, startIndex + pageSize);

  grid.innerHTML = '';
  if (pagedGeneral.length > 0) {
    pagedGeneral.forEach(entry => grid.appendChild(createPrivateHaremCard(entry)));
  } else if (hasFilter) {
    grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted); font-weight: bold;">Nenhum personagem no harém geral encontrado para "${escapeHtml(searchSummary)}"</div>`;
  } else {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted); font-weight: bold;">Todas as waifus do seu harém estão organizadas em coleções! ✨</div>';
  }

  // Atualiza controles de paginação
  if (haremPagination) {
    if (totalGeneral === 0 && !hasFilter) {
      haremPagination.classList.add('hidden');
    } else {
      haremPagination.classList.remove('hidden');
      const totalCountEl = document.getElementById('harem-general-total-count');
      if (totalCountEl) totalCountEl.textContent = `${totalGeneral} ${totalGeneral === 1 ? 'personagem' : 'personagens'}`;
      const pageIndicator = document.getElementById('harem-page-indicator');
      if (pageIndicator) pageIndicator.textContent = `${haremFilterState.page} / ${totalGeneralPages}`;
      const btnPrev = document.getElementById('harem-btn-prev');
      if (btnPrev) btnPrev.disabled = haremFilterState.page <= 1;
      const btnNext = document.getElementById('harem-btn-next');
      if (btnNext) btnNext.disabled = haremFilterState.page >= totalGeneralPages;
    }
  }

  // Atualiza navegação rápida de coleções
  updateHaremCollectionsNav(collections, marriedHarem, false);
}

async function toggleFavorite(characterId) {
  try {
    const res = await Api.post(`/api/web/user/${userPublicId}/favorite`, {
      token: userSessionToken,
      characterId,
    });
    if (res.success) {
      Api.showToast(res.data?.message || 'Favorito atualizado!', '💖');
      loadUserData();
    } else {
      Api.showToast(res.error?.message || 'Falha ao favoritar.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao favoritar.', '❌');
  }
}

async function toggleCharacterLock(characterId) {
  try {
    const res = await Api.post(`/api/web/user/${encodeURIComponent(userPublicId)}/lock`, {
      token: userSessionToken,
      characterId,
    });
    if (res?.success) {
      divorcePreviewCache.delete(characterId);
      Api.showToast(res.data?.message || 'Bloqueio do personagem atualizado!', res.data?.isLocked ? '🔒' : '🔓');
      loadUserData();
    } else {
      Api.showToast(res?.error?.message || 'Falha ao atualizar bloqueio do personagem.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao atualizar bloqueio do personagem.', '❌');
  }
}
window.toggleCharacterLock = toggleCharacterLock;

function renderPrivateWishlist(wishlist) {
  clearAllCardSlideshows();

  const grid = document.getElementById('wishlist-grid');
  document.getElementById('wishlist-count').textContent = wishlist.length;

  const bonusPct = Math.min(100, (wishlist.length / 1000) * 100);
  const bonusFormatted = Number.isInteger(bonusPct) ? bonusPct : bonusPct.toFixed(1);
  const bonusEl = document.getElementById('wishlist-bonus-val');
  if (bonusEl) {
    bonusEl.textContent = `+${bonusFormatted}%`;
  }

  const paginationEl = document.getElementById('wishlist-pagination');

  if (wishlist.length === 0) {
    if (paginationEl) paginationEl.classList.add('hidden');
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; font-weight: bold;">Sua wishlist está vazia. Use a aba "Catálogo" para desejar personagens!</div>';
    return;
  }

  const searchText = (wishlistFilterState.search || '').trim();
  const onlyMarried = Boolean(wishlistFilterState.onlyMarried);
  const filtered = wishlist.filter(entry => {
    const char = entry.character;
    if (!char) return false;
    const isMarried = Boolean(entry.isMarried || char.isMarried);
    if (onlyMarried && !isMarried) return false;
    return matchesTextFilter(searchText, char.name, char.series, char.id);
  });

  // Ordenação: Personagens casadas com o próprio usuário vêm PRIMEIRO!
  filtered.sort((a, b) => {
    const aChar = a.character || {};
    const bChar = b.character || {};
    const aSelf = Boolean(a.isMarriedToSelf || aChar.isMarriedToSelf || (a.marriedToPublicId && a.marriedToPublicId === userSessionData?.publicId));
    const bSelf = Boolean(b.isMarriedToSelf || bChar.isMarriedToSelf || (b.marriedToPublicId && b.marriedToPublicId === userSessionData?.publicId));
    if (aSelf && !bSelf) return -1;
    if (!aSelf && bSelf) return 1;

    if (onlyMarried) {
      const aMarried = Boolean(a.isMarried || aChar.isMarried);
      const bMarried = Boolean(b.isMarried || bChar.isMarried);
      if (aMarried && !bMarried) return -1;
      if (!aMarried && bMarried) return 1;
    }

    return 0;
  });

  const totalFiltered = filtered.length;
  const pageSize = wishlistFilterState.pageSize || 50;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  wishlistFilterState.page = Math.min(Math.max(1, wishlistFilterState.page), totalPages);

  const startIndex = (wishlistFilterState.page - 1) * pageSize;
  const pagedItems = filtered.slice(startIndex, startIndex + pageSize);

  grid.innerHTML = '';
  if (pagedItems.length === 0) {
    const emptyMsg = onlyMarried
      ? 'Nenhuma personagem casada encontrada na sua wishlist.'
      : `Nenhum personagem na wishlist encontrado para "${escapeHtml(searchText)}"`;
    grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 32px; color: var(--text-muted); font-weight: bold;">${emptyMsg}</div>`;
  } else {
    pagedItems.forEach(entry => {
      const char = entry.character;
      const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
      const isMarried = Boolean(entry.isMarried || char.isMarried);
      const isMarriedToSelf = Boolean(
        entry.isMarriedToSelf ||
        char.isMarriedToSelf ||
        (entry.marriedToPublicId && entry.marriedToPublicId === userSessionData?.publicId)
      );
      const spouse = entry.marriedTo || char.marriedTo;
      const isForSale = Boolean(
        entry.isForSale ||
        char.isForSale ||
        (Array.isArray(char.marketListings) && char.marketListings.length > 0) ||
        (window.marketWishlistCharIds && window.marketWishlistCharIds.has(char.id))
      );

      const card = document.createElement('div');
      if (isMarriedToSelf) {
        card.className = 'waifu-card is-married-self-wishlist';
        card.style.borderColor = '#10b981';
      } else if (isMarried) {
        card.className = 'waifu-card is-married-wishlist';
        card.style.borderColor = '#ef4444';
      } else {
        card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}`;
        card.style.borderColor = (char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color;
      }
      card.id = `wish-card-${char.id}`;

      let marriedBadgeHtml = '';
      if (isMarriedToSelf) {
        marriedBadgeHtml = `
          <div class="badge-married-alert" style="background: rgba(16, 185, 129, 0.95); border-color: #059669; color: #ffffff; font-weight: 800;" title="Casada com você!">
            💍 Casada com você
          </div>
        `;
      } else if (isMarried) {
        marriedBadgeHtml = `
          <div class="badge-married-alert" title="Casada(o) com ${escapeHtml(spouse || 'outro jogador')}">
            💍 Casada ${spouse ? `(${escapeHtml(spouse)})` : ''}
          </div>
        `;
      }

      if (entry.collectionId) {
        try { localStorage.setItem(`waifu_last_col_${char.id}`, entry.collectionId); } catch (_) {}
      }

      card.innerHTML = `
        <div class="card-img-wrapper" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="Clique para ver detalhes e fotos">
          <img decoding="async" src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)" loading="lazy">
          <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
            ${rarity.emoji} ${rarity.label}
          </div>
          ${marriedBadgeHtml}
          ${entry.isStarWish ? '<div class="badge-married" title="Starwish!">⭐</div>' : ''}
          <div class="badge-wishes is-in-wishlist" data-char-id="${char.id}" title="Desejado por ${char.wishlistCount || 0} pessoa(s). Clique para remover da Wishlist" onclick="event.stopPropagation(); toggleWishlist('${char.id}', null, event)">
            <span>⭐</span> <span class="wishes-count">${char.wishlistCount || 0}</span>
          </div>
          <div class="badge-likes" data-char-id="${char.id}" title="Curtido ${char.likeCount || 0} vez(es). Clique para curtir!" onclick="event.stopPropagation(); registerCardLike('${char.id}', event)">
            <span>❤️</span> <span class="likes-count">${char.likeCount || 0}</span>
          </div>
        </div>
        <div class="card-info">
          <div class="card-name" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')">${escapeHtml(char.name)}</div>
          <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
          <div class="card-actions" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
            ${!isMarried ? `
              <button class="btn-retro btn-sm btn-gold" style="width: 100%; font-weight: 800; border-color: #d97706; color: #92400e; background: #fef3c7;" onclick="openInvestModal('${char.id}')">
                <i class="fas fa-coins"></i> 📈 Investir
              </button>
            ` : ''}
            ${isMarried && entry.marriedToPublicId !== userSessionData?.publicId ? `
              ${userCovetedSet.has(char.id) ? `
                <button class="btn-retro btn-sm" style="width: 100%; border-color: #ec4899; color: #ec4899;" disabled>
                  <i class="fas fa-check"></i> 👀 Cobiçado
                </button>
              ` : `
                <button class="btn-retro btn-sm" style="width: 100%; border-color: #ec4899; color: #ec4899;" onclick="covetCharacter('${char.id}', this, event)">
                  <i class="fas fa-eye"></i> 👀 Cobiçar
                </button>
              `}
            ` : ''}
            <div style="display: flex; gap: 6px; width: 100%;">
              <button class="btn-retro btn-sm btn-danger" style="flex: 1;" onclick="removeFromWishlist('${char.id}')">
                <i class="fas fa-times"></i> Remover
              </button>
              <button class="btn-retro btn-sm" style="flex: 1;" data-action="suggest">
                <i class="fas fa-lightbulb"></i> Sugerir
              </button>
            </div>
            ${isForSale ? `
              <button type="button" class="btn-retro btn-sm btn-for-sale" style="width: 100%; background: #10b981 !important; color: #ffffff !important; border-color: #059669 !important; font-weight: 900 !important; letter-spacing: 0.5px !important; cursor: default; pointer-events: none; text-shadow: 1px 1px 0 #047857; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.4) !important; padding: 5px 10px; margin-top: 2px;" tabindex="-1">
                <i class="fas fa-tag"></i> À VENDA!
              </button>
            ` : ''}
          </div>
        </div>
      `;

      bindDataActions(card, {
        'suggest': () => openSuggestModal(char.id, char.name, char.baseRarity, char),
      });

      const imgEl = card.querySelector('.card-img-wrapper img');
      if (imgEl) {
        initCardSlideshow(card, imgEl, char.imageUrls, false);
      }

      grid.appendChild(card);
    });
  }

  // Atualiza controles de paginação da Wishlist
  if (paginationEl) {
    if (totalFiltered === 0 && !searchText) {
      paginationEl.classList.add('hidden');
    } else {
      paginationEl.classList.remove('hidden');
      const totalEl = document.getElementById('wishlist-total-count');
      if (totalEl) totalEl.textContent = `${totalFiltered} ${totalFiltered === 1 ? 'personagem' : 'personagens'}`;
      const pageIndicator = document.getElementById('wishlist-page-indicator');
      if (pageIndicator) pageIndicator.textContent = `${wishlistFilterState.page} / ${totalPages}`;
      const btnPrev = document.getElementById('wishlist-btn-prev');
      if (btnPrev) btnPrev.disabled = wishlistFilterState.page <= 1;
      const btnNext = document.getElementById('wishlist-btn-next');
      if (btnNext) btnNext.disabled = wishlistFilterState.page >= totalPages;
    }
  }
}

function createPublicHaremCard(entry) {
  const char = entry.character;
  const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
  const isMythic = Boolean(char.isMythic);
  const isSoulmate = !isMythic && Boolean(entry.isSoulmate || char.isSoulmate || (entry.keys && entry.keys >= 10));

  const card = document.createElement('div');
  if (isMythic) {
    const cust = char.mythicCustomization || {};
    const animType = cust.animationType || 'spin';
    card.className = `waifu-card mythic-card anim-${animType}`;
    card.style.setProperty('--mythic-border-color', cust.borderColor || '#ffd700');
    card.style.setProperty('--mythic-glow-color', cust.glowColor || '#c084fc');
  } else {
    card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}${isSoulmate ? ' soulmate-card' : ''}`;
    if (!isSoulmate) {
      card.style.borderColor = (char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color;
    }
  }
  card.id = `public-harem-card-${char.id}`;

  const auth = getActiveAuthUser();
  const isWish = auth.wishlistSet.has(char.id);
  const wishTitle = auth.token
    ? (isWish ? 'Na sua Wishlist! Clique para remover' : `Desejado por ${char.wishlistCount || 0} pessoa(s). Clique para adicionar à sua Wishlist`)
    : `Desejado por ${char.wishlistCount || 0} pessoa(s). Faça login para adicionar!`;

  const rarityBadgeHtml = `<div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
      ${rarity.emoji} ${rarity.label}
    </div>`;

  if (isMythic) {
    card.innerHTML = `
      <div class="card-img-wrapper" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="Clique para ver detalhes e fotos">
        <img decoding="async" src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)" loading="lazy">
      </div>
      <div class="card-info">
        <div class="card-name" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="${escapeHtml(char.name)}">${escapeHtml(char.name)}</div>
        <div class="mythic-bottom-badge" onclick="openWaifuPreview('${char.id}')" title="🔮 Personagem Mítico">🔮 Mítico</div>
        <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
      </div>
    `;
  } else if (isSoulmate) {
    card.innerHTML = `
      <div class="card-img-wrapper" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="Clique para ver detalhes e fotos">
        <img decoding="async" src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)" loading="lazy">
      </div>
      <div class="card-info">
        <div class="card-name" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="${escapeHtml(char.name)}">${escapeHtml(char.name)}</div>
        <div class="soulmate-bottom-badge" onclick="openWaifuPreview('${char.id}')" title="💖 Alma Gêmea (Vínculo Máximo)">💖 Soulmate</div>
        <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
      </div>
    `;
  } else {
    card.innerHTML = `
      <div class="card-img-wrapper" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="Clique para ver detalhes e fotos">
        <img decoding="async" src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)" loading="lazy">
        ${rarityBadgeHtml}
        ${entry.keys ? `<div class="badge-keys"><span>🔑</span> <span>${entry.keys}</span></div>` : ''}
        ${entry.isFavorite ? `<div class="badge-married" style="background: #ec4899; color: white; top: 8px; right: ${entry.keys ? '56px' : '8px'};">💖</div>` : ''}
        <div class="badge-wishes ${isWish ? 'is-in-wishlist' : ''}" data-char-id="${char.id}" title="${wishTitle}" onclick="event.stopPropagation(); toggleWishlist('${char.id}', null, event)">
          <span>${isWish ? '⭐' : '✨'}</span> <span class="wishes-count">${char.wishlistCount || 0}</span>
        </div>
        <div class="badge-likes" data-char-id="${char.id}" title="Curtido ${char.likeCount || 0} vez(es). Clique para curtir!" onclick="event.stopPropagation(); registerCardLike('${char.id}', event)">
          <span>❤️</span> <span class="likes-count">${char.likeCount || 0}</span>
        </div>
      </div>
      <div class="card-info">
        <div class="card-name" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')">${escapeHtml(char.name)}</div>
        <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
      </div>
    `;
  }

  const imgEl = card.querySelector('.card-img-wrapper img');
  if (imgEl) {
    initCardSlideshow(card, imgEl, char.imageUrls, Boolean(entry.pinnedPhoto));
  }

  return card;
}

function renderPublicHarem(harem) {
  clearAllCardSlideshows();

  const haremCountBadge = document.getElementById('public-harem-count');
  const totalCount = userSessionData?.totalHarem !== undefined ? userSessionData.totalHarem : (harem ? harem.length : 0);
  if (haremCountBadge) haremCountBadge.textContent = String(totalCount);

  const mythicsSection = document.getElementById('public-mythics-section');
  const mythicsGrid = document.getElementById('public-mythics-grid');
  const favoritesSection = document.getElementById('public-favorites-section');
  const favoritesGrid = document.getElementById('public-favorites-grid');
  const collectionsSection = document.getElementById('public-collections-section');
  const collectionsContainer = document.getElementById('public-collections-container');
  const sectionTitle = document.getElementById('public-harem-section-title');
  const grid = document.getElementById('public-harem-grid');
  const pagination = document.getElementById('public-harem-pagination');

  if (harem.length === 0) {
    if (mythicsSection) mythicsSection.classList.add('hidden');
    if (favoritesSection) favoritesSection.classList.add('hidden');
    if (collectionsSection) collectionsSection.classList.add('hidden');
    if (sectionTitle) sectionTitle.classList.add('hidden');
    if (pagination) pagination.classList.add('hidden');
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; font-weight: bold;">Este usuário ainda não possui personagens no harém.</div>';
    return;
  }

  sortHaremCards(harem);

  const searchText = (publicHaremFilterState.search || '').trim();
  const rarityFilter = (publicHaremFilterState.rarity || '').trim();
  const hasFilter = Boolean(searchText || rarityFilter);
  const filterLabel = rarityFilter === 'COVETED' ? 'Cobiçados' : (RARITY_CONFIG[rarityFilter]?.label || rarityFilter);
  const searchSummary = searchText || (rarityFilter ? filterLabel : '');

  // 1. Míticos Forjados (Fica acima de todos e só é exibida se tiver pelo menos 1 Mítico)
  const mythicEntries = harem.filter(entry => entry.character?.isMythic);
  const matchingMythics = mythicEntries.filter(e => matchesHaremCard(e, searchText, rarityFilter));
  if (mythicsSection && mythicsGrid) {
    if (hasFilter) {
      if (matchingMythics.length > 0) {
        mythicsSection.classList.remove('hidden');
        mythicsGrid.innerHTML = '';
        matchingMythics.forEach(entry => mythicsGrid.appendChild(createPublicHaremCard(entry)));
      } else {
        mythicsSection.classList.add('hidden');
      }
    } else {
      if (mythicEntries.length > 0) {
        mythicsSection.classList.remove('hidden');
        mythicsGrid.innerHTML = '';
        mythicEntries.forEach(entry => mythicsGrid.appendChild(createPublicHaremCard(entry)));
      } else {
        mythicsSection.classList.add('hidden');
      }
    }
  }

  // 2. Favoritos (em cima, logo após os míticos)
  const allFavorites = harem.filter(entry => entry.isFavorite && !entry.character?.isMythic);
  const matchingFavorites = allFavorites.filter(e => matchesHaremCard(e, searchText, rarityFilter));
  if (favoritesSection && favoritesGrid) {
    favoritesSection.style.scrollMarginTop = '70px';
    if (hasFilter) {
      if (matchingFavorites.length > 0) {
        favoritesSection.classList.remove('hidden');
        favoritesGrid.innerHTML = '';
        matchingFavorites.forEach(entry => favoritesGrid.appendChild(createPublicHaremCard(entry)));
      } else {
        favoritesSection.classList.add('hidden');
      }
    } else {
      if (allFavorites.length > 0) {
        favoritesSection.classList.remove('hidden');
        favoritesGrid.innerHTML = '';
        allFavorites.slice(0, 5).forEach(entry => favoritesGrid.appendChild(createPublicHaremCard(entry)));
      } else {
        favoritesSection.classList.add('hidden');
      }
    }
  }

  // 3. Coleções do Usuário (separadas em pastas, excluindo míticos)
  const collections = userSessionData?.collections || [];
  const colWithChars = collections.filter(c => harem.some(e => e.collectionId === c.id && !e.character?.isMythic));

  if (collectionsSection && collectionsContainer) {
    collectionsContainer.innerHTML = '';
    let visibleCollectionsCount = 0;

    colWithChars.forEach(col => {
      const colChars = harem.filter(e => e.collectionId === col.id && !e.character?.isMythic);
      const matchingColChars = colChars.filter(e => matchesHaremCard(e, searchText, rarityFilter));
      if (colChars.length === 0) return;
      if (hasFilter && matchingColChars.length === 0) return;

      visibleCollectionsCount++;
      const colBox = document.createElement('div');
      colBox.id = `public-collection-block-${col.id}`;
      colBox.style.cssText = 'background: var(--bg-card); border: var(--border-retro); border-radius: var(--radius-retro); padding: 14px; box-shadow: var(--shadow-retro-sm); scroll-margin-top: 70px;';
      colBox.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <span style="font-size: 16px; font-weight: 800; color: var(--text-main);">📂 ${escapeHtml(col.name)}</span>
          <span class="badge-tag" style="background: #3b82f6; color: #fff; font-weight: 800;">${matchingColChars.length}${hasFilter ? ` / ${colChars.length}` : ''}</span>
        </div>
        ${col.description ? `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">${escapeHtml(col.description)}</div>` : ''}
        <div class="waifu-grid" id="public-col-grid-${col.id}"></div>
      `;

      const subGrid = colBox.querySelector(`#public-col-grid-${col.id}`);
      matchingColChars.forEach(entry => subGrid.appendChild(createPublicHaremCard(entry)));
      collectionsContainer.appendChild(colBox);
    });

    if (visibleCollectionsCount > 0) {
      collectionsSection.classList.remove('hidden');
    } else {
      collectionsSection.classList.add('hidden');
    }
  } else if (collectionsSection) {
    collectionsSection.classList.add('hidden');
  }

  // 4. Harém Geral (demais personagens sem coleção, não favoritos e não míticos)
  const generalOthers = harem.filter(e => !e.collectionId && !e.character?.isMythic && !allFavorites.includes(e));
  const matchingGeneral = generalOthers.filter(e => matchesHaremCard(e, searchText, rarityFilter));

  const totalGeneral = matchingGeneral.length;
  const pageSize = publicHaremFilterState.pageSize || 30;
  const totalGeneralPages = Math.max(1, Math.ceil(totalGeneral / pageSize));
  publicHaremFilterState.page = Math.min(Math.max(1, publicHaremFilterState.page), totalGeneralPages);

  const startIndex = (publicHaremFilterState.page - 1) * pageSize;
  const pagedGeneral = matchingGeneral.slice(startIndex, startIndex + pageSize);

  grid.innerHTML = '';
  if (pagedGeneral.length > 0) {
    if (sectionTitle) {
      sectionTitle.style.scrollMarginTop = '70px';
      sectionTitle.classList.remove('hidden');
    }
    pagedGeneral.forEach(entry => grid.appendChild(createPublicHaremCard(entry)));
  } else if (hasFilter) {
    if (sectionTitle) sectionTitle.classList.remove('hidden');
    grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted); font-weight: bold;">Nenhum personagem no harém geral encontrado para "${escapeHtml(searchSummary)}"</div>`;
  } else {
    if (sectionTitle) sectionTitle.classList.add('hidden');
    if (mythicEntries.length > 0 || allFavorites.length > 0 || colWithChars.length > 0) {
      grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 20px; color: var(--text-muted); font-weight: bold;">Todas as waifus estão organizadas acima nas coleções ou em destaque! ✨</div>';
    } else {
      grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; font-weight: bold;">Este usuário ainda não possui personagens no harém.</div>';
    }
  }

  // Atualiza controles de paginação do Harém Geral Público
  if (pagination) {
    if (totalGeneral === 0 && !hasFilter) {
      pagination.classList.add('hidden');
    } else {
      pagination.classList.remove('hidden');
      const totalCountEl = document.getElementById('public-harem-general-total-count');
      if (totalCountEl) totalCountEl.textContent = `${totalGeneral} ${totalGeneral === 1 ? 'personagem' : 'personagens'}`;
      const pageIndicator = document.getElementById('public-harem-page-indicator');
      if (pageIndicator) pageIndicator.textContent = `${publicHaremFilterState.page} / ${totalGeneralPages}`;
      const btnPrev = document.getElementById('public-harem-btn-prev');
      if (btnPrev) btnPrev.disabled = publicHaremFilterState.page <= 1;
      const btnNext = document.getElementById('public-harem-btn-next');
      if (btnNext) btnNext.disabled = publicHaremFilterState.page >= totalGeneralPages;
    }
  }

  // Atualiza navegação de coleções do harém público
  updateHaremCollectionsNav(colWithChars, harem, true);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* GERENCIAMENTO DE COLEÇÕES (PASTAS DE HARÉM)                                */
/* ────────────────────────────────────────────────────────────────────────── */

let currentAssignCharId = null;
let assignModalCollections = [];
let assignModalEffectiveColId = '';

function renderAssignCollectionSelectOptions(selectedId, query = '') {
  const selectEl = document.getElementById('assign-col-select');
  if (!selectEl) return;
  const normalizedQuery = (query || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
  const filtered = normalizedQuery
    ? assignModalCollections.filter(c => (c.name || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(normalizedQuery))
    : assignModalCollections;

  selectEl.innerHTML = `
    <option value="">-- Nenhuma (Harém Geral) --</option>
    ${filtered.map(c => `
      <option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>
        📁 ${escapeHtml(c.name)} (${c.characterCount || 0} personagens)
      </option>
    `).join('')}
  `;

  if (selectedId && filtered.some(c => c.id === selectedId)) {
    selectEl.value = selectedId;
  } else {
    selectEl.value = '';
  }
}

function filterAssignCollectionSelect() {
  const filterInput = document.getElementById('assign-col-filter-input');
  const clearBtn = document.getElementById('btn-clear-assign-col-filter');
  const selectEl = document.getElementById('assign-col-select');
  const query = filterInput?.value || '';
  if (clearBtn) clearBtn.classList.toggle('hidden', !query.trim());
  const currentVal = selectEl?.value || assignModalEffectiveColId;
  renderAssignCollectionSelectOptions(currentVal, query);
}

function openAssignCollectionModal(characterId, characterName, charImg, currentCollectionId) {
  const entry = haremEntryCache.get(characterId);
  const char = entry?.character;
  if (char?.isMythic || String(char?.rarity || '').toUpperCase() === 'MYTHIC') {
    Api.showToast('Personagens míticos não podem ser colocados em coleções!', '⚠️');
    return;
  }

  currentAssignCharId = characterId;
  const modal = document.getElementById('modal-assign-collection');
  if (!modal) return;

  document.getElementById('assign-col-char-name').textContent = characterName || characterId;
  const imgEl = document.getElementById('assign-col-char-img');
  if (imgEl) imgEl.src = charImg || '/media/characters/default.jpg';

  const collections = userSessionData?.collections || [];
  assignModalCollections = collections;

  // Recupera a última coleção salva para este personagem (ou atual, ou global recente)
  const lastForChar = localStorage.getItem(`waifu_last_col_${characterId}`) || '';
  const lastGlobal = localStorage.getItem('waifu_last_col_global') || '';

  let effectiveColId = currentCollectionId;
  if (!effectiveColId && lastForChar && collections.some(c => c.id === lastForChar)) {
    effectiveColId = lastForChar;
  } else if (!effectiveColId && lastGlobal && collections.some(c => c.id === lastGlobal)) {
    effectiveColId = lastGlobal;
  }
  assignModalEffectiveColId = effectiveColId || '';

  const filterInput = document.getElementById('assign-col-filter-input');
  if (filterInput) filterInput.value = '';
  const clearBtn = document.getElementById('btn-clear-assign-col-filter');
  if (clearBtn) clearBtn.classList.add('hidden');

  renderAssignCollectionSelectOptions(effectiveColId, '');

  const currentCol = collections.find(c => c.id === currentCollectionId);
  const currentLabelEl = document.getElementById('assign-col-char-current');
  if (currentLabelEl) {
    currentLabelEl.textContent = currentCol ? `Coleção atual: 📁 ${currentCol.name}` : 'Coleção atual: Nenhuma (Harém Geral)';
  }

  openModal('modal-assign-collection');
}

async function submitAssignCollection() {
  if (!currentAssignCharId) return;
  const selectEl = document.getElementById('assign-col-select');
  const targetColId = selectEl?.value;
  const btn = document.getElementById('btn-submit-assign-collection');
  if (btn) btn.disabled = true;

  try {
    let res;
    if (targetColId) {
      res = await Api.post(`/api/web/user/${encodeURIComponent(userPublicId)}/collections/${encodeURIComponent(targetColId)}/characters`, {
        token: userSessionToken,
        characterId: currentAssignCharId,
      });
    } else {
      res = await Api.delete(`/api/web/user/${encodeURIComponent(userPublicId)}/collections/characters/${encodeURIComponent(currentAssignCharId)}?token=${encodeURIComponent(userSessionToken)}`);
    }

    if (res?.success) {
      if (targetColId) {
        try {
          localStorage.setItem(`waifu_last_col_${currentAssignCharId}`, targetColId);
          localStorage.setItem('waifu_last_col_global', targetColId);
        } catch (_) {}
      }
      Api.showToast(res.data?.message || 'Coleção atualizada com sucesso!', '📁');
      closeModal('modal-assign-collection');
      loadUserData();
    } else {
      Api.showToast(res?.error?.message || 'Falha ao mover personagem.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação.', '❌');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openNewCollectionModal() {
  const collections = userSessionData?.collections || [];
  if (collections.length >= 100) {
    Api.showToast('Você atingiu o limite máximo de 100 coleções.', '⚠️');
    return;
  }
  const nameInput = document.getElementById('new-collection-name');
  const descInput = document.getElementById('new-collection-desc');
  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
  const infoEl = document.getElementById('new-collection-count-info');
  if (infoEl) infoEl.textContent = `Coleções atuais: ${collections.length}/100`;
  openModal('modal-new-collection');
}

async function submitNewCollection() {
  const nameInput = document.getElementById('new-collection-name');
  const descInput = document.getElementById('new-collection-desc');
  const name = nameInput?.value.trim();
  const description = descInput?.value.trim();

  if (!name) {
    Api.showToast('Informe o nome da coleção.', '⚠️');
    return;
  }

  const btn = document.getElementById('btn-submit-new-collection');
  if (btn) btn.disabled = true;

  try {
    const res = await Api.post(`/api/web/user/${encodeURIComponent(userPublicId)}/collections`, {
      token: userSessionToken,
      name,
      description,
    });
    if (res?.success) {
      Api.showToast(res.data?.message || 'Coleção criada com sucesso!', '📁');
      closeModal('modal-new-collection');
      loadUserData();
    } else {
      Api.showToast(res?.error?.message || 'Falha ao criar coleção.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao criar coleção.', '❌');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function confirmDeleteCollection(collectionId, collectionName) {
  const confirmed = await Api.showConfirm({
    icon: '🗂️',
    title: 'Apagar Coleção',
    message: `Deseja realmente apagar a coleção "${collectionName}"?`,
    notice: 'Os personagens não serão excluídos nem divorciados, apenas retornarão ao harém geral.',
    noticeTone: 'info',
    confirmText: 'Apagar Coleção',
    confirmClass: 'btn-danger'
  });
  if (!confirmed) {
    return;
  }

  try {
    const res = await Api.delete(`/api/web/user/${encodeURIComponent(userPublicId)}/collections/${encodeURIComponent(collectionId)}?token=${encodeURIComponent(userSessionToken)}`);
    if (res?.success) {
      Api.showToast(res.data?.message || 'Coleção apagada com sucesso!', '🗑️');
      loadUserData();
    } else {
      Api.showToast(res?.error?.message || 'Falha ao apagar coleção.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro ao apagar coleção.', '❌');
  }
}

// --- Gestão de Nome do Harém ---
function openEditHaremNameModal() {
  const input = document.getElementById('input-harem-name');
  if (input) {
    input.value = userSessionData?.haremName || '';
    updateHaremNameCharCounter();
  }
  openModal('modal-edit-harem-name');
  if (input) setTimeout(() => input.focus(), 100);
}

function updateHaremNameCharCounter() {
  const input = document.getElementById('input-harem-name');
  const counter = document.getElementById('harem-name-char-count');
  if (input && counter) {
    counter.textContent = `${input.value.length}/20`;
  }
}

async function submitHaremName() {
  const input = document.getElementById('input-harem-name');
  const haremName = input ? input.value.trim() : '';
  const btn = document.getElementById('btn-save-harem-name');
  if (btn) btn.disabled = true;

  try {
    const res = await Api.patch(`/api/web/user/${encodeURIComponent(userPublicId)}/harem-name`, {
      token: userSessionToken,
      haremName: haremName || null,
    });
    if (res?.success) {
      Api.showToast('Nome do harém atualizado com sucesso!', '👑');
      closeModal('modal-edit-harem-name');
      loadUserData();
    } else {
      Api.showToast(res?.error?.message || 'Falha ao atualizar nome do harém.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao salvar nome.', '❌');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --- Gestão de Nome da Coleção ---
let currentEditCollectionId = null;

function openEditCollectionModal(colId, currentName) {
  currentEditCollectionId = colId;
  const input = document.getElementById('input-edit-collection-name');
  if (input) {
    input.value = currentName || '';
    updateEditCollectionNameCharCounter();
  }
  openModal('modal-edit-collection-name');
  if (input) setTimeout(() => { input.focus(); input.select(); }, 100);
}

function updateEditCollectionNameCharCounter() {
  const input = document.getElementById('input-edit-collection-name');
  const counter = document.getElementById('edit-collection-name-char-count');
  if (input && counter) {
    counter.textContent = `${input.value.length}/50`;
  }
}

async function submitEditCollectionName() {
  if (!currentEditCollectionId) return;
  const input = document.getElementById('input-edit-collection-name');
  const newName = (input ? input.value : '').trim();

  if (!newName) {
    Api.showToast('Informe o novo nome da pasta.', '⚠️');
    return;
  }

  const btn = document.getElementById('btn-save-collection-name');
  if (btn) btn.disabled = true;

  try {
    const res = await Api.patch(`/api/web/user/${encodeURIComponent(userPublicId)}/collections/${encodeURIComponent(currentEditCollectionId)}`, {
      token: userSessionToken,
      name: newName,
    });
    if (res?.success) {
      Api.showToast('Nome da coleção atualizado com sucesso!', '📁');
      closeModal('modal-edit-collection-name');
      await loadUserData();
    } else {
      Api.showToast(res?.error?.message || 'Falha ao renomear coleção.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao atualizar coleção.', '❌');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --- Inclusão em Lote na Coleção ---
let currentBatchTargetColId = null;
let currentBatchTargetColName = '';
let batchSelectedCharIds = new Set();
let batchAvailableHaremEntries = [];
let batchCollectionFilterMode = 'outside'; // 'outside' | 'inside' | 'all'

function getBatchCandidateHaremEntries() {
  const harem = userSessionData?.harem || [];
  // Exclui personagens míticos e personagens que já estão na coleção de destino
  const filtered = harem.filter(e => {
    if (e.character?.isMythic || String(e.character?.rarity || '').toUpperCase() === 'MYTHIC') return false;
    if (e.collectionId && e.collectionId === currentBatchTargetColId) return false;
    return true;
  });
  return sortHaremCards([...filtered]);
}

function openBatchAddCharactersModal(colId, colName) {
  currentBatchTargetColId = colId;
  currentBatchTargetColName = colName;
  batchSelectedCharIds.clear();
  batchCollectionFilterMode = 'outside';

  const titleEl = document.getElementById('batch-add-modal-title');
  if (titleEl) {
    titleEl.textContent = `📁 Adicionar Waifus: "${colName}"`;
  }

  // Reseta botões do toggle para o padrão "Apenas fora de coleção"
  document.querySelectorAll('.batch-filter-btn').forEach(b => {
    const isOutside = b.dataset.batchfilter === 'outside';
    b.classList.toggle('active', isOutside);
    b.classList.toggle('btn-gold', isOutside);
  });

  const candidates = getBatchCandidateHaremEntries();
  if (candidates.length === 0) {
    Api.showToast('Você não possui outros personagens para adicionar a esta pasta!', 'ℹ️');
    return;
  }

  const searchInput = document.getElementById('batch-add-search-input');
  if (searchInput) searchInput.value = '';
  const raritySelect = document.getElementById('batch-add-rarity-select');
  if (raritySelect) raritySelect.value = '';

  filterBatchAddCharacters();
  openModal('modal-batch-add-collection');
}

function setBatchAddFilter(mode, btn) {
  batchCollectionFilterMode = mode;
  document.querySelectorAll('.batch-filter-btn').forEach(b => {
    b.classList.remove('active');
    b.classList.remove('btn-gold');
  });
  if (btn) {
    btn.classList.add('active');
    btn.classList.add('btn-gold');
  }
  filterBatchAddCharacters();
}

function getBatchFilteredEntries() {
  const candidates = getBatchCandidateHaremEntries();
  const searchInput = document.getElementById('batch-add-search-input');
  const raritySelect = document.getElementById('batch-add-rarity-select');
  const term = (searchInput?.value || '').toLowerCase().trim();
  const selectedRarity = (raritySelect?.value || '').toUpperCase();

  return candidates.filter(entry => {
    // Filtro pelo modo do toggle
    if (batchCollectionFilterMode === 'outside' && entry.collectionId) return false;
    if (batchCollectionFilterMode === 'inside' && !entry.collectionId) return false;

    // Filtro de raridade
    if (selectedRarity) {
      const charRarity = (entry.character?.baseRarity || entry.character?.rarity || 'COMMON').toUpperCase();
      if (charRarity !== selectedRarity) return false;
    }

    // Filtro de busca de texto
    if (term) {
      const name = (entry.character?.name || '').toLowerCase();
      const series = (entry.character?.series || '').toLowerCase();
      if (!name.includes(term) && !series.includes(term)) return false;
    }
    return true;
  });
}

function filterBatchAddCharacters() {
  batchAvailableHaremEntries = getBatchFilteredEntries();
  renderBatchAddCharactersList(batchAvailableHaremEntries);
  updateBatchAddCounters();
}

function renderBatchAddCharactersList(entries) {
  const container = document.getElementById('batch-add-characters-list');
  if (!container) return;

  if (entries.length === 0) {
    let msg = 'Nenhum personagem encontrado.';
    if (batchCollectionFilterMode === 'outside') {
      msg = 'Nenhum personagem fora de coleções encontrado.';
    } else if (batchCollectionFilterMode === 'inside') {
      msg = 'Nenhum personagem em outras coleções encontrado.';
    }
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">${msg}</div>`;
    return;
  }

  container.innerHTML = entries.map(entry => {
    const char = entry.character;
    const isChecked = batchSelectedCharIds.has(char.id);
    const rarityClass = (char.baseRarity || 'COMMON').toLowerCase();
    const rarityLabel = (RARITY_CONFIG[char.baseRarity]?.label) || RARITY_LABELS[char.baseRarity] || char.baseRarity;
    const imgUrl = char.imageUrl || `/media/characters/${char.id}.jpg`;

    let currentFolderHtml = '';
    if (entry.collectionId) {
      const colName = entry.collection?.name || (userSessionData?.collections?.find(c => c.id === entry.collectionId)?.name) || 'Outra pasta';
      currentFolderHtml = `<div style="font-size: 10px; color: #f59e0b; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="Atualmente na pasta: ${escapeHtml(colName)}">📁 ${escapeHtml(colName)}</div>`;
    }

    return `
      <label class="batch-char-card ${isChecked ? 'selected' : ''}" style="display: flex; flex-direction: column; background: var(--bg-card); border: 2px solid ${isChecked ? 'var(--color-primary, #ec4899)' : 'var(--border-retro)'}; border-radius: 6px; padding: 6px; cursor: pointer; user-select: none; transition: all 0.15s ease;">
        <div style="position: relative; width: 100%; aspect-ratio: 1; margin-bottom: 6px; overflow: hidden; border-radius: 4px; background: #000;">
          <img decoding="async" src="${imgUrl}" style="width: 100%; height: 100%; object-fit: cover;" onerror="handleImgError(this)" loading="lazy">
          <input type="checkbox" data-char-id="${char.id}" ${isChecked ? 'checked' : ''} onchange="toggleBatchCharSelection('${char.id}', this.checked)" style="position: absolute; top: 6px; right: 6px; width: 20px; height: 20px; cursor: pointer; accent-color: #ec4899;">
          <span class="badge-tag badge-${rarityClass}" style="position: absolute; bottom: 4px; left: 4px; font-size: 10px; padding: 1px 4px;">${rarityLabel}</span>
        </div>
        <div style="font-weight: 800; font-size: 12px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(char.name)}">
          ${escapeHtml(char.name)}
        </div>
        <div style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(char.series || '')}">
          ${escapeHtml(char.series || '-')}
        </div>
        ${currentFolderHtml}
      </label>
    `;
  }).join('');
}

function toggleBatchCharSelection(charId, isSelected) {
  if (isSelected) {
    batchSelectedCharIds.add(charId);
  } else {
    batchSelectedCharIds.delete(charId);
  }
  updateBatchAddCounters();

  // Atualiza visual do card
  const checkbox = document.querySelector(`input[data-char-id="${charId}"]`);
  if (checkbox && checkbox.closest('.batch-char-card')) {
    const card = checkbox.closest('.batch-char-card');
    card.style.borderColor = isSelected ? 'var(--color-primary, #ec4899)' : 'var(--border-retro)';
  }
}

function toggleSelectAllBatchAdd() {
  const visibleEntries = batchAvailableHaremEntries;
  if (!visibleEntries || visibleEntries.length === 0) return;

  const allVisibleSelected = visibleEntries.every(e => batchSelectedCharIds.has(e.character.id));

  visibleEntries.forEach(entry => {
    if (allVisibleSelected) {
      batchSelectedCharIds.delete(entry.character.id);
    } else {
      batchSelectedCharIds.add(entry.character.id);
    }
  });

  renderBatchAddCharactersList(visibleEntries);
  updateBatchAddCounters();
}

function updateBatchAddCounters() {
  const count = batchSelectedCharIds.size;
  const countEl = document.getElementById('batch-add-selected-count');
  const btnCountEl = document.getElementById('batch-add-btn-count');
  const btnConfirm = document.getElementById('btn-confirm-batch-add');

  if (countEl) countEl.textContent = String(count);
  if (btnCountEl) btnCountEl.textContent = String(count);
  if (btnConfirm) btnConfirm.disabled = count === 0;

  const btnSelectAll = document.getElementById('btn-batch-select-all');
  if (btnSelectAll && batchAvailableHaremEntries.length > 0) {
    const allVisible = batchAvailableHaremEntries.every(e => batchSelectedCharIds.has(e.character.id));
    btnSelectAll.textContent = allVisible ? 'Desmarcar Todos' : 'Selecionar Todos';
  }
}

async function submitBatchAddCharacters() {
  if (batchSelectedCharIds.size === 0 || !currentBatchTargetColId) return;

  const btn = document.getElementById('btn-confirm-batch-add');
  if (btn) btn.disabled = true;

  const charIds = Array.from(batchSelectedCharIds);
  Api.showToast(`Adicionando ${charIds.length} waifus à coleção...`, '⏳');

  let successCount = 0;
  let failCount = 0;

  // Envia em lotes concorrentes de 5 requisições por vez
  const chunkSize = 5;
  for (let i = 0; i < charIds.length; i += chunkSize) {
    const chunk = charIds.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (charId) => {
      try {
        const res = await Api.post(
          `/api/web/user/${encodeURIComponent(userPublicId)}/collections/${encodeURIComponent(currentBatchTargetColId)}/characters`,
          {
            token: userSessionToken,
            characterId: charId,
          }
        );
        if (res?.success) successCount++;
        else failCount++;
      } catch {
        failCount++;
      }
    }));
  }

  if (successCount > 0) {
    Api.showToast(`✨ ${successCount} waifu(s) adicionada(s) à pasta "${currentBatchTargetColName}"!`, '📁');
    closeModal('modal-batch-add-collection');
    loadUserData();
  } else {
    Api.showToast('Falha ao adicionar personagens à coleção.', '❌');
    if (btn) btn.disabled = false;
  }
}

async function loadPublicUserListings() {
  const grid = document.getElementById('public-market-grid');
  try {
    const res = await Api.get(`/api/web/user/${encodeURIComponent(userPublicId)}/market/user-listings`);
    if (res.success && Array.isArray(res.data)) {
      renderPublicMarketListings(res.data);
    }
  } catch (err) {
    console.error('Erro ao recarregar classificados públicos:', err);
  }
}

function renderPublicMarketListings(listings) {
  const grid = document.getElementById('public-market-grid');
  const countBadge = document.getElementById('public-market-count');
  if (countBadge) countBadge.textContent = String(listings ? listings.length : 0);

  if (!grid) return;
  if (!listings || listings.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; background: var(--bg-card-subtle, rgba(0,0,0,0.05)); border: var(--border-retro); border-radius: 8px;">
        <div style="font-size: 32px; margin-bottom: 10px;">🏷️</div>
        <h4 style="font-weight: 800; margin-bottom: 6px;">Nenhum personagem anunciado</h4>
        <p style="font-size: 13px; color: var(--text-muted); margin: 0;">
          Este usuário não possui personagens à venda ou troca nos classificados no momento.
        </p>
      </div>
    `;
    return;
  }

  grid.innerHTML = '';
  listings.forEach(listing => {
    if (listing?.id) {
      marketListingsMap.set(listing.id, listing);
    }
    const char = listing.character;
    const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
    const isOwnListing = Boolean(userSessionData && userSessionData.publicId === userPublicId && userSessionData.isAdmin);

    const card = document.createElement('div');
    card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}`;
    card.style.borderColor = (char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color;

    const keys = listing.keys || char.keys || 1;
    const isSoulmate = Boolean(listing.isSoulmate || char.isSoulmate || keys >= 10);
    const keysBadgeHtml = isSoulmate
      ? `<div class="badge-keys" style="background: #ec4899; color: white; border-color: #f472b6;" title="💖 Soulmate (${keys} chaves)"><span>💖</span> <span>${keys}</span></div>`
      : `<div class="badge-keys" title="🔑 ${keys} chave(s)"><span>🔑</span> <span>${keys}</span></div>`;

    const listingAge = formatListingAge(listing.createdAt);
    const ageHtml = listingAge ? listingAge.html : '';

    card.innerHTML = `
      <div class="card-img-wrapper">
        <img loading="lazy" decoding="async" src="${getCharImg(char)}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)">
        <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
          ${rarity.emoji} ${rarity.label}
        </div>
        ${keysBadgeHtml}
      </div>
      <div class="card-info">
        <div class="card-name">${escapeHtml(char.name)}</div>
        <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
        ${ageHtml}
        <div style="background: var(--bg-retro-accent); padding: 6px 8px; border-radius: 4px; font-size: 12px; margin: 8px 0; border: var(--border-retro); word-break: break-word;">
          <strong style="color: #f59e0b;"><i class="fas fa-search"></i> Procura:</strong> ${escapeHtml(listing.interest)}
        </div>
        <div class="card-actions" style="margin-top: 8px;">
          ${isOwnListing ? `
            <button class="btn-retro btn-sm" style="width: 100%; opacity: 0.8;" disabled>
              <i class="fas fa-check"></i> Seu Anúncio
            </button>
          ` : `
            <button class="btn-retro btn-sm btn-gold" style="width: 100%;" onclick="handlePublicOfferClickById('${listing.id}')">
              <i class="fas fa-handshake"></i> Fazer Oferta
            </button>
          `}
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function handlePublicOfferClickById(listingId) {
  const listing = marketListingsMap.get(listingId);
  if (!listing) {
    console.error('Anúncio não encontrado:', listingId);
    return;
  }
  const char = listing.character || {};
  handlePublicOfferClick(listing.id, char.name || 'Personagem', getCharImg(char), listing.interest || 'Sem preferências');
}
window.handlePublicOfferClickById = handlePublicOfferClickById;

async function handlePublicOfferClick(listingId, charName, charImg, interest) {
  if ((!charName || interest === undefined) && marketListingsMap.has(listingId)) {
    const l = marketListingsMap.get(listingId);
    const char = l.character || {};
    charName = charName || char.name || 'Personagem';
    charImg = charImg || getCharImg(char);
    interest = interest !== undefined ? interest : (l.interest || 'Sem preferências');
  }

  if (userSessionToken && userSessionData?.isAdmin) {
    openOfferModal(listingId, charName, charImg, interest);
    return;
  }

  // Se não autenticado, abre modal instrutivo com link do WhatsApp da Ravena
  const titleEl = document.getElementById('public-offer-char-title');
  if (titleEl) titleEl.textContent = `Negociar ${charName}`;

  const btnWa = document.getElementById('btn-public-offer-wa-link');
  if (btnWa) {
    try {
      const res = await Api.get('/api/web/ravena-contact');
      if (res.success && res.data?.waLink) {
        btnWa.href = res.data.waLink;
      } else {
        btnWa.href = 'https://wa.me/?text=!mu-adm';
      }
    } catch {
      btnWa.href = 'https://wa.me/?text=!mu-adm';
    }
  }

  openModal('modal-public-offer-help');
}

// ========================================================
// ABA 1: CATÁLOGO GERAL NO PAINEL DO USUÁRIO
// ========================================================
async function loadCatalogCharacters() {
  if (catalogState.loading) return;
  catalogState.loading = true;

  const grid = document.getElementById('catalog-grid');
  const totalCountEl = document.getElementById('catalog-total-count');
  const pageIndicatorEl = document.getElementById('catalog-page-indicator');
  const btnPrev = document.getElementById('catalog-btn-prev');
  const btnNext = document.getElementById('catalog-btn-next');

  if (!grid) return;
  grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px;"><i class="fas fa-spinner fa-spin"></i> Carregando catálogo...</div>';

  const params = new URLSearchParams({
    page: catalogState.page,
    limit: catalogState.limit,
  });

  if (catalogState.search) params.append('search', catalogState.search);
  if (catalogState.gender) params.append('gender', catalogState.gender);
  if (catalogState.maritalStatus) params.append('maritalStatus', catalogState.maritalStatus);
  if (catalogState.rarity) params.append('rarity', catalogState.rarity);
  if (catalogState.sort) params.append('sort', catalogState.sort);

  try {
    const res = await Api.get(`/characters?${params.toString()}`);
    const resultData = res?.data;
    let characters = resultData?.data || [];

    if (catalogState.sort === 'name') {
      characters.sort((a, b) => a.name.localeCompare(b.name));
    }

    catalogState.total = resultData?.total || 0;
    catalogState.totalPages = Math.max(1, resultData?.totalPages || 1);
    catalogState.page = resultData?.page || catalogState.page;

    if (totalCountEl) totalCountEl.textContent = `${catalogState.total.toLocaleString('pt-BR')} personagens`;
    if (pageIndicatorEl) pageIndicatorEl.textContent = `${catalogState.page} / ${catalogState.totalPages}`;
    if (btnPrev) btnPrev.disabled = catalogState.page <= 1;
    if (btnNext) btnNext.disabled = catalogState.page >= catalogState.totalPages;

    grid.innerHTML = '';
    if (characters.length === 0) {
      grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px;">Nenhum personagem encontrado com os filtros selecionados.</div>';
      return;
    }

    const currentWishes = new Set((userSessionData?.wishlist || []).map(w => w.character?.id || w.characterId));

    characters.forEach(char => {
      const isMythic = Boolean(char.isMythic || char.baseRarity === 'MYTHIC');
      const rarityKey = char.baseRarity || 'COMMON';
      const rarityCfg = RARITY_CONFIG[rarityKey] || RARITY_CONFIG.COMMON;
      const isAlreadyWish = currentWishes.has(char.id);
      const isMarried = Boolean(char.isClaimed || char.owner);
      const spouse = char.owner?.name || (typeof char.owner === 'string' ? char.owner : null);
      const spousePublicId = char.owner?.publicId || null;
      const wishlistCount = char.wishlistCount || 0;

      const card = document.createElement('div');
      if (isMythic) {
        const cust = char.mythicCustomization || {};
        const animType = cust.animationType || 'spin';
        card.className = `waifu-card mythic-card anim-${animType}`;
        card.style.setProperty('--mythic-border-color', cust.borderColor || '#a855f7');
        card.style.setProperty('--mythic-glow-color', cust.glowColor || '#c084fc');
        card.style.borderColor = cust.borderColor || '#a855f7';
      } else {
        card.className = `waifu-card rarity-${rarityKey.toLowerCase()}`;
        card.style.borderColor = rarityKey === 'COMMON' ? '#000000' : rarityCfg.color;
      }

      let marriedTooltip = '💍 Solteira(o)';
      if (isMarried) {
        marriedTooltip = spouse
          ? `💍 Casada(o) com ${spouse}${spousePublicId ? ' (Clique para abrir perfil público)' : ''}`
          : '💍 Casada(o)';
      }

      const topBadgeHtml = isMythic
        ? `<div class="badge-rarity" style="background: linear-gradient(135deg, #581c87, #3b0764); border: 1.5px solid #c084fc; color: #facc15; font-weight: 900; box-shadow: 0 0 8px rgba(168, 85, 247, 0.6);" title="Raridade: 🔮 Mítico">🔮 MÍTICO</div>`
        : `<div class="badge-rarity" style="border-color: ${rarityCfg.color}; color: ${rarityCfg.color};" title="Raridade: ${rarityCfg.label}">
            ${rarityCfg.emoji} ${rarityCfg.label}
          </div>`;

      card.innerHTML = `
        <div class="card-img-wrapper" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="Clique para ver detalhes e fotos">
          <img loading="lazy" decoding="async" src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)">
          ${!isMythic ? topBadgeHtml : ''}
          ${!isMythic && isMarried ? `<div class="badge-married ${spousePublicId ? 'badge-married-link' : ''}" title="${escapeHtml(marriedTooltip)}">💍</div>` : ''}
          ${!isMythic ? `
            <div class="badge-wishes" data-char-id="${char.id}" title="${wishlistCount} pessoa(s) adicionaram à wishlist. Clique para alternar Wishlist" onclick="event.stopPropagation(); toggleWishlist('${char.id}', null, event)">
              <span>✨</span> <span>${wishlistCount}</span>
            </div>
          ` : ''}
          ${!isMythic ? `
            <div class="badge-likes" data-char-id="${char.id}" title="Curtido ${char.likeCount || 0} vez(es). Clique para curtir!" onclick="event.stopPropagation(); registerCardLike('${char.id}', event)">
              <span>❤️</span> <span class="likes-count">${char.likeCount || 0}</span>
            </div>
          ` : ''}
        </div>
        <div class="card-info">
          <div class="card-name" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="${escapeHtml(char.name)}">${escapeHtml(char.name)}</div>
          <div class="card-series" title="${escapeHtml(char.series || 'Sem série')}">${escapeHtml(char.series || 'Sem série')}</div>
          <div class="card-actions" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
            ${isMythic ? `
              <div style="text-align: center; padding: 6px; background: rgba(168, 85, 247, 0.15); border: 1px solid #a855f7; border-radius: 4px; font-weight: 800; font-size: 12px; color: #facc15;">
                🔮 Criação Mítica
              </div>
            ` : `
              <button class="btn-retro btn-sm ${isAlreadyWish ? 'btn-wish-active' : 'btn-gold'}" style="width: 100%;" onclick="toggleWishlist('${char.id}', this, event)" title="${isAlreadyWish ? 'Clique para remover da Wishlist' : 'Adicionar à Wishlist'}">
                ${isAlreadyWish ? '<i class="fas fa-check"></i> Na Wishlist' : '<i class="fas fa-star"></i> + Wishlist'}
              </button>
              ${isMarried && spousePublicId !== userSessionData?.publicId ? `
                ${userCovetedSet.has(char.id) ? `
                  <button class="btn-retro btn-sm" style="width: 100%; border-color: #ec4899; color: #ec4899;" disabled>
                    <i class="fas fa-check"></i> 👀 Cobiçado
                  </button>
                ` : `
                  <button class="btn-retro btn-sm" style="width: 100%; border-color: #ec4899; color: #ec4899;" onclick="covetCharacter('${char.id}', this, event)">
                    <i class="fas fa-eye"></i> 👀 Cobiçar
                  </button>
                `}
              ` : ''}
              <button class="btn-retro btn-sm btn-danger" style="width: 100%;" data-action="report">
                <i class="fas fa-ban"></i> Denunciar 🔞
              </button>
              <button class="btn-retro btn-sm" style="width: 100%;" data-action="suggest">
                <i class="fas fa-lightbulb"></i> Sugerir Mudança
              </button>
            `}
          </div>
        </div>
      `;

      bindDataActions(card, {
        'report': () => openReportModal(char.id, char.name),
        'suggest': () => openSuggestModal(char.id, char.name, char.baseRarity, char),
      });

      if (isMarried && spousePublicId) {
        const marriedBadge = card.querySelector('.badge-married');
        if (marriedBadge) {
          marriedBadge.addEventListener('click', (e) => {
            e.stopPropagation();
            const shareUrl = Api.getShareUrl(`/user/${spousePublicId}`);
            window.open(shareUrl, '_blank');
          });
        }
      }

      grid.appendChild(card);
    });
  } catch (err) {
    console.error('Erro ao carregar catálogo do usuário:', err);
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; color: #ef4444;">Erro ao carregar catálogo.</div>';
  } finally {
    catalogState.loading = false;
  }
}

// ========================================================
// DENÚNCIA DE PERSONAGEM (🔞)
// ========================================================
function openReportModal(charId, charName) {
  activeReportCharacter = { id: charId, name: charName };
  const nameEl = document.getElementById('report-char-name');
  if (nameEl) nameEl.textContent = charName;
  const reasonEl = document.getElementById('report-reason');
  if (reasonEl) reasonEl.value = '';
  openModal('modal-report');
}

async function submitReport() {
  if (!activeReportCharacter || !activeReportCharacter.id) return;
  const reason = document.getElementById('report-reason')?.value?.trim() || 'Conteúdo reportado pelo usuário (🔞).';
  const btn = document.getElementById('btn-confirm-report');
  if (btn) btn.disabled = true;

  Api.showLoading('Aguarde... Enviando denúncia...', 'Registrando ocorrência para a moderação...');
  try {
    const res = await Api.post(`/characters/${encodeURIComponent(activeReportCharacter.id)}/report`, {
      characterId: activeReportCharacter.id,
      reason,
      userId: userSessionData?.publicId || undefined,
    });
    if (res.success) {
      Api.showToast('Denúncia enviada com sucesso para a moderação!', '🔞');
      closeModal('modal-report');
    } else {
      Api.showToast(res.error?.message || 'Erro ao enviar denúncia.', '❌');
    }
  } catch (err) {
    console.error('Erro ao enviar denúncia:', err);
    Api.showToast('Erro de conexão ao enviar denúncia.', '❌');
  } finally {
    Api.hideLoading();
    if (btn) btn.disabled = false;
  }
}

// ========================================================
// AÇÕES DO USUÁRIO (DIVÓRCIO, WISHLIST, SUGESTÕES)
// ========================================================
async function openDivorceModal(charId, charName) {
  const entry = haremEntryCache?.get(charId);
  if (entry && (entry.isLocked || entry.collection?.isLocked)) {
    Api.showToast('Personagens bloqueados (ou em coleções bloqueadas) não podem ser divorciados.', '🔒');
    return;
  }
  pendingDivorceTarget = { id: charId, name: charName };
  const textEl = document.getElementById('divorce-modal-text');
  const amountEl = document.getElementById('divorce-modal-refund-amount');
  const confirmBtn = document.getElementById('btn-confirm-divorce');
  const drBox = document.getElementById('divorce-modal-dr-box');
  const drRarityTitle = document.getElementById('divorce-modal-dr-rarity-title');
  const drCountBadge = document.getElementById('divorce-modal-dr-count-badge');
  const drRateTag = document.getElementById('divorce-modal-dr-rate-tag');
  const drPenaltyDesc = document.getElementById('divorce-modal-dr-penalty-desc');

  if (textEl) {
    textEl.innerHTML = `Tem certeza que deseja divorciar de <strong>${escapeHtml(charName)}</strong>?`;
  }
  if (amountEl) {
    amountEl.textContent = 'Calculando...';
  }
  if (confirmBtn) {
    confirmBtn.innerHTML = '<i class="fas fa-heart-crack"></i> Divorciar Agora';
  }
  if (drBox) {
    drBox.classList.add('hidden');
  }
  openModal('modal-divorce');

  try {
    const res = await Api.get(
      `/api/web/user/${encodeURIComponent(userPublicId)}/divorce/preview/${encodeURIComponent(charId)}?token=${encodeURIComponent(userSessionToken)}`
    );
    if (res?.success && res.data) {
      const data = res.data;
      const formatted = Number(data.refundedKakera || 0).toLocaleString('pt-BR');
      if (amountEl) {
        const bonusTag = data.rankMultiplier && data.rankMultiplier > 1
          ? `<span style="color: #eab308; font-size: 11px; margin-left: 4px;">(🏆 ${data.rankMultiplier}x #${data.rarityPosition || 1})</span>`
          : '';
        const soulmateTag = data.isSoulmate
          ? '<span style="color: #ec4899; font-size: 11px; margin-left: 4px;">(💖 Dourado)</span>'
          : '';
        amountEl.innerHTML = `+${formatted} Zinthos ${bonusTag} ${soulmateTag}`;
      }

      // Painel informativo de Diminishing Returns (DR)
      if (drBox) {
        const rarity = data.character?.rarity || entry?.character?.baseRarity || 'COMMON';
        const rarityLabels = {
          COMMON: { label: 'Comum', color: '#9ca3af' },
          UNCOMMON: { label: 'Incomum', color: '#22c55e' },
          RARE: { label: 'Raro', color: '#3b82f6' },
          EPIC: { label: 'Épico', color: '#a855f7' },
          LEGENDARY: { label: 'Lendário', color: '#f59e0b' },
        };
        const rMeta = rarityLabels[rarity] || { label: rarity, color: 'var(--text-main)' };
        const countToday = Number(data.dailyDivorceCount || 0);
        const tier = Number(data.divorceTier || (countToday + 1));
        const rate = typeof data.refundRate === 'number' ? data.refundRate : 1.0;
        const ratePct = Math.round(rate * 100);

        if (drRarityTitle) {
          drRarityTitle.innerHTML = `<span style="color: ${rMeta.color}; font-weight: 800;">${rMeta.label}</span> • Divórcio #${tier} do dia`;
        }
        if (drCountBadge) {
          drCountBadge.textContent = countToday === 0 ? 'Nenhum hoje' : `${countToday} já divorciado(s) hoje`;
          drCountBadge.style.background = countToday === 0 ? '#16a34a' : countToday < 4 ? '#d97706' : '#dc2626';
          drCountBadge.style.color = '#fff';
        }
        if (drRateTag) {
          if (rate >= 1.0) {
            drRateTag.innerHTML = `<span style="color: #16a34a; font-weight: 800;">100% líquido (Sem penalidade)</span>`;
          } else {
            const lossPct = 100 - ratePct;
            drRateTag.innerHTML = `<span style="color: #ea580c; font-weight: 800;">${ratePct}% líquido (-${lossPct}% penalidade)</span>`;
          }
        }
        if (drPenaltyDesc) {
          if (rate >= 1.0) {
            drPenaltyDesc.textContent = 'Este é seu 1º divórcio desta raridade hoje: valor integral!';
          } else {
            const fullVal = Number(data.fullRefundKakera || 0).toLocaleString('pt-BR');
            drPenaltyDesc.textContent = `Penalidade de DR aplicada: o valor base seria +${fullVal} Zinthos, reduzido para ${ratePct}%. O limite diário reseta às 04:00 BRT.`;
          }
        }
        drBox.classList.remove('hidden');
      }

      // Atualiza o botão de confirmação com a indicação do DR e valor
      if (confirmBtn) {
        const rate = typeof data.refundRate === 'number' ? data.refundRate : 1.0;
        const ratePct = Math.round(rate * 100);
        const drSuffix = rate < 1.0 ? ` (DR ${ratePct}%)` : '';
        confirmBtn.innerHTML = `<i class="fas fa-heart-crack"></i> Divorciar Agora (+${formatted}z${drSuffix})`;
      }
    } else if (amountEl) {
      amountEl.textContent = 'Indisponível no momento';
    }
  } catch (_) {
    if (amountEl) amountEl.textContent = 'Indisponível no momento';
  }
}

async function executeDivorce() {
  if (!pendingDivorceTarget) return;
  const { id, name } = pendingDivorceTarget;

  Api.showLoading('Aguarde... Processando divórcio...', 'Calculando reembolso e atualizando harém...');
  try {
    const res = await Api.post(`/api/web/user/${userPublicId}/divorce`, {
      token: userSessionToken,
      characterId: id,
    });

    if (!res.success) {
      Api.showToast(res.error?.message || 'Falha ao divorciar.', '❌');
      return;
    }

    closeModal('modal-divorce');
    const refundedMsg = res.data?.refundedKakera
      ? ` Você recebeu +${Number(res.data.refundedKakera).toLocaleString('pt-BR')} Zinthos!`
      : '';
    Api.showToast(`Divórcio de ${name} realizado com sucesso!${refundedMsg}`, '💔');

    // Remove do DOM
    const card = document.getElementById(`harem-card-${id}`);
    if (card) card.remove();

    // Atualiza contadores
    userSessionData.harem = (userSessionData.harem || []).filter(h => h.character.id !== id);
    if (userSessionData.totalHarem !== undefined && userSessionData.totalHarem > 0) {
      userSessionData.totalHarem--;
    }
    const newCount = userSessionData.totalHarem !== undefined ? userSessionData.totalHarem : userSessionData.harem.length;
    const haremCountEl = document.getElementById('harem-count');
    if (haremCountEl) haremCountEl.textContent = newCount;
    const haremCountSub = document.getElementById('harem-count-sub');
    if (haremCountSub) haremCountSub.textContent = newCount;
    const subEl = document.getElementById('user-subtitle');
    if (subEl) subEl.textContent = `${newCount} personagens colecionados no harém`;

    // Invalida cache de resumo e recarrega para atualizar os contadores diários de divórcio (DR)
    haremSummaryData = null;
    loadHaremSummary(true).catch(() => {});
  } catch (err) {
    Api.showToast('Erro de comunicação ao divorciar.', '❌');
  } finally {
    Api.hideLoading();
  }
}

async function toggleWishlist(charId, btn = null, event = null) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const auth = getActiveAuthUser();
  if (!auth.token) {
    openModal('modal-public-offer-help');
    return;
  }

  const isAlreadyWish = auth.wishlistSet.has(charId);

  if (btn) btn.disabled = true;

  try {
    if (isAlreadyWish) {
      // 1. Remover da Wishlist
      const res = await Api.delete(`/api/web/user/${encodeURIComponent(auth.publicId || 'token-session')}/wishlist/${encodeURIComponent(charId)}?token=${encodeURIComponent(auth.token)}`);
      if (!res.success) {
        Api.showToast(res.error?.message || 'Falha ao remover da wishlist.', '❌');
        return;
      }

      if (auth.isOwner && userSessionData) {
        userSessionData.wishlist = (userSessionData.wishlist || []).filter(w => (w.character?.id || w.characterId) !== charId);
        const countEl = document.getElementById('wishlist-count');
        if (countEl) countEl.textContent = userSessionData.wishlist.length;

        const bonusPct = Math.min(100, (userSessionData.wishlist.length / 1000) * 100);
        const bonusFormatted = Number.isInteger(bonusPct) ? bonusPct : bonusPct.toFixed(1);
        const bonusEl = document.getElementById('wishlist-bonus-val');
        if (bonusEl) bonusEl.textContent = `+${bonusFormatted}%`;
      } else {
        visitorWishlistSet.delete(charId);
        if (visitorSessionData && Array.isArray(visitorSessionData.wishlist)) {
          visitorSessionData.wishlist = visitorSessionData.wishlist.filter(w => (w.character?.id || w.characterId) !== charId);
        }
      }

      const wishTabCard = document.getElementById(`wish-card-${charId}`);
      if (wishTabCard) wishTabCard.remove();
      if (window.marketWishlistCharIds) window.marketWishlistCharIds.delete(charId);

      Api.showToast('Personagem removido da sua Wishlist.', '🗑️');
    } else {
      // 2. Adicionar à Wishlist
      const res = await Api.post(`/api/web/user/${encodeURIComponent(auth.publicId || 'token-session')}/wishlist`, {
        token: auth.token,
        characterId: charId,
        isStarWish: false,
      });

      if (!res.success) {
        Api.showToast(res.error?.message || 'Falha ao adicionar.', '❌');
        return;
      }

      const isForSale = Boolean(res.data?.entry?.isForSale || res.data?.entry?.character?.isForSale);
      if (isForSale) {
        if (!window.marketWishlistCharIds) window.marketWishlistCharIds = new Set();
        window.marketWishlistCharIds.add(charId);
      }

      if (auth.isOwner && userSessionData) {
        if (!Array.isArray(userSessionData.wishlist)) {
          userSessionData.wishlist = [];
        }
        userSessionData.wishlist.push({
          id: res.data?.entry?.id || charId,
          characterId: charId,
          isStarWish: false,
          isForSale,
          character: res.data?.entry?.character || { id: charId, isForSale },
        });
        const countEl = document.getElementById('wishlist-count');
        if (countEl) countEl.textContent = userSessionData.wishlist.length;

        const bonusPct = Math.min(100, (userSessionData.wishlist.length / 1000) * 100);
        const bonusFormatted = Number.isInteger(bonusPct) ? bonusPct : bonusPct.toFixed(1);
        const bonusEl = document.getElementById('wishlist-bonus-val');
        if (bonusEl) bonusEl.textContent = `+${bonusFormatted}%`;
      } else {
        visitorWishlistSet.add(charId);
        if (visitorSessionData) {
          if (!Array.isArray(visitorSessionData.wishlist)) visitorSessionData.wishlist = [];
          visitorSessionData.wishlist.push({
            id: res.data?.entry?.id || charId,
            characterId: charId,
            isStarWish: false,
            character: res.data?.entry?.character || { id: charId },
          });
        }
      }

      Api.showToast('Adicionado à sua Wishlist com sucesso!', '✨');
    }

    // Sincroniza todos os botões de wishlist deste personagem na página
    document.querySelectorAll(`button[onclick*="toggleWishlist('${charId}'"]`).forEach(b => {
      if (isAlreadyWish) {
        b.className = 'btn-retro btn-sm btn-gold';
        b.innerHTML = '<i class="fas fa-star"></i> + Wishlist';
        b.title = 'Adicionar à Wishlist';
      } else {
        b.className = 'btn-retro btn-sm btn-wish-active';
        b.innerHTML = '<i class="fas fa-check"></i> Na Wishlist';
        b.title = 'Clique para remover da Wishlist';
      }
    });

    // Sincroniza todos os badges .badge-wishes deste personagem
    document.querySelectorAll(`.badge-wishes[data-char-id="${charId}"]`).forEach(badge => {
      const countSpan = badge.querySelector('.wishes-count') || badge.querySelector('span:last-child');
      if (countSpan) {
        const cur = parseInt(countSpan.textContent.trim(), 10) || 0;
        countSpan.textContent = isAlreadyWish ? Math.max(0, cur - 1) : cur + 1;
      }
      const iconSpan = badge.querySelector('span:first-child');
      if (iconSpan) {
        iconSpan.textContent = isAlreadyWish ? '✨' : '⭐';
      }
      if (isAlreadyWish) {
        badge.classList.remove('is-in-wishlist');
        badge.title = 'Clique para adicionar à sua Wishlist';
      } else {
        badge.classList.add('is-in-wishlist');
        badge.title = 'Na sua Wishlist! Clique para remover';
      }
    });

    // Sincroniza modal de preview se aberto
    const modalWishBtn = document.getElementById('btn-preview-wish');
    const modalWishSpan = document.getElementById('waifu-preview-wishes-count');
    if (previewState?.characterId === charId) {
      if (modalWishSpan) {
        const cur = parseInt(modalWishSpan.textContent.trim(), 10) || 0;
        modalWishSpan.textContent = isAlreadyWish ? Math.max(0, cur - 1) : cur + 1;
      }
      if (modalWishBtn) {
        const newCount = modalWishSpan ? modalWishSpan.textContent : '';
        if (isAlreadyWish) {
          modalWishBtn.className = 'btn-retro btn-sm btn-gold';
          modalWishBtn.innerHTML = `<i class="fas fa-star"></i> <span id="waifu-preview-wishes-count">${newCount}</span> Wishlist`;
        } else {
          modalWishBtn.className = 'btn-retro btn-sm btn-wish-active';
          modalWishBtn.innerHTML = `<i class="fas fa-check"></i> <span id="waifu-preview-wishes-count">${newCount}</span> Na Wishlist`;
        }
      }
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao atualizar wishlist.', '❌');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function registerCardLike(characterId, event = null) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const auth = getActiveAuthUser();
  if (!auth.token) {
    Api.showToast('Você precisa estar logado para curtir! Envie !mu-adm no WhatsApp.', '⚠️');
    return;
  }

  try {
    const res = await Api.post(`/api/web/user/${encodeURIComponent(auth.publicId || 'token-session')}/characters/${encodeURIComponent(characterId)}/like`, {
      token: auth.token
    });

    if (res.success) {
      const newLikes = res.data?.likeCount;
      Api.showToast(res.data?.message || 'Curtida registrada com sucesso! ❤️', '❤️');

      // Atualiza todos os badges de likes deste personagem na tela
      document.querySelectorAll(`.badge-likes[data-char-id="${characterId}"]`).forEach(badge => {
        const countSpan = badge.querySelector('.likes-count') || badge.querySelector('span:last-child');
        if (countSpan && newLikes !== undefined) {
          countSpan.textContent = newLikes;
        } else {
          badge.innerHTML = `<span>❤️</span> <span class="likes-count">${newLikes}</span>`;
        }
      });

      // Atualiza no modal de preview se estiver aberto com esta waifu
      if (previewState?.characterId === characterId) {
        const modalLikes = document.getElementById('waifu-preview-likes-count');
        if (modalLikes && newLikes !== undefined) modalLikes.textContent = newLikes;
        if (previewState.charData) {
          previewState.charData.likeCount = newLikes;
        }
      }
    } else {
      Api.showToast(res.error?.message || 'Falha ao registrar curtida.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de conexão ao curtir personagem.', '❌');
  }
}

async function addToWishlist(charId, btn, event) {
  return toggleWishlist(charId, btn, event);
}

async function removeFromWishlist(charId) {
  try {
    const res = await Api.delete(`/api/web/user/${userPublicId}/wishlist/${charId}?token=${encodeURIComponent(userSessionToken)}`);
    if (!res.success) {
      Api.showToast(res.error?.message || 'Falha ao remover.', '❌');
      return;
    }

    Api.showToast('Personagem removido da Wishlist.', '🗑️');
    const card = document.getElementById(`wish-card-${charId}`);
    if (card) card.remove();
    if (window.marketWishlistCharIds) window.marketWishlistCharIds.delete(charId);

    userSessionData.wishlist = (userSessionData.wishlist || []).filter(w => (w.character?.id || w.characterId) !== charId);
    const countEl = document.getElementById('wishlist-count');
    if (countEl) countEl.textContent = userSessionData.wishlist.length;

    const bonusPct = Math.min(100, (userSessionData.wishlist.length / 1000) * 100);
    const bonusFormatted = Number.isInteger(bonusPct) ? bonusPct : bonusPct.toFixed(1);
    const bonusEl = document.getElementById('wishlist-bonus-val');
    if (bonusEl) bonusEl.textContent = `+${bonusFormatted}%`;

    if (userSessionData.wishlist.length === 0) {
      const grid = document.getElementById('wishlist-grid');
      if (grid) {
        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; font-weight: bold;">Sua wishlist está vazia. Use a aba "Catálogo" para desejar personagens!</div>';
      }
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao remover da wishlist.', '❌');
  }
}

// ========================================================
// MODAL DE SUGESTÕES (Compartilhado via js/suggestion-modal.js)
// ========================================================
function openSuggestModal(charId, charName, currentRarity, preloadedChar = null) {
  if (!window.SuggestionModal) {
    Api.showToast('Componente de sugestões não carregado.', '❌');
    return;
  }
  window.SuggestionModal.open({
    characterId: charId,
    characterName: charName,
    currentRarity,
    character: preloadedChar,
    token: userSessionToken,
    publicId: userPublicId || 'token-session',
    onSuccess: () => {
      if (typeof loadUserSuggestions === 'function') loadUserSuggestions();
    },
  });
}

// Helpers de Modal
function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }
}

function closeModal(id) {
  if (id === 'modal-suggest' && window.SuggestionModal) {
    window.SuggestionModal.close();
    return;
  }
  if (!id && window.SuggestionModal) {
    window.SuggestionModal.close();
  }
  if (id === 'modal-mythic-edit' && typeof cancelMythicCrop === 'function') {
    cancelMythicCrop();
  }
  if (id === 'modal-suggest-character' && typeof resetSuggestCharacterModal === 'function') {
    resetSuggestCharacterModal();
  }
  if (id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  } else {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
  }

  const hasOpenModals = Boolean(document.querySelector('.modal-overlay:not(.hidden)'));
  if (!hasOpenModals) {
    document.body.classList.remove('modal-open');
  }

  // Restaura a subaba ativa do painel visível caso tenha sido afetada
  const activeTabContent = document.querySelector('#private-panel > .tab-content:not(.hidden)');
  if (activeTabContent) {
    const activeSubBtn = activeTabContent.querySelector('.retro-subtab.active');
    if (activeSubBtn && activeSubBtn.dataset.subtab) {
      const activeSubContent = document.getElementById(activeSubBtn.dataset.subtab);
      if (activeSubContent && activeSubContent.classList.contains('hidden')) {
        activeSubContent.classList.remove('hidden');
      }
    }
  }
}

// Escape HTML completo (& < > " ') para texto e valores de atributo entre aspas.
function escapeHtml(str) {
  return Api.escapeHtml(str);
}

/**
 * Liga handlers de clique aos elementos [data-action] dentro de root usando closures.
 * Evita interpolar dados de jogadores (nomes, séries, tags, URLs) em JS inline
 * (onclick="f('...')"), onde o escape HTML não protege.
 * Deve ser chamado logo após o innerHTML, antes de anexar elementos filhos que
 * tenham seus próprios data-action.
 */
function bindDataActions(root, actions) {
  if (!root) return;
  root.querySelectorAll('[data-action]').forEach((el) => {
    const handler = actions[el.dataset.action];
    if (typeof handler === 'function' && !el.dataset.actionBound) {
      el.dataset.actionBound = '1';
      el.addEventListener('click', (event) => handler(event, el));
    }
  });
}

async function loadUserSuggestions() {
  if (!userSessionToken) return;

  const tbody = document.getElementById('tbody-user-suggestions');
  const countBadge = document.getElementById('badge-user-suggestions-count');
  if (!tbody) return;

  try {
    const res = await Api.get(`/api/web/user/${userPublicId}/suggestions?token=${encodeURIComponent(userSessionToken)}`);
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--accent-red); padding: 20px;">Falha ao carregar sugestões.</td></tr>`;
      return;
    }

    const raw = res.data;
    const isBlocked = Boolean(raw?.isBlocked);
    const blockBanner = document.getElementById('user-suggestions-block-banner');
    const btnOpenSuggest = document.getElementById('btn-open-suggest-char');
    if (blockBanner) {
      if (isBlocked) {
        blockBanner.classList.remove('hidden');
        if (btnOpenSuggest) {
          btnOpenSuggest.disabled = true;
          btnOpenSuggest.title = 'Você está impedido de enviar sugestões';
        }
      } else {
        blockBanner.classList.add('hidden');
        if (btnOpenSuggest) {
          btnOpenSuggest.disabled = false;
          btnOpenSuggest.title = '';
        }
      }
    }

    const suggestions = Array.isArray(raw) ? raw : (raw?.suggestions || raw?.data || []);
    if (countBadge) {
      countBadge.textContent = suggestions.length;
    }

    if (suggestions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--text-muted);">Você ainda não enviou nenhuma sugestão. Que tal sugerir um personagem novo?</td></tr>`;
      return;
    }

    const typeLabels = {
      RARITY: '⚖️ Raridade',
      IMAGE: '🖼️ Foto',
      NEW_CHARACTER: '✨ Novo Personagem',
      DELETE_CHARACTER: '🔞 Denúncia / Remoção',
      EDIT: '📝 Edição de Dados',
    };

    const statusBadges = {
      PENDING: '<span class="status-badge status-pending" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid #f59e0b; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">⏳ Pendente</span>',
      APPROVED: '<span class="status-badge status-approved" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid #10b981; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">✅ Aceita</span>',
      REJECTED: '<span class="status-badge status-rejected" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid #ef4444; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">❌ Rejeitada</span>'
    };

    tbody.innerHTML = suggestions.map(s => {
      const dateStr = s.createdAt ? new Date(s.createdAt).toLocaleDateString('pt-BR') : '-';
      const typeLabel = typeLabels[s.type] || s.type;
      const statusBadge = statusBadges[s.status] || s.status;

      let detail = '';
      const imgUrl = s.imageUrl ? (s.imageUrl.startsWith('/media/') ? s.imageUrl : `/media/${s.imageUrl}`) : '';
      if (s.type === 'NEW_CHARACTER') {
        detail = `<strong>${escapeHtml(s.characterName || 'Sem nome')}</strong> (${escapeHtml(s.series || 'Sem série')}) - Raridade: ${escapeHtml(s.suggestedRarity || 'COMMON')}`;
        if (imgUrl) {
          detail += ` <a href="${escapeHtml(imgUrl)}" target="_blank" rel="noopener noreferrer" style="margin-left: 6px; text-decoration: underline; font-size: 11px;">[Ver foto]</a>`;
        }
      } else if (s.character) {
        detail = `<strong>${escapeHtml(s.character.name)}</strong> (${escapeHtml(s.character.series || '')})`;
        if (s.type === 'RARITY') detail += ` &rarr; Nova: ${escapeHtml(s.suggestedRarity || '')}`;
        if (s.type === 'IMAGE') {
          detail += ` &rarr; Sugestão de Foto`;
          if (imgUrl) {
            detail += ` <a href="${escapeHtml(imgUrl)}" target="_blank" rel="noopener noreferrer" style="margin-left: 6px; text-decoration: underline; font-size: 11px;">[Ver foto]</a>`;
          }
        }
        if (s.type === 'EDIT') {
          const changes = [];
          if (s.suggestedName && s.suggestedName !== s.character.name) changes.push(`Nome: ${escapeHtml(s.suggestedName)}`);
          if (s.suggestedSeries && s.suggestedSeries !== s.character.series) changes.push(`Série: ${escapeHtml(s.suggestedSeries)}`);
          if (s.suggestedRarity && s.suggestedRarity !== s.character.baseRarity) changes.push(`Raridade: ${escapeHtml(s.suggestedRarity)}`);
          if (s.suggestedGender && s.suggestedGender !== s.character.gender) changes.push(`Gênero: ${escapeHtml(s.suggestedGender)}`);
          if (s.suggestedTags && s.suggestedTags.length > 0) changes.push(`Tags`);
          if (s.suggestedDescription) changes.push(`Descrição`);
          if (changes.length > 0) {
            detail += ` &rarr; ${changes.join(', ')}`;
          } else {
            detail += ` &rarr; Atualização de dados`;
          }
        }
      } else {
        detail = escapeHtml(s.characterName || 'Personagem');
        if (s.type === 'EDIT') detail += ` &rarr; Atualização de dados`;
      }

      const notes = s.rejectionReason ? `<br><small style="color: var(--accent-red); font-weight: bold;">Motivo recusa: ${escapeHtml(s.rejectionReason)}</small>` : '';
      const reason = s.reason ? `<small style="color: var(--text-muted);">${escapeHtml(s.reason)}</small>` : '-';

      return `
        <tr>
          <td style="white-space: nowrap; font-size: 12px;">${dateStr}</td>
          <td style="white-space: nowrap; font-size: 12px;">${typeLabel}</td>
          <td>${detail}</td>
          <td>${statusBadge}</td>
          <td style="font-size: 12px;">${reason}${notes}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--accent-red); padding: 20px;">Erro ao carregar sugestões.</td></tr>`;
  }
}

// ========================================================
// ABA 6: NOTIFICAÇÕES DO USUÁRIO & WEB PUSH NO DISPOSITIVO
// ========================================================
let notificationsFilterUnreadOnly = false;
let userNotificationsCache = [];
let deviceNotifCheckInterval = null;

function isDeviceNotifsEnabled() {
  return localStorage.getItem('waifuletes_device_notifs_enabled') === 'true';
}

function updateDeviceNotifButtonUI() {
  const btn = document.getElementById('btn-toggle-device-notifs');
  const icon = document.getElementById('device-notif-icon');
  const label = document.getElementById('device-notif-label');
  if (!btn) return;

  if (!('Notification' in window)) {
    btn.style.display = 'none';
    return;
  }

  if (Notification.permission === 'granted' && isDeviceNotifsEnabled()) {
    btn.classList.add('btn-gold');
    btn.style.borderColor = '#16a34a';
    if (icon) {
      icon.className = 'fas fa-bell';
      icon.style.color = '#16a34a';
    }
    if (label) label.textContent = 'Notificações no Dispositivo: On';
    btn.title = 'Notificações no dispositivo ativadas! Clique para desativar.';
  } else {
    btn.classList.remove('btn-gold');
    btn.style.borderColor = '';
    if (icon) {
      icon.className = 'fas fa-bell-slash';
      icon.style.color = 'inherit';
    }
    if (label) label.textContent = 'Notificações no Dispositivo: Off';
    btn.title = 'Clique para ativar notificações no seu dispositivo.';
  }
}

async function toggleDeviceNotifs() {
  if (!('Notification' in window)) {
    Api.showToast('Seu navegador não suporta notificações de dispositivo.', '⚠️');
    return;
  }

  if (Notification.permission === 'denied') {
    Api.showToast('Notificações bloqueadas nas configurações do seu navegador.', '🚫');
    return;
  }

  if (Notification.permission === 'default') {
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        localStorage.setItem('waifuletes_device_notifs_enabled', 'true');
        Api.showToast('🔔 Notificações no dispositivo ativadas com sucesso!', '✨');
        sendDeviceAlert(
          '🔔 Waifuletes',
          'Notificações ativadas! Você será avisado sobre novidades no seu harém, propostas e classificados.',
          'waifu-welcome',
          window.location.origin + `/user/${encodeURIComponent(userPublicId)}#notificacoes`
        );
        initDeviceNotifPolling();
      } else {
        localStorage.setItem('waifuletes_device_notifs_enabled', 'false');
        Api.showToast('Permissão de notificação não concedida.', '⚠️');
      }
    } catch (e) {
      Api.showToast('Erro ao solicitar permissão de notificação.', '❌');
    }
  } else if (Notification.permission === 'granted') {
    const currentlyOn = isDeviceNotifsEnabled();
    const newState = !currentlyOn;
    localStorage.setItem('waifuletes_device_notifs_enabled', newState.toString());
    Api.showToast(newState ? '🔔 Notificações no dispositivo ativadas!' : '🔕 Notificações no dispositivo desativadas.', newState ? '✨' : 'ℹ️');
    if (newState) {
      initDeviceNotifPolling();
    }
  }

  updateDeviceNotifButtonUI();
}

function sendDeviceAlert(title, body, tag = 'waifu-alert', dataUrl = window.location.href) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !isDeviceNotifsEnabled()) return;
  const options = {
    body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag,
    renotify: true,
    data: { url: dataUrl },
  };

  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(title, options))
        .catch(() => {
          try {
            const notif = new Notification(title, options);
            notif.onclick = () => {
              window.focus();
              if (dataUrl) window.location.href = dataUrl;
            };
          } catch (_) {}
        });
    } else {
      const notif = new Notification(title, options);
      notif.onclick = () => {
        window.focus();
        if (dataUrl) window.location.href = dataUrl;
      };
    }
  } catch (e) {
    console.warn('Erro ao disparar notificação no dispositivo:', e);
  }
}

function getAlertedNotifIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem('waifuletes_alerted_notif_ids') || '[]'));
  } catch (_) {
    return new Set();
  }
}

function saveAlertedNotifId(id) {
  try {
    const set = getAlertedNotifIds();
    set.add(id);
    const arr = Array.from(set).slice(-200);
    localStorage.setItem('waifuletes_alerted_notif_ids', JSON.stringify(arr));
  } catch (_) {}
}

async function checkNewDeviceNotifications() {
  if (!userSessionToken || !userPublicId) return;
  if (!isDeviceNotifsEnabled() || !('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    const res = await Api.get(`/api/web/user/${encodeURIComponent(userPublicId)}/notifications?token=${encodeURIComponent(userSessionToken)}&unreadOnly=true&limit=10`);
    if (!res?.success || !res.data) return;

    const unreads = res.data.notifications || [];
    const unreadCount = Number(res.data.unreadCount ?? unreads.length);
    const badge = document.getElementById('notifications-count-badge');
    if (badge) {
      if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    const alertedSet = getAlertedNotifIds();
    let hasNew = false;
    for (const notif of unreads) {
      if (!alertedSet.has(notif.id)) {
        hasNew = true;
        saveAlertedNotifId(notif.id);
        sendDeviceAlert(
          notif.title || '🔔 Waifuletes',
          notif.message || 'Nova notificação no seu harém!',
          'notif-' + notif.id,
          window.location.origin + `/user/${encodeURIComponent(userPublicId)}#notificacoes`
        );
      }
    }

    const activeTab = document.querySelector('.retro-tab.active')?.dataset.tab;
    if (hasNew && activeTab === 'tab-notifications') {
      loadUserNotifications();
    }
  } catch (_) {}
}

function initDeviceNotifPolling() {
  if (deviceNotifCheckInterval) return;
  checkNewDeviceNotifications();
  deviceNotifCheckInterval = setInterval(checkNewDeviceNotifications, 60000);
}

window.isDeviceNotifsEnabled = isDeviceNotifsEnabled;
window.updateDeviceNotifButtonUI = updateDeviceNotifButtonUI;
window.toggleDeviceNotifs = toggleDeviceNotifs;
window.sendDeviceAlert = sendDeviceAlert;
window.checkNewDeviceNotifications = checkNewDeviceNotifications;

async function loadUserNotifications() {
  updateDeviceNotifButtonUI();
  const loadingEl = document.getElementById('notifications-loading');
  const listEl = document.getElementById('notifications-list');
  if (!listEl) return;

  if (loadingEl) loadingEl.style.display = 'block';

  try {
    const res = await Api.get(`/api/web/user/${userPublicId}/notifications?token=${encodeURIComponent(userSessionToken)}`);
    if (!res.success) {
      if (loadingEl) loadingEl.style.display = 'none';
      listEl.innerHTML = `<div style="text-align: center; padding: 24px; color: #ef4444;">${escapeHtml(res.error?.message || 'Erro ao carregar notificações.')}</div>`;
      return;
    }

    userNotificationsCache = res.data?.notifications || (Array.isArray(res.data) ? res.data : []);
    if (loadingEl) loadingEl.style.display = 'none';
    renderNotificationsList();
  } catch (err) {
    if (loadingEl) loadingEl.style.display = 'none';
    listEl.innerHTML = '<div style="text-align: center; padding: 24px; color: #ef4444;">Erro de comunicação ao carregar notificações.</div>';
  }
}

function renderNotificationsList() {
  const listEl = document.getElementById('notifications-list');
  if (!listEl) return;

  let items = userNotificationsCache;
  if (notificationsFilterUnreadOnly) {
    items = items.filter(n => !n.read);
  }

  if (items.length === 0) {
    listEl.innerHTML = `
      <div style="text-align: center; padding: 40px; font-weight: bold; color: var(--text-muted); background: var(--bg-card); border: var(--border-retro); border-radius: var(--radius-retro);">
        <i class="fas fa-bell-slash" style="font-size: 28px; display: block; margin-bottom: 8px;"></i>
        ${notificationsFilterUnreadOnly ? 'Nenhuma notificação não lida.' : 'Nenhuma notificação no momento. Tudo tranquilo por aqui! ✨'}
      </div>
    `;
    return;
  }

  const typeIcons = {
    CHARACTER_MODIFIED: '✨',
    SUGGESTION_REVIEW: '💡',
    MARKET_OFFER: '🤝',
    MARKET_SALE: '💰',
    COVET_ALERT: '👀',
    WISHLIST_LISTED: '⭐'
  };

  listEl.innerHTML = items.map(n => {
    const icon = typeIcons[n.type] || '🔔';
    const dateStr = n.createdAt ? new Date(n.createdAt).toLocaleString('pt-BR') : '';
    const isUnread = !n.read;

    let meta = {};
    try {
      meta = typeof n.metadata === 'string' ? JSON.parse(n.metadata || '{}') : (n.metadata || {});
    } catch (_) {}

    const charLinkHtml = meta.characterId
      ? `<a href="/character/${encodeURIComponent(meta.characterId)}" target="_blank" class="btn-retro btn-sm" style="text-decoration:none; display:inline-flex; align-items:center; gap:4px; padding:3px 8px; font-size:11px; font-weight:800;"><i class="fas fa-id-card"></i> ${escapeHtml(meta.characterName || 'Ver Personagem')}</a>`
      : '';
    const userLinkHtml = meta.actorPublicId
      ? `<a href="/user/${encodeURIComponent(meta.actorPublicId)}" target="_blank" class="btn-retro btn-sm" style="text-decoration:none; display:inline-flex; align-items:center; gap:4px; padding:3px 8px; font-size:11px; font-weight:800;"><i class="fas fa-user"></i> ${escapeHtml(meta.actorName || 'Ver Perfil')}</a>`
      : '';
    const linksRowHtml = (charLinkHtml || userLinkHtml)
      ? `<div class="notification-links" style="display:flex; flex-wrap:wrap; gap:6px; margin: 8px 0 4px 0;">${charLinkHtml}${userLinkHtml}</div>`
      : '';

    return `
      <div class="notification-card ${isUnread ? 'unread' : ''}" id="notif-${n.id}">
        <div class="notification-icon">${icon}</div>
        <div class="notification-content">
          <div class="notification-title">
            <span>${escapeHtml(n.title)}</span>
            ${isUnread ? '<span class="notification-badge-unread">NOVA</span>' : ''}
          </div>
          <div class="notification-message">${escapeHtml(n.message)}</div>
          ${linksRowHtml}
          <div class="notification-time"><i class="far fa-clock"></i> ${dateStr}</div>
        </div>
      </div>
    `;
  }).join('');
}

async function markAllNotificationsAsRead() {
  const btn = document.getElementById('btn-notifications-mark-read');
  if (btn) btn.disabled = true;

  try {
    const res = await Api.post(`/api/web/user/${userPublicId}/notifications/read`, { token: userSessionToken, all: true });
    if (res.success) {
      Api.showToast('Todas as notificações foram marcadas como lidas!', '✅');
      const badge = document.getElementById('notifications-count-badge');
      if (badge) badge.classList.add('hidden');

      userNotificationsCache.forEach(n => { n.read = true; });
      renderNotificationsList();
    } else {
      Api.showToast(res.error?.message || 'Falha ao marcar notificações.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro ao marcar notificações como lidas.', '❌');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* MÓDULO DE CLASSIFICADOS E MERCADO (PAINEL WEB)                             */
/* ────────────────────────────────────────────────────────────────────────── */

function getCharImg(char) {
  if (!char) return '/media/characters/default.jpg';
  if (typeof char === 'string') {
    if (char.startsWith('http') || char.startsWith('/media/')) return char;
    return `/media/${char}`;
  }
  if (char.imageUrl) {
    if (char.imageUrl.startsWith('http') || char.imageUrl.startsWith('/media/')) return char.imageUrl;
    return `/media/${char.imageUrl}`;
  }
  if (Array.isArray(char.imageUrls) && char.imageUrls.length > 0) {
    const first = char.imageUrls[0];
    if (first.startsWith('http') || first.startsWith('/media/')) return first;
    return `/media/${first}`;
  }
  return '/media/characters/default.jpg';
}


const LOCAL_BUFF_DESCRIPTIONS = {
  bait_on_trash: 'Evita perder a isca ao pescar lixo',
  rare_chance_boost: 'Aumenta chance de peixe raro',
  double_catch: 'Pesca 2 peixes em 1 tentativa',
  cooldown_reduction: 'Reduz o tempo de espera',
  guaranteed_weight: 'Garante peso extra aos peixes',
  inventory_slot: 'Aumenta capacidade do inventário',
  next_fish_bonus: 'Bônus de peso no próximo peixe',
  longer_cooldown: 'Aumenta o tempo de espera',
  remove_baits: 'Perde iscas'
};

function getLocalBuffDescription(type) {
  return LOCAL_BUFF_DESCRIPTIONS[type] || 'Buff permanente de pesca';
}

let previewState = {
  characterId: null,
  images: [],
  currentIndex: 0,
  charData: null
};

async function openWaifuPreview(charId, charName, charImg, series, rarity, gender) {
  const modal = document.getElementById('modal-waifu-preview');
  if (!modal) return;

  // Busca dados completos atualizados do personagem (traz imageUrls, likes, wishlists, ranks, owner, tags)
  let fullChar = null;
  try {
    const res = await Api.get(`/characters/${encodeURIComponent(charId)}`);
    if (res?.data) fullChar = res.data;
  } catch (_) {}

  const cName = fullChar?.name || charName || charId;
  const cSeries = fullChar?.series || series || '';
  const cRarity = fullChar?.baseRarity || rarity || 'COMMON';
  const cGender = fullChar?.gender || gender || 'OTHER';
  const cDesc = fullChar?.description || '';
  const cLikes = Number(fullChar?.likeCount || 0);
  const cWishes = Number(fullChar?.wishlistCount || 0);
  const cWaifuRank = fullChar?.waifuRank || null;
  const cMudaeRank = fullChar?.rank || null;
  const cScore = Number(fullChar?.popularityScore || 0);
  const cTags = Array.isArray(fullChar?.tags) ? fullChar.tags : [];
  const cOwner = fullChar?.owner || null;
  const isClaimed = Boolean(fullChar?.isClaimed || cOwner);
  const isMythic = Boolean(fullChar?.isMythic || fullChar?.rarity === 'MYTHIC');

  // Ajusta botão de Sugerir no preview (desativa para Míticos)
  const btnSuggest = document.getElementById('btn-preview-suggest');
  if (btnSuggest) {
    btnSuggest.style.display = isMythic ? 'none' : '';
  }

  // Lista de imagens
  let images = [];
  if (fullChar?.imageUrls && Array.isArray(fullChar.imageUrls) && fullChar.imageUrls.length > 0) {
    images = fullChar.imageUrls;
  } else if (charImg && charImg !== '/media/characters/default.jpg') {
    images = [charImg];
  } else {
    images = ['/media/characters/default.jpg'];
  }

  previewState = {
    characterId: charId,
    images,
    currentIndex: 0,
    charData: fullChar || { id: charId, name: cName, series: cSeries, baseRarity: cRarity, gender: cGender, description: cDesc }
  };

  document.getElementById('waifu-preview-name').textContent = cName;
  document.getElementById('waifu-preview-series').textContent = cSeries ? `Série: ${cSeries}` : '';
  
  // Linha de Ranks
  const rankLineEl = document.getElementById('waifu-preview-rank-line');
  if (rankLineEl) {
    rankLineEl.innerHTML = `
      <span class="badge-tag" style="background: #eab308; color: #000; font-weight: 800;" title="Rank Oficial Waifuletes (baseado em curtidas, casamentos e wishlists)">
        🏆 #${cWaifuRank ? cWaifuRank : '-'}
      </span>
      ${cMudaeRank ? `
        <span class="badge-tag" style="background: #3b82f6; color: #fff; font-weight: 800;" title="Rank original do Mudae">
          🌐 Mudae #${cMudaeRank}
        </span>
      ` : ''}
      <span class="badge-tag" style="background: #64748b; color: #fff; font-weight: 800;" title="Pontuação total de popularidade">
        ⭐ ${cScore} pts
      </span>
    `;
  }

  const rarityEl = document.getElementById('waifu-preview-rarity');
  if (isMythic) {
    rarityEl.innerHTML = `<span class="badge-rarity" style="position: static; display: inline-block; background: linear-gradient(135deg, #581c87, #3b0764); border: 1.5px solid #c084fc; color: #facc15; font-weight: 900; box-shadow: 0 0 8px rgba(168, 85, 247, 0.6); padding: 4px 10px; border-radius: 4px;">🔮 MÍTICO</span>`;
  } else if (cRarity && RARITY_CONFIG[cRarity]) {
    const r = RARITY_CONFIG[cRarity];
    rarityEl.innerHTML = `<span style="color: var(--rarity-text-${cRarity.toLowerCase()}, ${r.color}); font-weight:800;">${r.emoji} ${r.label}</span>`;
  } else {
    rarityEl.textContent = '';
  }

  const genderEl = document.getElementById('waifu-preview-gender');
  if (genderEl) {
    const formatGender = (g) => {
      if (g === 'FEMALE') return '<span style="color:#ec4899;">♀ Feminino</span>';
      if (g === 'MALE') return '<span style="color:#3b82f6;">♂ Masculino</span>';
      return '<span style="color:#8b5cf6;">⚧ Outro</span>';
    };
    genderEl.innerHTML = formatGender(cGender);
  }

  // Linha de Casamento
  const marriageLineEl = document.getElementById('waifu-preview-marriage-line');
  if (marriageLineEl) {
    if (isMythic) {
      const creator = fullChar?.creator || fullChar?.creatorUser;
      const creatorName = creator?.name || cOwner?.name || 'Apoiador';
      const creatorPublicId = creator?.publicId || cOwner?.publicId || null;
      const creatorLink = creatorPublicId
        ? `<a href="/user/${creatorPublicId}" target="_blank" style="color: #facc15; text-decoration: underline; font-weight: 800;">${escapeHtml(creatorName)}</a>`
        : `<span style="color: #facc15; font-weight: 800;">${escapeHtml(creatorName)}</span>`;

      marriageLineEl.innerHTML = `
        <div style="margin-bottom: 4px;"><span style="color: #c084fc; font-weight: 800;">🔮 Forjado por:</span> ${creatorLink}</div>
        <div style="font-size: 13px; color: #ec4899; font-weight: 700;">💍 Eternamente Casada(o) com ${creatorLink}</div>
      `;
    } else if (isClaimed) {
      const ownerName = cOwner?.name || (typeof cOwner === 'string' ? cOwner : 'Outro jogador');
      const ownerPublicId = cOwner?.publicId || null;
      if (ownerPublicId) {
        marriageLineEl.innerHTML = `💍 Casada(o) com <a href="/user/${ownerPublicId}" target="_blank" style="color: #ec4899; text-decoration: underline; font-weight: 800;">${escapeHtml(ownerName)}</a>`;
      } else {
        marriageLineEl.innerHTML = `💍 Casada(o) com <span style="color: #ec4899; font-weight: 800;">${escapeHtml(ownerName)}</span>`;
      }
    } else {
      marriageLineEl.innerHTML = `<span style="color: #22c55e; font-weight: 800;">💍 Solteira(o) (Livre para casamento!)</span>`;
    }
  }

  // Botão de Likes
  const likesCountEl = document.getElementById('waifu-preview-likes-count');
  if (likesCountEl) likesCountEl.textContent = cLikes;
  const btnLike = document.getElementById('btn-preview-like');
  if (btnLike) {
    btnLike.onclick = (e) => registerCardLike(charId, e);
  }

  // Botão de Wishlist (oculta para Míticos)
  const wishesCountEl = document.getElementById('waifu-preview-wishes-count');
  if (wishesCountEl) wishesCountEl.textContent = cWishes;
  const btnWish = document.getElementById('btn-preview-wish');
  if (btnWish) {
    if (isMythic) {
      btnWish.style.display = 'none';
    } else {
      btnWish.style.display = '';
      const auth = getActiveAuthUser();
      const isAlreadyWish = auth.wishlistSet.has(charId);
      if (isAlreadyWish) {
        btnWish.className = 'btn-retro btn-sm btn-wish-active';
        btnWish.innerHTML = `<i class="fas fa-check"></i> <span id="waifu-preview-wishes-count">${cWishes}</span> Na Wishlist`;
      } else {
        btnWish.className = 'btn-retro btn-sm btn-gold';
        btnWish.innerHTML = `<i class="fas fa-star"></i> <span id="waifu-preview-wishes-count">${cWishes}</span> Wishlist`;
      }
      btnWish.onclick = (e) => toggleWishlist(charId, btnWish, e);
    }
  }

  // Tags
  const tagsEl = document.getElementById('waifu-preview-tags');
  if (tagsEl) {
    if (isMythic) {
      tagsEl.innerHTML = '';
      tagsEl.style.display = 'none';
    } else {
      tagsEl.style.display = 'flex';
      tagsEl.innerHTML = '';
      if (cTags && cTags.length > 0) {
        cTags.forEach(tag => {
          const tagSpan = document.createElement('span');
          tagSpan.className = 'badge-tag';
          tagSpan.textContent = `#${tag}`;
          tagsEl.appendChild(tagSpan);
        });
      } else {
        tagsEl.innerHTML = '<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">Nenhuma tag cadastrada</span>';
      }
    }
  }

  const descEl = document.getElementById('waifu-preview-description');
  if (descEl) {
    if (cDesc) {
      descEl.textContent = cDesc;
      descEl.style.display = 'block';
    } else {
      descEl.style.display = 'none';
    }
  }

  const directLinkEl = document.getElementById('btn-preview-link');
  if (directLinkEl) {
    directLinkEl.href = `/character/${encodeURIComponent(charId)}`;
  }

  // Ações contextuais
  const actionsEl = document.getElementById('waifu-preview-actions');
  if (actionsEl) {
    actionsEl.innerHTML = '';
    const isOwner = Boolean(userSessionData?.isAdmin);
    const isMarriedToMe = isOwner && (
      cOwner?.publicId === userPublicId ||
      (userSessionData?.harem || []).some(h => (h.character?.id || h.characterId) === charId)
    );

    if (isOwner) {
      if (isMythic) {
        if (isMarriedToMe) {
          // Favoritar
          const isFav = (userSessionData?.harem || []).some(h => (h.character?.id || h.characterId) === charId && h.isFavorite);
          const favBtn = document.createElement('button');
          favBtn.className = 'btn-retro btn-sm';
          favBtn.style.cssText = 'width: 100%; background: #ec4899; color: white; border-color: #db2777; font-weight: 800;';
          favBtn.innerHTML = `💖 ${isFav ? 'Desfavoritar' : 'Favoritar'}`;
          favBtn.onclick = () => { closeModal('modal-waifu-preview'); toggleFavorite(charId); };
          actionsEl.appendChild(favBtn);

          // Editar Criação
          const editBtn = document.createElement('button');
          editBtn.className = 'btn-retro btn-sm btn-gold';
          editBtn.style.cssText = 'width: 100%; font-weight: 800;';
          editBtn.innerHTML = '🔮 Editar Criação Mítica';
          editBtn.onclick = () => { closeModal('modal-waifu-preview'); openEditMythicModalById(charId); };
          actionsEl.appendChild(editBtn);

          // Escolher Foto Fixa
          const photoBtn = document.createElement('button');
          photoBtn.className = 'btn-retro btn-sm btn-purple';
          photoBtn.style.cssText = 'width: 100%; font-weight: 800;';
          photoBtn.innerHTML = '📷 Escolher Foto Fixa';
          photoBtn.onclick = () => { closeModal('modal-waifu-preview'); openChoosePhotoModal(charId); };
          actionsEl.appendChild(photoBtn);

          // Excluir Mítico & Liberar Slot
          const delBtn = document.createElement('button');
          delBtn.className = 'btn-retro btn-sm btn-danger';
          delBtn.style.cssText = 'width: 100%; font-weight: 800;';
          delBtn.innerHTML = '🗑️ Excluir Mítico & Liberar Slot';
          delBtn.onclick = () => { closeModal('modal-waifu-preview'); confirmDeleteMythic(charId, cName); };
          actionsEl.appendChild(delBtn);
        } else {
          const badgeNotice = document.createElement('div');
          badgeNotice.style.cssText = 'background: rgba(168, 85, 247, 0.15); border: 1.5px solid #a855f7; border-radius: 6px; padding: 10px; text-align: center; color: #a855f7; font-weight: 800; font-size: 13px;';
          badgeNotice.innerHTML = `🔮 Criação Mítica Eterna de <strong>${escapeHtml(cOwner?.name || 'Apoiador')}</strong>`;
          actionsEl.appendChild(badgeNotice);
        }
      } else if (isMarriedToMe) {
        const haremEntry = haremEntryCache?.get(charId) || (userSessionData?.harem || []).find(h => (h.character?.id || h.characterId) === charId);
        const isEntryLocked = Boolean(haremEntry?.isLocked || haremEntry?.collection?.isLocked);

        // Bloqueio
        const lockBtn = document.createElement('button');
        lockBtn.className = 'btn-retro btn-sm';
        lockBtn.style.cssText = `width: 100%; border-color: ${haremEntry?.isLocked ? '#ef4444' : '#10b981'}; color: ${haremEntry?.isLocked ? '#ef4444' : '#10b981'}; font-weight: 800;`;
        lockBtn.innerHTML = haremEntry?.isLocked ? '🔓 Desbloquear Personagem' : '🔒 Bloquear Personagem';
        lockBtn.onclick = () => { closeModal('modal-waifu-preview'); toggleCharacterLock(charId); };
        actionsEl.appendChild(lockBtn);

        // Favoritar
        const isFav = Boolean(haremEntry?.isFavorite);
        const favBtn = document.createElement('button');
        favBtn.className = 'btn-retro btn-sm';
        favBtn.style.cssText = 'width: 100%; background: #ec4899; color: white; border-color: #db2777; font-weight: 800;';
        favBtn.innerHTML = `💖 ${isFav ? 'Desfavoritar' : 'Favoritar'}`;
        favBtn.onclick = () => { closeModal('modal-waifu-preview'); toggleFavorite(charId); };
        actionsEl.appendChild(favBtn);

        // Vender
        const sellBtn = document.createElement('button');
        sellBtn.className = 'btn-retro btn-sm btn-gold';
        sellBtn.style.cssText = 'width: 100%; font-weight: 800;';
        if (isEntryLocked) {
          sellBtn.disabled = true;
          sellBtn.style.opacity = '0.5';
          sellBtn.style.cursor = 'not-allowed';
          sellBtn.innerHTML = '<i class="fas fa-lock"></i> 🔒 Venda Bloqueada';
        } else {
          sellBtn.innerHTML = '<i class="fas fa-tag"></i> 💰 Vender nos Classificados';
          sellBtn.onclick = () => { closeModal('modal-waifu-preview'); openSellModal(charId, cName, images[0], cSeries); };
        }
        actionsEl.appendChild(sellBtn);

        // Divorciar
        const divBtn = document.createElement('button');
        divBtn.className = 'btn-retro btn-sm btn-danger';
        divBtn.style.cssText = 'width: 100%; font-weight: 800;';
        if (isEntryLocked) {
          divBtn.disabled = true;
          divBtn.style.opacity = '0.5';
          divBtn.style.cursor = 'not-allowed';
          const cachedVal = divorcePreviewCache.get(charId);
          divBtn.innerHTML = `<i class="fas fa-lock"></i> 🔒 Divórcio Bloqueado ${cachedVal != null ? `(${formatZinthosValue(cachedVal)})` : '(...)'}`;
          if (cachedVal == null) {
            loadLockedDivorcePreview(charId, divBtn);
          }
        } else {
          const divInfo = getRarityDailyDivorceInfo(cRarity);
          const drText = divInfo
            ? (divInfo.count > 0 ? ` (${divInfo.count} hoje • DR ${Math.round(divInfo.nextRate * 100)}%)` : ' (100% líq.)')
            : '';
          divBtn.innerHTML = `<i class="fas fa-heart-crack"></i> Divorciar${drText}`;
          divBtn.onclick = () => { closeModal('modal-waifu-preview'); openDivorceModal(charId, cName); };
        }
        actionsEl.appendChild(divBtn);
      } else {
        // Não é casada com o usuário autenticado
        if (isClaimed) {
          // Cobiçar
          const isCoveted = userCovetedSet.has(charId);
          const covBtn = document.createElement('button');
          covBtn.className = 'btn-retro btn-sm';
          covBtn.style.cssText = 'width: 100%; border-color: #ec4899; color: #ec4899; font-weight: 800;';
          covBtn.disabled = isCoveted;
          covBtn.innerHTML = isCoveted ? '<i class="fas fa-check"></i> 👀 Cobiçado' : '<i class="fas fa-eye"></i> 👀 Cobiçar Personagem';
          if (!isCoveted) {
            covBtn.onclick = (e) => { covetCharacter(charId, covBtn, e); };
          }
          actionsEl.appendChild(covBtn);
        } else {
          // Investir
          const invBtn = document.createElement('button');
          invBtn.className = 'btn-retro btn-sm btn-gold';
          invBtn.style.cssText = 'width: 100%; font-weight: 800; border-color: #d97706; color: #92400e; background: #fef3c7;';
          invBtn.innerHTML = '<i class="fas fa-coins"></i> 📈 Investir Zinthos';
          invBtn.onclick = () => { closeModal('modal-waifu-preview'); openInvestModal(charId); };
          actionsEl.appendChild(invBtn);
        }
      }
    } else {
      // Visitante visualizando perfil público de outro jogador
      if (isClaimed) {
        const isCoveted = userCovetedSet.has(charId);
        const covBtn = document.createElement('button');
        covBtn.className = 'btn-retro btn-sm';
        covBtn.style.cssText = 'width: 100%; border-color: #ec4899; color: #ec4899; font-weight: 800;';
        covBtn.disabled = isCoveted;
        covBtn.innerHTML = isCoveted ? '<i class="fas fa-check"></i> 👀 Cobiçado' : '<i class="fas fa-eye"></i> 👀 Cobiçar Personagem';
        if (!isCoveted) {
          covBtn.onclick = (e) => { covetCharacter(charId, covBtn, e); };
        }
        actionsEl.appendChild(covBtn);
      }
    }
  }

  updatePreviewPhotoDisplay();
  openModal('modal-waifu-preview');
}

function updatePreviewPhotoDisplay() {
  const imgEl = document.getElementById('waifu-preview-img');
  const countEl = document.getElementById('waifu-preview-photo-count');
  const btnPrev = document.getElementById('btn-preview-prev');
  const btnNext = document.getElementById('btn-preview-next');
  const thumbsContainer = document.getElementById('waifu-preview-thumbs');

  const total = previewState.images.length;
  const curr = previewState.currentIndex;
  const currentSrc = previewState.images[curr] || '/media/characters/default.jpg';

  if (imgEl) imgEl.src = currentSrc;

  if (total > 1) {
    if (countEl) {
      countEl.style.display = 'inline-block';
      countEl.textContent = `Foto ${curr + 1} de ${total}`;
    }
    if (btnPrev) btnPrev.style.display = 'flex';
    if (btnNext) btnNext.style.display = 'flex';
  } else {
    if (countEl) countEl.style.display = 'none';
    if (btnPrev) btnPrev.style.display = 'none';
    if (btnNext) btnNext.style.display = 'none';
  }

  if (thumbsContainer) {
    thumbsContainer.innerHTML = '';
    if (total > 1) {
      previewState.images.forEach((src, idx) => {
        const thumb = document.createElement('img');
        thumb.loading = 'lazy';
        thumb.decoding = 'async';
        thumb.src = src;
        thumb.style.width = '36px';
        thumb.style.height = '48px';
        thumb.style.objectFit = 'cover';
        thumb.style.borderRadius = '3px';
        thumb.style.cursor = 'pointer';
        thumb.style.border = idx === curr ? '2px solid #eab308' : '1px solid #000';
        thumb.style.opacity = idx === curr ? '1' : '0.6';
        thumb.onclick = () => {
          previewState.currentIndex = idx;
          updatePreviewPhotoDisplay();
        };
        thumbsContainer.appendChild(thumb);
      });
    }
  }
}

function changePreviewPhoto(delta) {
  const total = previewState.images.length;
  if (total <= 1) return;
  previewState.currentIndex = (previewState.currentIndex + delta + total) % total;
  updatePreviewPhotoDisplay();
}

function openSuggestFromPreview() {
  closeModal('modal-waifu-preview');
  if (previewState.charData) {
    openSuggestModal(
      previewState.charData.id,
      previewState.charData.name,
      previewState.charData.baseRarity,
      previewState.charData
    );
  }
}

/**
 * Sincroniza o Hash da URL com a aba e subaba ativas (ex: #harem/miticos, #catalogo/sugestoes)
 * Permite navegação direta, favoritos e preservação de estado ao pressionar F5.
 */
function updateUrlHash(mainTabKey, subtabKey = null) {
  let hash = '#' + mainTabKey;
  if (subtabKey) {
    hash += '/' + subtabKey;
  }
  if (window.location.hash !== hash) {
    const url = new URL(window.location.href);
    url.hash = hash;
    history.replaceState(null, '', url.toString());
  }
}

/**
 * Ativa uma aba principal do painel privado
 */
function activateMainTab(tabId, updateHash = true) {
  const tabBtn = document.querySelector(`#private-panel .retro-tabs:not(.retro-subtabs) .retro-tab[data-tab="${tabId}"]`);
  const allTabs = document.querySelectorAll('#private-panel .retro-tabs:not(.retro-subtabs) .retro-tab[data-tab]');
  allTabs.forEach(t => t.classList.remove('active'));
  if (tabBtn) tabBtn.classList.add('active');

  document.querySelectorAll('#private-panel > .tab-content').forEach(c => c.classList.add('hidden'));
  const activeContent = document.getElementById(tabId);
  if (activeContent) activeContent.classList.remove('hidden');

  // Pausa slideshows de cards que ficaram em abas ocultas
  if (typeof activeSlideshowCards !== 'undefined' && activeSlideshowCards.size > 0) {
    activeSlideshowCards.forEach(card => {
      if (card.closest('.hidden')) {
        pauseCardSlideshow(card);
      }
    });
  }

  if (updateHash) {
    if (tabId === 'tab-catalog') {
      const activeSub = document.querySelector('#catalog-subtabs .retro-subtab.active')?.dataset.subtab || 'subtab-catalog-characters';
      if (activeSub === 'subtab-catalog-suggestions') updateUrlHash('catalogo', 'sugestoes');
      else updateUrlHash('catalogo', 'personagens');
    } else if (tabId === 'tab-rankings') {
      updateUrlHash('rankings');
    } else if (tabId === 'tab-harem') {
      const activeSub = document.querySelector('#harem-subtabs .retro-subtab.active')?.dataset.subtab || 'subtab-harem-married';
      if (activeSub === 'subtab-harem-summary') updateUrlHash('harem', 'resumo');
      else if (activeSub === 'subtab-harem-mythics') updateUrlHash('harem', 'miticos');
      else if (activeSub === 'subtab-harem-wishlist') updateUrlHash('harem', 'wishlist');
      else if (activeSub === 'subtab-harem-settings') updateUrlHash('harem', 'configuracoes');
      else updateUrlHash('harem', 'casados');
    } else if (tabId === 'tab-market') {
      const activeSub = document.querySelector('#market-subtabs .retro-subtab.active')?.dataset.subtab || 'subtab-market-browse';
      if (activeSub === 'subtab-market-my-listings') updateUrlHash('classificados', 'meus-anuncios');
      else if (activeSub === 'subtab-market-sent-offers') updateUrlHash('classificados', 'ofertas-enviadas');
      else updateUrlHash('classificados', 'geral');
    } else if (tabId === 'tab-notifications') {
      updateUrlHash('notificacoes');
    }
  }
}

/**
 * Ativa uma subaba interna (Catálogo, Harém ou Classificados)
 */
function activateSubTab(subtabsContainerId, subtabId, updateHash = true) {
  const container = document.getElementById(subtabsContainerId);
  if (!container) return;

  const subBtn = container.querySelector(`.retro-subtab[data-subtab="${subtabId}"]`);
  container.querySelectorAll('.retro-subtab').forEach(t => t.classList.remove('active'));
  if (subBtn) subBtn.classList.add('active');

  const tabContent = container.closest('.tab-content');
  if (tabContent) {
    tabContent.querySelectorAll('.subtab-content').forEach(c => c.classList.add('hidden'));
    const activeSub = document.getElementById(subtabId);
    if (activeSub) activeSub.classList.remove('hidden');

    // Pausa slideshows de cards que ficaram em subabas ocultas
    if (typeof activeSlideshowCards !== 'undefined' && activeSlideshowCards.size > 0) {
      activeSlideshowCards.forEach(card => {
        if (card.closest('.hidden')) {
          pauseCardSlideshow(card);
        }
      });
    }
  }

  if (updateHash) {
    if (subtabId === 'subtab-catalog-characters') updateUrlHash('catalogo', 'personagens');
    else if (subtabId === 'subtab-catalog-suggestions') updateUrlHash('catalogo', 'sugestoes');
    else if (subtabId === 'subtab-harem-summary') updateUrlHash('harem', 'resumo');
    else if (subtabId === 'subtab-harem-married') updateUrlHash('harem', 'casados');
    else if (subtabId === 'subtab-harem-mythics') updateUrlHash('harem', 'miticos');
    else if (subtabId === 'subtab-harem-wishlist') updateUrlHash('harem', 'wishlist');
    else if (subtabId === 'subtab-harem-settings') updateUrlHash('harem', 'configuracoes');
    else if (subtabId === 'subtab-market-browse') updateUrlHash('classificados', 'geral');
    else if (subtabId === 'subtab-market-my-listings') updateUrlHash('classificados', 'meus-anuncios');
    else if (subtabId === 'subtab-market-sent-offers') updateUrlHash('classificados', 'ofertas-enviadas');
  }
}

/**
 * Alterna dinamicamente abas e subabas do painel
 */
function switchTab(tabId, subtabId = null) {
  // Compatibilidade com chamadas legadas
  if (tabId === 'tab-harem-summary' || tabId === 'tab-summary') {
    activateMainTab('tab-harem', false);
    activateSubTab('harem-subtabs', 'subtab-harem-summary', true);
    loadHaremSummary();
    return;
  }
  if (tabId === 'tab-mythics') {
    activateMainTab('tab-harem', false);
    activateSubTab('harem-subtabs', 'subtab-harem-mythics', true);
    loadUserMythics();
    return;
  }
  if (tabId === 'tab-wishlist') {
    activateMainTab('tab-harem', false);
    activateSubTab('harem-subtabs', 'subtab-harem-wishlist', true);
    return;
  }
  if (tabId === 'tab-settings' || tabId === 'tab-harem-settings') {
    activateMainTab('tab-harem', false);
    activateSubTab('harem-subtabs', 'subtab-harem-settings', true);
    return;
  }
  if (tabId === 'tab-suggestions') {
    activateMainTab('tab-catalog', false);
    activateSubTab('catalog-subtabs', 'subtab-catalog-suggestions', true);
    loadUserSuggestions();
    return;
  }

  activateMainTab(tabId, !subtabId);

  if (tabId === 'tab-catalog') {
    const targetSub = subtabId || document.querySelector('#catalog-subtabs .retro-subtab.active')?.dataset.subtab || 'subtab-catalog-characters';
    activateSubTab('catalog-subtabs', targetSub, true);
    if (targetSub === 'subtab-catalog-suggestions') loadUserSuggestions();
    else loadCatalogCharacters();
  } else if (tabId === 'tab-harem') {
    const targetSub = subtabId || document.querySelector('#harem-subtabs .retro-subtab.active')?.dataset.subtab || 'subtab-harem-married';
    activateSubTab('harem-subtabs', targetSub, true);
    if (targetSub === 'subtab-harem-summary') loadHaremSummary();
    else if (targetSub === 'subtab-harem-mythics') loadUserMythics();
  } else if (tabId === 'tab-rankings') {
    loadRankings(document.getElementById('ranking-search-input')?.value || '');
  } else if (tabId === 'tab-market') {
    const targetSub = subtabId || document.querySelector('#market-subtabs .retro-subtab.active')?.dataset.subtab || 'subtab-market-browse';
    activateSubTab('market-subtabs', targetSub, true);
    loadMarketTab();
  } else if (tabId === 'tab-notifications') {
    loadUserNotifications();
  }
}

/**
 * Roteia a interface a partir do hash atual na URL (ex: #harem/miticos, #rankings)
 */
function navigateToHash(hash) {
  if (!hash) return;
  const cleanHash = hash.replace(/^#/, '').toLowerCase().trim();
  if (!cleanHash) return;

  const parts = cleanHash.split('/');
  const mainPart = parts[0];
  const subPart = parts[1];

  if (mainPart === 'catalogo' || mainPart === 'catalog') {
    activateMainTab('tab-catalog', false);
    if (subPart === 'sugestoes' || subPart === 'suggestions') {
      activateSubTab('catalog-subtabs', 'subtab-catalog-suggestions', false);
      loadUserSuggestions();
    } else {
      activateSubTab('catalog-subtabs', 'subtab-catalog-characters', false);
      loadCatalogCharacters();
    }
  } else if (mainPart === 'sugestoes' || mainPart === 'suggestions') {
    activateMainTab('tab-catalog', false);
    activateSubTab('catalog-subtabs', 'subtab-catalog-suggestions', false);
    loadUserSuggestions();
  } else if (mainPart === 'rankings' || mainPart === 'ranking') {
    activateMainTab('tab-rankings', false);
    loadRankings(document.getElementById('ranking-search-input')?.value || '');
  } else if (mainPart === 'harem') {
    activateMainTab('tab-harem', false);
    if (subPart === 'resumo' || subPart === 'summary' || subPart === 'diario') {
      activateSubTab('harem-subtabs', 'subtab-harem-summary', false);
      loadHaremSummary();
    } else if (subPart === 'miticos' || subPart === 'mythics') {
      activateSubTab('harem-subtabs', 'subtab-harem-mythics', false);
      loadUserMythics();
    } else if (subPart === 'wishlist' || subPart === 'desejos') {
      activateSubTab('harem-subtabs', 'subtab-harem-wishlist', false);
    } else if (subPart === 'configuracoes' || subPart === 'settings') {
      activateSubTab('harem-subtabs', 'subtab-harem-settings', false);
    } else {
      activateSubTab('harem-subtabs', 'subtab-harem-married', false);
    }
  } else if (mainPart === 'resumo' || mainPart === 'summary' || mainPart === 'diario') {
    activateMainTab('tab-harem', false);
    activateSubTab('harem-subtabs', 'subtab-harem-summary', false);
    loadHaremSummary();
  } else if (mainPart === 'miticos' || mainPart === 'mythics') {
    activateMainTab('tab-harem', false);
    activateSubTab('harem-subtabs', 'subtab-harem-mythics', false);
    loadUserMythics();
  } else if (mainPart === 'wishlist') {
    activateMainTab('tab-harem', false);
    activateSubTab('harem-subtabs', 'subtab-harem-wishlist', false);
  } else if (mainPart === 'configuracoes' || mainPart === 'settings') {
    activateMainTab('tab-harem', false);
    activateSubTab('harem-subtabs', 'subtab-harem-settings', false);
  } else if (mainPart === 'classificados' || mainPart === 'mercado' || mainPart === 'market') {
    activateMainTab('tab-market', false);
    if (subPart === 'meus-anuncios' || subPart === 'anuncios' || subPart === 'my-listings') {
      activateSubTab('market-subtabs', 'subtab-market-my-listings', false);
    } else if (subPart === 'ofertas-enviadas' || subPart === 'ofertas' || subPart === 'sent-offers') {
      activateSubTab('market-subtabs', 'subtab-market-sent-offers', false);
    } else {
      activateSubTab('market-subtabs', 'subtab-market-browse', false);
    }
    loadMarketTab();
  } else if (mainPart === 'notificacoes' || mainPart === 'notifications') {
    activateMainTab('tab-notifications', false);
    loadUserNotifications();
  }
}

function openSellModal(characterId, characterName, imageUrl, series) {
  const entry = haremEntryCache?.get(characterId);
  const char = entry?.character;
  if (entry && (entry.isLocked || entry.collection?.isLocked)) {
    Api.showToast('Personagens bloqueados (ou em coleções bloqueadas) não podem ser anunciados nos classificados.', '🔒');
    return;
  }
  if (char && (char.isMythic || char.baseRarity === 'MYTHIC' || char.rarity === 'MYTHIC')) {
    Api.showToast('Personagens Míticos pertencem exclusivamente ao criador e não podem ser anunciados nos classificados.', '⚠️');
    return;
  }
  activeSellCharacter = { id: characterId, name: characterName };
  document.getElementById('sell-modal-char-name').textContent = characterName;
  document.getElementById('sell-modal-char-series').textContent = series || 'Sem série';
  document.getElementById('sell-modal-char-img').src = getCharImg(imageUrl);
  const interestInput = document.getElementById('sell-modal-interest');

  const cachedKeyInfo = sellKeysPreviewCache.get(characterId);
  const initialKeys = Number(cachedKeyInfo?.keys ?? entry?.keys ?? char?.keys ?? 1);
  const initialSoulmate = Boolean(cachedKeyInfo?.isSoulmate ?? entry?.isSoulmate ?? char?.isSoulmate ?? initialKeys >= 10);
  updateSellModalKeysWarning(initialKeys, initialSoulmate);

  const auth = typeof getActiveAuthUser === 'function' ? getActiveAuthUser() : { isOwner: true, token: userSessionData?.token, publicId: userPublicId };
  const token = auth?.token || userSessionToken;
  const pId = auth?.publicId || userPublicId || 'token-session';

  if (divorcePreviewCache.has(characterId)) {
    const cachedVal = divorcePreviewCache.get(characterId);
    interestInput.value = cachedVal != null && cachedVal > 0
      ? `Valor mínimo: ${Number(cachedVal).toLocaleString('pt-BR')}z`
      : '';
  } else {
    interestInput.value = 'Valor mínimo: calculando...';
    if (token) {
      Api.get(`/api/web/user/${encodeURIComponent(pId)}/divorce/preview/${encodeURIComponent(characterId)}?token=${encodeURIComponent(token)}`)
        .then(res => {
          if (res && res.success && res.data) {
            const val = res.data.refundedKakera ?? res.data.fullRefundKakera ?? 0;
            divorcePreviewCache.set(characterId, val);
            const currentKeys = Number(res.data.currentKeys ?? initialKeys);
            const isSoulmate = Boolean(res.data.isSoulmate || initialSoulmate || currentKeys >= 10);
            sellKeysPreviewCache.set(characterId, { keys: currentKeys, isSoulmate });
            updateSellModalKeysWarning(currentKeys, isSoulmate);
            if (interestInput.value === 'Valor mínimo: calculando...' || interestInput.value === '') {
              interestInput.value = val > 0 ? `Valor mínimo: ${Number(val).toLocaleString('pt-BR')}z` : '';
              if (interestInput.value) interestInput.select();
            }
          } else if (interestInput.value === 'Valor mínimo: calculando...') {
            interestInput.value = '';
          }
        })
        .catch(() => {
          if (interestInput.value === 'Valor mínimo: calculando...') {
            interestInput.value = '';
          }
        });
    } else {
      interestInput.value = '';
    }
  }

  openModal('modal-market-sell');
  requestAnimationFrame(() => {
    interestInput.focus();
    if (interestInput.value) interestInput.select();
  });
}

async function confirmPublishListing() {
  if (!activeSellCharacter) return;
  const interestInput = document.getElementById('sell-modal-interest');
  const interest = interestInput.value.trim();

  if (!interest || interest === 'Valor mínimo: calculando...') {
    Api.showToast('Por favor, informe o que você busca em troca.', '⚠️');
    interestInput.focus();
    return;
  }

  const btn = document.getElementById('btn-confirm-sell');
  btn.disabled = true;

  try {
    const res = await Api.post(`/api/web/user/${encodeURIComponent(userPublicId)}/market/listings`, {
      token: userSessionToken,
      characterId: activeSellCharacter.id,
      interest,
    });

    if (res.success) {
      activeMyListingsCharIds.add(activeSellCharacter.id);
      if (Array.isArray(userSessionData?.listedCharacterIds) && !userSessionData.listedCharacterIds.includes(activeSellCharacter.id)) {
        userSessionData.listedCharacterIds.push(activeSellCharacter.id);
      }
      closeModal('modal-market-sell');
      Api.showToast('Personagem anunciado nos classificados com sucesso!', '✨');
      loadMyListings();
      loadWishlistMarket();
      loadGlobalMarket();
      updateMarketPendingBadge();
    } else {
      Api.showToast(res.error?.message || 'Falha ao publicar anúncio.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao publicar anúncio.', '❌');
  } finally {
    btn.disabled = false;
  }
}

async function updateMarketPendingBadge() {
  if (!userSessionToken) return;
  try {
    const res = await Api.get(`/api/web/user/${encodeURIComponent(userPublicId)}/market/my-listings?token=${encodeURIComponent(userSessionToken)}`);
    if (res.success && Array.isArray(res.data)) {
      let pendingCount = 0;
      res.data.forEach(l => {
        pendingCount += (l.offers || []).length;
      });

      const badge = document.getElementById('market-pending-badge');
      if (badge) {
        if (pendingCount > 0) {
          badge.textContent = pendingCount;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }
    }
  } catch (e) {
    // Silencioso
  }
}

function loadMarketTab() {
  loadMyListings();
  loadWishlistMarket();
  loadGlobalMarket();
  loadMySentOffers();
}

function createMyListingCard(listing) {
  const char = listing.character;
  const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
  const pendingOffersCount = (listing.offers || []).length;
  const hasOffers = pendingOffersCount > 0;

  const card = document.createElement('div');
  card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}${hasOffers ? ' has-pending-offers' : ''}`;
  card.style.borderColor = hasOffers ? '#f59e0b' : ((char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color);

  const offersBtnClass = hasOffers ? 'btn-has-offers' : '';
  const offersBtnText = hasOffers
    ? `<i class="fas fa-bell"></i> <strong>Ver Ofertas (${pendingOffersCount})</strong>`
    : `<i class="fas fa-envelope-open"></i> Ver Ofertas (0)`;

  const keys = listing.keys || char.keys || 1;
  const isSoulmate = Boolean(listing.isSoulmate || char.isSoulmate || keys >= 10);
  const keysBadgeHtml = isSoulmate
    ? `<div class="badge-keys" style="background: #ec4899; color: white; border-color: #f472b6;" title="💖 Soulmate (${keys} chaves)"><span>💖</span> <span>${keys}</span></div>`
    : `<div class="badge-keys" title="🔑 ${keys} chave(s)"><span>🔑</span> <span>${keys}</span></div>`;

  const listingAge = formatListingAge(listing.createdAt);
  const ageHtml = listingAge ? listingAge.html : '';

  card.innerHTML = `
    <div class="card-img-wrapper">
      <img loading="lazy" decoding="async" src="${getCharImg(char)}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)">
      <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
        ${rarity.emoji} ${rarity.label}
      </div>
      ${keysBadgeHtml}
      ${hasOffers ? `<div class="badge-married" style="background: #f59e0b; color: black; font-weight: 800; top: 8px; left: 8px; box-shadow: 0 0 8px rgba(245, 158, 11, 0.7);">${pendingOffersCount} 🫰</div>` : ''}
    </div>
    <div class="card-info">
      <div class="card-name">${escapeHtml(char.name)}</div>
      <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
      ${ageHtml}
      <div style="background: var(--bg-retro-accent); padding: 6px 8px; border-radius: 4px; font-size: 12px; margin: 6px 0; border: var(--border-retro);">
        <strong style="color: #f59e0b;"><i class="fas fa-search"></i> Procura:</strong> ${escapeHtml(listing.interest)}
      </div>
      <div class="card-actions" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
        <button class="btn-retro btn-sm ${offersBtnClass}" style="width: 100%;" data-action="view-offers">
          ${offersBtnText}
        </button>
        <button class="btn-retro btn-sm btn-danger" style="width: 100%;" data-action="cancel-listing">
          <i class="fas fa-times-circle"></i> Cancelar Anúncio
        </button>
      </div>
    </div>
  `;
  bindDataActions(card, {
    'view-offers': () => openViewOffersModal(listing.id, char.name),
    'cancel-listing': (event, el) => cancelMyListing(listing.id, el),
  });
  return card;
}

let activeMyListingsCharIds = new Set();

async function loadMyListings() {
  const grid = document.getElementById('my-listings-grid');
  if (!grid) return;

  const countBadge = document.getElementById('my-listings-count');

  try {
    const res = await Api.get(`/api/web/user/${encodeURIComponent(userPublicId)}/market/my-listings?token=${encodeURIComponent(userSessionToken)}`);
    if (!res.success || !Array.isArray(res.data) || res.data.length === 0) {
      activeMyListingsCharIds = new Set();
      if (userSessionData) userSessionData.listedCharacterIds = [];
      if (countBadge) countBadge.textContent = '0';
      grid.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--text-muted); background: var(--bg-card); border: var(--border-retro); border-radius: var(--radius-retro);">Você não possui nenhum anúncio ativo no momento. Clique em "Novo Classificado" acima para selecionar uma waifu do seu harém!</div>';
      return;
    }

    activeMyListingsCharIds = new Set(res.data.map(l => l.characterId || l.character?.id).filter(Boolean));
    if (userSessionData) {
      userSessionData.listedCharacterIds = Array.from(activeMyListingsCharIds);
    }

    if (countBadge) countBadge.textContent = res.data.length;

    const withOffers = res.data.filter(l => (l.offers || []).length > 0);
    const withoutOffers = res.data.filter(l => (l.offers || []).length === 0);

    grid.innerHTML = `
      <!-- Seção: Com ofertas -->
      <div id="my-listings-with-offers-section" style="margin-bottom: 24px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <span style="font-weight: 800; font-size: 15px; color: #f59e0b; display: inline-flex; align-items: center; gap: 6px;">
            <i class="fas fa-bell"></i> Com ofertas (${withOffers.length}):
          </span>
          ${withOffers.length > 0 ? '<span class="badge-tag" style="background: #f59e0b; color: #000; font-weight: 800;">Aguardando sua decisão</span>' : ''}
        </div>
        <div id="my-listings-with-offers-grid" class="waifu-grid"></div>
      </div>

      <!-- Divisor Horizontal -->
      <div class="market-listings-divider" style="margin: 28px 0 20px 0;">
        <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
          <span style="font-weight: 800; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); white-space: nowrap;">
            <i class="fas fa-bullhorn"></i> Sem ofertas (${withoutOffers.length}):
          </span>
          <div style="flex: 1; height: 2px; background: var(--border-retro); opacity: 0.6;"></div>
        </div>
      </div>

      <!-- Seção: Sem ofertas -->
      <div id="my-listings-without-offers-section">
        <div id="my-listings-without-offers-grid" class="waifu-grid"></div>
      </div>
    `;

    const withOffersGrid = document.getElementById('my-listings-with-offers-grid');
    const withoutOffersGrid = document.getElementById('my-listings-without-offers-grid');

    if (withOffers.length > 0) {
      withOffers.forEach(listing => withOffersGrid.appendChild(createMyListingCard(listing)));
    } else {
      withOffersGrid.innerHTML = '<div style="grid-column: 1 / -1; padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px; font-style: italic; background: var(--bg-card); border: var(--border-retro); border-radius: var(--radius-retro);">Nenhum anúncio com ofertas pendentes no momento.</div>';
    }

    if (withoutOffers.length > 0) {
      withoutOffers.forEach(listing => withoutOffersGrid.appendChild(createMyListingCard(listing)));
    } else {
      withoutOffersGrid.innerHTML = '<div style="grid-column: 1 / -1; padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px; font-style: italic; background: var(--bg-card); border: var(--border-retro); border-radius: var(--radius-retro);">Todos os seus anúncios possuem ofertas pendentes! ✨</div>';
    }
  } catch (err) {
    grid.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--accent-red); background: var(--bg-card); border: var(--border-retro); border-radius: var(--radius-retro);">Erro ao carregar seus anúncios.</div>';
  }
}

// Ids com requisição em andamento (evita duplo envio por clique duplo/reabertura)
const listingCancelsInFlight = new Set();
const offerAcceptsInFlight = new Set();

async function cancelMyListing(listingId, triggerBtn = null) {
  if (listingCancelsInFlight.has(listingId)) return;
  const confirmed = await Api.showConfirm({
    icon: '🗑️',
    title: 'Cancelar Anúncio',
    message: 'Deseja realmente cancelar este anúncio?',
    notice: 'Todas as ofertas pendentes recebidas nele serão canceladas automaticamente.',
    noticeTone: 'warning',
    confirmText: 'Cancelar Anúncio',
    confirmClass: 'btn-danger'
  });
  if (!confirmed || listingCancelsInFlight.has(listingId)) return;
  listingCancelsInFlight.add(listingId);
  if (triggerBtn) triggerBtn.disabled = true;
  try {
    const res = await Api.delete(`/api/web/user/${encodeURIComponent(userPublicId)}/market/listings/${encodeURIComponent(listingId)}?token=${encodeURIComponent(userSessionToken)}`);
    if (res.success) {
      Api.showToast('Anúncio cancelado com sucesso.', 'ℹ️');
      loadMyListings();
      loadWishlistMarket();
      loadGlobalMarket();
      updateMarketPendingBadge();
    } else {
      Api.showToast(res.error?.message || 'Falha ao cancelar anúncio.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao cancelar anúncio.', '❌');
  } finally {
    listingCancelsInFlight.delete(listingId);
    if (triggerBtn) triggerBtn.disabled = false;
  }
}

let currentOffersMap = new Map();

// Valor de moeda de uma oferta como número finito (ausente/inválido = 0)
function offerAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatOfferCurrencyText(value, symbol, label) {
  const warn = value < 0 ? ' ⚠️ (negativo, inválido)' : '';
  return `${symbol} ${value.toLocaleString('pt-BR')} ${label}${warn}`;
}

function formatOfferCurrencyHtml(value, symbol, label, color) {
  const invalid = value < 0;
  const amountHtml = `<span style="color:${invalid ? 'var(--accent-red)' : color};font-weight:800;">${symbol} ${escapeHtml(value.toLocaleString('pt-BR'))} ${label}</span>`;
  return invalid
    ? `${amountHtml} <span style="color:var(--accent-red);font-weight:800;">⚠️ valor negativo (inválido)</span>`
    : amountHtml;
}

async function openViewOffersModal(listingId, characterName) {
  currentOffersMap.clear();
  const container = document.getElementById('offers-list-container');
  const title = document.getElementById('view-offers-char-title');
  title.textContent = `Propostas para: ${characterName}`;
  container.innerHTML = '<div style="text-align: center; padding: 20px;">Buscando ofertas...</div>';
  openModal('modal-market-view-offers');

  try {
    const res = await Api.get(`/api/web/user/${encodeURIComponent(userPublicId)}/market/listings/${encodeURIComponent(listingId)}/offers?token=${encodeURIComponent(userSessionToken)}`);
    if (!res.success || !Array.isArray(res.data) || res.data.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">Nenhuma oferta recebida para este anúncio ainda.</div>';
      return;
    }

    container.innerHTML = '';
    res.data.forEach(offer => {
      const offered = offer.offeredItems || {};
      const buyerName = offer.buyer?.name || 'Jogador Anônimo';
      const isPending = offer.status === 'PENDING';

      let itemsHtml = '';
      if (offered.isFree) {
        itemsHtml = '<div style="color: #10b981; font-weight: 700;">🎁 Pediu de graça (Doação)</div>';
      } else {
        const parts = [];
        if (Array.isArray(offered.waifus) && offered.waifus.length > 0) {
          parts.push(`<div><strong>Waifus (${offered.waifus.length}):</strong> ${offered.waifus.map(w => {
            return `<button type="button" class="badge-tag" style="background:#8b5cf6;color:#fff;border:none;cursor:pointer;margin:2px;padding:3px 8px;font-size:12px;" ${waifuPreviewDataAttrs(w.id, w.name || w.id, getCharImg(w), w.series || '', w.baseRarity || '')}><i class="fas fa-image"></i> ${escapeHtml(w.name || w.id)}</button>`;
          }).join(' ')}</div>`);
        } else if (Array.isArray(offered.waifuIds) && offered.waifuIds.length > 0) {
          parts.push(`<div><strong>Waifus (${offered.waifuIds.length}):</strong> ${offered.waifuIds.map(wId => {
            return `<button type="button" class="badge-tag" style="background:#8b5cf6;color:#fff;border:none;cursor:pointer;margin:2px;padding:3px 8px;font-size:12px;" ${waifuPreviewDataAttrs(wId, wId, '', '', '')}><i class="fas fa-image"></i> ${escapeHtml(wId)}</button>`;
          }).join(' ')}</div>`);
        }
        // Exibe qualquer valor diferente de zero (inclusive negativos/fracionados, destacados)
        // para que o vendedor nunca aceite uma oferta com valores ocultos.
        const runasVal = offerAmount(offered.runas);
        if (runasVal !== 0) {
          parts.push(`<div><strong>Moeda Global (Runas):</strong> ${formatOfferCurrencyHtml(runasVal, 'ᚱ', 'Runas', '#38bdf8')}</div>`);
        }
        const petalitasVal = offerAmount(offered.petalitas);
        if (petalitasVal !== 0) {
          parts.push(`<div><strong>Moeda da Fazenda (Petalitas):</strong> ${formatOfferCurrencyHtml(petalitasVal, '🌸', 'Petalitas', '#ec4899')}</div>`);
        }
        if (Array.isArray(offered.fishes) && offered.fishes.length > 0) {
          const fishSummary = {};
          offered.fishes.forEach(f => {
            const k = f.name || 'Peixe';
            fishSummary[k] = (fishSummary[k] || 0) + 1;
          });
          const fishStr = Object.entries(fishSummary).map(([name, count]) => `${count}x ${escapeHtml(name)}`).join(', ');
          parts.push(`<div><strong>Peixes (${offered.fishes.length}):</strong> ${fishStr}</div>`);
        }
        if (Array.isArray(offered.fishingBuffs) && offered.fishingBuffs.length > 0) {
          parts.push(`<div><strong>Buffs de Pesca (${offered.fishingBuffs.length}):</strong> ${offered.fishingBuffs.map(b => {
            const bName = b.originalName || b.type || 'Buff';
            const bDesc = b.description || getLocalBuffDescription(b.type);
            return `<b>${escapeHtml(bName)}</b> <span style="color:var(--text-muted); font-size:11px;">(${escapeHtml(bDesc)})</span>`;
          }).join(', ')}</div>`);
        }
        if (Array.isArray(offered.farmItems) && offered.farmItems.length > 0) {
          parts.push(`<div><strong>Itens de Fazenda:</strong> ${offered.farmItems.map(it => `${Number(it.amount) || 0}x ${escapeHtml(it.name || it.itemId)}`).join(', ')}</div>`);
        }
        const zinthosVal = offerAmount(offered.zinthos);
        if (zinthosVal !== 0) {
          if (zinthosVal > 0) {
            const netZinthos = Math.floor(zinthosVal * 0.95);
            parts.push(`<div><strong>Moeda (Zinthos a receber):</strong> ${formatOfferCurrencyHtml(netZinthos, '🪙', 'Zinthos', '#f59e0b')} <span style="font-size: 11px; color: var(--text-muted);">(descontada taxa de negociação de 5% sobre ${zinthosVal.toLocaleString('pt-BR')})</span></div>`);
          } else {
            parts.push(`<div><strong>Moeda (Zinthos):</strong> ${formatOfferCurrencyHtml(zinthosVal, '🪙', 'Zinthos', '#f59e0b')}</div>`);
          }
        }
        itemsHtml = parts.join('<div style="margin-top: 4px;"></div>') || '<span style="color: var(--text-muted);">Nenhum item especificado</span>';
      }

      currentOffersMap.set(offer.id, {
        offer,
        listingId,
        characterName,
        itemsHtml,
      });

      let statusBadge = `<span class="badge-tag" style="background: #eab308; color: #000;">Pendente</span>`;
      if (offer.status === 'ACCEPTED') statusBadge = `<span class="badge-tag" style="background: #22c55e; color: #fff;">Aceita 🎉</span>`;
      if (offer.status === 'REJECTED') statusBadge = `<span class="badge-tag" style="background: #64748b; color: #fff;">Recusada</span>`;
      if (offer.status === 'CANCELLED') statusBadge = `<span class="badge-tag" style="background: #ef4444; color: #fff;">Cancelada</span>`;

      const card = document.createElement('div');
      card.dataset.offerId = offer.id;
      card.style.background = 'var(--bg-card)';
      card.style.border = 'var(--border-retro)';
      card.style.borderRadius = 'var(--radius-retro)';
      card.style.padding = '12px 14px';

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-weight: 800; font-size: 14px;"><i class="fas fa-user"></i> ${escapeHtml(buyerName)}</span>
          ${statusBadge}
        </div>
        <div style="font-size: 13px; margin-bottom: 8px;">
          ${itemsHtml}
        </div>
        ${offer.message ? `<div style="font-size: 12px; color: var(--text-muted); font-style: italic; margin-bottom: 8px;">"${escapeHtml(offer.message)}"</div>` : ''}
        ${offer.cancelReason ? `<div style="font-size: 12px; color: var(--accent-red); font-weight: bold; margin-bottom: 8px;">${offer.status === 'REJECTED' ? 'Motivo da recusa' : 'Motivo do cancelamento'}: ${escapeHtml(offer.cancelReason)}</div>` : ''}
        ${isPending ? `
          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button class="btn-retro btn-sm btn-gold" style="flex: 1;" data-action="accept-offer">
              <i class="fas fa-check"></i> Aceitar Oferta
            </button>
            <button class="btn-retro btn-sm btn-danger" style="flex: 1;" data-action="reject-offer">
              <i class="fas fa-times"></i> Negar
            </button>
          </div>
        ` : ''}
      `;
      bindDataActions(card, {
        'accept-offer': () => promptAcceptMarketOffer(offer.id),
        'reject-offer': () => rejectMarketOffer(offer.id, listingId, characterName),
      });
      if (offerAcceptsInFlight.has(offer.id)) {
        card.querySelectorAll('button[data-action]').forEach(b => { b.disabled = true; });
      }
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--accent-red);">Erro ao carregar propostas.</div>';
  }
}

// Atributos data-* para abrir a pré-visualização de uma waifu ofertada. O resumo da oferta
// (itemsHtml) é reinjetado no modal de confirmação, por isso o clique é tratado por
// delegação no document em vez de JS inline com dados de jogadores.
function waifuPreviewDataAttrs(id, name, img, series, rarity) {
  return [
    `data-preview-char-id="${escapeHtml(id)}"`,
    `data-preview-name="${escapeHtml(name)}"`,
    `data-preview-img="${escapeHtml(img)}"`,
    `data-preview-series="${escapeHtml(series)}"`,
    `data-preview-rarity="${escapeHtml(rarity)}"`,
  ].join(' ');
}

document.addEventListener('click', (event) => {
  const btn = event.target instanceof Element ? event.target.closest('[data-preview-char-id]') : null;
  if (!btn) return;
  const d = btn.dataset;
  openWaifuPreview(d.previewCharId, d.previewName || '', d.previewImg || '', d.previewSeries || '', d.previewRarity || '');
});

function setOfferActionsBusy(offerId, busy) {
  document.querySelectorAll('#offers-list-container [data-offer-id]').forEach(card => {
    if (card.dataset.offerId === String(offerId)) {
      card.querySelectorAll('button[data-action]').forEach(b => { b.disabled = busy; });
    }
  });
  const btnConfirm = document.getElementById('btn-confirm-accept-offer');
  if (btnConfirm) btnConfirm.disabled = busy;
}

function promptAcceptMarketOffer(offerId) {
  const data = currentOffersMap.get(offerId);
  if (!data || offerAcceptsInFlight.has(offerId)) return;
  const { offer, listingId, characterName, itemsHtml } = data;
  const buyerName = offer.buyer?.name || 'Jogador Anônimo';

  const charNameEl = document.getElementById('confirm-offer-char-name');
  if (charNameEl) charNameEl.textContent = characterName;

  const buyerNameEl = document.getElementById('confirm-offer-buyer-name');
  if (buyerNameEl) buyerNameEl.textContent = buyerName;

  const itemsSummaryEl = document.getElementById('confirm-offer-items-summary');
  if (itemsSummaryEl) itemsSummaryEl.innerHTML = itemsHtml;

  const btnConfirm = document.getElementById('btn-confirm-accept-offer');
  if (btnConfirm) {
    btnConfirm.onclick = () => {
      closeModal('modal-confirm-accept-offer');
      executeAcceptMarketOffer(offerId, listingId, characterName);
    };
  }

  openModal('modal-confirm-accept-offer');
}

async function executeAcceptMarketOffer(offerId, listingId, characterName) {
  if (offerAcceptsInFlight.has(offerId)) return;
  offerAcceptsInFlight.add(offerId);
  setOfferActionsBusy(offerId, true);
  try {
    const res = await Api.post(`/api/web/user/${encodeURIComponent(userPublicId)}/market/offers/${encodeURIComponent(offerId)}/accept`, {
      token: userSessionToken,
    });

    if (res.success) {
      Api.showToast('Oferta aceita com sucesso! A troca foi realizada.', '🎉');
      closeModal('modal-market-view-offers');
      loadUserData();
      loadMarketTab();
    } else {
      // Se foi cancelada por falta de itens, avisa com destaque
      await Api.showAlert({
        icon: '⚠️',
        title: 'Oferta Indisponível',
        message: res.reason || 'Não foi possível aceitar a oferta.',
        noticeTone: 'warning',
        confirmText: 'Entendi',
        confirmClass: 'btn-primary'
      });
      openViewOffersModal(listingId, characterName);
      loadMyListings();
      loadGlobalMarket();
      updateMarketPendingBadge();
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao aceitar oferta.', '❌');
  } finally {
    offerAcceptsInFlight.delete(offerId);
    setOfferActionsBusy(offerId, false);
  }
}

function acceptMarketOffer(offerId, listingId, characterName) {
  if (currentOffersMap.has(offerId)) {
    promptAcceptMarketOffer(offerId);
  } else {
    executeAcceptMarketOffer(offerId, listingId, characterName);
  }
}

async function rejectMarketOffer(offerId, listingId, characterName) {
  promptRejectMarketOffer(offerId, listingId, characterName);
}

function promptRejectMarketOffer(offerId, listingId, characterName) {
  const charNameEl = document.getElementById('reject-offer-char-name');
  if (charNameEl) charNameEl.textContent = characterName || 'personagem';
  const reasonInput = document.getElementById('reject-offer-reason-input');
  if (reasonInput) reasonInput.value = '';

  const confirmBtn = document.getElementById('btn-confirm-reject-offer');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.onclick = async () => {
      const reason = reasonInput ? reasonInput.value.trim() : '';
      confirmBtn.disabled = true;
      await executeRejectMarketOffer(offerId, listingId, characterName, reason);
      confirmBtn.disabled = false;
    };
  }

  openModal('modal-confirm-reject-offer');
}

async function executeRejectMarketOffer(offerId, listingId, characterName, reason) {
  try {
    const res = await Api.post(`/api/web/user/${encodeURIComponent(userPublicId)}/market/offers/${encodeURIComponent(offerId)}/reject`, {
      token: userSessionToken,
      ...(reason ? { reason } : {}),
    });
    if (res.success) {
      closeModal('modal-confirm-reject-offer');
      Api.showToast('Oferta negada.', '👎');
      openViewOffersModal(listingId, characterName);
      loadMyListings();
      updateMarketPendingBadge();
    } else {
      Api.showToast(res.error?.message || 'Falha ao negar oferta.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao negar oferta.', '❌');
  }
}

window.promptRejectMarketOffer = promptRejectMarketOffer;

function createMarketListingCard(listing) {
  if (listing?.id) {
    marketListingsMap.set(listing.id, listing);
  }
  const char = listing.character;
  const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
  const sellerName = listing.user?.name || 'Jogador';
  const isOwnListing = Boolean(userSessionData && listing.user?.publicId === userSessionData.publicId);

  const card = document.createElement('div');
  card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}`;
  card.style.borderColor = (char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color;

  const keys = listing.keys || char.keys || 1;
  const isSoulmate = Boolean(listing.isSoulmate || char.isSoulmate || keys >= 10);
  const keysBadgeHtml = isSoulmate
    ? `<div class="badge-keys" style="background: #ec4899; color: white; border-color: #f472b6;" title="💖 Soulmate (${keys} chaves)"><span>💖</span> <span>${keys}</span></div>`
    : `<div class="badge-keys" title="🔑 ${keys} chave(s)"><span>🔑</span> <span>${keys}</span></div>`;

  const listingAge = formatListingAge(listing.createdAt);
  const ageHtml = listingAge ? listingAge.html : '';

  card.innerHTML = `
    <div class="card-img-wrapper" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="Clique para ver detalhes">
      <img loading="lazy" decoding="async" src="${getCharImg(char)}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)">
      <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
        ${rarity.emoji} ${rarity.label}
      </div>
      ${keysBadgeHtml}
      ${isOwnListing ? `<div class="badge-married" style="background: #3b82f6; color: white; top: 8px; left: 8px;">SEU ANÚNCIO</div>` : ''}
    </div>
    <div class="card-info">
      <div class="card-name" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')">${escapeHtml(char.name)}</div>
      <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
      <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
        <i class="fas fa-user-tag"></i> Vendedor: <strong>${escapeHtml(sellerName)}</strong>
      </div>
      ${ageHtml}
      <div style="background: var(--bg-retro-accent); padding: 6px 8px; border-radius: 4px; font-size: 12px; margin: 8px 0; border: var(--border-retro); word-break: break-word;">
        <strong style="color: #f59e0b;"><i class="fas fa-search"></i> Procura:</strong> ${escapeHtml(listing.interest)}
      </div>
      <div class="card-actions" style="margin-top: 8px;">
        ${isOwnListing ? `
          <button class="btn-retro btn-sm" style="width: 100%; opacity: 0.8;" disabled>
            <i class="fas fa-check"></i> Seu Personagem
          </button>
        ` : `
          <button class="btn-retro btn-sm btn-gold" style="width: 100%;" onclick="openOfferModalById('${listing.id}')">
            <i class="fas fa-handshake"></i> Fazer Oferta
          </button>
        `}
      </div>
    </div>
  `;

  const imgEl = card.querySelector('.card-img-wrapper img');
  if (imgEl && Array.isArray(char.imageUrls) && char.imageUrls.length > 1) {
    initCardSlideshow(card, imgEl, char.imageUrls, false);
  }

  return card;
}

let marketWishlistListings = [];

async function loadWishlistMarket() {
  const section = document.getElementById('section-market-wishlist');
  const grid = document.getElementById('market-wishlist-grid');
  if (!section || !grid) return;

  if (!userSessionToken || !userPublicId) {
    section.classList.add('hidden');
    grid.innerHTML = '';
    return;
  }

  try {
    const res = await Api.get(`/api/web/user/${encodeURIComponent(userPublicId)}/market/wishlist-listings?token=${encodeURIComponent(userSessionToken)}`);
    if (!res.success || !Array.isArray(res.data) || res.data.length === 0) {
      section.classList.add('hidden');
      grid.innerHTML = '';
      marketWishlistListings = [];
      return;
    }

    marketWishlistListings = res.data;
    if (!window.marketWishlistCharIds) window.marketWishlistCharIds = new Set();
    marketWishlistListings.forEach(l => {
      if (l.characterId) window.marketWishlistCharIds.add(l.characterId);
      if (l.character?.id) window.marketWishlistCharIds.add(l.character.id);
    });

    grid.innerHTML = '';
    marketWishlistListings.forEach(listing => {
      grid.appendChild(createMarketListingCard(listing));
    });

    section.classList.remove('hidden');
  } catch (err) {
    console.error('Erro ao carregar wishlist nos classificados:', err);
    section.classList.add('hidden');
    grid.innerHTML = '';
  }
}

function getMarketPageLimit() {
  const grid = document.getElementById('global-market-grid');
  // Com o grid oculto (outra aba/subaba) o grid-template-columns não é resolvido e a
  // largura é 0: mantém o limite atual em vez de calcular um valor errado.
  if (!grid || grid.offsetParent === null || grid.clientWidth <= 0) {
    return marketState.limit || 10;
  }

  let cols = 0;
  const style = window.getComputedStyle(grid);
  const tracks = (style.getPropertyValue('grid-template-columns') || '').trim().split(/\s+/).filter(Boolean);
  if (tracks.length > 0 && tracks.every(t => /^[\d.]+px$/.test(t))) {
    // Grid visível: trilhas já resolvidas pelo navegador (mesmo cálculo do auto-fill do CSS)
    cols = tracks.length;
  } else {
    // Fallback pela largura útil do grid (mesmos mínimos do retro-theme.css)
    const isTablet = window.innerWidth <= 768;
    const gap = parseFloat(style.columnGap) || (isTablet ? 12 : 16);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const minCard = isTablet ? 160 : 180;
    cols = Math.max(1, Math.floor((grid.clientWidth - padding + gap) / (minCard + gap)));
  }

  // Mobile/retrato: 2 colunas x até 5 linhas = 10 itens; desktop: 2 linhas x N colunas
  return cols <= 2 ? 10 : cols * 2;
}

async function loadGlobalMarket() {
  const grid = document.getElementById('global-market-grid');
  if (!grid) return;

  // Só volta para a página 1 quando o tamanho da página realmente muda
  const newLimit = getMarketPageLimit();
  if (newLimit !== marketState.limit) {
    marketState.limit = newLimit;
    marketState.page = 1;
  }

  grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 28px;">Buscando classificados globais...</div>';

  try {
    const query = new URLSearchParams({
      search: marketState.search,
      sortBy: marketState.sortBy,
      page: marketState.page,
      limit: marketState.limit,
    });
    if (marketState.rarity) {
      query.append('rarity', marketState.rarity);
    }

    const res = await Api.get(`/api/web/user/${encodeURIComponent(userPublicId)}/market/listings?${query.toString()}`);
    if (!res.success || !res.data || !Array.isArray(res.data.listings) || res.data.listings.length === 0) {
      grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; color: var(--text-muted);">Nenhum anúncio encontrado nos classificados no momento.</div>';
      document.getElementById('market-page-info').textContent = 'Página 1 de 1';
      document.getElementById('btn-market-prev').disabled = true;
      document.getElementById('btn-market-next').disabled = true;
      return;
    }

    const { listings, total, page, totalPages } = res.data;
    marketState.page = page;
    marketState.totalPages = totalPages;

    document.getElementById('market-page-info').textContent = `Página ${page} de ${totalPages} (${total} anúncios)`;
    document.getElementById('btn-market-prev').disabled = page <= 1;
    document.getElementById('btn-market-next').disabled = page >= totalPages;

    grid.innerHTML = '';
    listings.forEach(listing => {
      grid.appendChild(createMarketListingCard(listing));
    });
  } catch (err) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 28px; color: var(--accent-red);">Erro ao carregar classificados globais.</div>';
  }
}

function emptyBuyerInventory() {
  return {
    runas: 0,
    rates: { runasPerZinthos: 0.2857, runasPerJardimCoin: 0.125 },
    fishingBuffs: [],
    farm: { coins: 0, items: [] }
  };
}

let liveBuyerInventory = emptyBuyerInventory();

// Limpa o inventário ao vivo para que dados de uma abertura anterior do modal
// não sejam usados em "Tudo"/envio quando a busca falhar.
function resetLiveBuyerInventory() {
  liveBuyerInventory = emptyBuyerInventory();
  window.activeBuffGroups = [];
  window.activeFarmItems = [];
}

function updateOfferRunasQuote() {
  const input = document.getElementById('offer-runas-input');
  const quoteEl = document.getElementById('offer-runas-quote-display');
  if (!input || !quoteEl) return;
  const val = Math.max(0, parseFloat(input.value) || 0);

  const rz = liveBuyerInventory.rates?.runasPerZinthos || 0.2857;
  const rj = liveBuyerInventory.rates?.runasPerJardimCoin || 0.125;

  const approxZinthos = rz > 0 ? Math.floor(val / rz) : 0;
  const approxPetalitas = rj > 0 ? Math.floor(val / rj) : 0;

  quoteEl.innerHTML = `<i class="fas fa-calculator" style="color: #f59e0b;"></i> Cotação do banco: <strong>≈ ${approxZinthos.toLocaleString('pt-BR')} Zinthos</strong> | <strong>≈ ${approxPetalitas.toLocaleString('pt-BR')} Petalitas</strong>`;
}

function setOfferRunasMax() {
  const input = document.getElementById('offer-runas-input');
  if (input) {
    input.value = Math.floor(liveBuyerInventory.runas || 0);
    updateOfferRunasQuote();
  }
}

function setOfferRunasZero() {
  const input = document.getElementById('offer-runas-input');
  if (input) {
    input.value = '0';
    updateOfferRunasQuote();
  }
}

function addOfferRunas(qty) {
  const input = document.getElementById('offer-runas-input');
  if (input) {
    const current = parseFloat(input.value) || 0;
    const maxVal = liveBuyerInventory.runas || 0;
    input.value = Math.min(maxVal, current + qty);
    updateOfferRunasQuote();
  }
}

function setOfferPetalitasMax() {
  const input = document.getElementById('offer-petalitas-input');
  if (input) {
    input.value = Math.floor(liveBuyerInventory.farm?.coins || 0);
  }
}

function setOfferPetalitasZero() {
  const input = document.getElementById('offer-petalitas-input');
  if (input) {
    input.value = '0';
  }
}

function addOfferPetalitas(qty) {
  const input = document.getElementById('offer-petalitas-input');
  if (input) {
    const current = parseFloat(input.value) || 0;
    const maxVal = liveBuyerInventory.farm?.coins || 0;
    input.value = Math.min(maxVal, current + qty);
  }
}

window.updateOfferRunasQuote = updateOfferRunasQuote;
window.setOfferRunasMax = setOfferRunasMax;
window.setOfferRunasZero = setOfferRunasZero;
window.addOfferRunas = addOfferRunas;
window.setOfferPetalitasMax = setOfferPetalitasMax;
window.setOfferPetalitasZero = setOfferPetalitasZero;
window.addOfferPetalitas = addOfferPetalitas;

function openOfferModalById(listingId) {
  const listing = marketListingsMap.get(listingId);
  if (!listing) {
    console.error('Anúncio não encontrado:', listingId);
    return;
  }
  const char = listing.character || {};
  openOfferModal(listing.id, char.name || 'Personagem', getCharImg(char), listing.interest || 'Sem preferências');
}
window.openOfferModalById = openOfferModalById;

async function openOfferModal(listingId, characterName, imageUrl, interest) {
  if ((!characterName || interest === undefined) && marketListingsMap.has(listingId)) {
    const l = marketListingsMap.get(listingId);
    const char = l.character || {};
    characterName = characterName || char.name || 'Personagem';
    imageUrl = imageUrl || getCharImg(char);
    interest = interest !== undefined ? interest : (l.interest || 'Sem preferências');
  }

  activeOfferListing = { id: listingId, name: characterName };
  document.getElementById('offer-target-name').textContent = characterName;
  document.getElementById('offer-target-interest').textContent = `Procura: ${interest}`;
  document.getElementById('offer-target-img').src = getCharImg(imageUrl);
  document.getElementById('offer-is-free-checkbox').checked = false;
  toggleFreeOffer(false);
  document.getElementById('offer-message-input').value = '';

  const auth = getActiveAuthUser();
  const token = auth.token || userSessionToken;
  const pId = auth.publicId || userPublicId || 'token-session';
  const buyerData = auth.isOwner ? userSessionData : (visitorSessionData || userSessionData);

  const zInput = document.getElementById('offer-zinthos-input');
  if (zInput) zInput.value = '0';
  if (typeof updateOfferZinthosSpreadNote === 'function') {
    updateOfferZinthosSpreadNote();
  }
  const balanceEl = document.getElementById('offer-user-zinthos-balance');
  if (balanceEl) {
    balanceEl.textContent = Number(buyerData?.kakera || 0).toLocaleString('pt-BR');
  }

  // 1. Popula Waifus disponíveis do harém do comprador (exceto Míticos e Bloqueadas), ordenado por Raridade > Chaves
  const waifusList = document.getElementById('offer-waifus-list');
  const harem = getEligibleUnlockedHaremEntries(buyerData?.harem || []);

  const offerSearchInput = document.getElementById('offer-waifus-search-input');
  if (offerSearchInput) offerSearchInput.value = '';
  const raritySelect = document.getElementById('offer-waifus-rarity-select');
  if (raritySelect) raritySelect.value = '';
  const covCb = document.getElementById('offer-waifus-coveted-checkbox');
  if (covCb) covCb.checked = false;
  const clearSearchBtn = document.getElementById('btn-clear-offer-waifus-search');
  if (clearSearchBtn) clearSearchBtn.classList.add('hidden');
  const emptySearchEl = document.getElementById('offer-waifus-empty-search');
  if (emptySearchEl) emptySearchEl.classList.add('hidden');
  const searchContainer = document.getElementById('offer-waifus-search-container');
  if (searchContainer) {
    searchContainer.style.display = harem.length === 0 ? 'none' : '';
  }

  const anyCoveted = harem.some(item => Number(item.activeCovetsCount || item.unseenCovetsCount || 0) > 0);
  const covLabel = document.getElementById('offer-waifus-coveted-label');
  if (covLabel) {
    covLabel.style.display = anyCoveted ? 'flex' : 'none';
  }

  if (harem.length === 0) {
    waifusList.innerHTML = '<div style="grid-column: 1 / -1; font-size: 12px; color: var(--text-muted); padding: 8px;">Você não possui waifus no harém para oferecer.</div>';
  } else {
    waifusList.innerHTML = harem.map(item => {
      const char = item.character;
      const k = item.keys || 1;
      const sm = k >= 10;
      const r = (char.baseRarity || char.rarity || 'COMMON').toUpperCase();
      const isCoveted = (Number(item.activeCovetsCount || item.unseenCovetsCount || 0) > 0) ? '1' : '0';
      return `
        <label class="offer-waifu-card" title="${escapeHtml(char.name)} (${sm ? '💖' : '🔑'} ${k})" data-name="${escapeHtml(char.name || '')}" data-series="${escapeHtml(char.series || '')}" data-rarity="${r}" data-coveted="${isCoveted}">
          <img decoding="async" src="${getCharImg(char)}" class="offer-waifu-img" onerror="handleImgError(this)" loading="lazy">
          <input type="checkbox" name="offer-waifu-cb" value="${escapeHtml(char.id)}" style="display: none;" onchange="this.closest('.offer-waifu-card').classList.toggle('is-selected', this.checked)">
          <div class="offer-waifu-overlay">
            <span class="offer-waifu-name">${escapeHtml(char.name)}</span>
            <span class="offer-waifu-keys" style="color: ${sm ? '#f472b6' : '#fde047'};">${sm ? '💖' : '🔑'}${k}</span>
          </div>
          <div class="offer-waifu-check">✓</div>
        </label>
      `;
    }).join('');
  }

  // Prepara placeholders enquanto carrega o inventário ao vivo
  const runasInput = document.getElementById('offer-runas-input');
  if (runasInput) runasInput.value = '0';
  const petalitasInput = document.getElementById('offer-petalitas-input');
  if (petalitasInput) petalitasInput.value = '0';

  const runasBalanceEl = document.getElementById('offer-user-runas-balance');
  if (runasBalanceEl) runasBalanceEl.textContent = 'Carregando...';
  const petalitasBalanceEl = document.getElementById('offer-user-petalitas-balance');
  if (petalitasBalanceEl) petalitasBalanceEl.textContent = 'Carregando...';

  const buffsList = document.getElementById('offer-buffs-list');
  if (buffsList) buffsList.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 12px; text-align: center;"><i class="fas fa-spinner fa-spin"></i> Carregando buffs de pesca ao vivo...</div>';

  const farmList = document.getElementById('offer-farm-list');
  if (farmList) farmList.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 12px; text-align: center;"><i class="fas fa-spinner fa-spin"></i> Carregando itens da fazenda ao vivo...</div>';

  openModal('modal-market-offer');

  resetLiveBuyerInventory();

  // Busca inventário ao vivo através do endpoint seguro
  try {
    const res = await Api.get(`/api/web/user/${encodeURIComponent(pId)}/market/my-inventory?token=${encodeURIComponent(token)}`);
    if (res.success && res.data) {
      liveBuyerInventory = res.data;

      // 2. Popula Runas e Cotação
      if (runasBalanceEl) {
        runasBalanceEl.textContent = `${Number(liveBuyerInventory.runas || 0).toLocaleString('pt-BR')} ᚱ`;
      }
      updateOfferRunasQuote();

      // 3. Popula Buffs Permanentes de Pesca (somente inventory_slot e max_baits)
      const rawBuffs = Array.isArray(liveBuyerInventory.fishingBuffs) ? liveBuyerInventory.fishingBuffs : [];
      const permanentBuffs = rawBuffs.filter(b => b.type === 'inventory_slot' || b.type === 'max_baits');
      const buffGroups = {};
      permanentBuffs.forEach(b => {
        const key = b.originalName || b.type || 'Buff';
        if (!buffGroups[key]) {
          buffGroups[key] = {
            name: key,
            type: b.type,
            description: b.description || (b.type === 'inventory_slot' ? 'Aumenta capacidade permanente da mochila de pesca' : 'Aumenta limite permanente de iscas simultâneas'),
            items: []
          };
        }
        buffGroups[key].items.push(b);
      });
      const buffGroupList = Object.values(buffGroups);

      if (buffGroupList.length === 0) {
        buffsList.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 12px; text-align: center;">Nenhum buff de pesca permanente (Slot de Mochila ou Iscas Extras) no seu inventário.</div>';
        window.activeBuffGroups = [];
      } else {
        window.activeBuffGroups = buffGroupList;
        buffsList.innerHTML = buffGroupList.map((bg, idx) => {
          const count = bg.items.length;
          return `
            <div style="display: flex; align-items: center; justify-content: space-between; border: var(--border-retro); padding: 8px 12px; border-radius: 4px; background: var(--bg-card); font-size: 12px;">
              <div>
                ⚡ <strong>${escapeHtml(bg.name)}</strong>
                <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(bg.description)} <span style="font-weight:700; color: #38bdf8;">(Estoque: ${count})</span></div>
              </div>
              <div class="retro-qty-control" style="display: flex; gap: 4px; align-items: center;">
                <button type="button" class="btn-retro btn-sm" onclick="adjustOfferBuffGroupQty(${idx}, -1, ${count})">-</button>
                <input type="number" min="0" max="${count}" id="buff-group-qty-${idx}" value="0" style="width: 55px; text-align: center;" oninput="onInputOfferBuffGroupQty(${idx}, ${count})">
                <button type="button" class="btn-retro btn-sm" onclick="adjustOfferBuffGroupQty(${idx}, 1, ${count})">+</button>
                <button type="button" class="btn-retro btn-sm btn-gold" onclick="setOfferBuffGroupAll(${idx}, ${count})" title="Oferecer tudo">Tudo</button>
              </div>
            </div>
          `;
        }).join('');
      }

      // 4. Popula Fazenda: Petalitas + Elixirs (verde) + Decorações (roxo)
      if (petalitasBalanceEl) {
        petalitasBalanceEl.textContent = Number(liveBuyerInventory.farm?.coins || 0).toLocaleString('pt-BR');
      }

      const farmData = liveBuyerInventory.farm;
      if (liveBuyerInventory.farmUnavailable) {
        farmList.innerHTML = '<div style="font-size: 12px; color: #f59e0b; padding: 12px; text-align: center;">⚠️ Inventário da fazenda temporariamente indisponível. Você ainda pode oferecer Waifus, Zinthos, Runas e Buffs.</div>';
        window.activeFarmItems = [];
      } else {
        const rawFarmItems = Array.isArray(farmData?.items) ? farmData.items : [];
        // Ordena: primeiro consumíveis / elixirs, depois sementes, depois decorações
        const farmTypeOrder = { consumable: 0, seed: 1, decoration: 2 };
        const sortedFarmItems = [...rawFarmItems].sort((a, b) => {
          const oA = farmTypeOrder[a.type] ?? 9;
          const oB = farmTypeOrder[b.type] ?? 9;
          if (oA !== oB) return oA - oB;
          return (a.name || a.itemId).localeCompare(b.name || b.itemId);
        });

        window.activeFarmItems = sortedFarmItems;

        if (sortedFarmItems.length === 0) {
          farmList.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 12px; text-align: center;">Nenhum elixir, semente ou decoração disponível no seu inventário da fazenda.</div>';
        } else {
          farmList.innerHTML = sortedFarmItems.map((it, idx) => {
            const maxQty = Math.max(1, Math.floor(Number(it.quantity) || 1));
            const isConsumable = it.type === 'consumable';
            const isSeed = it.type === 'seed';
            const borderColor = isConsumable ? '#10b981' : isSeed ? '#f59e0b' : '#a855f7';
            const icon = isConsumable ? '🧪' : isSeed ? '🌱' : '🪴';
            const typeLabel = isConsumable ? 'Elixir' : isSeed ? 'Semente' : 'Decoração';
            return `
              <div style="display: flex; align-items: center; justify-content: space-between; border: 2px solid ${borderColor}; padding: 8px 12px; border-radius: 4px; background: var(--bg-card); font-size: 12px;">
                <div>
                  ${icon} <strong>${escapeHtml(it.name || it.itemId)}</strong>
                  <span class="badge-tag" style="font-size: 10px; margin-left: 6px; padding: 1px 6px; border: 1px solid ${borderColor}; color: ${borderColor};">${typeLabel}</span>
                  <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Em estoque: <strong>${maxQty}</strong></div>
                </div>
                <div class="retro-qty-control" style="display: flex; gap: 4px; align-items: center;">
                  <button type="button" class="btn-retro btn-sm" onclick="adjustOfferFarmQty(${idx}, -1, ${maxQty})">-</button>
                  <input type="number" min="0" max="${maxQty}" id="farm-qty-${idx}" value="0" style="width: 55px; text-align: center;" oninput="onInputOfferFarmQty(${idx}, ${maxQty})">
                  <button type="button" class="btn-retro btn-sm" onclick="adjustOfferFarmQty(${idx}, 1, ${maxQty})">+</button>
                  <button type="button" class="btn-retro btn-sm btn-gold" onclick="setOfferFarmAll(${idx}, ${maxQty})" title="Oferecer tudo">Tudo</button>
                </div>
              </div>
            `;
          }).join('');
        }
      }
    } else {
      throw new Error(res.error?.message || 'Falha ao buscar inventário');
    }
  } catch (err) {
    resetLiveBuyerInventory();
    updateOfferRunasQuote();
    if (runasBalanceEl) runasBalanceEl.textContent = '0 ᚱ';
    if (petalitasBalanceEl) petalitasBalanceEl.textContent = '0';
    if (buffsList) buffsList.innerHTML = '<div style="font-size: 12px; color: var(--accent-red); padding: 12px; text-align: center;">Não foi possível carregar buffs ao vivo.</div>';
    if (farmList) farmList.innerHTML = '<div style="font-size: 12px; color: var(--accent-red); padding: 12px; text-align: center;">Não foi possível carregar itens da fazenda ao vivo.</div>';
  }
}

let selectedNewListingChar = null;

function getEligibleUnlockedHaremEntries(haremEntries, excludedCharIds = null) {
  return sortHaremCards(
    (haremEntries || []).filter(item => {
      const c = item?.character;
      if (!c?.id) return false;
      const isLocked = Boolean(item.isLocked || item.collection?.isLocked);
      const isMythic = Boolean(c.isMythic || c.rarity === 'MYTHIC' || c.baseRarity === 'MYTHIC');
      if (isLocked || isMythic) return false;
      if (excludedCharIds && excludedCharIds.has(c.id)) return false;
      return true;
    })
  );
}

function filterWaifuPickerGrid({ searchInputId, raritySelectId, covetedCheckboxId, clearBtnId, emptyElId, listElId, cardSelector = '.offer-waifu-card' }) {
  const searchInput = document.getElementById(searchInputId);
  const raritySelect = document.getElementById(raritySelectId);
  const covetedCheckbox = document.getElementById(covetedCheckboxId);
  const clearBtn = document.getElementById(clearBtnId);
  const emptyEl = document.getElementById(emptyElId);
  const listEl = document.getElementById(listElId);
  if (!listEl) return;

  const query = (searchInput?.value || '').trim();
  const selectedRarity = (raritySelect?.value || '').toUpperCase();
  const onlyCoveted = Boolean(covetedCheckbox?.checked);

  if (clearBtn) {
    clearBtn.classList.toggle('hidden', !query);
  }

  const cards = listEl.querySelectorAll(cardSelector);
  let visibleCount = 0;

  cards.forEach(card => {
    const name = card.dataset.name || '';
    const series = card.dataset.series || '';
    const rarity = (card.dataset.rarity || '').toUpperCase();
    const isCoveted = card.dataset.coveted === '1';

    let match = matchesTextFilter(query, name, series);
    if (match && selectedRarity) {
      match = rarity === selectedRarity;
    }
    if (match && onlyCoveted) {
      match = isCoveted;
    }

    if (match) {
      card.style.display = '';
      visibleCount++;
    } else {
      card.style.display = 'none';
    }
  });

  if (emptyEl) {
    if (cards.length > 0 && visibleCount === 0) {
      emptyEl.classList.remove('hidden');
    } else {
      emptyEl.classList.add('hidden');
    }
  }
}

function filterOfferWaifus() {
  filterWaifuPickerGrid({
    searchInputId: 'offer-waifus-search-input',
    raritySelectId: 'offer-waifus-rarity-select',
    covetedCheckboxId: 'offer-waifus-coveted-checkbox',
    clearBtnId: 'btn-clear-offer-waifus-search',
    emptyElId: 'offer-waifus-empty-search',
    listElId: 'offer-waifus-list',
  });
}

function clearOfferWaifusSearch() {
  const searchInput = document.getElementById('offer-waifus-search-input');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  filterOfferWaifus();
}

function openNewMarketListingPicker() {
  const listEl = document.getElementById('new-listing-waifus-list');
  if (!listEl) return;

  selectedNewListingChar = null;
  const proceedBtn = document.getElementById('btn-proceed-new-listing');
  if (proceedBtn) proceedBtn.disabled = true;

  const searchInput = document.getElementById('new-listing-waifus-search-input');
  if (searchInput) searchInput.value = '';
  const raritySelect = document.getElementById('new-listing-waifus-rarity-select');
  if (raritySelect) raritySelect.value = '';
  const covCb = document.getElementById('new-listing-waifus-coveted-checkbox');
  if (covCb) covCb.checked = false;
  const clearBtn = document.getElementById('btn-clear-new-listing-search');
  if (clearBtn) clearBtn.classList.add('hidden');
  const emptyEl = document.getElementById('new-listing-waifus-empty-search');
  if (emptyEl) emptyEl.classList.add('hidden');

  const listedIds = new Set([
    ...Array.from(activeMyListingsCharIds || []),
    ...(Array.isArray(userSessionData?.listedCharacterIds) ? userSessionData.listedCharacterIds : []),
  ]);

  const rawHarem = Array.isArray(userSessionData?.harem) && userSessionData.harem.length > 0
    ? userSessionData.harem
    : Array.from(haremEntryCache.values());
  const candidates = getEligibleUnlockedHaremEntries(rawHarem, listedIds);

  const searchContainer = document.getElementById('new-listing-search-container');
  if (searchContainer) {
    searchContainer.style.display = candidates.length === 0 ? 'none' : 'flex';
  }

  const infoEl = document.getElementById('new-listing-picker-info');
  if (infoEl) {
    infoEl.textContent = candidates.length > 0
      ? `Selecione uma waifu desbloqueada do seu harém para anunciar (${candidates.length} disponíveis):`
      : 'Nenhuma waifu desbloqueada disponível para anunciar no momento.';
  }

  if (candidates.length === 0) {
    listEl.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; font-size: 12px; color: var(--text-muted); padding: 16px;">Todas as suas waifus elegíveis estão bloqueadas ou já anunciadas nos classificados.</div>';
  } else {
    listEl.innerHTML = candidates.map(item => {
      const char = item.character;
      const k = item.keys || 1;
      const sm = k >= 10;
      const r = (char.baseRarity || char.rarity || 'COMMON').toUpperCase();
      const covetsCount = Number(item.activeCovetsCount || item.unseenCovetsCount || 0);
      const isCoveted = covetsCount > 0 ? '1' : '0';
      return `
        <label class="offer-waifu-card" data-char-id="${escapeHtml(char.id)}" title="${escapeHtml(char.name)} (${sm ? '💖' : '🔑'} ${k})" data-name="${escapeHtml(char.name || '')}" data-series="${escapeHtml(char.series || '')}" data-rarity="${r}" data-coveted="${isCoveted}" ondblclick="selectNewListingCandidate('${escapeHtml(char.id)}'); proceedNewMarketListing();">
          <img decoding="async" src="${getCharImg(char)}" class="offer-waifu-img" onerror="handleImgError(this)" loading="lazy">
          <input type="radio" name="new-listing-waifu-rb" value="${escapeHtml(char.id)}" style="display: none;" onchange="selectNewListingCandidate('${escapeHtml(char.id)}')">
          <div class="offer-waifu-overlay">
            <span class="offer-waifu-name">${escapeHtml(char.name)}</span>
            <span class="offer-waifu-keys" style="color: ${sm ? '#f472b6' : '#fde047'};">${covetsCount > 0 ? `👀${covetsCount} ` : ''}${sm ? '💖' : '🔑'}${k}</span>
          </div>
          <div class="offer-waifu-check">✓</div>
        </label>
      `;
    }).join('');
  }

  openModal('modal-market-new-listing-picker');
}

function selectNewListingCandidate(charId) {
  const entry = haremEntryCache?.get(charId) || (userSessionData?.harem || []).find(item => (item.character?.id || item.characterId) === charId);
  const char = entry?.character || null;
  selectedNewListingChar = char ? { id: char.id, name: char.name, imageUrl: char.imageUrl, imageUrls: char.imageUrls, series: char.series || '' } : { id: charId, name: charId, imageUrl: '/media/characters/default.jpg', series: '' };

  const listEl = document.getElementById('new-listing-waifus-list');
  if (listEl) {
    listEl.querySelectorAll('.offer-waifu-card').forEach(card => {
      card.classList.toggle('is-selected', card.dataset.charId === charId);
    });
  }

  const proceedBtn = document.getElementById('btn-proceed-new-listing');
  if (proceedBtn) proceedBtn.disabled = false;
}

function filterNewListingWaifus() {
  filterWaifuPickerGrid({
    searchInputId: 'new-listing-waifus-search-input',
    raritySelectId: 'new-listing-waifus-rarity-select',
    covetedCheckboxId: 'new-listing-waifus-coveted-checkbox',
    clearBtnId: 'btn-clear-new-listing-search',
    emptyElId: 'new-listing-waifus-empty-search',
    listElId: 'new-listing-waifus-list',
  });
}

function clearNewListingWaifusSearch() {
  const searchInput = document.getElementById('new-listing-waifus-search-input');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  filterNewListingWaifus();
}

function proceedNewMarketListing() {
  if (!selectedNewListingChar?.id) {
    Api.showToast('Selecione uma waifu para anunciar nos classificados.', '⚠️');
    return;
  }
  const target = selectedNewListingChar;
  closeModal('modal-market-new-listing-picker');
  openSellModal(target.id, target.name, getCharImg(target), target.series || '');
}

function adjustOfferBuffGroupQty(idx, delta, max) {
  const input = document.getElementById(`buff-group-qty-${idx}`);
  if (!input) return;
  let val = parseInt(input.value, 10) || 0;
  val = Math.max(0, Math.min(max, val + delta));
  input.value = val;
}

function setOfferBuffGroupAll(idx, max) {
  const input = document.getElementById(`buff-group-qty-${idx}`);
  if (input) input.value = Math.max(0, max);
}

function onInputOfferBuffGroupQty(idx, max) {
  const input = document.getElementById(`buff-group-qty-${idx}`);
  if (!input) return;
  let val = parseInt(input.value, 10);
  if (isNaN(val)) return;
  if (val < 0) input.value = 0;
  else if (val > max) input.value = max;
}

function adjustOfferFarmQty(farmIdx, delta, max) {
  const input = document.getElementById(`farm-qty-${farmIdx}`);
  if (!input) return;
  let val = parseInt(input.value, 10) || 0;
  val = Math.max(0, Math.min(max, val + delta));
  input.value = val;
}

function setOfferFarmAll(farmIdx, max) {
  const input = document.getElementById(`farm-qty-${farmIdx}`);
  if (input) input.value = Math.max(0, max);
}

function onInputOfferFarmQty(farmIdx, max) {
  const input = document.getElementById(`farm-qty-${farmIdx}`);
  if (!input) return;
  let val = parseInt(input.value, 10);
  if (isNaN(val)) return;
  if (val < 0) input.value = 0;
  else if (val > max) input.value = max;
}

function toggleFreeOffer(isFree) {
  const area = document.getElementById('offer-items-selection-area');
  if (area) {
    area.style.opacity = isFree ? '0.35' : '1';
    area.style.pointerEvents = isFree ? 'none' : 'auto';
  }
}

async function submitMarketOffer() {
  if (!activeOfferListing) return;

  const isFree = document.getElementById('offer-is-free-checkbox').checked;
  const message = document.getElementById('offer-message-input').value.trim();

  const selectedWaifuIds = Array.from(document.querySelectorAll('input[name="offer-waifu-cb"]:checked')).map(cb => cb.value);

  const selectedBuffs = [];
  if (Array.isArray(window.activeBuffGroups)) {
    window.activeBuffGroups.forEach((bg, idx) => {
      const input = document.getElementById(`buff-group-qty-${idx}`);
      const qty = parseInt(input?.value, 10) || 0;
      if (qty > 0) {
        for (let i = 0; i < qty && i < bg.items.length; i++) {
          const b = bg.items[i];
          selectedBuffs.push({
            id: b.id,
            originalName: b.originalName || bg.name,
            type: b.type,
            description: bg.description,
          });
        }
      }
    });
  }

  const farmItems = [];
  if (Array.isArray(window.activeFarmItems)) {
    window.activeFarmItems.forEach((it, idx) => {
      const qtyInput = document.getElementById(`farm-qty-${idx}`);
      const qty = parseInt(qtyInput?.value, 10) || 0;
      if (qty > 0) {
        farmItems.push({
          itemId: it.itemId,
          name: it.name || it.itemId,
          amount: qty,
        });
      }
    });
  }

  // Moedas: inteiros >= 0. Valores negativos/inválidos bloqueiam o envio;
  // frações são truncadas (e o campo é atualizado com o valor enviado).
  const amountFields = [
    { id: 'offer-zinthos-input', label: 'Zinthos' },
    { id: 'offer-runas-input', label: 'Runas' },
    { id: 'offer-petalitas-input', label: 'Petalitas' },
  ];
  const amounts = {};
  for (const field of amountFields) {
    const input = document.getElementById(field.id);
    const raw = Number(input?.value || 0);
    if (input?.validity?.badInput || !Number.isFinite(raw) || raw < 0) {
      Api.showToast(`Informe um valor válido para ${field.label} (número inteiro maior ou igual a 0).`, '⚠️');
      input?.focus();
      return;
    }
    amounts[field.label] = Math.max(0, Math.floor(raw));
    if (input && String(amounts[field.label]) !== String(input.value)) input.value = String(amounts[field.label]);
  }
  const netZinthos = amounts.Zinthos;
  const zinthos = netZinthos > 0 ? Math.ceil(netZinthos / 0.95) : 0;
  if (zinthos > getActiveBuyerKakera()) {
    Api.showToast('Saldo insuficiente de Zinthos para cobrir esta oferta (incluindo taxa de negociação).', '⚠️');
    return;
  }
  const runas = amounts.Runas;
  const petalitas = amounts.Petalitas;

  if (!isFree && selectedWaifuIds.length === 0 && selectedBuffs.length === 0 && farmItems.length === 0 && zinthos <= 0 && runas <= 0 && petalitas <= 0) {
    Api.showToast('Selecione ao menos um item, waifu, Zinthos, Runas ou Petalitas para oferecer (ou marque "Pedir de graça").', '⚠️');
    return;
  }

  const auth = getActiveAuthUser();
  if (!auth.token) {
    openModal('modal-public-offer-help');
    return;
  }

  const btn = document.getElementById('btn-submit-offer');
  btn.disabled = true;

  try {
    const res = await Api.post(`/api/web/user/${encodeURIComponent(auth.publicId || 'token-session')}/market/offers`, {
      token: auth.token,
      listingId: activeOfferListing.id,
      message,
      offeredItems: {
        isFree,
        zinthos,
        runas,
        petalitas,
        waifuIds: selectedWaifuIds,
        fishingBuffs: selectedBuffs,
        fishingBuffIds: selectedBuffs.map(b => b.id),
        farmItems,
      },
    });

    if (res.success) {
      closeModal('modal-market-offer');
      Api.showToast('Sua oferta foi enviada ao vendedor!', '🚀');
      loadMySentOffers();
    } else {
      Api.showToast(res.error?.message || 'Falha ao enviar oferta.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao enviar oferta.', '❌');
  } finally {
    btn.disabled = false;
  }
}

let mySentOffersState = {
  items: [],
  page: 1,
  pageSize: 20,
};

async function loadMySentOffers() {
  const tbody = document.getElementById('tbody-my-offers');
  if (!tbody) return;

  const auth = getActiveAuthUser();
  const token = auth.token || userSessionToken;
  const pId = auth.publicId || userPublicId || 'token-session';
  if (!token) {
    mySentOffersState.items = [];
    const countBadge = document.getElementById('my-sent-offers-count');
    if (countBadge) countBadge.textContent = '0';
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">Faça login pelo link do bot para ver as ofertas que você enviou.</td></tr>';
    return;
  }

  try {
    const res = await Api.get(`/api/web/user/${encodeURIComponent(pId)}/market/my-offers?token=${encodeURIComponent(token)}`);
    if (!res.success || !Array.isArray(res.data)) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--accent-red); padding: 20px;">Erro ao carregar histórico de ofertas.</td></tr>';
      return;
    }

    mySentOffersState.items = res.data;
    // Sempre a última oferta enviada (mais recente) no topo
    mySentOffersState.items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const countBadge = document.getElementById('my-sent-offers-count');
    if (countBadge) countBadge.textContent = mySentOffersState.items.length;

    renderMySentOffersPage();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--accent-red); padding: 20px;">Erro ao carregar histórico de ofertas.</td></tr>';
  }
}

function renderMySentOffersPage() {
  const tbody = document.getElementById('tbody-my-offers');
  if (!tbody) return;

  const total = mySentOffersState.items.length;
  const pageSize = mySentOffersState.pageSize || 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (mySentOffersState.page > totalPages) mySentOffersState.page = totalPages;
  if (mySentOffersState.page < 1) mySentOffersState.page = 1;

  const totalCountEl = document.getElementById('my-offers-total-count');
  if (totalCountEl) {
    totalCountEl.textContent = `${total} oferta${total === 1 ? '' : 's'}`;
  }
  const pageIndicator = document.getElementById('my-offers-page-indicator');
  if (pageIndicator) {
    pageIndicator.textContent = `${mySentOffersState.page} / ${totalPages}`;
  }
  const btnPrev = document.getElementById('btn-my-offers-prev');
  if (btnPrev) {
    btnPrev.disabled = mySentOffersState.page <= 1;
  }
  const btnNext = document.getElementById('btn-my-offers-next');
  if (btnNext) {
    btnNext.disabled = mySentOffersState.page >= totalPages;
  }

  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">Você não enviou nenhuma oferta até o momento.</td></tr>';
    return;
  }

  const startIdx = (mySentOffersState.page - 1) * pageSize;
  const pageItems = mySentOffersState.items.slice(startIdx, startIdx + pageSize);

  tbody.innerHTML = pageItems.map(offer => {
    const dateStr = new Date(offer.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    const charName = offer.listing?.character?.name || 'Personagem';
    const series = offer.listing?.character?.series ? ` (${escapeHtml(offer.listing.character.series)})` : '';
    const seller = offer.listing?.user?.name || 'Vendedor';

    const offered = offer.offeredItems || {};
    let summary = '';
    if (offered.isFree) {
      summary = '🎁 Pedido de graça (Doação)';
    } else {
      const parts = [];
      if (Array.isArray(offered.waifus) && offered.waifus.length > 0) {
        parts.push(`${offered.waifus.length} waifu(s)`);
      } else if (Array.isArray(offered.waifuIds) && offered.waifuIds.length > 0) {
        parts.push(`${offered.waifuIds.length} waifu(s)`);
      }
      const runasVal = offerAmount(offered.runas);
      if (runasVal !== 0) parts.push(formatOfferCurrencyText(runasVal, 'ᚱ', 'runas'));
      const petalitasVal = offerAmount(offered.petalitas);
      if (petalitasVal !== 0) parts.push(formatOfferCurrencyText(petalitasVal, '🌸', 'petalitas'));
      if (Array.isArray(offered.fishes) && offered.fishes.length > 0) parts.push(`${offered.fishes.length} peixe(s)`);
      if (Array.isArray(offered.fishingBuffs) && offered.fishingBuffs.length > 0) parts.push(`${offered.fishingBuffs.length} buff(s)`);
      if (Array.isArray(offered.farmItems) && offered.farmItems.length > 0) {
        const farmCount = offered.farmItems.reduce((acc, it) => acc + (Number(it.amount) || 1), 0);
        parts.push(`${farmCount} item(ns) da fazenda`);
      }
      const zinthosVal = offerAmount(offered.zinthos);
      if (zinthosVal !== 0) parts.push(formatOfferCurrencyText(zinthosVal, '🪙', 'zinthos'));
      summary = parts.join(', ') || 'Nenhum item';
    }

    let statusBadge = `<span class="badge-tag" style="background: #eab308; color: #000;">Pendente</span>`;
    if (offer.status === 'ACCEPTED') statusBadge = `<span class="badge-tag" style="background: #22c55e; color: #fff;">Aceita 🎉</span>`;
    if (offer.status === 'REJECTED') {
      const rejectReason = offer.cancelReason ? `<div style="font-size: 11px; color: var(--accent-red); margin-top: 4px; font-weight: 700;">Motivo: ${escapeHtml(offer.cancelReason)}</div>` : '';
      statusBadge = `<span class="badge-tag" style="background: #64748b; color: #fff;">Recusada 👎</span>${rejectReason}`;
    }
    if (offer.status === 'CANCELLED') {
      const reasonTooltip = offer.cancelReason ? ` - Motivo: ${escapeHtml(offer.cancelReason)}` : '';
      statusBadge = `<span class="badge-tag" style="background: #ef4444; color: #fff;" title="${escapeHtml(offer.cancelReason || '')}">Cancelada ⚠️${reasonTooltip}</span>`;
    }

    const actionCell = offer.status === 'PENDING'
      ? `<button type="button" class="btn-retro btn-sm btn-danger" data-action="cancel-sent-offer" data-offer-id="${escapeHtml(offer.id)}" title="Cancelar esta proposta para enviar outra"><i class="fas fa-ban"></i> Cancelar</button>`
      : `<span style="color: var(--text-muted); font-size: 12px;">—</span>`;

    return `
      <tr>
        <td style="white-space: nowrap; font-size: 12px;">${dateStr}</td>
        <td style="font-weight: 700;">${escapeHtml(charName)}${series}</td>
        <td>${escapeHtml(seller)}</td>
        <td style="font-size: 13px;">${escapeHtml(summary)}</td>
        <td>${statusBadge}</td>
        <td style="white-space: nowrap;">${actionCell}</td>
      </tr>
    `;
  }).join('');

  bindDataActions(tbody, {
    'cancel-sent-offer': (event, el) => {
      const offer = pageItems.find(o => String(o.id) === el.dataset.offerId);
      if (offer) promptCancelSentOffer(offer.id, offer.listing?.character?.name || 'Personagem');
    },
  });
}

function promptCancelSentOffer(offerId, characterName) {
  const charNameEl = document.getElementById('cancel-offer-char-name');
  if (charNameEl) charNameEl.textContent = characterName || 'personagem';

  const confirmBtn = document.getElementById('btn-confirm-cancel-offer');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      await executeCancelSentOffer(offerId);
      confirmBtn.disabled = false;
    };
  }

  openModal('modal-confirm-cancel-offer');
}

async function executeCancelSentOffer(offerId) {
  const auth = typeof getActiveAuthUser === 'function' ? getActiveAuthUser() : {};
  const token = auth.token || userSessionToken;
  const pId = auth.publicId || userPublicId || 'token-session';

  try {
    const res = await Api.post(`/api/web/user/${encodeURIComponent(pId)}/market/offers/${encodeURIComponent(offerId)}/cancel`, {
      token,
    });
    if (res.success) {
      closeModal('modal-confirm-cancel-offer');
      Api.showToast('Proposta cancelada! Você já pode enviar uma nova oferta.', '✅');
      loadMySentOffers();
      loadGlobalMarket();
    } else {
      Api.showToast(res.error?.message || 'Falha ao cancelar proposta.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao cancelar proposta.', '❌');
  }
}

window.promptCancelSentOffer = promptCancelSentOffer;

// Funções de controle de Zinthos no modal de oferta
function getActiveBuyerKakera() {
  const auth = typeof getActiveAuthUser === 'function' ? getActiveAuthUser() : { isOwner: true };
  const buyerData = auth.isOwner ? userSessionData : (visitorSessionData || userSessionData);
  return Number(buyerData?.kakera || 0);
}

function updateOfferZinthosSpreadNote() {
  const input = document.getElementById('offer-zinthos-input');
  const note = document.getElementById('offer-zinthos-spread-note');
  if (!note) return;
  const raw = input ? parseInt(input.value, 10) : 0;
  const net = Math.max(0, isNaN(raw) ? 0 : raw);
  const gross = net > 0 ? Math.ceil(net / 0.95) : 0;
  note.textContent = `Você irá pagar ${gross.toLocaleString('pt-BR')} nesta oferta e o usuário irá receber ${net.toLocaleString('pt-BR')} (taxa de negociação)`;
}
window.updateOfferZinthosSpreadNote = updateOfferZinthosSpreadNote;

function setOfferZinthosMax() {
  const maxGross = getActiveBuyerKakera();
  const maxReceivable = Math.max(0, Math.floor(maxGross * 0.95));
  const input = document.getElementById('offer-zinthos-input');
  if (input) input.value = maxReceivable;
  updateOfferZinthosSpreadNote();
}
window.setOfferZinthosMax = setOfferZinthosMax;

function setOfferZinthosZero() {
  const input = document.getElementById('offer-zinthos-input');
  if (input) input.value = '0';
  updateOfferZinthosSpreadNote();
}
window.setOfferZinthosZero = setOfferZinthosZero;

function addOfferZinthos(amount) {
  const input = document.getElementById('offer-zinthos-input');
  if (!input) return;
  const current = parseInt(input.value, 10) || 0;
  const maxGross = getActiveBuyerKakera();
  const maxReceivable = Math.max(0, Math.floor(maxGross * 0.95));
  input.value = Math.max(0, Math.min(maxReceivable, current + amount));
  updateOfferZinthosSpreadNote();
}
window.addOfferZinthos = addOfferZinthos;

// Cobiçar personagem casado
async function covetCharacter(characterId, btn, event) {
  if (event) event.stopPropagation();
  if (btn) btn.disabled = true;

  const auth = getActiveAuthUser();
  if (!auth.token) {
    openModal('modal-public-offer-help');
    if (btn) btn.disabled = false;
    return;
  }

  try {
    const res = await Api.post(`/api/web/user/${encodeURIComponent(auth.publicId || 'token-session')}/covet`, {
      token: auth.token,
      characterId,
    });

    if (res.success) {
      userCovetedSet.add(characterId);
      visitorWishlistSet.add(characterId);
      if (btn) {
        btn.innerHTML = '<i class="fas fa-check"></i> 👀 Cobiçado';
        btn.disabled = true;
      }
      Api.showToast('Você cobiçou o personagem! Ele também foi adicionado à sua Wishlist.', '👀');

      // Atualiza badge de wishes se presente na tela
      document.querySelectorAll(`.badge-wishes[data-char-id="${characterId}"]`).forEach(badge => {
        badge.classList.add('is-in-wishlist');
        const icon = badge.querySelector('span:first-child');
        if (icon) icon.textContent = '⭐';
      });
    } else {
      if (btn) btn.disabled = false;
      Api.showToast(res.error?.message || 'Falha ao cobiçar personagem.', '❌');
    }
  } catch (err) {
    if (btn) btn.disabled = false;
    Api.showToast('Erro de comunicação ao cobiçar.', '❌');
  }
}

// Modal de Interessados no Harém
async function openHaremCovetsModal(characterId, characterName, imageUrl, series) {
  activeCovetsChar = { id: characterId, name: characterName, imageUrl, series };
  const nameEl = document.getElementById('covets-char-name');
  if (nameEl) nameEl.textContent = characterName;

  const sellBtn = document.getElementById('btn-covets-sell-now');
  if (sellBtn) {
    sellBtn.onclick = () => {
      closeModal('modal-harem-covets');
      openSellModal(characterId, characterName, imageUrl || '/media/characters/default.jpg', series || '');
    };
  }

  const markAllBtn = document.getElementById('btn-covets-mark-all-seen');
  if (markAllBtn) {
    markAllBtn.onclick = () => markAllCovetsSeen(characterId);
  }

  openModal('modal-harem-covets');
  loadHaremCovetsTable(characterId);
}

async function loadHaremCovetsTable(characterId) {
  const tbody = document.getElementById('tbody-harem-covets');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 16px;"><i class="fas fa-spinner fa-spin"></i> Carregando interessados...</td></tr>';

  try {
    const res = await Api.get(`/api/web/user/${encodeURIComponent(userPublicId)}/harem/${encodeURIComponent(characterId)}/covets?token=${encodeURIComponent(userSessionToken)}`);
    if (!res.success || !Array.isArray(res.data) || res.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--text-muted);">Nenhum jogador cobiçou este personagem ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = res.data.map(covet => {
      const date = new Date(covet.createdAt).toLocaleDateString('pt-BR');
      let statusHtml = '<span class="badge-tag" style="background: #f59e0b; color: #000;">Novo</span>';
      if (covet.status === 'SEEN') statusHtml = '<span class="badge-tag" style="background: #3b82f6; color: #fff;">Visto</span>';
      if (covet.status === 'IGNORED') statusHtml = '<span class="badge-tag" style="background: #64748b; color: #fff;">Ignorado</span>';

      const isIgnored = covet.status === 'IGNORED';
      const profileBtn = covet.userPublicId
        ? `<a href="/user/${encodeURIComponent(covet.userPublicId)}" target="_blank" class="btn-retro btn-sm btn-gold" style="text-decoration:none; display:inline-flex; align-items:center; gap:4px; margin-right:4px; font-weight:800;" title="Ver perfil de ${escapeHtml(covet.userName)}"><i class="fas fa-user"></i> Ver Perfil</a>`
        : '';
      const actionBtn = !isIgnored
        ? `<button class="btn-retro btn-sm btn-danger" onclick="ignoreHaremCovet('${characterId}', '${covet.id}')"><i class="fas fa-eye-slash"></i> Ignorar</button>`
        : '<span style="color: var(--text-muted); font-size: 11px;">Ignorado</span>';

      const userNameHtml = covet.userPublicId
        ? `<a href="/user/${encodeURIComponent(covet.userPublicId)}" target="_blank" style="color: inherit; text-decoration: underline; font-weight: 800;" title="Ver perfil de ${escapeHtml(covet.userName)}">${escapeHtml(covet.userName)}</a>`
        : `<strong>${escapeHtml(covet.userName)}</strong>`;

      return `
        <tr>
          <td>${userNameHtml}</td>
          <td style="font-size: 12px; color: var(--text-muted);">${date}</td>
          <td>${statusHtml}</td>
          <td style="text-align: right; white-space: nowrap;">${profileBtn}${actionBtn}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 16px; color: var(--accent-red);">Erro ao carregar interessados.</td></tr>';
  }
}

async function ignoreHaremCovet(characterId, covetId) {
  try {
    const res = await Api.post(`/api/web/user/${encodeURIComponent(userPublicId)}/harem/${encodeURIComponent(characterId)}/covets/ignore`, {
      token: userSessionToken,
      covetId,
    });
    if (res.success) {
      Api.showToast('Interesse ignorado.', 'ℹ️');
      loadHaremCovetsTable(characterId);
      loadUserData();
    } else {
      Api.showToast(res.error?.message || 'Falha ao ignorar interesse.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação.', '❌');
  }
}

async function markAllCovetsSeen(characterId) {
  try {
    const res = await Api.post(`/api/web/user/${encodeURIComponent(userPublicId)}/harem/${encodeURIComponent(characterId)}/covets/seen-all`, {
      token: userSessionToken,
    });
    if (res.success) {
      Api.showToast('Marcado como visto!', '✨');
      loadHaremCovetsTable(characterId);
      loadUserData();
    } else {
      Api.showToast(res.error?.message || 'Falha ao marcar como visto.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação.', '❌');
  }
}

// ---------------------------------------------------------------------------
// Sistema de Investimento em Cotas de Waifus (Wishlist)
// ---------------------------------------------------------------------------
let currentInvestQuoteData = null;

async function openInvestModal(charId) {
  if (!userSessionToken || !userPublicId) {
    Api.showToast('Você precisa estar autenticado para investir.', '⚠️');
    return;
  }

  currentInvestQuoteData = null;
  const loadingEl = document.getElementById('invest-modal-loading');
  const contentEl = document.getElementById('invest-modal-content');
  const confirmBtn = document.getElementById('btn-confirm-invest');

  if (loadingEl) loadingEl.classList.remove('hidden');
  if (contentEl) contentEl.classList.add('hidden');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.5';
  }

  openModal('modal-invest');

  try {
    const res = await Api.get(
      `/api/web/user/${encodeURIComponent(userPublicId)}/market/quote/${encodeURIComponent(charId)}?token=${encodeURIComponent(userSessionToken)}`
    );

    if (!res.success || !res.data) {
      Api.showToast(res.error?.message || 'Erro ao carregar cotação do personagem.', '❌');
      closeModal('modal-invest');
      return;
    }

    currentInvestQuoteData = res.data;
    const char = res.data.character;
    const pricing = res.data.pricing;
    const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
    const userShares = Number(res.data.userShares || 0);
    const userKakera = Number(res.data.userKakera || userSessionData?.kakera || 0);

    // Atualiza elementos do modal
    const imgEl = document.getElementById('invest-modal-img');
    if (imgEl) imgEl.src = char.imageUrl || '/media/characters/default.jpg';

    const nameEl = document.getElementById('invest-modal-char-name');
    if (nameEl) nameEl.textContent = char.name;

    const seriesEl = document.getElementById('invest-modal-char-series');
    if (seriesEl) seriesEl.textContent = char.series || 'Sem série';

    const rarityEl = document.getElementById('invest-modal-char-rarity');
    if (rarityEl) {
      const rarityKey = RARITY_CONFIG[char.baseRarity] ? char.baseRarity.toLowerCase() : 'common';
      rarityEl.innerHTML = `<span style="color: var(--rarity-text-${rarityKey}, ${rarity.color}); font-weight: 800;">${rarity.emoji} ${rarity.label}</span>`;
    }

    const cotaPriceEl = document.getElementById('invest-modal-cota-price');
    if (cotaPriceEl) {
      cotaPriceEl.innerHTML = `${Number(pricing.cotaPrice).toLocaleString('pt-BR')} Zinthos ${pricing.discountPercent ? `<span style="color:#22c55e;font-size:12px;font-weight:800;margin-left:4px;">(${pricing.discountPercent}% OFF)</span>` : ''}`;
    }

    const totalPriceEl = document.getElementById('invest-modal-total-price');
    if (totalPriceEl) {
      totalPriceEl.textContent = `${Number(pricing.dynamicPrice).toLocaleString('pt-BR')} Zinthos`;
    }

    const userSharesEl = document.getElementById('invest-modal-user-shares');
    if (userSharesEl) {
      userSharesEl.textContent = `${userShares} / 4 cotas (${userShares * 25}%)${char.isOwner ? ` • Chave ${char.currentKeys}/10` : ''}`;
    }

    const userBalanceEl = document.getElementById('invest-modal-user-balance');
    if (userBalanceEl) {
      userBalanceEl.textContent = `${userKakera.toLocaleString('pt-BR')} Zinthos`;
    }

    // Configura o seletor de cotas disponíveis
    const select = document.getElementById('invest-modal-shares-select');
    const remainingShares = Math.max(0, 4 - userShares);

    if (select) {
      select.innerHTML = '';
      if (char.isSoulmate) {
        select.innerHTML = '<option value="0">💖 Soulmate (Vínculo Máximo Atingido)</option>';
        select.disabled = true;
      } else if (remainingShares === 0) {
        select.innerHTML = '<option value="0">Todas as 4 cotas já adquiridas</option>';
        select.disabled = true;
      } else {
        select.disabled = false;
        for (let i = 1; i <= remainingShares; i++) {
          const opt = document.createElement('option');
          opt.value = String(i);
          const pct = (userShares + i) * 25;
          let extraLabel = '';
          if (userShares + i === 4) {
            if (char.isOwner) {
              extraLabel = char.currentKeys >= 9 ? ' — 💖 Tornar-se Soulmate!' : ' — 🔑 +1 Chave';
            } else {
              extraLabel = ' — 💍 Casamento Imediato';
            }
          }
          opt.textContent = `${i} cota(s) (+${i * 25}% ➔ Total: ${pct}%)${extraLabel}`;
          select.appendChild(opt);
        }
      }
    }

    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');

    updateInvestModalTotal();
  } catch (err) {
    Api.showToast('Erro de comunicação ao consultar cotação.', '❌');
    closeModal('modal-invest');
  }
}

function updateInvestModalTotal() {
  if (!currentInvestQuoteData) return;

  const select = document.getElementById('invest-modal-shares-select');
  const shares = parseInt(select?.value || '1', 10);
  const cotaPrice = Number(currentInvestQuoteData.pricing?.cotaPrice || 0);
  const userKakera = Number(currentInvestQuoteData.userKakera || userSessionData?.kakera || 0);
  const userShares = Number(currentInvestQuoteData.userShares || 0);

  const subtotal = shares * cotaPrice;
  const subtotalEl = document.getElementById('invest-modal-subtotal');
  if (subtotalEl) {
    subtotalEl.textContent = `${subtotal.toLocaleString('pt-BR')} Zinthos`;
  }

  const warningEl = document.getElementById('invest-modal-balance-warning');
  const confirmBtn = document.getElementById('btn-confirm-invest');

  if (shares <= 0) {
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.style.background = '#9ca3af';
      confirmBtn.style.borderColor = '#6b7280';
      confirmBtn.style.color = '#374151';
      confirmBtn.style.cursor = 'not-allowed';
      confirmBtn.style.boxShadow = 'none';
      confirmBtn.innerHTML = '<i class="fas fa-check"></i> 100% Adquirido';
    }
    if (warningEl) warningEl.classList.add('hidden');
    return;
  }

  const hasEnoughBalance = userKakera >= subtotal;

  if (!hasEnoughBalance) {
    // Botão confirmar cinza e desabilitado se não tiver zinthos suficiente
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.style.background = '#9ca3af';
      confirmBtn.style.borderColor = '#6b7280';
      confirmBtn.style.color = '#374151';
      confirmBtn.style.cursor = 'not-allowed';
      confirmBtn.style.boxShadow = 'none';
      confirmBtn.innerHTML = '<i class="fas fa-coins"></i> Saldo Insuficiente';
    }

    if (warningEl) {
      const missing = subtotal - userKakera;
      warningEl.textContent = `⚠️ Saldo insuficiente para adquirir ${shares} cota(s). Faltam ${missing.toLocaleString('pt-BR')} Zinthos.`;
      warningEl.classList.remove('hidden');
    }
  } else {
    // Saldo suficiente: botão dourado/ativo
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.style.background = '';
      confirmBtn.style.borderColor = '';
      confirmBtn.style.color = '';
      confirmBtn.style.cursor = 'pointer';
      confirmBtn.style.boxShadow = '';
      confirmBtn.style.opacity = '1';

      const char = currentInvestQuoteData.character || {};
      if (userShares + shares >= 4) {
        if (char.isOwner) {
          confirmBtn.innerHTML = char.currentKeys >= 9
            ? '<i class="fas fa-heart"></i> Tornar-se Soulmate! (4 Cotas)'
            : '<i class="fas fa-key"></i> Confirmar +1 Chave (4 Cotas)';
        } else {
          confirmBtn.innerHTML = '<i class="fas fa-ring"></i> Confirmar Casamento (4 Cotas)';
        }
      } else {
        confirmBtn.innerHTML = `<i class="fas fa-coins"></i> Comprar ${shares} Cota(s)`;
      }
    }

    if (warningEl) {
      warningEl.classList.add('hidden');
    }
  }
}

async function confirmInvest() {
  if (!currentInvestQuoteData || !userSessionToken || !userPublicId) return;

  const select = document.getElementById('invest-modal-shares-select');
  const shares = parseInt(select?.value || '1', 10);
  const charId = currentInvestQuoteData.character?.id;
  const charName = currentInvestQuoteData.character?.name || 'Waifu';

  if (!shares || shares <= 0) return;

  const confirmBtn = document.getElementById('btn-confirm-invest');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando transação...';
  }

  try {
    const res = await Api.post(`/api/web/user/${encodeURIComponent(userPublicId)}/market/invest`, {
      token: userSessionToken,
      characterId: charId,
      shares,
    });

    if (!res.success) {
      Api.showToast(res.error?.message || 'Falha ao processar investimento.', '❌');
      if (confirmBtn) {
        confirmBtn.disabled = false;
        updateInvestModalTotal();
      }
      return;
    }

    // Atualiza saldo local e na interface
    if (typeof res.data.remainingKakera === 'number') {
      userSessionData.kakera = res.data.remainingKakera;
      const zinthos = Number(userSessionData.kakera || 0).toLocaleString('pt-BR');
      const zinthosEl = document.getElementById('user-zinthos');
      if (zinthosEl) zinthosEl.textContent = `${zinthos} zinthos`;
    }

    closeModal('modal-invest');

    if (res.data.becameSoulmate) {
      Api.showToast(`💖✨ Parabéns! ${charName} agora é sua Alma Gêmea (Soulmate)!`, '💖');
      setTimeout(() => loadUserData(), 600);
    } else if (res.data.keyEarned) {
      Api.showToast(`🔑 Parabéns! Você completou 4 cotas e ganhou +1 Chave com ${charName}! (Chaves: ${res.data.currentKeys}/10)`, '🔑');
      setTimeout(() => loadUserData(), 600);
    } else if (res.data.acquired) {
      Api.showToast(`💍 Parabéns! Você adquiriu as 4 cotas (100%) e se casou com ${charName}! 🎉`, '✨');
      setTimeout(() => loadUserData(), 600);
    } else {
      const isOwner = Boolean(res.data.isMarried);
      Api.showToast(`📈 Sucesso! Você adquiriu ${shares} cota(s) de ${charName}.${isOwner ? ` (${res.data.totalShares}/4 cotas para a próxima chave)` : ''}`, '✅');
      setTimeout(() => loadUserData(), 600);
    }
  } catch (err) {
    Api.showToast('Erro de comunicação durante a compra de cotas.', '❌');
    if (confirmBtn) {
      confirmBtn.disabled = false;
      updateInvestModalTotal();
    }
  }
}

// ========================================================
// RANKINGS GLOBAIS NO PAINEL DO USUÁRIO
// ========================================================
let userRankingsLoaded = false;
let userRankingsSearchTerm = '';

async function loadRankings(searchTerm = '') {
  const tbodyZinthos = document.getElementById('tbody-ranking-zinthos');
  const tbodyWaifus = document.getElementById('tbody-ranking-waifus');
  if (!tbodyZinthos || !tbodyWaifus) return;

  const cleanTerm = (searchTerm || '').trim();
  if (userRankingsLoaded && cleanTerm === userRankingsSearchTerm) return;
  userRankingsSearchTerm = cleanTerm;

  try {
    const searchParam = cleanTerm ? `&search=${encodeURIComponent(cleanTerm)}` : '';
    const [resUsers, resHarem] = await Promise.all([
      Api.get(`/leaderboard/users?limit=25${searchParam}`),
      Api.get(`/leaderboard/harem?limit=25${searchParam}`),
    ]);

    const isAuthenticated = Boolean(
      userSessionToken ||
      getCookie('waifu_session') ||
      localStorage.getItem('waifu_session') ||
      userSessionData
    );

    // 1. Ranking por Zinthos
    const topRich = resUsers?.data?.topRich || [];
    if (topRich.length === 0) {
      tbodyZinthos.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 20px;">${cleanTerm ? 'Nenhum jogador encontrado.' : 'Nenhum registro ainda.'}</td></tr>`;
    } else {
      tbodyZinthos.innerHTML = topRich
        .map((u, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`;
          const displayName = u.name;
          const isLinkable = isAuthenticated && !u.haremPrivate && Boolean(u.publicId);
          const nameHtml = isLinkable
            ? `<a href="/user/${u.publicId}" target="_blank" style="text-decoration:none; color:inherit; font-weight:800;">${escapeHtml(displayName)}</a>`
            : `<strong>${escapeHtml(displayName)}</strong>${u.haremPrivate ? ' <i class="fas fa-lock" style="font-size:10px; opacity:0.6; margin-left:3px;" title="Harém Privado"></i>' : ''}`;
          const zinthos = Number(u.kakera || 0).toLocaleString('pt-BR');
          const haremCount = u._count?.harem || 0;

          return `
            <tr>
              <td><span style="display:inline-block; min-width: 26px; font-weight: 800; margin-right: 4px;">${medal}</span> ${nameHtml}</td>
              <td style="text-align: right; font-weight: 700; color: #9333ea;">${zinthos}</td>
              <td style="text-align: center;">${haremCount}</td>
            </tr>
          `;
        })
        .join('');
    }

    // 2. Ranking por Waifus (Harém)
    const topHarem = resHarem?.data?.topHarem || [];
    if (topHarem.length === 0) {
      tbodyWaifus.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 20px;">${cleanTerm ? 'Nenhum harém encontrado.' : 'Nenhum registro ainda.'}</td></tr>`;
    } else {
      tbodyWaifus.innerHTML = topHarem
        .map((u, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`;
          const haremCustomName = u.haremName && String(u.haremName).trim();
          const displayName = haremCustomName ? haremCustomName : u.name;
          const titleAttr = haremCustomName ? ` title="Jogador: ${escapeHtml(u.name)}"` : '';
          const isLinkable = isAuthenticated && !u.haremPrivate && Boolean(u.publicId);
          const nameHtml = isLinkable
            ? `<a href="/user/${u.publicId}" target="_blank"${titleAttr} style="text-decoration:none; color:inherit; font-weight:800;">${escapeHtml(displayName)}</a>`
            : `<strong${titleAttr}>${escapeHtml(displayName)}</strong>${u.haremPrivate ? ' <i class="fas fa-lock" style="font-size:10px; opacity:0.6; margin-left:3px;" title="Harém Privado"></i>' : ''}`;
          const totalMarriages = Number(u.totalMarriages || 0).toLocaleString('pt-BR');
          const points = Number(u.collectionPoints || 0).toLocaleString('pt-BR');

          return `
            <tr>
              <td><span style="display:inline-block; min-width: 26px; font-weight: 800; margin-right: 4px;">${medal}</span> ${nameHtml}</td>
              <td style="text-align: center; font-weight: 700; color: #e11d48;">${totalMarriages} 💍</td>
              <td style="text-align: right; font-weight: 700;">${points} pts</td>
            </tr>
          `;
        })
        .join('');
    }

    userRankingsLoaded = true;
  } catch (err) {
    console.error('Erro ao carregar rankings no painel do usuário:', err);
    tbodyZinthos.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #ef4444; padding: 20px;">Erro ao carregar dados.</td></tr>`;
    tbodyWaifus.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #ef4444; padding: 20px;">Erro ao carregar dados.</td></tr>`;
  }
}

// ========================================================
// ABA: RESUMO DO HARÉM (DIÁRIO, DR, CUSTOS E ESTATÍSTICAS)
// ========================================================

let haremSummaryData = null;
let summaryCountdownInterval = null;

async function loadHaremSummary(forceRefresh = false) {
  if (haremSummaryData && !forceRefresh) {
    renderHaremSummary(haremSummaryData);
    return;
  }

  const loadingEl = document.getElementById('summary-loading');
  const contentEl = document.getElementById('summary-content');
  if (loadingEl) loadingEl.classList.remove('hidden');
  if (contentEl) contentEl.classList.add('hidden');

  try {
    const url = `/api/web/user/${encodeURIComponent(userPublicId)}/summary${userSessionToken ? `?token=${encodeURIComponent(userSessionToken)}` : ''}`;
    const res = await Api.get(url);
    if (!res.success) {
      if (loadingEl) {
        loadingEl.innerHTML = `
          <div style="color: #ef4444; font-weight: 800; padding: 20px;">
            <i class="fas fa-exclamation-triangle"></i> Falha ao carregar resumo: ${escapeHtml(res.error?.message || 'Erro desconhecido')}
          </div>
        `;
      }
      return;
    }

    haremSummaryData = res.data;
    renderHaremSummary(haremSummaryData);
  } catch (err) {
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div style="color: #ef4444; font-weight: 800; padding: 20px;">
          <i class="fas fa-exclamation-triangle"></i> Erro ao buscar resumo. Tente novamente mais tarde.
        </div>
      `;
    }
  } finally {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');
  }
}

function renderHaremSummary(data) {
  if (!data) return;

  // 1. Timers de Reset
  startSummaryCountdowns(data.dailyCycle?.secondsUntilReset, data.weeklyCycle?.secondsUntilReset);

  // 2. Divórcios Diários e Diminishing Returns
  const divBadge = document.getElementById('summary-divorces-today-badge');
  if (divBadge) {
    const totalDiv = data.divorces?.totalToday || 0;
    divBadge.textContent = `${totalDiv} hoje`;
    divBadge.style.background = totalDiv > 0 ? '#ef4444' : '#6b7280';
  }

  const raritiesListEl = document.getElementById('summary-divorce-rarities-list');
  if (raritiesListEl && data.divorces?.rarities) {
    const rarityLabels = {
      COMMON: { label: 'Comum', color: '#9ca3af', bg: 'rgba(156, 163, 175, 0.15)', border: '#4b5563' },
      UNCOMMON: { label: 'Incomum', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)', border: '#16a34a' },
      RARE: { label: 'Raro', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)', border: '#2563eb' },
      EPIC: { label: 'Épico', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)', border: '#9333ea' },
      LEGENDARY: { label: 'Lendário', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', border: '#d97706' },
    };

    let html = '';
    for (const [key, meta] of Object.entries(rarityLabels)) {
      const info = data.divorces.rarities[key] || { count: 0, currentRate: 1, nextRate: 1 };
      const nextRatePct = Math.round(info.nextRate * 100);

      let statusBadge = '';
      if (info.count === 0) {
        statusBadge = `<span class="badge-tag" style="background: #22c55e; color: #fff; font-weight: 700; font-size: 11px;">100% (Sem penalidade)</span>`;
      } else if (info.count < 4) {
        statusBadge = `<span class="badge-tag" style="background: #f59e0b; color: #000; font-weight: 700; font-size: 11px;">DR Ativo (${nextRatePct}% próx.)</span>`;
      } else {
        statusBadge = `<span class="badge-tag" style="background: #ef4444; color: #fff; font-weight: 700; font-size: 11px;">Penalidade Máxima (5%)</span>`;
      }

      html += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: ${meta.bg}; border: 1px solid ${meta.border}; border-radius: 6px; flex-wrap: wrap; gap: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 800; font-size: 12px; color: ${meta.color};">${meta.label}</span>
            <span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">• ${info.count} divórcio(s) hoje</span>
          </div>
          <div>${statusBadge}</div>
        </div>
      `;
    }
    raritiesListEl.innerHTML = html;
  }

  // 3. Rolls da Semana & DR de Lendários
  const legDR = data.weeklyLegendaryDR || {};
  const legCount = legDR.weeklyCount || 0;
  const legCap = legDR.hardCap || 8;
  const legMult = legDR.multiplier !== undefined ? legDR.multiplier : 1;
  const isBlocked = Boolean(legDR.isBlocked);

  const legCountText = document.getElementById('summary-legendary-count-text');
  if (legCountText) legCountText.textContent = `${legCount} / ${legCap}`;

  const legBar = document.getElementById('summary-legendary-progress-bar');
  if (legBar) {
    const pct = Math.min(100, Math.round((legCount / legCap) * 100));
    legBar.style.width = `${pct}%`;
    legBar.style.background = isBlocked ? '#ef4444' : legCount > 0 ? '#f59e0b' : '#22c55e';
  }

  const legMultText = document.getElementById('summary-legendary-mult-text');
  if (legMultText) {
    const multPct = Math.round(legMult * 100);
    legMultText.textContent = isBlocked ? '0% (Bloqueado)' : `${multPct}%`;
    legMultText.style.color = isBlocked ? '#ef4444' : legCount > 0 ? '#f59e0b' : '#22c55e';
  }

  const legBadge = document.getElementById('summary-legendary-status-badge');
  if (legBadge) {
    if (isBlocked) {
      legBadge.textContent = 'Hard Cap Atingido';
      legBadge.style.background = '#ef4444';
    } else if (legCount > 0) {
      legBadge.textContent = 'DR Ativo';
      legBadge.style.background = '#f59e0b';
    } else {
      legBadge.textContent = '100% Normal';
      legBadge.style.background = '#22c55e';
    }
  }

  const legWarning = document.getElementById('summary-legendary-warning');
  if (legWarning) {
    if (isBlocked) legWarning.classList.remove('hidden');
    else legWarning.classList.add('hidden');
  }

  // 4. Casamentos
  const marriages = data.marriages || {};
  const mToday = document.getElementById('summary-marriages-today');
  if (mToday) mToday.textContent = marriages.today ?? 0;
  const mWeek = document.getElementById('summary-marriages-week');
  if (mWeek) mWeek.textContent = marriages.thisWeek ?? 0;
  const mTotal = document.getElementById('summary-marriages-total');
  if (mTotal) mTotal.textContent = marriages.total ?? (userSessionData?.totalHarem || 0);

  // 5. Custos de Hospedagem
  const hCost = data.hostingCost || {};
  const hTotal = document.getElementById('summary-hosting-total-cost');
  if (hTotal) hTotal.textContent = Number(hCost.totalCost || 0).toLocaleString('pt-BR');

  const hBadge = document.getElementById('summary-hosting-status-badge');
  if (hBadge) {
    if (hCost.isInactive) {
      hBadge.textContent = `Inativo (${hCost.multiplier}x)`;
      hBadge.style.background = '#ef4444';
    } else {
      hBadge.textContent = 'Conta Ativa';
      hBadge.style.background = '#10b981';
    }
  }

  const hAutonomy = document.getElementById('summary-hosting-autonomy');
  if (hAutonomy) {
    const userKakera = Number(data.kakera || userSessionData?.kakera || 0);
    const dailyCost = Number(hCost.totalCost || 0);
    if (dailyCost <= 0) {
      hAutonomy.textContent = 'Sem custos';
      hAutonomy.style.color = '#10b981';
    } else {
      const days = Math.floor(userKakera / dailyCost);
      hAutonomy.textContent = `${days} dia(s)`;
      hAutonomy.style.color = days < 3 ? '#ef4444' : days < 7 ? '#f59e0b' : '#10b981';
    }
  }

  const hBreakdown = document.getElementById('summary-hosting-rarities-breakdown');
  if (hBreakdown && hCost.counts && hCost.costs) {
    const labels = {
      COMMON: 'Comum',
      UNCOMMON: 'Incomum',
      RARE: 'Raro',
      EPIC: 'Épico',
      LEGENDARY: 'Lendário',
    };
    let bHtml = '';
    for (const [r, label] of Object.entries(labels)) {
      const c = hCost.counts[r] || 0;
      const cost = hCost.costs[r] || 0;
      const rate = hCost.rates?.[r] || 0;
      if (c > 0) {
        bHtml += `
          <div style="display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px dashed var(--border-color, #374151);">
            <span>${label} (${c}x ${rate}z):</span>
            <span style="font-weight: 700; color: #f59e0b;">${Number(cost).toLocaleString('pt-BR')} z</span>
          </div>
        `;
      }
    }
    if (!bHtml) {
      bHtml = '<div style="color: var(--text-muted); font-style: italic;">Nenhuma waifu sujeita à taxa diária.</div>';
    }
    hBreakdown.innerHTML = bHtml;
  }

  // 6. Classificados & Mercado
  const market = data.market || {};
  const mActive = document.getElementById('summary-market-active');
  if (mActive) mActive.textContent = market.activeListings || 0;
  const mSold = document.getElementById('summary-market-sold');
  if (mSold) mSold.textContent = market.soldListings || 0;
  const mRec = document.getElementById('summary-market-offers-received');
  if (mRec) mRec.textContent = market.pendingOffersReceived || 0;
  const mSent = document.getElementById('summary-market-offers-sent');
  if (mSent) mSent.textContent = market.pendingOffersSent || 0;
}

function startSummaryCountdowns(dailySeconds, weeklySeconds) {
  if (summaryCountdownInterval) {
    clearInterval(summaryCountdownInterval);
  }

  let dSec = Math.max(0, parseInt(dailySeconds, 10) || 0);
  let wSec = Math.max(0, parseInt(weeklySeconds, 10) || 0);

  const updateDisplays = () => {
    const dailyEl = document.getElementById('summary-daily-reset-time');
    if (dailyEl) {
      const h = Math.floor(dSec / 3600);
      const m = Math.floor((dSec % 3600) / 60);
      const s = dSec % 60;
      dailyEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    const weeklyEl = document.getElementById('summary-weekly-reset-time');
    if (weeklyEl) {
      const days = Math.floor(wSec / 86400);
      const hours = Math.floor((wSec % 86400) / 3600);
      const minutes = Math.floor((wSec % 3600) / 60);
      weeklyEl.textContent = `${days}d ${hours}h ${minutes}m`;
    }

    if (dSec > 0) dSec--;
    if (wSec > 0) wSec--;
  };

  updateDisplays();
  summaryCountdownInterval = setInterval(updateDisplays, 1000);
}

// ========================================================
// ABA: PERSONAGENS MÍTICOS (CRIAÇÃO, EDIÇÃO, SLOTS, PREVIEW)
// ========================================================

let userMythicsList = [];
let userMythicSlotsData = { totalSlots: 0, usedSlots: 0, availableSlots: 0 };
let mythicPhotosState = []; // Array de strings (URLs ou DataURLs base64)
let mythicCropperInstance = null;

async function loadUserMythics() {
  if (!userSessionToken || !userPublicId) return;

  const grid = document.getElementById('mythics-grid');
  const countBadge = document.getElementById('mythics-count');
  const totalSlotsBadge = document.getElementById('mythics-total-slots');
  const usedSlotsEl = document.getElementById('mythic-slots-used');
  const totalSlotsEl = document.getElementById('mythic-slots-total');
  const btnCreate = document.getElementById('btn-open-create-mythic');

  if (grid) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 32px; color: var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Carregando seus personagens míticos...</div>';
  }

  try {
    const res = await Api.get(`/api/web/user/${encodeURIComponent(userPublicId)}/mythics?token=${encodeURIComponent(userSessionToken)}`);

    if (!res.success) {
      if (grid) grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 24px; color: #ef4444;">${escapeHtml(res.error?.message || 'Erro ao carregar míticos.')}</div>`;
      return;
    }

    userMythicSlotsData = res.data;
    userMythicsList = res.data.mythics || [];

    // Atualiza contadores
    if (countBadge) countBadge.textContent = userMythicSlotsData.usedSlots;
    if (totalSlotsBadge) totalSlotsBadge.textContent = userMythicSlotsData.totalSlots;
    if (usedSlotsEl) usedSlotsEl.textContent = userMythicSlotsData.usedSlots;
    if (totalSlotsEl) totalSlotsEl.textContent = userMythicSlotsData.totalSlots;

    if (btnCreate) {
      if (userMythicSlotsData.availableSlots > 0) {
        btnCreate.disabled = false;
        btnCreate.classList.remove('disabled');
        btnCreate.title = `Você tem ${userMythicSlotsData.availableSlots} slot(s) livre(s)!`;
      } else {
        btnCreate.disabled = true;
        btnCreate.classList.add('disabled');
        btnCreate.title = 'Todos os seus slots estão ocupados. Exclua um mítico ou doe para a Ravena (R$ 50) para liberar slots!';
      }
    }

    if (userMythicsList.length === 0) {
      if (grid) {
        grid.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; padding: 48px 20px; background: var(--bg-card); border: var(--border-retro); border-radius: 8px;">
            <div style="font-size: 42px; margin-bottom: 12px;">🔮</div>
            <h3 style="margin: 0 0 8px 0; font-size: 17px; font-weight: 800;">Nenhum Personagem Mítico Ainda</h3>
            <p style="margin: 0 0 16px 0; font-size: 13px; color: var(--text-muted); max-width: 450px; margin-left: auto; margin-right: auto;">
              ${userMythicSlotsData.availableSlots > 0
                ? `Você possui <strong>${userMythicSlotsData.availableSlots} slot(s) livre(s)</strong>! Clique em "Forjar Novo Mítico" acima para criar sua própria lenda no jogo.`
                : 'Você ainda não possui slots de mítico disponíveis. Faça um apoio/doação de <strong>R$ 50</strong> para a Ravena para desbloquear seu primeiro slot!'
              }
            </p>
            ${userMythicSlotsData.availableSlots > 0 ? `
              <button class="btn-retro btn-sm btn-gold" onclick="openCreateMythicModal()" style="font-weight: 800;">
                <i class="fas fa-plus"></i> Forjar Meu Primeiro Mítico
              </button>
            ` : ''}
          </div>
        `;
      }
      return;
    }

    if (grid) {
      grid.innerHTML = '';
      userMythicsList.forEach((char) => {
        grid.appendChild(createMythicCard(char));
      });
    }
  } catch (err) {
    console.error('Erro ao carregar míticos:', err);
    if (grid) grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 24px; color: #ef4444;">Erro de comunicação ao carregar míticos.</div>';
  }
}

function createMythicCard(char) {
  const card = document.createElement('div');
  const cust = char.mythicCustomization || {};
  const animType = cust.animationType || 'spin';

  card.className = `waifu-card mythic-card anim-${animType}`;
  card.id = `mythic-card-${char.id}`;
  card.style.setProperty('--mythic-border-color', cust.borderColor || '#ffd700');
  card.style.setProperty('--mythic-glow-color', cust.glowColor || '#c084fc');

  card.innerHTML = `
    <div class="card-img-wrapper" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="Clique para ver detalhes">
      <img loading="lazy" decoding="async" src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)">
    </div>
    <div class="card-info">
      <div class="card-name" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="${escapeHtml(char.name)}">${escapeHtml(char.name)}</div>
      <div class="mythic-bottom-badge" onclick="openWaifuPreview('${char.id}')" title="🔮 Personagem Mítico">🔮 Mítico</div>
      <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
      <div class="card-actions" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
        <button class="btn-retro btn-sm btn-gold" style="width: 100%; font-weight: 800;" onclick="openEditMythicModalById('${char.id}')">
          <i class="fas fa-edit"></i> Editar
        </button>
        <button class="btn-retro btn-sm btn-purple" style="width: 100%; font-weight: 800;" onclick="openChoosePhotoModal('${char.id}')">
          <i class="fas fa-camera"></i> Foto Fixa
        </button>
        <button class="btn-retro btn-sm btn-danger" style="width: 100%; font-weight: 800;" data-action="delete-mythic">
          <i class="fas fa-trash-alt"></i> Excluir (Liberar Slot)
        </button>
      </div>
    </div>
  `;

  bindDataActions(card, {
    'delete-mythic': () => confirmDeleteMythic(char.id, char.name),
  });

  const imgEl = card.querySelector('.card-img-wrapper img');
  if (imgEl && char.imageUrls && char.imageUrls.length > 1) {
    initCardSlideshow(card, imgEl, char.imageUrls, Boolean(char.pinnedPhoto));
  }

  return card;
}

function openCreateMythicModal() {
  if (userMythicSlotsData.availableSlots <= 0) {
    Api.showToast('Você não possui slots livres. Exclua um mítico ou doe para a Ravena para obter mais slots.', '⚠️');
    return;
  }

  document.getElementById('mythic-modal-title').textContent = '🔮 Forjar Personagem Mítico';
  document.getElementById('mythic-edit-char-id').value = '';
  document.getElementById('mythic-input-name').value = '';
  document.getElementById('mythic-input-series').value = '';
  document.getElementById('mythic-input-desc').value = '';
  document.getElementById('mythic-input-gender').value = 'FEMALE';
  document.getElementById('mythic-color-border').value = '#ffd700';
  document.getElementById('mythic-color-glow').value = '#c084fc';
  document.getElementById('mythic-select-animation').value = 'spin';
  document.getElementById('btn-save-mythic').innerHTML = '<i class="fas fa-magic"></i> Forjar Lenda Mítica';

  mythicPhotosState = [];
  cancelMythicCrop();
  renderMythicPhotoThumbnails();
  updateMythicPreview();
  openModal('modal-mythic-edit');
}

function openEditMythicModalById(charId) {
  const char = userMythicsList.find(m => m.id === charId);
  if (!char) {
    const haremEntry = haremEntryCache.get(charId);
    if (haremEntry && haremEntry.character) {
      openEditMythicModal(haremEntry.character);
      return;
    }
    Api.showToast('Personagem não encontrado.', '❌');
    return;
  }
  openEditMythicModal(char);
}

function openEditMythicModal(char) {
  document.getElementById('mythic-modal-title').textContent = '🔮 Editar Personagem Mítico';
  document.getElementById('mythic-edit-char-id').value = char.id;
  document.getElementById('mythic-input-name').value = char.name || '';
  document.getElementById('mythic-input-series').value = char.series || '';
  document.getElementById('mythic-input-desc').value = char.description || '';
  document.getElementById('mythic-input-gender').value = char.gender || 'FEMALE';

  const cust = char.mythicCustomization || {};
  document.getElementById('mythic-color-border').value = cust.borderColor || '#ffd700';
  document.getElementById('mythic-color-glow').value = cust.glowColor || '#c084fc';
  document.getElementById('mythic-select-animation').value = cust.animationType || 'spin';
  document.getElementById('btn-save-mythic').innerHTML = '<i class="fas fa-save"></i> Salvar Alterações';

  mythicPhotosState = Array.isArray(char.rawImageUrls)
    ? [...char.rawImageUrls]
    : Array.isArray(char.imageUrls) ? [...char.imageUrls] : [];

  cancelMythicCrop();
  renderMythicPhotoThumbnails();
  updateMythicPreview();
  openModal('modal-mythic-edit');
}

function renderMythicPhotoThumbnails() {
  const container = document.getElementById('mythic-photos-thumbnails');
  const countEl = document.getElementById('mythic-photos-count');
  if (countEl) countEl.textContent = mythicPhotosState.length;
  if (!container) return;

  container.innerHTML = '';
  if (mythicPhotosState.length === 0) {
    container.innerHTML = '<span style="grid-column: 1/-1; font-size: 11px; color: var(--text-muted); font-style: italic; align-self: center;">Nenhuma foto adicionada ainda (máximo 5).</span>';
    return;
  }

  mythicPhotosState.forEach((src, idx) => {
    const thumb = document.createElement('div');
    thumb.style.cssText = 'position: relative; width: 100%; aspect-ratio: 1/1; border: var(--border-retro); border-radius: 4px; overflow: hidden; background: #000;';
    thumb.innerHTML = `
      <img loading="lazy" decoding="async" src="${src}" style="width: 100%; height: 100%; object-fit: cover;">
      <button type="button" onclick="removeMythicPhoto(${idx})" style="position: absolute; top: 2px; right: 2px; background: rgba(220, 38, 38, 0.85); color: #fff; border: none; border-radius: 50%; width: 18px; height: 18px; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Remover foto">&times;</button>
      ${idx === 0 ? '<span style="position: absolute; bottom: 2px; left: 2px; background: #8b5cf6; color: #fff; font-size: 9px; font-weight: 800; padding: 1px 4px; border-radius: 2px;">Capa</span>' : ''}
    `;
    container.appendChild(thumb);
  });
}

function handleMythicFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (mythicPhotosState.length >= 5) {
    Api.showToast('Limite de 5 fotos atingido por personagem.', '⚠️');
    event.target.value = '';
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    Api.showToast('A imagem enviada é muito grande! Compacte ela antes', '⚠️');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target?.result;
    if (!dataUrl) return;

    const cropperContainer = document.getElementById('mythic-cropper-container');
    const cropperImg = document.getElementById('mythic-cropper-img');
    if (!cropperContainer || !cropperImg) {
      mythicPhotosState.push(String(dataUrl));
      renderMythicPhotoThumbnails();
      updateMythicPreview();
      return;
    }

    cropperImg.src = dataUrl;
    cropperContainer.classList.remove('hidden');

    if (mythicCropperInstance) {
      mythicCropperInstance.destroy();
      mythicCropperInstance = null;
    }

    // Inicializa Cropper.js com proporção 225x350 (9/14 - proporção padrão de cards Waifuletes/Mudae)
    mythicCropperInstance = new Cropper(cropperImg, {
      aspectRatio: 225 / 350,
      viewMode: 1,
      autoCropArea: 0.95,
      preview: '#mythic-crop-preview',
      responsive: true,
    });

    cropperContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function applyMythicCrop() {
  if (!mythicCropperInstance) return;

  if (mythicPhotosState.length >= 5) {
    Api.showToast('Limite de 5 fotos atingido por personagem.', '⚠️');
    cancelMythicCrop();
    return;
  }

  const canvas = mythicCropperInstance.getCroppedCanvas({ width: 450, height: 700 });
  if (!canvas) {
    Api.showToast('Erro ao recortar imagem.', '❌');
    return;
  }

  const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
  mythicPhotosState.push(croppedDataUrl);

  cancelMythicCrop();
  renderMythicPhotoThumbnails();
  updateMythicPreview();
  Api.showToast('Foto recortada e adicionada com sucesso!', '✂️');
}

function cancelMythicCrop() {
  if (mythicCropperInstance) {
    mythicCropperInstance.destroy();
    mythicCropperInstance = null;
  }
  const cropperContainer = document.getElementById('mythic-cropper-container');
  if (cropperContainer) {
    cropperContainer.classList.add('hidden');
  }
  const fileInput = document.getElementById('mythic-file-input');
  if (fileInput) fileInput.value = '';
}

function addMythicPhotoUrl() {
  const input = document.getElementById('mythic-url-input');
  const url = input?.value?.trim();
  if (!url) return;

  if (mythicPhotosState.length >= 5) {
    Api.showToast('Limite de 5 fotos atingido por personagem.', '⚠️');
    return;
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    Api.showToast('Por favor, insira uma URL válida iniciando com http:// ou https://', '⚠️');
    return;
  }

  mythicPhotosState.push(url);
  input.value = '';
  renderMythicPhotoThumbnails();
  updateMythicPreview();
}

function removeMythicPhoto(index) {
  mythicPhotosState.splice(index, 1);
  renderMythicPhotoThumbnails();
  updateMythicPreview();
}

function applyMythicPreset(type, value) {
  if (type === 'border') {
    const input = document.getElementById('mythic-color-border');
    if (input) input.value = value;
  } else if (type === 'glow') {
    const input = document.getElementById('mythic-color-glow');
    if (input) input.value = value;
  }
  updateMythicPreview();
}

function updateMythicPreview() {
  const container = document.getElementById('mythic-preview-card-container');
  if (!container) return;

  const name = document.getElementById('mythic-input-name')?.value?.trim() || 'Nome da Lenda';
  const series = document.getElementById('mythic-input-series')?.value?.trim() || 'Obra / Universo';
  const borderColor = document.getElementById('mythic-color-border')?.value || '#ffd700';
  const glowColor = document.getElementById('mythic-color-glow')?.value || '#c084fc';
  const animType = document.getElementById('mythic-select-animation')?.value || 'spin';
  const photo = mythicPhotosState[0] || '/media/characters/default.jpg';

  container.innerHTML = `
    <div class="waifu-card mythic-card anim-${animType}" style="--mythic-border-color: ${borderColor}; --mythic-glow-color: ${glowColor}; width: 100%;">
      <div class="card-img-wrapper" style="height: 240px;">
        <img loading="lazy" decoding="async" src="${photo}" alt="${escapeHtml(name)}" onerror="handleImgError(this)" style="width: 100%; height: 100%; object-fit: cover;">
      </div>
      <div class="card-info" style="padding: 10px;">
        <div class="card-name" style="font-weight: 800; font-size: 14px;">${escapeHtml(name)}</div>
        <div class="mythic-bottom-badge" style="font-size: 10px; margin: 3px auto 5px auto;">🔮 Mítico</div>
        <div class="card-series" style="font-size: 11px;">${escapeHtml(series)}</div>
      </div>
    </div>
  `;
}

async function saveMythicCharacter() {
  const charId = document.getElementById('mythic-edit-char-id')?.value;
  const name = document.getElementById('mythic-input-name')?.value?.trim();
  const series = document.getElementById('mythic-input-series')?.value?.trim();
  const description = document.getElementById('mythic-input-desc')?.value?.trim();
  const gender = document.getElementById('mythic-input-gender')?.value || 'FEMALE';
  const borderColor = document.getElementById('mythic-color-border')?.value || '#ffd700';
  const glowColor = document.getElementById('mythic-color-glow')?.value || '#c084fc';
  const animationType = document.getElementById('mythic-select-animation')?.value || 'spin';

  if (!name || name.length < 2) {
    Api.showToast('Informe um nome com pelo menos 2 caracteres.', '⚠️');
    return;
  }

  const payload = {
    token: userSessionToken,
    name,
    series: series || undefined,
    description: description || undefined,
    gender,
    photos: mythicPhotosState,
    customization: {
      borderColor,
      glowColor,
      animationType,
    },
  };

  const isEditing = Boolean(charId);
  Api.showLoading(isEditing ? 'Salvando alterações...' : 'Forjando sua lenda...', 'Gravando dados do personagem mítico no servidor...');

  try {
    const url = isEditing
      ? `/api/web/user/${encodeURIComponent(userPublicId)}/mythics/${encodeURIComponent(charId)}`
      : `/api/web/user/${encodeURIComponent(userPublicId)}/mythics`;

    const res = isEditing
      ? await Api.put(url, payload)
      : await Api.post(url, payload);

    if (!res.success) {
      Api.showToast(res.error?.message || 'Falha ao salvar mítico.', '❌');
      return;
    }

    Api.showToast(isEditing ? 'Lenda atualizada com sucesso!' : '🔮 Personagem Mítico forjado com sucesso!', '✨');
    closeModal('modal-mythic-edit');
    loadUserMythics();
    loadUserData();
  } catch (err) {
    Api.showToast('Erro de comunicação ao salvar mítico.', '❌');
  } finally {
    Api.hideLoading();
  }
}

async function confirmDeleteMythic(charId, charName) {
  const confirmed = await Api.showConfirm({
    icon: '🐉',
    title: 'Excluir Personagem Mítico',
    message: `Tem certeza que deseja excluir o mítico "${charName}"?`,
    notice: 'Esta ação apagará permanentemente o personagem do jogo e liberará o slot para você criar uma nova lenda.',
    noticeTone: 'danger',
    confirmText: 'Excluir Mítico',
    confirmClass: 'btn-danger'
  });
  if (!confirmed) return;

  Api.showLoading('Excluindo mítico...', 'Removendo personagem e liberando seu slot...');
  try {
    const res = await Api.delete(`/api/web/user/${encodeURIComponent(userPublicId)}/mythics/${encodeURIComponent(charId)}?token=${encodeURIComponent(userSessionToken)}`);

    if (!res.success) {
      Api.showToast(res.error?.message || 'Falha ao excluir mítico.', '❌');
      return;
    }

    Api.showToast('🔮 Mítico excluído com sucesso! Seu slot foi liberado.', '✅');
    loadUserMythics();
    loadUserData();
  } catch (err) {
    Api.showToast('Erro de comunicação ao excluir mítico.', '❌');
  } finally {
    Api.hideLoading();
  }
}

/**
 * Renderiza o Badge de Custo de Hospedagem Diária e seus tooltips/popups interativos
 */
function renderHostingCostBadge(hostingCost, isPublic = false) {
  const prefix = isPublic ? 'public-' : '';
  const badge = document.getElementById(`${prefix}harem-hosting-badge`);
  const textEl = document.getElementById(`${prefix}harem-hosting-text`);
  const statusEl = document.getElementById(`${prefix}hosting-tooltip-status`);
  const bodyEl = document.getElementById(`${prefix}hosting-tooltip-body`);

  if (!badge || !textEl || !bodyEl) return;

  if (!hostingCost) {
    badge.style.display = 'none';
    return;
  }

  badge.style.display = 'inline-flex';

  const totalCost = Number(hostingCost.totalCost || 0).toLocaleString('pt-BR');
  textEl.textContent = `Custo atual da hospedagem: ${totalCost} zinthos/dia`;

  if (hostingCost.isInactive) {
    badge.classList.add('inactive-mode');
    if (statusEl) {
      statusEl.textContent = 'Hospedagem (Jogador Inativo > 72h)';
      statusEl.style.color = '#ef4444';
    }
  } else {
    badge.classList.remove('inactive-mode');
    if (statusEl) {
      statusEl.textContent = 'Hospedagem Diária (Jogador Ativo)';
      statusEl.style.color = '#15803d';
    }
  }

  const counts = hostingCost.counts || {};
  const costs = hostingCost.costs || {};
  const rates = hostingCost.rates || {};

  const rarityMeta = [
    { key: 'COMMON', label: 'Comum', emoji: '⚪', color: '#94a3b8' },
    { key: 'UNCOMMON', label: 'Incomum', emoji: '🟢', color: '#22c55e' },
    { key: 'RARE', label: 'Raro', emoji: '🔵', color: '#3b82f6' },
    { key: 'EPIC', label: 'Épico', emoji: '🟣', color: '#a855f7' },
    { key: 'LEGENDARY', label: 'Lendário', emoji: '⭐', color: '#eab308' },
  ];

  let rowsHtml = '';
  rarityMeta.forEach(r => {
    const qty = counts[r.key] || 0;
    const rate = rates[r.key] || 0;
    const cost = Number(costs[r.key] || 0).toLocaleString('pt-BR');
    rowsHtml += `
      <div class="hosting-row">
        <span>${r.emoji} <strong>${r.label}:</strong> ${qty} waifus (${rate}z/un)</span>
        <span style="font-weight: 700;">${cost}z</span>
      </div>
    `;
  });

  const totalWaifus = hostingCost.totalWaifus !== undefined ? hostingCost.totalWaifus : Object.values(counts).reduce((a, b) => a + b, 0);

  rowsHtml += `
    <div class="hosting-row-total">
      <span>Total (${totalWaifus} waifus):</span>
      <span style="color: #9333ea;">${totalCost} zinthos/dia</span>
    </div>
    <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px; font-style: italic;">
      ${hostingCost.isInactive ? `⚠️ Taxa de inatividade aplicada (> 72h offline${hostingCost.extraDays > 0 ? `, +${hostingCost.extraDays}d extras: +${hostingCost.extraDays * 10}%` : ''}).` : '✨ Cobrado no reset diário (04:00 BRT).'}
    </div>
  `;

  bodyEl.innerHTML = rowsHtml;

  // Suporte a toque no Mobile (alterna classe active-touch)
  badge.onclick = (e) => {
    // Previne fechar imediatamente se clicar dentro do tooltip
    if (e.target.closest('.harem-hosting-tooltip')) return;
    badge.classList.toggle('active-touch');
  };
}

// Fecha tooltip do mobile ao clicar fora
document.addEventListener('click', (e) => {
  if (!e.target.closest('.harem-hosting-badge')) {
    document.querySelectorAll('.harem-hosting-badge.active-touch').forEach(el => {
      el.classList.remove('active-touch');
    });
  }
});

/**
 * Renderiza os itens da lista de navegação rápida de coleções do harém
 */
function updateHaremCollectionsNav(collections, haremEntries, isPublic = false) {
  const prefix = isPublic ? 'public-' : '';
  const badge = document.getElementById(`${prefix}harem-collections-nav-badge`);
  const listEl = document.getElementById(`${prefix}harem-collections-nav-list`);
  if (!badge || !listEl) return;

  const validCollections = Array.isArray(collections) ? collections : [];
  const allEntries = Array.isArray(haremEntries) ? haremEntries : [];
  const favCount = allEntries.filter(e => e.isFavorite && !e.character?.isMythic).length;
  const generalCount = allEntries.filter(e => !e.collectionId && !e.character?.isMythic).length;

  if (allEntries.length === 0 || (validCollections.length === 0 && favCount === 0)) {
    badge.classList.add('hidden');
    return;
  }
  badge.classList.remove('hidden');

  if (validCollections.length === 0 && favCount === 0) {
    listEl.innerHTML = `
      <div style="color: var(--text-muted); font-size: 12px; font-style: italic; padding: 8px; text-align: center;">
        Nenhuma coleção criada ainda.
      </div>
    `;
    return;
  }

  let itemsHtml = '';

  // Atalho para Favoritas se houver
  if (favCount > 0) {
    const favTarget = isPublic ? 'public-favorites-section' : 'private-favorites-section';
    itemsHtml += `
      <div class="harem-nav-collection-item" data-col-target="${favTarget}">
        <span class="harem-nav-col-name"><i class="fas fa-star" style="color: #facc15;"></i> ⭐ Favoritas</span>
        <span class="harem-nav-col-count badge-tag" style="background: #f59e0b; color: #000;">${favCount}</span>
      </div>
    `;
  }

  // Coleções do usuário
  validCollections.forEach(col => {
    const colCount = allEntries.filter(e => e.collectionId === col.id && !e.character?.isMythic).length;
    const targetId = isPublic ? `public-collection-block-${col.id}` : `collection-block-${col.id}`;
    itemsHtml += `
      <div class="harem-nav-collection-item" data-col-target="${targetId}">
        <span class="harem-nav-col-name"><i class="fas fa-folder"></i> ${escapeHtml(col.name)}</span>
        <span class="harem-nav-col-count badge-tag" style="background: #3b82f6; color: #fff;">${colCount}</span>
      </div>
    `;
  });

  // Atalho para Harém Geral
  const generalTarget = isPublic ? 'public-harem-section-title' : 'private-harem-general-title';
  itemsHtml += `
    <div class="harem-nav-collection-item" data-col-target="${generalTarget}">
      <span class="harem-nav-col-name"><i class="fas fa-ring"></i> Harém Geral</span>
      <span class="harem-nav-col-count badge-tag">${generalCount}</span>
    </div>
  `;

  listEl.innerHTML = itemsHtml;

  // Adiciona evento de clique em cada item
  listEl.querySelectorAll('.harem-nav-collection-item').forEach(item => {
    item.onclick = (e) => {
      e.stopPropagation();
      const targetId = item.dataset.colTarget;
      badge.classList.remove('is-active', 'active-touch');
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        targetEl.classList.add('collection-highlight-pulse');
        setTimeout(() => targetEl.classList.remove('collection-highlight-pulse'), 1500);
      }
    };
  });
}

/**
 * Configura listeners de hover com debounce (1s) e clique mobile para o botão de navegação de coleções
 */
function setupHaremCollectionsNavEvents(isPublic = false) {
  const prefix = isPublic ? 'public-' : '';
  const badge = document.getElementById(`${prefix}harem-collections-nav-badge`);
  const tooltip = document.getElementById(`${prefix}harem-collections-nav-tooltip`);
  if (!badge || !tooltip) return;

  let hideTimer = null;

  const showNav = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    badge.classList.add('is-active');
  };

  const scheduleHide = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      badge.classList.remove('is-active');
      hideTimer = null;
    }, 1000);
  };

  // Hover desktop no botão e no tooltip
  badge.addEventListener('mouseenter', showNav);
  badge.addEventListener('mouseleave', scheduleHide);
  tooltip.addEventListener('mouseenter', showNav);
  tooltip.addEventListener('mouseleave', scheduleHide);

  // Toque / clique no mobile
  badge.addEventListener('click', (e) => {
    if (e.target.closest('.harem-collections-nav-tooltip')) return;
    const isActive = badge.classList.contains('active-touch') || badge.classList.contains('is-active');
    if (isActive) {
      badge.classList.remove('active-touch', 'is-active');
      if (hideTimer) clearTimeout(hideTimer);
    } else {
      showNav();
      badge.classList.add('active-touch');
    }
  });

  // Fecha ao clicar fora
  document.addEventListener('click', (e) => {
    if (!e.target.closest(`#${prefix}harem-collections-nav-badge`)) {
      badge.classList.remove('active-touch', 'is-active');
      if (hideTimer) clearTimeout(hideTimer);
    }
  });
}




