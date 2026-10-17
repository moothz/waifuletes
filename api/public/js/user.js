// js/user.js - Lógica da Página do Usuário (Harém Público & Painel Privado com Sugestões e Recorte)

const RARITY_CONFIG = {
  COMMON:    { emoji: '⚪', label: 'Comum',    color: '#94a3b8' },
  UNCOMMON:  { emoji: '🟢', label: 'Incomum',  color: '#22c55e' },
  RARE:      { emoji: '🔵', label: 'Raro',     color: '#3b82f6' },
  EPIC:      { emoji: '🟣', label: 'Épico',    color: '#a855f7' },
  LEGENDARY: { emoji: '⭐', label: 'Lendário', color: '#eab308' }
};

let userPublicId = '';
let userSessionToken = '';
let userSessionData = null;
let cropperInstance = null;
let activeSuggestCharacter = null;
let pendingDivorceTarget = null;
let activeReportCharacter = null;
let activeSellCharacter = null;
let activeOfferListing = null;

let marketState = {
  search: '',
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
  sort: 'ranking',
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
    userPublicId = pathParts[userIdx + 1];
  }

  // Extrai token da query string (?token=...)
  const params = new URLSearchParams(window.location.search);
  userSessionToken = params.get('token') || '';

  if (!userPublicId) {
    document.getElementById('user-title').textContent = 'Usuário não especificado';
    return;
  }

  setupEventListeners();
  loadUserData();
});

function setupEventListeners() {
  // Compartilhar Harém (Link limpo sem token com suporte a tema)
  const btnShare = document.getElementById('btn-share-public');
  if (btnShare) {
    btnShare.addEventListener('click', () => {
      const cleanUrl = Api.getShareUrl(`${window.location.origin}/user/${userPublicId}`);
      Api.copyToClipboard(cleanUrl, 'Link público do harém copiado!');
    });
  }

  // Alternância de abas do painel privado
  const tabs = document.querySelectorAll('.retro-tabs .retro-tab[data-tab]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      const activeContent = document.getElementById(targetId);
      if (activeContent) activeContent.classList.remove('hidden');

      if (targetId === 'tab-catalog') {
        loadCatalogCharacters();
      } else if (targetId === 'tab-suggestions') {
        loadUserSuggestions();
      } else if (targetId === 'tab-market') {
        loadMarketTab();
      }
    });
  });

  // Alternância de subabas do modal de sugestão
  const subtabs = document.querySelectorAll('#modal-suggest .retro-tab[data-subtab]');
  subtabs.forEach(tab => {
    tab.addEventListener('click', () => {
      subtabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.dataset.subtab;
      document.querySelectorAll('.subtab-content').forEach(c => c.classList.add('hidden'));
      const activeContent = document.getElementById(targetId);
      if (activeContent) activeContent.classList.remove('hidden');
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
  catalogGenderPills.forEach(pill => {
    pill.addEventListener('click', () => {
      catalogGenderPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      catalogState.gender = pill.dataset.gender || '';
      catalogState.page = 1;
      loadCatalogCharacters();
    });
  });

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
  document.getElementById('btn-confirm-divorce').addEventListener('click', executeDivorce);

  // Envio de sugestão de raridade
  document.getElementById('btn-submit-rarity').addEventListener('click', submitRaritySuggestion);

  // Upload e inicialização do Cropper para nova foto
  const fileInput = document.getElementById('suggest-file-input');
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const cropperImg = document.getElementById('cropper-img');
      cropperImg.src = event.target.result;

      document.getElementById('cropper-container').classList.remove('hidden');

      if (cropperInstance) {
        cropperInstance.destroy();
      }

      // Inicializa Cropper.js com proporção Mudae 225x350 (9/14)
      cropperInstance = new Cropper(cropperImg, {
        aspectRatio: 225 / 350,
        viewMode: 1,
        autoCropArea: 0.95,
        preview: '#crop-preview',
        responsive: true,
      });
    };
    reader.readAsDataURL(file);
  });

  // Envio de sugestão de imagem recortada
  const btnSubmitImg = document.getElementById('btn-submit-image') || document.getElementById('btn-submit-crop');
  if (btnSubmitImg) {
    btnSubmitImg.addEventListener('click', typeof submitImageSuggestion !== 'undefined' ? submitImageSuggestion : submitCroppedImage);
  }

  // Limpar Wishlist (Remover Casadas)
  const btnClearWishlist = document.getElementById('btn-clear-wishlist');
  if (btnClearWishlist) {
    btnClearWishlist.addEventListener('click', async () => {
      if (!confirm('Deseja remover todas as personagens casadas da sua Wishlist?')) return;
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

  // Abrir modal de sugestão de novo personagem
  const btnOpenSuggestChar = document.getElementById('btn-open-suggest-char');
  if (btnOpenSuggestChar) {
    btnOpenSuggestChar.addEventListener('click', () => {
      document.getElementById('form-new-character').reset();
      document.getElementById('new-char-preview-container').classList.add('hidden');
      document.getElementById('modal-suggest-character').classList.remove('hidden');
    });
  }

  // Pré-visualização da foto do novo personagem
  const newCharPhoto = document.getElementById('new-char-photo');
  if (newCharPhoto) {
    newCharPhoto.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
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
      btn.disabled = true;

      const name = document.getElementById('new-char-name').value.trim();
      const series = document.getElementById('new-char-series').value.trim();
      const rarity = document.getElementById('new-char-rarity').value;
      const description = document.getElementById('new-char-description').value.trim();
      const reason = document.getElementById('new-char-reason').value.trim();
      const photoFile = document.getElementById('new-char-photo').files?.[0];

      const formData = new FormData();
      formData.append('token', userSessionToken);
      formData.append('type', 'NEW_CHARACTER');
      formData.append('name', name);
      formData.append('series', series);
      formData.append('rarity', rarity);
      formData.append('description', description);
      formData.append('reason', reason);
      if (photoFile) {
        formData.append('photo', photoFile);
      }

      try {
        const res = await Api.post(`/api/web/user/${userPublicId}/suggestions`, formData);
        if (res.success) {
          closeModal('modal-suggest-character');
          Api.showToast('Sugestão enviada com sucesso! A moderação e o Telegram foram notificados.', '✨');
          loadUserSuggestions();
        } else {
          Api.showToast(res.error?.message || 'Falha ao enviar sugestão.', '❌');
        }
      } catch (err) {
        Api.showToast('Erro de comunicação ao enviar sugestão.', '❌');
      } finally {
        btn.disabled = false;
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

  // Botão de ir para o harém criar anúncio
  document.getElementById('btn-market-new-from-harem')?.addEventListener('click', () => {
    switchTab('tab-harem');
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
}

async function loadUserData() {
  try {
    const url = `/api/web/user/${encodeURIComponent(userPublicId)}${userSessionToken ? `?token=${encodeURIComponent(userSessionToken)}` : ''}`;
    const res = await Api.get(url);

    if (!res.success) {
      document.getElementById('user-title').textContent = 'Usuário não encontrado';
      document.getElementById('user-subtitle').textContent = res.error?.message || 'Link inválido ou expirado.';
      return;
    }

    userSessionData = res.data;
    const isOwner = Boolean(userSessionData.isAdmin);

    document.getElementById('user-title').textContent = isOwner
      ? `Painel de ${userSessionData.name}`
      : `Harém de ${userSessionData.name}`;

    const harem = userSessionData.harem || [];
    document.getElementById('user-subtitle').textContent = `${harem.length} personagens colecionados no harém`;

    const zinthos = Number(userSessionData.kakera || 0).toLocaleString('pt-BR');
    const zinthosEl = document.getElementById('user-zinthos');
    if (zinthosEl) zinthosEl.textContent = `${zinthos} zinthos`;

    if (isOwner) {
      // Inicia contador de sessão ativa
      renderSessionTimer(userSessionData.expiresIn);

      // Exibe botão de compartilhar apenas para o dono
      document.getElementById('btn-share-public')?.classList.remove('hidden');

      document.getElementById('private-panel').classList.remove('hidden');
      document.getElementById('public-panel').classList.add('hidden');

      loadCatalogCharacters();
      renderPrivateHarem(harem);
      renderPrivateWishlist(userSessionData.wishlist || []);
      loadUserSuggestions();
      updateMarketPendingBadge();
    } else {
      document.getElementById('btn-share-public')?.classList.add('hidden');
      document.getElementById('private-panel').classList.add('hidden');
      document.getElementById('public-panel').classList.remove('hidden');

      renderPublicHarem(harem);
    }
  } catch (err) {
    console.error('Erro ao carregar dados do usuário:', err);
    document.getElementById('user-title').textContent = 'Erro ao carregar dados';
    document.getElementById('user-subtitle').textContent = 'Tente recarregar a página.';
  }
}

function renderSessionTimer(remainingSeconds) {
  const container = document.getElementById('session-badge-container');
  if (!remainingSeconds || remainingSeconds <= 0) {
    container.innerHTML = '<span class="badge-rarity" style="position: static; background: #ef4444; color: #fff;">Sessão Expirada</span>';
    return;
  }

  let sec = remainingSeconds;
  const updateBadge = () => {
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

const RARITY_WEIGHT = { LEGENDARY: 5, EPIC: 4, RARE: 3, UNCOMMON: 2, COMMON: 1 };

function sortHaremCards(harem) {
  return harem.sort((a, b) => {
    // 1. Favorita em destaque
    if (b.isFavorite !== a.isFavorite) return (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0);
    // 2. Chaves
    if ((b.keys || 0) !== (a.keys || 0)) return (b.keys || 0) - (a.keys || 0);
    // 3. Raridade
    const rA = RARITY_WEIGHT[a.character?.baseRarity] || 0;
    const rB = RARITY_WEIGHT[b.character?.baseRarity] || 0;
    if (rB !== rA) return rB - rA;
    // 4. Popularidade
    const popA = a.character?.claimCount || a.character?.likeCount || (100000 - (a.character?.rank || 100000));
    const popB = b.character?.claimCount || b.character?.likeCount || (100000 - (b.character?.rank || 100000));
    if (popB !== popA) return popB - popA;
    // 5. Wishlist
    return (b.character?.wishlistCount || 0) - (a.character?.wishlistCount || 0);
  });
}

function renderPrivateHarem(harem) {
  const grid = document.getElementById('harem-grid');
  document.getElementById('harem-count').textContent = harem.length;

  if (harem.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; font-weight: bold;">Seu harém ainda está vazio. Jogue no WhatsApp usando !mu-roll para casar com waifus!</div>';
    return;
  }

  sortHaremCards(harem);

  grid.innerHTML = '';
  harem.forEach(entry => {
    const char = entry.character;
    const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
    const card = document.createElement('div');
    card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}`;
    card.id = `harem-card-${char.id}`;
    card.style.borderColor = (char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color;

    card.innerHTML = `
      <div class="card-img-wrapper">
        <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="this.onerror=null;this.src='/media/characters/default.jpg';">
        <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
          ${rarity.emoji} ${rarity.label}
        </div>
        ${entry.keys ? `<div class="badge-wishes"><span>🔑</span> <span>${entry.keys}</span></div>` : ''}
        ${entry.isFavorite ? `<div class="badge-married" style="background: #ec4899; color: white;">💖</div>` : ''}
      </div>
      <div class="card-info">
        <div class="card-name">${escapeHtml(char.name)}</div>
        <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
        <div class="card-actions" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
          <button class="btn-retro btn-sm btn-gold" style="width: 100%;" onclick="openSellModal('${char.id}', '${escapeHtml(char.name)}', '${char.imageUrl || '/media/characters/default.jpg'}', '${escapeHtml(char.series || '')}')">
            <i class="fas fa-tag"></i> 💰 Vender
          </button>
          <button class="btn-retro btn-sm ${entry.isFavorite ? 'btn-gold' : ''}" style="width: 100%;" onclick="toggleFavorite('${char.id}')">
            ${entry.isFavorite ? '💖 Favorita' : '🤍 Favoritar'}
          </button>
          <button class="btn-retro btn-sm btn-danger" style="width: 100%;" onclick="openDivorceModal('${char.id}', '${escapeHtml(char.name)}')">
            <i class="fas fa-heart-crack"></i> Divorciar
          </button>
          <button class="btn-retro btn-sm" style="width: 100%;" onclick="openSuggestModal('${char.id}', '${escapeHtml(char.name)}', '${char.baseRarity}')">
            <i class="fas fa-lightbulb"></i> Sugerir Mudança
          </button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
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

function renderPrivateWishlist(wishlist) {
  const grid = document.getElementById('wishlist-grid');
  document.getElementById('wishlist-count').textContent = wishlist.length;

  const bonusPct = Math.min(100, (wishlist.length / 1000) * 100);
  const bonusFormatted = Number.isInteger(bonusPct) ? bonusPct : bonusPct.toFixed(1);
  const bonusEl = document.getElementById('wishlist-bonus-val');
  if (bonusEl) {
    bonusEl.textContent = `+${bonusFormatted}%`;
  }

  if (wishlist.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; font-weight: bold;">Sua wishlist está vazia. Use a aba "Catálogo" para desejar personagens!</div>';
    return;
  }

  grid.innerHTML = '';
  wishlist.forEach(entry => {
    const char = entry.character;
    const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
    const isMarried = Boolean(entry.isMarried || char.isMarried);
    const spouse = entry.marriedTo || char.marriedTo;

    const card = document.createElement('div');
    if (isMarried) {
      card.className = 'waifu-card is-married-wishlist';
      card.style.borderColor = '#ef4444';
    } else {
      card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}`;
      card.style.borderColor = (char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color;
    }
    card.id = `wish-card-${char.id}`;

    let marriedBadgeHtml = '';
    if (isMarried) {
      marriedBadgeHtml = `
        <div class="badge-married-alert" title="Casada(o) com ${escapeHtml(spouse || 'outro jogador')}">
          💍 Casada ${spouse ? `(${escapeHtml(spouse)})` : ''}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-img-wrapper">
        <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="this.onerror=null;this.src='/media/characters/default.jpg';">
        <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
          ${rarity.emoji} ${rarity.label}
        </div>
        ${marriedBadgeHtml}
        ${entry.isStarWish ? '<div class="badge-married" title="Starwish!">⭐</div>' : ''}
      </div>
      <div class="card-info">
        <div class="card-name">${escapeHtml(char.name)}</div>
        <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
        <div class="card-actions">
          <button class="btn-retro btn-sm btn-danger" onclick="removeFromWishlist('${char.id}')">
            <i class="fas fa-times"></i> Remover
          </button>
          <button class="btn-retro btn-sm" onclick="openSuggestModal('${char.id}', '${escapeHtml(char.name)}', '${char.baseRarity}')">
            <i class="fas fa-lightbulb"></i> Sugerir Mudança
          </button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function renderPublicHarem(harem) {
  const favoritesSection = document.getElementById('public-favorites-section');
  const favoritesGrid = document.getElementById('public-favorites-grid');
  const sectionTitle = document.getElementById('public-harem-section-title');
  const grid = document.getElementById('public-harem-grid');

  if (harem.length === 0) {
    if (favoritesSection) favoritesSection.classList.add('hidden');
    if (sectionTitle) sectionTitle.classList.add('hidden');
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; font-weight: bold;">Este usuário ainda não possui personagens no harém.</div>';
    return;
  }

  // Ordena os cards: Chaves -> Raridade -> Popularidade -> Wishlist
  sortHaremCards(harem);

  // Separa favoritas (máximo 5) e demais personagens
  const favorites = harem.filter(entry => entry.isFavorite).slice(0, 5);
  const others = harem.filter(entry => !favorites.includes(entry));

  // 1. Renderiza Favoritas (em cima, centralizado)
  if (favorites.length > 0) {
    if (favoritesSection) favoritesSection.classList.remove('hidden');
    if (favoritesGrid) {
      favoritesGrid.innerHTML = '';
      favorites.forEach(entry => {
        const char = entry.character;
        const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
        const card = document.createElement('div');
        card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}`;
        card.style.borderColor = (char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color;
        card.style.width = '200px';

        card.innerHTML = `
          <div class="card-img-wrapper">
            <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="this.onerror=null;this.src='/media/characters/default.jpg';">
            <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
              ${rarity.emoji} ${rarity.label}
            </div>
            ${entry.keys ? `<div class="badge-wishes"><span>🔑</span> <span>${entry.keys}</span></div>` : ''}
            <div class="badge-married" style="background: #ec4899; color: white;">💖</div>
          </div>
          <div class="card-info">
            <div class="card-name">${escapeHtml(char.name)}</div>
            <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
          </div>
        `;
        favoritesGrid.appendChild(card);
      });
    }
  } else {
    if (favoritesSection) favoritesSection.classList.add('hidden');
  }

  // 2. Renderiza Demais Personagens (em baixo, na grid normal)
  if (favorites.length > 0 && others.length > 0) {
    if (sectionTitle) sectionTitle.classList.remove('hidden');
  } else {
    if (sectionTitle) sectionTitle.classList.add('hidden');
  }

  grid.innerHTML = '';
  if (others.length === 0 && favorites.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; font-weight: bold;">Este usuário ainda não possui personagens no harém.</div>';
    return;
  }

  others.forEach(entry => {
    const char = entry.character;
    const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
    const card = document.createElement('div');
    card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}`;
    card.style.borderColor = (char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color;

    card.innerHTML = `
      <div class="card-img-wrapper">
        <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="this.onerror=null;this.src='/media/characters/default.jpg';">
        <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
          ${rarity.emoji} ${rarity.label}
        </div>
        ${entry.keys ? `<div class="badge-wishes"><span>🔑</span> <span>${entry.keys}</span></div>` : ''}
        ${entry.isFavorite ? `<div class="badge-married" style="background: #ec4899; color: white;">💖</div>` : ''}
      </div>
      <div class="card-info">
        <div class="card-name">${escapeHtml(char.name)}</div>
        <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
      </div>
    `;
    grid.appendChild(card);
  });
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
      const rarityKey = char.baseRarity || 'COMMON';
      const rarityCfg = RARITY_CONFIG[rarityKey] || RARITY_CONFIG.COMMON;
      const isAlreadyWish = currentWishes.has(char.id);
      const isMarried = Boolean(char.isClaimed || char.owner);
      const spouse = char.owner?.name || (typeof char.owner === 'string' ? char.owner : null);
      const spousePublicId = char.owner?.publicId || null;
      const wishlistCount = char.wishlistCount || 0;

      const card = document.createElement('div');
      card.className = `waifu-card rarity-${rarityKey.toLowerCase()}`;
      card.style.borderColor = rarityKey === 'COMMON' ? '#000000' : rarityCfg.color;

      let marriedTooltip = '💍 Solteira(o)';
      if (isMarried) {
        marriedTooltip = spouse
          ? `💍 Casada(o) com ${spouse}${spousePublicId ? ' (Clique para abrir perfil público)' : ''}`
          : '💍 Casada(o)';
      }

      card.innerHTML = `
        <div class="card-img-wrapper">
          <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="this.onerror=null;this.src='/media/characters/default.jpg';">
          <div class="badge-rarity" style="border-color: ${rarityCfg.color}; color: ${rarityCfg.color};" title="Raridade: ${rarityCfg.label}">
            ${rarityCfg.emoji} ${rarityCfg.label}
          </div>
          ${isMarried ? `<div class="badge-married ${spousePublicId ? 'badge-married-link' : ''}" title="${marriedTooltip}">💍</div>` : ''}
          <div class="badge-wishes" title="${wishlistCount} pessoa(s) adicionaram à wishlist">
            <span>✨</span> <span>${wishlistCount}</span>
          </div>
        </div>
        <div class="card-info">
          <div class="card-name" title="${escapeHtml(char.name)}">${escapeHtml(char.name)}</div>
          <div class="card-series" title="${escapeHtml(char.series || 'Sem série')}">${escapeHtml(char.series || 'Sem série')}</div>
          <div class="card-actions" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
            <button class="btn-retro btn-sm ${isAlreadyWish ? '' : 'btn-gold'}" style="width: 100%;" ${isAlreadyWish ? 'disabled' : ''} onclick="addToWishlist('${char.id}', this, event)">
              ${isAlreadyWish ? '<i class="fas fa-check"></i> Na Wishlist' : '<i class="fas fa-star"></i> + Wishlist'}
            </button>
            <button class="btn-retro btn-sm btn-danger" style="width: 100%;" onclick="openReportModal('${char.id}', '${escapeHtml(char.name)}')">
              <i class="fas fa-ban"></i> Denunciar 🔞
            </button>
            <button class="btn-retro btn-sm" style="width: 100%;" onclick="openSuggestModal('${char.id}', '${escapeHtml(char.name)}', '${char.baseRarity}')">
              <i class="fas fa-lightbulb"></i> Sugerir Mudança
            </button>
          </div>
        </div>
      `;

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
    if (btn) btn.disabled = false;
  }
}

// ========================================================
// AÇÕES DO USUÁRIO (DIVÓRCIO, WISHLIST, SUGESTÕES)
// ========================================================
function openDivorceModal(charId, charName) {
  pendingDivorceTarget = { id: charId, name: charName };
  document.getElementById('divorce-modal-text').innerHTML = `Tem certeza que deseja divorciar de <strong>${charName}</strong>?`;
  openModal('modal-divorce');
}

async function executeDivorce() {
  if (!pendingDivorceTarget) return;
  const { id, name } = pendingDivorceTarget;

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
    Api.showToast(`Divórcio de ${name} realizado com sucesso!`, '💔');

    // Remove do DOM
    const card = document.getElementById(`harem-card-${id}`);
    if (card) card.remove();

    // Atualiza contadores
    userSessionData.harem = (userSessionData.harem || []).filter(h => h.character.id !== id);
    document.getElementById('harem-count').textContent = userSessionData.harem.length;
  } catch (err) {
    Api.showToast('Erro de comunicação ao divorciar.', '❌');
  }
}

async function addToWishlist(charId, btn, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  try {
    const res = await Api.post(`/api/web/user/${userPublicId}/wishlist`, {
      token: userSessionToken,
      characterId: charId,
      isStarWish: false,
    });

    if (!res.success) {
      Api.showToast(res.error?.message || 'Falha ao adicionar.', '❌');
      return;
    }

    btn.disabled = true;
    btn.className = 'btn-retro btn-sm';
    btn.innerHTML = '<i class="fas fa-check"></i> Na Wishlist';

    // Atualiza estado local da wishlist sem recarregar o catálogo (evita pulo da página)
    if (userSessionData) {
      if (!Array.isArray(userSessionData.wishlist)) {
        userSessionData.wishlist = [];
      }
      userSessionData.wishlist.push({
        id: res.data?.entry?.id || charId,
        characterId: charId,
        isStarWish: false,
        character: { id: charId },
      });
      const countEl = document.getElementById('wishlist-count');
      if (countEl) countEl.textContent = userSessionData.wishlist.length;

      const bonusPct = Math.min(100, (userSessionData.wishlist.length / 1000) * 100);
      const bonusFormatted = Number.isInteger(bonusPct) ? bonusPct : bonusPct.toFixed(1);
      const bonusEl = document.getElementById('wishlist-bonus-val');
      if (bonusEl) bonusEl.textContent = `+${bonusFormatted}%`;
    }

    Api.showToast('Adicionado à sua Wishlist com sucesso!', '✨');
  } catch (err) {
    Api.showToast('Erro de comunicação ao adicionar à wishlist.', '❌');
  }
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
// MODAL DE SUGESTÕES (RARIDADE E FOTO CROPPER)
// ========================================================
function openSuggestModal(charId, charName, currentRarity) {
  activeSuggestCharacter = { id: charId, name: charName, currentRarity };

  const nameEl = document.getElementById('suggest-char-name');
  if (nameEl) nameEl.textContent = `Personagem: ${charName}`;

  const currBadge = document.getElementById('suggest-current-rarity');
  const cfg = RARITY_CONFIG[currentRarity] || RARITY_CONFIG.COMMON;
  if (currBadge) {
    currBadge.style.borderColor = cfg.color;
    currBadge.style.color = cfg.color;
    currBadge.textContent = `${cfg.emoji} ${cfg.label}`;
  }

  const rarityReason = document.getElementById('suggest-rarity-reason') || document.getElementById('suggest-reason');
  if (rarityReason) rarityReason.value = '';

  const photoReason = document.getElementById('suggest-photo-reason') || document.getElementById('suggest-img-reason');
  if (photoReason) photoReason.value = '';

  const fileInput = document.getElementById('suggest-file-input');
  if (fileInput) fileInput.value = '';

  const cropContainer = document.getElementById('cropper-container');
  if (cropContainer) cropContainer.classList.add('hidden');

  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }

  // Reseta estado das subabas para Raridade
  const subtabs = document.querySelectorAll('#modal-suggest .retro-tab[data-subtab]');
  subtabs.forEach((t, i) => {
    if (i === 0) t.classList.add('active');
    else t.classList.remove('active');
  });
  document.querySelectorAll('#modal-suggest .subtab-content').forEach((c, i) => {
    if (i === 0) c.classList.remove('hidden');
    else c.classList.add('hidden');
  });

  openModal('modal-suggest');
}

async function submitRaritySuggestion() {
  if (!activeSuggestCharacter) return;
  const selectEl = document.getElementById('suggest-rarity-select') || document.getElementById('suggest-new-rarity');
  const newRarity = selectEl ? selectEl.value : 'COMMON';
  const reasonEl = document.getElementById('suggest-rarity-reason') || document.getElementById('suggest-reason');
  const reason = reasonEl ? reasonEl.value.trim() : '';

  if (!reason || reason.length < 5) {
    Api.showToast('Por favor, informe uma justificativa válida com pelo menos 5 caracteres.', '⚠️');
    return;
  }

  try {
    const res = await Api.post(`/api/web/user/${userPublicId}/suggestions`, {
      token: userSessionToken,
      type: 'RARITY',
      characterId: activeSuggestCharacter.id,
      suggestedRarity: newRarity,
      reason: reason,
    });

    if (!res.success) {
      Api.showToast(res.error?.message || 'Falha ao enviar sugestão.', '❌');
      return;
    }

    closeModal('modal-suggest');
    Api.showToast(res.data?.message || 'Sugestão enviada para a moderação!', '💡');
    if (typeof loadUserSuggestions === 'function') {
      loadUserSuggestions();
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao enviar sugestão.', '❌');
  }
}

async function submitImageSuggestion() {
  if (!activeSuggestCharacter || !cropperInstance) return;

  const reasonEl = document.getElementById('suggest-photo-reason') || document.getElementById('suggest-img-reason');
  const reason = reasonEl ? reasonEl.value.trim() : '';

  // Exporta o canvas recortado em 450x700 (proporção 225x350)
  const canvas = cropperInstance.getCroppedCanvas({
    width: 450,
    height: 700,
  });

  canvas.toBlob(async (blob) => {
    if (!blob) {
      Api.showToast('Falha ao processar recorte de imagem.', '❌');
      return;
    }

    const formData = new FormData();
    formData.append('token', userSessionToken);
    formData.append('type', 'IMAGE');
    formData.append('characterId', activeSuggestCharacter.id);
    formData.append('reason', reason);
    formData.append('image', blob, 'cropped.png');

    try {
      const res = await Api.post(`/api/web/user/${userPublicId}/suggestions`, formData);
      if (!res.success) {
        Api.showToast(res.error?.message || 'Falha ao enviar foto.', '❌');
        return;
      }

      closeModal('modal-suggest');
      Api.showToast(res.data?.message || 'Sugestão de foto enviada para a moderação!', '🖼️');
      if (typeof loadUserSuggestions === 'function') {
        loadUserSuggestions();
      }
    } catch (err) {
      Api.showToast('Erro de comunicação ao enviar imagem.', '❌');
    }
  }, 'image/png');
}

// Helpers de Modal
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function escapeHtml(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
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
      DELETE_CHARACTER: '🔞 Denúncia / Remoção'
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
        detail = `<strong>${escapeHtml(s.characterName || 'Sem nome')}</strong> (${escapeHtml(s.series || 'Sem série')}) - Raridade: ${s.suggestedRarity || 'COMMON'}`;
        if (imgUrl) {
          detail += ` <a href="${imgUrl}" target="_blank" style="margin-left: 6px; text-decoration: underline; font-size: 11px;">[Ver foto]</a>`;
        }
      } else if (s.character) {
        detail = `<strong>${escapeHtml(s.character.name)}</strong> (${escapeHtml(s.character.series || '')})`;
        if (s.type === 'RARITY') detail += ` &rarr; Nova: ${s.suggestedRarity}`;
        if (s.type === 'IMAGE' && imgUrl) {
          detail += ` &rarr; Nova Foto <a href="${imgUrl}" target="_blank" style="margin-left: 6px; text-decoration: underline; font-size: 11px;">[Ver foto enviada]</a>`;
        }
      } else {
        detail = escapeHtml(s.characterName || 'Personagem');
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

/* ────────────────────────────────────────────────────────────────────────── */
/* MÓDULO DE CLASSIFICADOS E MERCADO (PAINEL WEB)                             */
/* ────────────────────────────────────────────────────────────────────────── */

function switchTab(tabId) {
  const tabBtn = document.querySelector(`.retro-tabs .retro-tab[data-tab="${tabId}"]`);
  if (tabBtn) tabBtn.click();
}

function openSellModal(characterId, characterName, imageUrl, series) {
  activeSellCharacter = { id: characterId, name: characterName };
  document.getElementById('sell-modal-char-name').textContent = characterName;
  document.getElementById('sell-modal-char-series').textContent = series || 'Sem série';
  document.getElementById('sell-modal-char-img').src = imageUrl || '/media/characters/default.jpg';
  document.getElementById('sell-modal-interest').value = '';
  openModal('modal-market-sell');
}

async function confirmPublishListing() {
  if (!activeSellCharacter) return;
  const interestInput = document.getElementById('sell-modal-interest');
  const interest = interestInput.value.trim();

  if (!interest) {
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
      closeModal('modal-market-sell');
      Api.showToast('Personagem anunciado nos classificados com sucesso!', '✨');
      switchTab('tab-market');
      loadMyListings();
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
  loadGlobalMarket();
  loadMySentOffers();
}

async function loadMyListings() {
  const grid = document.getElementById('my-listings-grid');
  if (!grid) return;

  try {
    const res = await Api.get(`/api/web/user/${encodeURIComponent(userPublicId)}/market/my-listings?token=${encodeURIComponent(userSessionToken)}`);
    if (!res.success || !Array.isArray(res.data) || res.data.length === 0) {
      grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 20px; color: var(--text-muted);">Você não possui nenhum anúncio ativo no momento. Vá ao seu Harém e clique em "Vender" para anunciar!</div>';
      return;
    }

    grid.innerHTML = '';
    res.data.forEach(listing => {
      const char = listing.character;
      const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
      const pendingOffersCount = (listing.offers || []).length;

      const card = document.createElement('div');
      card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}`;
      card.style.borderColor = (char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color;

      const hasOffers = pendingOffersCount > 0;
      const offersBtnClass = hasOffers ? 'btn-gold' : '';
      const offersBtnText = hasOffers
        ? `<i class="fas fa-bell"></i> <strong>Ver Ofertas (${pendingOffersCount})</strong>`
        : `<i class="fas fa-envelope-open"></i> Ver Ofertas (0)`;

      card.innerHTML = `
        <div class="card-img-wrapper">
          <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="this.onerror=null;this.src='/media/characters/default.jpg';">
          <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
            ${rarity.emoji} ${rarity.label}
          </div>
          ${hasOffers ? `<div class="badge-married" style="background: #f59e0b; color: black; font-weight: 800;">${pendingOffersCount} 🫰</div>` : ''}
        </div>
        <div class="card-info">
          <div class="card-name">${escapeHtml(char.name)}</div>
          <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
          <div style="background: var(--bg-retro-accent); padding: 6px 8px; border-radius: 4px; font-size: 12px; margin: 6px 0; border: var(--border-retro);">
            <strong style="color: #f59e0b;"><i class="fas fa-search"></i> Procura:</strong> ${escapeHtml(listing.interest)}
          </div>
          <div class="card-actions" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
            <button class="btn-retro btn-sm ${offersBtnClass}" style="width: 100%;" onclick="openViewOffersModal('${listing.id}', '${escapeHtml(char.name)}')">
              ${offersBtnText}
            </button>
            <button class="btn-retro btn-sm btn-danger" style="width: 100%;" onclick="cancelMyListing('${listing.id}')">
              <i class="fas fa-times-circle"></i> Cancelar Anúncio
            </button>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 20px; color: var(--accent-red);">Erro ao carregar seus anúncios.</div>';
  }
}

async function cancelMyListing(listingId) {
  if (!confirm('Deseja realmente cancelar este anúncio? Todas as ofertas pendentes nele serão canceladas.')) return;
  try {
    const res = await Api.delete(`/api/web/user/${encodeURIComponent(userPublicId)}/market/listings/${encodeURIComponent(listingId)}?token=${encodeURIComponent(userSessionToken)}`);
    if (res.success) {
      Api.showToast('Anúncio cancelado com sucesso.', 'ℹ️');
      loadMyListings();
      loadGlobalMarket();
      updateMarketPendingBadge();
    } else {
      Api.showToast(res.error?.message || 'Falha ao cancelar anúncio.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao cancelar anúncio.', '❌');
  }
}

async function openViewOffersModal(listingId, characterName) {
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
        if (Array.isArray(offered.waifuIds) && offered.waifuIds.length > 0) {
          parts.push(`<div><strong>Waifus (${offered.waifuIds.length}):</strong> ${offered.waifuIds.map(w => `<span class="badge-tag" style="background:#8b5cf6;color:#fff;">${escapeHtml(w)}</span>`).join(' ')}</div>`);
        }
        if (Array.isArray(offered.fishes) && offered.fishes.length > 0) {
          parts.push(`<div><strong>Peixes (${offered.fishes.length}):</strong> ${offered.fishes.map(f => `${escapeHtml(f.name || 'Peixe')} (${f.weight || 0}kg)`).join(', ')}</div>`);
        }
        if (Array.isArray(offered.fishingBuffs) && offered.fishingBuffs.length > 0) {
          parts.push(`<div><strong>Buffs de Pesca (${offered.fishingBuffs.length}):</strong> ${offered.fishingBuffs.map(b => escapeHtml(b.originalName || b.type || 'Buff')).join(', ')}</div>`);
        }
        if (Array.isArray(offered.farmItems) && offered.farmItems.length > 0) {
          parts.push(`<div><strong>Itens de Fazenda:</strong> ${offered.farmItems.map(it => `${it.amount}x ${escapeHtml(it.name || it.itemId)}`).join(', ')}</div>`);
        }
        itemsHtml = parts.join('<div style="margin-top: 4px;"></div>') || '<span style="color: var(--text-muted);">Nenhum item especificado</span>';
      }

      let statusBadge = `<span class="badge-tag" style="background: #eab308; color: #000;">Pendente</span>`;
      if (offer.status === 'ACCEPTED') statusBadge = `<span class="badge-tag" style="background: #22c55e; color: #fff;">Aceita 🎉</span>`;
      if (offer.status === 'REJECTED') statusBadge = `<span class="badge-tag" style="background: #64748b; color: #fff;">Negada</span>`;
      if (offer.status === 'CANCELLED') statusBadge = `<span class="badge-tag" style="background: #ef4444; color: #fff;">Cancelada</span>`;

      const card = document.createElement('div');
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
        ${offer.cancelReason ? `<div style="font-size: 12px; color: var(--accent-red); font-weight: bold; margin-bottom: 8px;">Motivo do cancelamento: ${escapeHtml(offer.cancelReason)}</div>` : ''}
        ${isPending ? `
          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button class="btn-retro btn-sm btn-gold" style="flex: 1;" onclick="acceptMarketOffer('${offer.id}', '${listingId}', '${escapeHtml(characterName)}')">
              <i class="fas fa-check"></i> Aceitar Oferta
            </button>
            <button class="btn-retro btn-sm btn-danger" style="flex: 1;" onclick="rejectMarketOffer('${offer.id}', '${listingId}', '${escapeHtml(characterName)}')">
              <i class="fas fa-times"></i> Negar
            </button>
          </div>
        ` : ''}
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--accent-red);">Erro ao carregar propostas.</div>';
  }
}

async function acceptMarketOffer(offerId, listingId, characterName) {
  if (!confirm('Deseja aceitar esta oferta? Os itens e personagens serão transferidos imediatamente.')) return;
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
      alert(res.reason || 'Não foi possível aceitar a oferta.');
      openViewOffersModal(listingId, characterName);
      loadMyListings();
      loadGlobalMarket();
      updateMarketPendingBadge();
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao aceitar oferta.', '❌');
  }
}

async function rejectMarketOffer(offerId, listingId, characterName) {
  try {
    const res = await Api.post(`/api/web/user/${encodeURIComponent(userPublicId)}/market/offers/${encodeURIComponent(offerId)}/reject`, {
      token: userSessionToken,
    });
    if (res.success) {
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

async function loadGlobalMarket() {
  const grid = document.getElementById('global-market-grid');
  if (!grid) return;

  grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 28px;">Buscando classificados globais...</div>';

  try {
    const query = new URLSearchParams({
      search: marketState.search,
      sortBy: marketState.sortBy,
      page: marketState.page,
      limit: marketState.limit,
    });

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
      const char = listing.character;
      const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
      const sellerName = listing.user?.name || 'Jogador';
      const isOwnListing = Boolean(userSessionData && listing.user?.publicId === userSessionData.publicId);

      const card = document.createElement('div');
      card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}`;
      card.style.borderColor = (char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color;

      card.innerHTML = `
        <div class="card-img-wrapper">
          <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="this.onerror=null;this.src='/media/characters/default.jpg';">
          <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
            ${rarity.emoji} ${rarity.label}
          </div>
          ${isOwnListing ? `<div class="badge-married" style="background: #3b82f6; color: white;">SEU ANÚNCIO</div>` : ''}
        </div>
        <div class="card-info">
          <div class="card-name">${escapeHtml(char.name)}</div>
          <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
            <i class="fas fa-user-tag"></i> Vendedor: <strong>${escapeHtml(sellerName)}</strong>
          </div>
          <div style="background: var(--bg-retro-accent); padding: 6px 8px; border-radius: 4px; font-size: 12px; margin: 8px 0; border: var(--border-retro);">
            <strong style="color: #f59e0b;"><i class="fas fa-search"></i> Procura:</strong> ${escapeHtml(listing.interest)}
          </div>
          <div class="card-actions" style="margin-top: 8px;">
            ${isOwnListing ? `
              <button class="btn-retro btn-sm" style="width: 100%; opacity: 0.8;" disabled>
                <i class="fas fa-check"></i> Seu Personagem
              </button>
            ` : `
              <button class="btn-retro btn-sm btn-gold" style="width: 100%;" onclick="openOfferModal('${listing.id}', '${escapeHtml(char.name)}', '${char.imageUrl || '/media/characters/default.jpg'}', '${escapeHtml(listing.interest)}')">
                <i class="fas fa-handshake"></i> Fazer Oferta
              </button>
            `}
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 28px; color: var(--accent-red);">Erro ao carregar classificados globais.</div>';
  }
}

function openOfferModal(listingId, characterName, imageUrl, interest) {
  activeOfferListing = { id: listingId, name: characterName };
  document.getElementById('offer-target-name').textContent = characterName;
  document.getElementById('offer-target-interest').textContent = `Procura: ${interest}`;
  document.getElementById('offer-target-img').src = imageUrl || '/media/characters/default.jpg';
  document.getElementById('offer-is-free-checkbox').checked = false;
  toggleFreeOffer(false);
  document.getElementById('offer-message-input').value = '';

  // 1. Popula Waifus disponíveis do harém do comprador
  const waifusList = document.getElementById('offer-waifus-list');
  const harem = userSessionData?.harem || [];
  if (harem.length === 0) {
    waifusList.innerHTML = '<div style="grid-column: 1 / -1; font-size: 12px; color: var(--text-muted); padding: 8px;">Você não possui waifus no harém para oferecer.</div>';
  } else {
    waifusList.innerHTML = harem.map(item => {
      const char = item.character;
      return `
        <label style="border: var(--border-retro); border-radius: 6px; padding: 6px; display: flex; flex-direction: column; align-items: center; cursor: pointer; background: var(--bg-card); font-size: 11px; text-align: center;">
          <img src="${char.imageUrl || '/media/characters/default.jpg'}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; margin-bottom: 4px;">
          <span style="font-weight: 700; max-width: 110px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(char.name)}</span>
          <input type="checkbox" name="offer-waifu-cb" value="${char.id}" style="margin-top: 4px;">
        </label>
      `;
    }).join('');
  }

  // 2. Popula Peixes da Pescaria
  const fishesList = document.getElementById('offer-fishes-list');
  const fishes = userSessionData?.inventory?.fishes || [];
  if (fishes.length === 0) {
    fishesList.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 8px;">Nenhum peixe na sua mochila de pesca no momento.</div>';
  } else {
    fishesList.innerHTML = fishes.map(fish => {
      const rareTag = fish.is_rare || fish.isRare ? '⭐ RARO' : '';
      return `
        <label style="display: flex; align-items: center; justify-content: space-between; border: var(--border-retro); padding: 6px 10px; border-radius: 4px; background: var(--bg-card); font-size: 12px; cursor: pointer;">
          <span>🐟 <strong>${escapeHtml(fish.name)}</strong> (${fish.weight} kg) <span style="color:#eab308;font-weight:bold;">${rareTag}</span></span>
          <input type="checkbox" name="offer-fish-cb" value="${fish.id}" data-name="${escapeHtml(fish.name)}" data-weight="${fish.weight}">
        </label>
      `;
    }).join('');
  }

  // 3. Popula Buffs Permanentes de Pesca
  const buffsList = document.getElementById('offer-buffs-list');
  const buffs = userSessionData?.inventory?.buffs || [];
  if (buffs.length === 0) {
    buffsList.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 8px;">Nenhum buff de pesca permanente no seu inventário.</div>';
  } else {
    buffsList.innerHTML = buffs.map(b => {
      return `
        <label style="display: flex; align-items: center; justify-content: space-between; border: var(--border-retro); padding: 6px 10px; border-radius: 4px; background: var(--bg-card); font-size: 12px; cursor: pointer;">
          <span>⚡ <strong>${escapeHtml(b.original_name || b.originalName || b.type)}</strong> (${escapeHtml(b.type || 'buff')})</span>
          <input type="checkbox" name="offer-buff-cb" value="${b.id}" data-name="${escapeHtml(b.original_name || b.originalName || b.type)}">
        </label>
      `;
    }).join('');
  }

  // 4. Popula Itens da Fazenda (Jardim das Sombras)
  const farmList = document.getElementById('offer-farm-list');
  const farmItems = userSessionData?.inventory?.farmItems || [];
  if (farmItems.length === 0) {
    farmList.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 8px;">Nenhum item da fazenda disponível no momento.</div>';
  } else {
    farmList.innerHTML = farmItems.map(it => {
      const maxQty = Number(it.quantity) || 1;
      return `
        <div style="display: flex; align-items: center; justify-content: space-between; border: var(--border-retro); padding: 6px 10px; border-radius: 4px; background: var(--bg-card); font-size: 12px;">
          <div>
            🌱 <strong>${escapeHtml(it.name || it.itemId)}</strong>
            <span style="color: var(--text-muted); margin-left: 6px;">(Em estoque: ${maxQty})</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <button type="button" class="btn-retro btn-sm" onclick="adjustOfferFarmQty('${it.itemId}', -1, ${maxQty})">-</button>
            <input type="number" id="farm-qty-${it.itemId}" value="0" min="0" max="${maxQty}" style="width: 45px; text-align: center; border: var(--border-retro); border-radius: 4px;" readonly>
            <button type="button" class="btn-retro btn-sm" onclick="adjustOfferFarmQty('${it.itemId}', 1, ${maxQty})">+</button>
          </div>
        </div>
      `;
    }).join('');
  }

  openModal('modal-market-offer');
}

function adjustOfferFarmQty(itemId, delta, max) {
  const input = document.getElementById(`farm-qty-${itemId}`);
  if (!input) return;
  let val = parseInt(input.value, 10) || 0;
  val = Math.max(0, Math.min(max, val + delta));
  input.value = val;
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
  const selectedFishes = Array.from(document.querySelectorAll('input[name="offer-fish-cb"]:checked')).map(cb => ({
    id: parseInt(cb.value, 10),
    name: cb.dataset.name,
    weight: parseFloat(cb.dataset.weight),
  }));
  const selectedBuffs = Array.from(document.querySelectorAll('input[name="offer-buff-cb"]:checked')).map(cb => ({
    id: parseInt(cb.value, 10),
    originalName: cb.dataset.name,
  }));

  const farmItems = [];
  const farmList = userSessionData?.inventory?.farmItems || [];
  farmList.forEach(it => {
    const qtyInput = document.getElementById(`farm-qty-${it.itemId}`);
    const qty = parseInt(qtyInput?.value, 10) || 0;
    if (qty > 0) {
      farmItems.push({
        itemId: it.itemId,
        name: it.name || it.itemId,
        amount: qty,
      });
    }
  });

  if (!isFree && selectedWaifuIds.length === 0 && selectedFishes.length === 0 && selectedBuffs.length === 0 && farmItems.length === 0) {
    Api.showToast('Selecione ao menos um item para oferecer ou marque "Pedir de graça".', '⚠️');
    return;
  }

  const btn = document.getElementById('btn-submit-offer');
  btn.disabled = true;

  try {
    const res = await Api.post(`/api/web/user/${encodeURIComponent(userPublicId)}/market/offers`, {
      token: userSessionToken,
      listingId: activeOfferListing.id,
      message,
      offeredItems: {
        isFree,
        waifuIds: selectedWaifuIds,
        fishes: selectedFishes,
        fishingBuffs: selectedBuffs,
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

async function loadMySentOffers() {
  const tbody = document.getElementById('tbody-my-offers');
  if (!tbody) return;

  try {
    const res = await Api.get(`/api/web/user/${encodeURIComponent(userPublicId)}/market/my-offers?token=${encodeURIComponent(userSessionToken)}`);
    if (!res.success || !Array.isArray(res.data) || res.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">Você não enviou nenhuma oferta nos últimos 15 dias.</td></tr>';
      return;
    }

    tbody.innerHTML = res.data.map(offer => {
      const dateStr = new Date(offer.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const charName = offer.listing?.character?.name || 'Personagem';
      const series = offer.listing?.character?.series ? ` (${escapeHtml(offer.listing.character.series)})` : '';
      const seller = offer.listing?.user?.name || 'Vendedor';

      const offered = offer.offeredItems || {};
      let summary = '';
      if (offered.isFree) {
        summary = '🎁 Pedido de graça (Doação)';
      } else {
        const parts = [];
        if (Array.isArray(offered.waifuIds) && offered.waifuIds.length > 0) parts.push(`${offered.waifuIds.length} waifu(s)`);
        if (Array.isArray(offered.fishes) && offered.fishes.length > 0) parts.push(`${offered.fishes.length} peixe(s)`);
        if (Array.isArray(offered.fishingBuffs) && offered.fishingBuffs.length > 0) parts.push(`${offered.fishingBuffs.length} buff(s)`);
        if (Array.isArray(offered.farmItems) && offered.farmItems.length > 0) parts.push(`${offered.farmItems.length} item(ns) da fazenda`);
        summary = parts.join(', ') || 'Nenhum item';
      }

      let statusBadge = `<span class="badge-tag" style="background: #eab308; color: #000;">Pendente</span>`;
      if (offer.status === 'ACCEPTED') statusBadge = `<span class="badge-tag" style="background: #22c55e; color: #fff;">Aceita 🎉</span>`;
      if (offer.status === 'REJECTED') statusBadge = `<span class="badge-tag" style="background: #64748b; color: #fff;">Negada 👎</span>`;
      if (offer.status === 'CANCELLED') {
        const reasonTooltip = offer.cancelReason ? ` - Motivo: ${escapeHtml(offer.cancelReason)}` : '';
        statusBadge = `<span class="badge-tag" style="background: #ef4444; color: #fff;" title="${escapeHtml(offer.cancelReason || '')}">Cancelada ⚠️${reasonTooltip}</span>`;
      }

      return `
        <tr>
          <td style="white-space: nowrap; font-size: 12px;">${dateStr}</td>
          <td style="font-weight: 700;">${escapeHtml(charName)}${series}</td>
          <td>${escapeHtml(seller)}</td>
          <td style="font-size: 13px;">${summary}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--accent-red); padding: 20px;">Erro ao carregar histórico de ofertas.</td></tr>';
  }
}


