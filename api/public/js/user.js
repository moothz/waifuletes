// js/user.js - Lógica da Página do Usuário (Harém Público & Painel Privado com Sugestões e Recorte)

const RARITY_CONFIG = {
  COMMON:    { emoji: '⚪', label: 'Comum',    color: '#94a3b8' },
  UNCOMMON:  { emoji: '🟢', label: 'Incomum',  color: '#22c55e' },
  RARE:      { emoji: '🔵', label: 'Raro',     color: '#3b82f6' },
  EPIC:      { emoji: '🟣', label: 'Épico',    color: '#a855f7' },
  LEGENDARY: { emoji: '⭐', label: 'Lendário', color: '#eab308' }
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
let cropperInstance = null;
let activeSuggestCharacter = null;
let suggestTagsState = [];
let pendingDivorceTarget = null;
let activeReportCharacter = null;
let activeSellCharacter = null;
let activeOfferListing = null;
let activeCovetsChar = null;
let userCovetedSet = new Set();
let visitorSessionData = null;
let visitorWishlistSet = new Set();

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
  // Compartilhar Harém (Link limpo sem token com suporte a tema)
  const btnShare = document.getElementById('btn-share-public');
  if (btnShare) {
    btnShare.addEventListener('click', () => {
      const cleanUrl = Api.getShareUrl(`${window.location.origin}/user/${userPublicId}`);
      Api.copyToClipboard(cleanUrl, 'Link público do harém copiado!');
    });
  }

  // Alternância de abas do painel privado
  const tabs = document.querySelectorAll('#private-panel .retro-tabs .retro-tab[data-tab]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.dataset.tab;
      document.querySelectorAll('#private-panel .tab-content').forEach(c => c.classList.add('hidden'));
      const activeContent = document.getElementById(targetId);
      if (activeContent) activeContent.classList.remove('hidden');

      if (targetId === 'tab-catalog') {
        loadCatalogCharacters();
      } else if (targetId === 'tab-rankings') {
        loadRankings();
      } else if (targetId === 'tab-suggestions') {
        loadUserSuggestions();
      } else if (targetId === 'tab-market') {
        loadMarketTab();
      } else if (targetId === 'tab-notifications') {
        loadUserNotifications();
      }
    });
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
  const btnDivorce = document.getElementById('btn-confirm-divorce');
  if (btnDivorce) {
    btnDivorce.addEventListener('click', executeDivorce);
  }

  // Envio de sugestão de dados ou raridade
  const btnSubmitEditInfo = document.getElementById('btn-submit-edit-info');
  if (btnSubmitEditInfo) {
    btnSubmitEditInfo.addEventListener('click', submitEditInfoSuggestion);
  }
  const btnSubmitRarity = document.getElementById('btn-submit-rarity');
  if (btnSubmitRarity) {
    btnSubmitRarity.addEventListener('click', submitEditInfoSuggestion);
  }

  // Upload e inicialização do Cropper para nova foto
  const fileInput = document.getElementById('suggest-file-input');
  if (fileInput) {
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
  }

  // Envio de sugestão de imagem recortada (se botão separado sem onclick existir)
  const btnSubmitImg = document.getElementById('btn-submit-image');
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

  // Monitora seleção de raridade para regra de personagens já casados
  const suggestEditRarity = document.getElementById('suggest-edit-rarity');
  if (suggestEditRarity) {
    suggestEditRarity.addEventListener('change', updateSuggestLegendaryMarriedBox);
  }

  // Pré-visualização da foto lendária para personagem casado
  const suggestLegPhotoInput = document.getElementById('suggest-legendary-photo-input');
  if (suggestLegPhotoInput) {
    suggestLegPhotoInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      const prevBox = document.getElementById('suggest-legendary-preview-container');
      const prevImg = document.getElementById('suggest-legendary-preview-img');
      if (file && prevBox && prevImg) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          prevImg.src = evt.target.result;
          prevBox.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
      } else if (prevBox) {
        prevBox.classList.add('hidden');
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
      const gender = document.getElementById('new-char-gender')?.value || 'FEMALE';
      const rarity = document.getElementById('new-char-rarity').value;
      const tags = document.getElementById('new-char-tags')?.value.trim() || '';
      const description = document.getElementById('new-char-description').value.trim();
      const reason = document.getElementById('new-char-reason').value.trim();
      const photoFile = document.getElementById('new-char-photo').files?.[0];

      const formData = new FormData();
      formData.append('token', userSessionToken);
      formData.append('type', 'NEW_CHARACTER');
      formData.append('name', name);
      formData.append('series', series);
      formData.append('gender', gender);
      formData.append('rarity', rarity);
      formData.append('tags', tags);
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

  // Tag manager no modal de sugestão
  document.getElementById('btn-add-suggest-tag')?.addEventListener('click', () => addSuggestTag());
  document.getElementById('suggest-new-tag-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSuggestTag();
    }
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

  // Fechar modais ao clicar fora (fundo overlay escuro)
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
      }
    });
  });

  // Fechar modal ao pressionar tecla Escape (Esc)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      const openOverlays = Array.from(document.querySelectorAll('.modal-overlay:not(.hidden)'));
      if (openOverlays.length > 0) {
        const topModal = openOverlays[openOverlays.length - 1];
        topModal.classList.add('hidden');
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
      document.getElementById('user-subtitle').textContent = res.error?.message || 'Link inválido ou expirado.';

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

    document.getElementById('user-title').textContent = isOwner
      ? `Painel de ${userSessionData.name}`
      : `Harém de ${userSessionData.name}`;

    const harem = userSessionData.harem || [];
    const totalHaremCount = userSessionData.totalHarem !== undefined ? userSessionData.totalHarem : harem.length;
    document.getElementById('user-subtitle').textContent = `${totalHaremCount} personagens colecionados no harém`;

    const zinthos = Number(userSessionData.kakera || 0).toLocaleString('pt-BR');
    const zinthosEl = document.getElementById('user-zinthos');
    if (zinthosEl) zinthosEl.textContent = `${zinthos} zinthos`;

    if (isOwner) {
      // Inicia contador de sessão ativa
      renderSessionTimer(userSessionData.expiresIn);

      // Renderiza botão de Manter Login / Sair
      renderSessionAuthButton(Boolean(userSessionData.isPersistent));

      // Se a sessão for persistente, renova/salva cookies por 3 dias
      if (userSessionData.isPersistent && userSessionToken) {
        setCookie(`waifu_session_${userPublicId}`, userSessionToken, 3);
        setCookie('waifu_session', userSessionToken, 3);
        setCookie('waifu_user_public_id', userPublicId, 3);
        setCookie('waifu_public_id', userPublicId, 3);
      }

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

      document.getElementById('private-panel').classList.remove('hidden');
      document.getElementById('public-panel').classList.add('hidden');

      loadCatalogCharacters();
      renderPrivateHarem(harem);
      renderPrivateWishlist(userSessionData.wishlist || []);
      loadUserSuggestions();
      updateMarketPendingBadge();
    } else {
      document.getElementById('btn-session-auth')?.classList.add('hidden');
      document.getElementById('btn-share-public')?.classList.add('hidden');
      document.getElementById('private-panel').classList.add('hidden');
      document.getElementById('public-panel').classList.remove('hidden');

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
              headerActions.appendChild(btnHarem);
            }
          }
        } catch (_) {}
      }

      const marketUserNameEl = document.getElementById('public-market-user-name');
      if (marketUserNameEl) marketUserNameEl.textContent = userSessionData.name || 'Jogador';

      renderPublicHarem(harem);
      renderPublicMarketListings(userSessionData.listings || []);
    }
  } catch (err) {
    console.error('Erro ao carregar dados do usuário:', err);
    document.getElementById('user-title').textContent = 'Erro ao carregar dados';
    document.getElementById('user-subtitle').textContent = err?.message || 'Tente recarregar a página.';

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

function renderSessionAuthButton(isPersistent) {
  const btn = document.getElementById('btn-session-auth');
  if (!btn) return;

  btn.classList.remove('hidden');

  if (isPersistent) {
    btn.classList.remove('btn-keep-login');
    btn.classList.add('btn-logout');
    btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Sair';
    btn.title = 'Encerrar sessão mantida neste navegador';
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await Api.post(`/api/web/user/${userPublicId}/logout`, { token: userSessionToken });
      } catch (_) {}
      deleteCookie(`waifu_session_${userPublicId}`);
      deleteCookie('waifu_session');
      deleteCookie('waifu_user_public_id');
      window.location.href = `/user/${userPublicId}`;
    };
  } else {
    btn.classList.add('btn-keep-login');
    btn.classList.remove('btn-logout');
    btn.innerHTML = '<i class="fas fa-thumbtack"></i> Manter Login!';
    btn.title = 'Salvar login por 3 dias sem precisar de novo link do bot';
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const res = await Api.post(`/api/web/user/${userPublicId}/persist-session`, { token: userSessionToken });
        if (res.success) {
          setCookie(`waifu_session_${userPublicId}`, userSessionToken, 3);
          setCookie('waifu_session', userSessionToken, 3);
          setCookie('waifu_user_public_id', userPublicId, 3);
          userSessionData.isPersistent = true;
          Api.showToast('Login mantido por 3 dias com sucesso! Quando voltar ao site você continuará autenticado.', '🔒');
          renderSessionAuthButton(true);
          renderSessionTimer(259200);
        } else {
          Api.showToast(res.error?.message || 'Falha ao manter login.', '❌');
          btn.disabled = false;
        }
      } catch (err) {
        Api.showToast('Erro ao manter login.', '❌');
        btn.disabled = false;
      }
    };
  }
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

function createPrivateHaremCard(entry) {
  const char = entry.character;
  const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
  const card = document.createElement('div');
  card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}`;
  card.id = `harem-card-${char.id}`;
  card.style.borderColor = (char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color;

  const unseenCovets = Number(entry.unseenCovetsCount || 0);
  const covetsLabel = unseenCovets > 0 ? `Interessados (${unseenCovets})` : 'Interessados';
  const covetsBtnClass = unseenCovets > 0 ? 'btn-gold' : '';
  const covetsBtnStyle = unseenCovets > 0 ? 'border-color: #f59e0b; font-weight: 800;' : '';

  if (entry.collectionId) {
    try { localStorage.setItem(`waifu_last_col_${char.id}`, entry.collectionId); } catch (_) {}
  }

  const photosCount = (char.imageUrls && Array.isArray(char.imageUrls)) ? char.imageUrls.length : 1;
  const photosBadgeHtml = photosCount > 1
    ? `<div class="badge-photos" onclick="event.stopPropagation(); openWaifuPreview('${char.id}')" title="${photosCount} fotos cadastradas">📷 ${photosCount}</div>`
    : '';

  const colBadgeHtml = entry.collection
    ? `<div class="badge-collection-tag" style="bottom: ${unseenCovets > 0 ? '34px' : '8px'};" title="Coleção: ${escapeHtml(entry.collection.name)}">📁 ${escapeHtml(entry.collection.name)}</div>`
    : '';

  card.innerHTML = `
    <div class="card-img-wrapper" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="Clique para ver detalhes e fotos">
      <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)">
      <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
        ${rarity.emoji} ${rarity.label}
      </div>
      ${entry.keys ? `<div class="badge-keys"><span>🔑</span> <span>${entry.keys}</span></div>` : ''}
      ${entry.isFavorite ? `<div class="badge-married" style="background: #ec4899; color: white; top: 8px; right: ${entry.keys ? '56px' : '8px'};">💖</div>` : ''}
      ${unseenCovets > 0 ? `<div class="badge-covets" onclick="event.stopPropagation(); openHaremCovetsModal('${char.id}', '${escapeAttr(char.name)}', '${char.imageUrl || '/media/characters/default.jpg'}', '${escapeAttr(char.series || '')}')" title="${unseenCovets} jogador(es) interessados">👀 ${unseenCovets}</div>` : ''}
      ${photosBadgeHtml}
      ${colBadgeHtml}
    </div>
    <div class="card-info">
      <div class="card-name" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')">${escapeHtml(char.name)}</div>
      <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
      <div class="card-actions" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
        <!-- 1. Favoritar -->
        <button class="btn-retro btn-sm" style="width: 100%; background: #ec4899; color: white; border-color: #db2777;" onclick="toggleFavorite('${char.id}')">
          💖 ${entry.isFavorite ? 'Desfavoritar' : 'Favoritar'}
        </button>
        <!-- 2. Coleção -->
        <button class="btn-retro btn-sm" style="width: 100%; border-color: #3b82f6; color: #3b82f6; font-weight: 800;" onclick="openAssignCollectionModal('${char.id}', '${escapeHtml(char.name)}', '${char.imageUrl || '/media/characters/default.jpg'}', '${entry.collectionId || ''}')">
          📁 ${entry.collection ? `Pasta: ${escapeHtml(entry.collection.name)}` : 'Mover para Coleção'}
        </button>
        <!-- 3. Divorciar -->
        <button class="btn-retro btn-sm btn-danger" style="width: 100%;" onclick="openDivorceModal('${char.id}', '${escapeHtml(char.name)}')">
          <i class="fas fa-heart-crack"></i> Divorciar
        </button>
        <!-- 4. Vender -->
        <button class="btn-retro btn-sm btn-gold" style="width: 100%;" onclick="openSellModal('${char.id}', '${escapeHtml(char.name)}', '${char.imageUrl || '/media/characters/default.jpg'}', '${escapeHtml(char.series || '')}')">
          <i class="fas fa-tag"></i> 💰 Vender
        </button>
        <!-- 5. Interessados -->
        <button class="btn-retro btn-sm ${covetsBtnClass}" style="width: 100%; ${covetsBtnStyle}" onclick="openHaremCovetsModal('${char.id}', '${escapeHtml(char.name)}', '${char.imageUrl || '/media/characters/default.jpg'}', '${escapeHtml(char.series || '')}')">
          <i class="fas fa-eye"></i> 👀 ${covetsLabel}
        </button>
        <!-- 6. Sugerir Mudança -->
        <button class="btn-retro btn-sm" style="width: 100%;" onclick="openSuggestModal('${char.id}', '${escapeHtml(char.name)}', '${char.baseRarity}')">
          <i class="fas fa-lightbulb"></i> Sugerir Alterações
        </button>
      </div>
    </div>
  `;
  return card;
}

function renderPrivateHarem(harem) {
  const grid = document.getElementById('harem-grid');
  const favSection = document.getElementById('private-favorites-section');
  const favGrid = document.getElementById('private-favorites-grid');
  const colSection = document.getElementById('private-collections-section');
  const colContainer = document.getElementById('private-collections-container');
  const colBadge = document.getElementById('collections-count-badge');
  const generalTitle = document.getElementById('private-harem-general-title');

  const totalCount = userSessionData?.totalHarem !== undefined ? userSessionData.totalHarem : harem.length;
  document.getElementById('harem-count').textContent = totalCount;

  if (harem.length === 0) {
    if (favSection) favSection.classList.add('hidden');
    if (generalTitle) generalTitle.style.display = 'none';
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; font-weight: bold;">Seu harém ainda está vazio. Jogue no WhatsApp usando !mu-roll para casar com waifus!</div>';
    return;
  }

  sortHaremCards(harem);

  // 1. Favoritas (até 5)
  const favorites = harem.filter(e => e.isFavorite).slice(0, 5);
  if (favorites.length > 0 && favSection && favGrid) {
    favSection.classList.remove('hidden');
    favGrid.innerHTML = '';
    favorites.forEach(entry => favGrid.appendChild(createPrivateHaremCard(entry)));
  } else if (favSection) {
    favSection.classList.add('hidden');
  }

  // 2. Coleções
  const collections = userSessionData?.collections || [];
  if (colBadge) colBadge.textContent = `${collections.length}/15`;
  const btnNewCol = document.getElementById('btn-open-new-collection');
  if (btnNewCol) btnNewCol.disabled = collections.length >= 15;

  if (colContainer) {
    colContainer.innerHTML = '';
    if (collections.length === 0) {
      colContainer.innerHTML = `
        <div style="text-align: center; padding: 18px; border: 1.5px dashed var(--border-retro); border-radius: var(--radius-retro); font-size: 13px; color: var(--text-muted); background: var(--bg-card);">
          <i class="fas fa-folder-open" style="font-size: 24px; display: block; margin-bottom: 6px;"></i>
          Você ainda não possui pastas criadas. Crie até 15 coleções usando o botão acima para organizar suas waifus!
        </div>
      `;
    } else {
      collections.forEach(col => {
        const colCard = document.createElement('div');
        colCard.style.cssText = 'background: var(--bg-card); border: var(--border-retro); border-radius: var(--radius-retro); padding: 14px; box-shadow: var(--shadow-retro-sm);';

        const colChars = harem.filter(e => e.collectionId === col.id);

        colCard.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 16px; font-weight: 800;">📂 ${escapeHtml(col.name)}</span>
              <span class="badge-tag" style="background: #3b82f6; color: #fff; font-weight: 800;">${colChars.length} waifus</span>
            </div>
            <button class="btn-retro btn-sm btn-danger" onclick="confirmDeleteCollection('${col.id}', '${escapeHtml(col.name)}')">
              <i class="fas fa-trash"></i> Excluir Pasta
            </button>
          </div>
          ${col.description ? `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">${escapeHtml(col.description)}</div>` : ''}
          <div class="waifu-grid" id="col-grid-${col.id}"></div>
        `;

        const subGrid = colCard.querySelector(`#col-grid-${col.id}`);
        if (colChars.length > 0) {
          colChars.forEach(entry => subGrid.appendChild(createPrivateHaremCard(entry)));
        } else {
          subGrid.innerHTML = `<div style="grid-column: 1 / -1; padding: 14px; text-align: center; font-size: 13px; color: var(--text-muted); font-style: italic;">Esta pasta está vazia. Clique em "📁 Coleção" em qualquer waifu abaixo para movê-la para cá.</div>`;
        }

        colContainer.appendChild(colCard);
      });
    }
  }

  // 3. Harém Geral (waifus que não estão em nenhuma coleção)
  const generalEntries = harem.filter(e => !e.collectionId);
  if (generalTitle) generalTitle.style.display = 'block';

  grid.innerHTML = '';
  if (generalEntries.length > 0) {
    generalEntries.forEach(entry => grid.appendChild(createPrivateHaremCard(entry)));
  } else {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted); font-weight: bold;">Todas as waifus do seu harém estão organizadas em coleções! ✨</div>';
  }
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

    if (entry.collectionId) {
    try { localStorage.setItem(`waifu_last_col_${char.id}`, entry.collectionId); } catch (_) {}
  }

  const photosCount = (char.imageUrls && Array.isArray(char.imageUrls)) ? char.imageUrls.length : 1;
    const photosBadgeHtml = photosCount > 1
      ? `<div class="badge-photos" style="bottom: 38px; left: 8px;" onclick="event.stopPropagation(); openWaifuPreview('${char.id}')" title="${photosCount} fotos cadastradas">📷 ${photosCount}</div>`
      : '';

    card.innerHTML = `
      <div class="card-img-wrapper" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="Clique para ver detalhes e fotos">
        <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)">
        <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
          ${rarity.emoji} ${rarity.label}
        </div>
        ${marriedBadgeHtml}
        ${entry.isStarWish ? '<div class="badge-married" title="Starwish!">⭐</div>' : ''}
        ${photosBadgeHtml}
        <div class="badge-wishes" data-char-id="${char.id}" title="Desejado por ${char.wishlistCount || 0} pessoa(s). Clique para remover da Wishlist" onclick="event.stopPropagation(); toggleWishlist('${char.id}', null, event)">
          <span>✨</span> <span>${char.wishlistCount || 0}</span>
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
            <button class="btn-retro btn-sm" style="flex: 1;" onclick="openSuggestModal('${char.id}', '${escapeHtml(char.name)}', '${char.baseRarity}')">
              <i class="fas fa-lightbulb"></i> Sugerir
            </button>
          </div>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function createPublicHaremCard(entry) {
  const char = entry.character;
  const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
  const card = document.createElement('div');
  card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}`;
  card.style.borderColor = (char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color;

  const auth = getActiveAuthUser();
  const isWish = auth.wishlistSet.has(char.id);
  const wishTitle = auth.token
    ? (isWish ? 'Na sua Wishlist! Clique para remover' : `Desejado por ${char.wishlistCount || 0} pessoa(s). Clique para adicionar à sua Wishlist`)
    : `Desejado por ${char.wishlistCount || 0} pessoa(s). Faça login para adicionar!`;

  const photosCount = (char.imageUrls && Array.isArray(char.imageUrls)) ? char.imageUrls.length : 1;
  const photosBadgeHtml = photosCount > 1
    ? `<div class="badge-photos" style="bottom: 38px; left: 8px;" onclick="event.stopPropagation(); openWaifuPreview('${char.id}')" title="${photosCount} fotos cadastradas">📷 ${photosCount}</div>`
    : '';

  card.innerHTML = `
    <div class="card-img-wrapper" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="Clique para ver detalhes e fotos">
      <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)">
      <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
        ${rarity.emoji} ${rarity.label}
      </div>
      ${entry.keys ? `<div class="badge-keys"><span>🔑</span> <span>${entry.keys}</span></div>` : ''}
      ${entry.isFavorite ? `<div class="badge-married" style="background: #ec4899; color: white; top: 8px; right: ${entry.keys ? '56px' : '8px'};">💖</div>` : ''}
      ${photosBadgeHtml}
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
  return card;
}

function renderPublicHarem(harem) {
  const haremCountBadge = document.getElementById('public-harem-count');
  const totalCount = userSessionData?.totalHarem !== undefined ? userSessionData.totalHarem : (harem ? harem.length : 0);
  if (haremCountBadge) haremCountBadge.textContent = String(totalCount);

  const favoritesSection = document.getElementById('public-favorites-section');
  const favoritesGrid = document.getElementById('public-favorites-grid');
  const collectionsSection = document.getElementById('public-collections-section');
  const collectionsContainer = document.getElementById('public-collections-container');
  const sectionTitle = document.getElementById('public-harem-section-title');
  const grid = document.getElementById('public-harem-grid');

  if (harem.length === 0) {
    if (favoritesSection) favoritesSection.classList.add('hidden');
    if (collectionsSection) collectionsSection.classList.add('hidden');
    if (sectionTitle) sectionTitle.classList.add('hidden');
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; font-weight: bold;">Este usuário ainda não possui personagens no harém.</div>';
    return;
  }

  sortHaremCards(harem);

  // 1. Favoritas (em cima)
  const favorites = harem.filter(entry => entry.isFavorite).slice(0, 5);
  if (favorites.length > 0 && favoritesSection && favoritesGrid) {
    favoritesSection.classList.remove('hidden');
    favoritesGrid.innerHTML = '';
    favorites.forEach(entry => favoritesGrid.appendChild(createPublicHaremCard(entry)));
  } else if (favoritesSection) {
    favoritesSection.classList.add('hidden');
  }

  // 2. Coleções do Usuário (separadas em pastas)
  const collections = userSessionData?.collections || [];
  const colWithChars = collections.filter(c => harem.some(e => e.collectionId === c.id));

  if (colWithChars.length > 0 && collectionsSection && collectionsContainer) {
    collectionsSection.classList.remove('hidden');
    collectionsContainer.innerHTML = '';

    colWithChars.forEach(col => {
      const colChars = harem.filter(e => e.collectionId === col.id);
      if (colChars.length === 0) return;

      const colBox = document.createElement('div');
      colBox.style.cssText = 'background: var(--bg-card); border: var(--border-retro); border-radius: var(--radius-retro); padding: 14px; box-shadow: var(--shadow-retro-sm);';
      colBox.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <span style="font-size: 16px; font-weight: 800; color: var(--text-main);">📂 ${escapeHtml(col.name)}</span>
          <span class="badge-tag" style="background: #3b82f6; color: #fff; font-weight: 800;">${colChars.length}</span>
        </div>
        ${col.description ? `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">${escapeHtml(col.description)}</div>` : ''}
        <div class="waifu-grid" id="public-col-grid-${col.id}"></div>
      `;

      const subGrid = colBox.querySelector(`#public-col-grid-${col.id}`);
      colChars.forEach(entry => subGrid.appendChild(createPublicHaremCard(entry)));
      collectionsContainer.appendChild(colBox);
    });
  } else if (collectionsSection) {
    collectionsSection.classList.add('hidden');
  }

  // 3. Harém Geral (demais personagens sem coleção e não favoritos)
  const generalOthers = harem.filter(e => !e.collectionId && !favorites.includes(e));
  if (generalOthers.length > 0) {
    if (sectionTitle) sectionTitle.classList.remove('hidden');
    grid.innerHTML = '';
    generalOthers.forEach(entry => grid.appendChild(createPublicHaremCard(entry)));
  } else {
    if (sectionTitle) sectionTitle.classList.add('hidden');
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 20px; color: var(--text-muted); font-weight: bold;">Todas as waifus estão organizadas acima nas coleções! ✨</div>';
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* GERENCIAMENTO DE COLEÇÕES (PASTAS DE HARÉM)                                */
/* ────────────────────────────────────────────────────────────────────────── */

let currentAssignCharId = null;

function openAssignCollectionModal(characterId, characterName, charImg, currentCollectionId) {
  currentAssignCharId = characterId;
  const modal = document.getElementById('modal-assign-collection');
  if (!modal) return;

  document.getElementById('assign-col-char-name').textContent = characterName || characterId;
  const imgEl = document.getElementById('assign-col-char-img');
  if (imgEl) imgEl.src = charImg || '/media/characters/default.jpg';

  const collections = userSessionData?.collections || [];
  const selectEl = document.getElementById('assign-col-select');

  // Recupera a última coleção salva para este personagem (ou atual, ou global recente)
  const lastForChar = localStorage.getItem(`waifu_last_col_${characterId}`) || '';
  const lastGlobal = localStorage.getItem('waifu_last_col_global') || '';

  let effectiveColId = currentCollectionId;
  if (!effectiveColId && lastForChar && collections.some(c => c.id === lastForChar)) {
    effectiveColId = lastForChar;
  } else if (!effectiveColId && lastGlobal && collections.some(c => c.id === lastGlobal)) {
    effectiveColId = lastGlobal;
  }

  if (selectEl) {
    selectEl.innerHTML = `
      <option value="">-- Nenhuma (Harém Geral) --</option>
      ${collections.map(c => `
        <option value="${c.id}" ${c.id === effectiveColId ? 'selected' : ''}>
          📁 ${escapeHtml(c.name)} (${c.characterCount || 0} personagens)
        </option>
      `).join('')}
    `;
    if (effectiveColId && collections.some(c => c.id === effectiveColId)) {
      selectEl.value = effectiveColId;
    } else {
      selectEl.value = '';
    }
  }

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
  if (collections.length >= 15) {
    Api.showToast('Você atingiu o limite máximo de 15 coleções.', '⚠️');
    return;
  }
  const nameInput = document.getElementById('new-collection-name');
  const descInput = document.getElementById('new-collection-desc');
  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
  const infoEl = document.getElementById('new-collection-count-info');
  if (infoEl) infoEl.textContent = `Coleções atuais: ${collections.length}/15`;
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
  if (!confirm(`Deseja realmente apagar a coleção "${collectionName}"?\n\nOs personagens não serão excluídos nem divorciados, apenas retornarão ao harém geral.`)) {
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
    const char = listing.character;
    const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
    const isOwnListing = Boolean(userSessionData && userSessionData.publicId === userPublicId && userSessionData.isAdmin);

    const card = document.createElement('div');
    card.className = `waifu-card rarity-${(char.baseRarity || 'COMMON').toLowerCase()}`;
    card.style.borderColor = (char.baseRarity || 'COMMON') === 'COMMON' ? '#000000' : rarity.color;

    card.innerHTML = `
      <div class="card-img-wrapper">
        <img src="${getCharImg(char)}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)">
        <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
          ${rarity.emoji} ${rarity.label}
        </div>
      </div>
      <div class="card-info">
        <div class="card-name">${escapeHtml(char.name)}</div>
        <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
        <div style="background: var(--bg-retro-accent); padding: 6px 8px; border-radius: 4px; font-size: 12px; margin: 8px 0; border: var(--border-retro);">
          <strong style="color: #f59e0b;"><i class="fas fa-search"></i> Procura:</strong> ${escapeHtml(listing.interest)}
        </div>
        <div class="card-actions" style="margin-top: 8px;">
          ${isOwnListing ? `
            <button class="btn-retro btn-sm" style="width: 100%; opacity: 0.8;" disabled>
              <i class="fas fa-check"></i> Seu Anúncio
            </button>
          ` : `
            <button class="btn-retro btn-sm btn-gold" style="width: 100%;" onclick="handlePublicOfferClick('${listing.id}', '${escapeAttr(char.name)}', '${getCharImg(char)}', '${escapeAttr(listing.interest)}')">
              <i class="fas fa-handshake"></i> Fazer Oferta
            </button>
          `}
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

async function handlePublicOfferClick(listingId, charName, charImg, interest) {
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
        <div class="card-img-wrapper" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="Clique para ver detalhes e fotos">
          <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)">
          <div class="badge-rarity" style="border-color: ${rarityCfg.color}; color: ${rarityCfg.color};" title="Raridade: ${rarityCfg.label}">
            ${rarityCfg.emoji} ${rarityCfg.label}
          </div>
          ${isMarried ? `<div class="badge-married ${spousePublicId ? 'badge-married-link' : ''}" title="${marriedTooltip}">💍</div>` : ''}
          <div class="badge-wishes" data-char-id="${char.id}" title="${wishlistCount} pessoa(s) adicionaram à wishlist. Clique para alternar Wishlist" onclick="event.stopPropagation(); toggleWishlist('${char.id}', null, event)">
            <span>✨</span> <span>${wishlistCount}</span>
          </div>
          <div class="badge-likes" data-char-id="${char.id}" title="Curtido ${char.likeCount || 0} vez(es). Clique para curtir!" onclick="event.stopPropagation(); registerCardLike('${char.id}', event)">
            <span>❤️</span> <span class="likes-count">${char.likeCount || 0}</span>
          </div>
        </div>
        <div class="card-info">
          <div class="card-name" style="cursor: pointer;" onclick="openWaifuPreview('${char.id}')" title="${escapeHtml(char.name)}">${escapeHtml(char.name)}</div>
          <div class="card-series" title="${escapeHtml(char.series || 'Sem série')}">${escapeHtml(char.series || 'Sem série')}</div>
          <div class="card-actions" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
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
    if (userSessionData.totalHarem !== undefined && userSessionData.totalHarem > 0) {
      userSessionData.totalHarem--;
    }
    const newCount = userSessionData.totalHarem !== undefined ? userSessionData.totalHarem : userSessionData.harem.length;
    document.getElementById('harem-count').textContent = newCount;
    document.getElementById('user-subtitle').textContent = `${newCount} personagens colecionados no harém`;
  } catch (err) {
    Api.showToast('Erro de comunicação ao divorciar.', '❌');
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

      if (auth.isOwner && userSessionData) {
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
      } else {
        visitorWishlistSet.add(charId);
        if (visitorSessionData) {
          if (!Array.isArray(visitorSessionData.wishlist)) visitorSessionData.wishlist = [];
          visitorSessionData.wishlist.push({
            id: res.data?.entry?.id || charId,
            characterId: charId,
            isStarWish: false,
            character: { id: charId },
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
// MODAL DE SUGESTÕES (DADOS COMPLETOS & GALERIA DE FOTOS)
// ========================================================
let userPhotosList = [];
let userPhotoAction = 'ADD'; // 'ADD' | 'DELETE' | 'REPLACE'
let userTargetPhoto = null;

async function openSuggestModal(charId, charName, currentRarity, preloadedChar = null) {
  let char = preloadedChar;
  if (!char || !char.imageUrls) {
    try {
      const res = await Api.get(`/characters/${encodeURIComponent(charId)}`);
      if (res?.data) char = res.data;
    } catch (_) {}
  }

  activeSuggestCharacter = char || { id: charId, name: charName, baseRarity: currentRarity };
  activeSuggestCharacter.wasEverMarried = Boolean(
    activeSuggestCharacter.wasEverMarried ||
    activeSuggestCharacter.isClaimed ||
    (activeSuggestCharacter.claimCount && activeSuggestCharacter.claimCount > 0) ||
    activeSuggestCharacter.owner
  );

  const nameEl = document.getElementById('suggest-char-name');
  if (nameEl) nameEl.textContent = `Personagem: ${activeSuggestCharacter.name || charName}`;

  const seriesBadge = document.getElementById('suggest-char-series-badge');
  if (seriesBadge) seriesBadge.textContent = activeSuggestCharacter.series ? `Série: ${activeSuggestCharacter.series}` : '';

  const currBadge = document.getElementById('suggest-current-rarity');
  const cfg = RARITY_CONFIG[activeSuggestCharacter.baseRarity || currentRarity] || RARITY_CONFIG.COMMON;
  if (currBadge) {
    currBadge.style.borderColor = cfg.color;
    currBadge.style.color = cfg.color;
    currBadge.textContent = `${cfg.emoji} ${cfg.label}`;
  }

  // Preenche aba Dados com valores atuais para referência
  const editName = document.getElementById('suggest-edit-name');
  if (editName) editName.value = activeSuggestCharacter.name || '';

  const editSeries = document.getElementById('suggest-edit-series');
  if (editSeries) editSeries.value = activeSuggestCharacter.series || '';

  const editGender = document.getElementById('suggest-edit-gender');
  if (editGender) editGender.value = activeSuggestCharacter.gender || 'FEMALE';

  const editRarity = document.getElementById('suggest-edit-rarity');
  if (editRarity) editRarity.value = activeSuggestCharacter.baseRarity || currentRarity || 'COMMON';

  const editTags = document.getElementById('suggest-edit-tags');
  if (editTags) {
    editTags.value = Array.isArray(activeSuggestCharacter.tags) ? activeSuggestCharacter.tags.join(', ') : '';
  }

  // Tags Chips
  suggestTagsState = Array.isArray(activeSuggestCharacter.tags) ? [...activeSuggestCharacter.tags] : [];
  renderSuggestTagsChips();

  const editDesc = document.getElementById('suggest-edit-description');
  if (editDesc) editDesc.value = activeSuggestCharacter.description || '';

  const editReason = document.getElementById('suggest-edit-reason');
  if (editReason) editReason.value = '';

  // Reseta input de foto lendária para personagem casado
  const legInput = document.getElementById('suggest-legendary-photo-input');
  if (legInput) legInput.value = '';
  const legPrevBox = document.getElementById('suggest-legendary-preview-container');
  if (legPrevBox) legPrevBox.classList.add('hidden');
  const legPrevImg = document.getElementById('suggest-legendary-preview-img');
  if (legPrevImg) legPrevImg.src = '';

  updateSuggestLegendaryMarriedBox();

  // Prepara fotos
  userPhotosList = Array.isArray(activeSuggestCharacter.imageUrls) && activeSuggestCharacter.imageUrls.length > 0
    ? [...activeSuggestCharacter.imageUrls]
    : (activeSuggestCharacter.imageUrl ? [activeSuggestCharacter.imageUrl] : []);

  renderUserPhotosGrid();
  cancelUserPhotoAction();

  // Reseta abas para a primeira
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

function renderSuggestTagsChips() {
  const container = document.getElementById('suggest-tags-chips-container');
  const hiddenInput = document.getElementById('suggest-edit-tags');
  if (!container) return;

  container.innerHTML = '';
  if (suggestTagsState.length === 0) {
    container.innerHTML = '<span style="font-size: 11px; color: #94a3b8; font-style: italic;">Nenhuma tag adicionada.</span>';
  } else {
    suggestTagsState.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = `
        #${escapeHtml(tag)}
        <button type="button" class="tag-chip-remove" title="Remover tag" onclick="removeSuggestTag('${escapeAttr(tag)}')">&times;</button>
      `;
      container.appendChild(chip);
    });
  }

  if (hiddenInput) {
    hiddenInput.value = suggestTagsState.join(', ');
  }
}

function addSuggestTag(tag) {
  const input = document.getElementById('suggest-new-tag-input');
  const rawTag = (tag !== undefined ? tag : input?.value || '').trim().replace(/^#+/, '').toLowerCase();
  if (!rawTag) return;

  if (rawTag.length < 2 || rawTag.length > 30) {
    Api.showToast('A tag deve ter entre 2 e 30 caracteres.', '⚠️');
    return;
  }

  if (suggestTagsState.includes(rawTag)) {
    Api.showToast('Esta tag já foi adicionada.', 'ℹ️');
    return;
  }

  suggestTagsState.push(rawTag);
  renderSuggestTagsChips();
  if (input) input.value = '';
}

function removeSuggestTag(tagToRemove) {
  suggestTagsState = suggestTagsState.filter(t => t !== tagToRemove);
  renderSuggestTagsChips();
}

function renderUserPhotosGrid() {
  const container = document.getElementById('suggest-photos-grid');
  const countEl = document.getElementById('suggest-photos-count');
  if (countEl) countEl.textContent = userPhotosList.length;
  if (!container) return;

  container.innerHTML = '';
  if (userPhotosList.length === 0) {
    container.innerHTML = '<div style="grid-column: 1 / -1; font-size: 12px; color: #64748b; font-style: italic; padding: 12px; background: #fff; border: 1px dashed #cbd5e1; border-radius: 4px; text-align: center;">Nenhuma foto cadastrada para este personagem.</div>';
    return;
  }

  userPhotosList.forEach((src, idx) => {
    const item = document.createElement('div');
    item.style.position = 'relative';
    item.style.border = '1.5px solid #2d241e';
    item.style.borderRadius = '4px';
    item.style.overflow = 'hidden';
    item.style.background = '#111';

    item.innerHTML = `
      <div style="aspect-ratio: 9/14; width: 100%; position: relative;">
        <img src="${src}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='/media/characters/default.jpg'">
        <span style="position: absolute; top: 4px; left: 4px; background: rgba(0,0,0,0.7); color: #fff; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 3px;">#${idx + 1}</span>
      </div>
      <div style="padding: 4px; background: #fff; border-top: 1px solid #2d241e; display: flex; flex-direction: column; gap: 4px;">
        <button type="button" class="btn-retro btn-sm btn-gold" style="padding: 2px 4px; font-size: 11px; width: 100%;" onclick="triggerUserReplacePhoto('${escapeAttr(src)}', ${idx})">
          🔄 Substituir
        </button>
        <button type="button" class="btn-retro btn-sm btn-danger" style="padding: 2px 4px; font-size: 11px; width: 100%;" onclick="triggerUserDeletePhoto('${escapeAttr(src)}', ${idx})">
          🗑️ Excluir
        </button>
      </div>
    `;
    container.appendChild(item);
  });
}

function triggerUserAddPhoto() {
  userPhotoAction = 'ADD';
  userTargetPhoto = null;
  const box = document.getElementById('user-photo-action-box');
  const title = document.getElementById('user-photo-action-title');
  const deleteForm = document.getElementById('user-photo-delete-form');
  const uploadForm = document.getElementById('user-photo-upload-form');

  if (title) title.innerHTML = '➕ <b>Sugerir Nova Foto Extra:</b>';
  if (deleteForm) deleteForm.classList.add('hidden');
  if (uploadForm) uploadForm.classList.remove('hidden');
  if (box) box.classList.remove('hidden');

  const fileInput = document.getElementById('suggest-file-input');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
}

function triggerUserReplacePhoto(targetPhoto, idx) {
  userPhotoAction = 'REPLACE';
  userTargetPhoto = targetPhoto;
  const box = document.getElementById('user-photo-action-box');
  const title = document.getElementById('user-photo-action-title');
  const deleteForm = document.getElementById('user-photo-delete-form');
  const uploadForm = document.getElementById('user-photo-upload-form');

  if (title) title.innerHTML = `🔄 <b>Sugerir Substituição da Foto #${idx + 1}:</b>`;
  if (deleteForm) deleteForm.classList.add('hidden');
  if (uploadForm) uploadForm.classList.remove('hidden');
  if (box) box.classList.remove('hidden');

  const fileInput = document.getElementById('suggest-file-input');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
}

function triggerUserDeletePhoto(targetPhoto, idx) {
  userPhotoAction = 'DELETE';
  userTargetPhoto = targetPhoto;
  const box = document.getElementById('user-photo-action-box');
  const title = document.getElementById('user-photo-action-title');
  const deleteForm = document.getElementById('user-photo-delete-form');
  const uploadForm = document.getElementById('user-photo-upload-form');

  if (title) title.innerHTML = `🗑️ <b>Sugerir Exclusão da Foto #${idx + 1}:</b>`;
  if (uploadForm) uploadForm.classList.add('hidden');
  if (deleteForm) deleteForm.classList.remove('hidden');
  if (box) box.classList.remove('hidden');

  const reasonInput = document.getElementById('user-photo-delete-reason');
  if (reasonInput) {
    reasonInput.value = '';
    reasonInput.focus();
  }
}

function cancelUserPhotoAction() {
  const box = document.getElementById('user-photo-action-box');
  if (box) box.classList.add('hidden');
  const crop = document.getElementById('cropper-container');
  if (crop) crop.classList.add('hidden');
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
  const fileInput = document.getElementById('suggest-file-input');
  if (fileInput) fileInput.value = '';
  userTargetPhoto = null;
}

let isSubmittingSuggestion = false;

async function submitUserDeletePhotoSuggestion() {
  if (isSubmittingSuggestion) return;
  if (!activeSuggestCharacter || !userTargetPhoto) return;
  const reasonInput = document.getElementById('user-photo-delete-reason');
  const reason = reasonInput ? reasonInput.value.trim() : '';

  if (!reason || reason.length < 5) {
    Api.showToast('Informe o motivo da exclusão com pelo menos 5 caracteres.', '⚠️');
    return;
  }

  isSubmittingSuggestion = true;
  try {
    const res = await Api.post(`/api/web/user/${userPublicId}/suggestions`, {
      token: userSessionToken,
      type: 'IMAGE',
      characterId: activeSuggestCharacter.id,
      action: 'DELETE',
      targetPhoto: userTargetPhoto,
      reason,
    });

    if (!res.success) {
      Api.showToast(res.error?.message || 'Falha ao enviar sugestão de exclusão.', '❌');
      return;
    }

    closeModal('modal-suggest');
    Api.showToast('Sugestão de exclusão de foto enviada para moderação!', '🗑️');
    if (typeof loadUserSuggestions === 'function') loadUserSuggestions();
  } catch (err) {
    Api.showToast('Erro de comunicação ao enviar sugestão.', '❌');
  } finally {
    isSubmittingSuggestion = false;
  }
}

async function submitUserPhotoCropSuggestion() {
  if (isSubmittingSuggestion) return;
  if (!activeSuggestCharacter || !cropperInstance) return;

  const btnCrop = document.getElementById('btn-submit-crop');
  const reasonEl = document.getElementById('suggest-photo-reason');
  const reason = reasonEl ? reasonEl.value.trim() : '';

  const canvas = cropperInstance.getCroppedCanvas({ width: 450, height: 700 });
  if (btnCrop) btnCrop.disabled = true;
  isSubmittingSuggestion = true;

  canvas.toBlob(async (blob) => {
    if (!blob) {
      Api.showToast('Falha ao processar recorte de imagem.', '❌');
      if (btnCrop) btnCrop.disabled = false;
      isSubmittingSuggestion = false;
      return;
    }

    const formData = new FormData();
    formData.append('token', userSessionToken);
    formData.append('type', 'IMAGE');
    formData.append('characterId', activeSuggestCharacter.id);
    formData.append('action', userPhotoAction);
    if (userTargetPhoto) {
      formData.append('targetPhoto', userTargetPhoto);
    }
    formData.append('reason', reason);
    formData.append('image', blob, 'user_photo.png');

    try {
      const res = await Api.post(`/api/web/user/${userPublicId}/suggestions`, formData);
      if (!res.success) {
        Api.showToast(res.error?.message || 'Falha ao enviar foto.', '❌');
        return;
      }

      closeModal('modal-suggest');
      const msg = userPhotoAction === 'REPLACE'
        ? 'Sugestão de substituição de foto enviada para a moderação!'
        : 'Sugestão de nova foto enviada para a moderação!';
      Api.showToast(msg, '🖼️');
      if (typeof loadUserSuggestions === 'function') loadUserSuggestions();
    } catch (err) {
      Api.showToast('Erro de comunicação ao enviar imagem.', '❌');
    } finally {
      if (btnCrop) btnCrop.disabled = false;
      isSubmittingSuggestion = false;
    }
  }, 'image/png');
}

function updateSuggestLegendaryMarriedBox() {
  const raritySelect = document.getElementById('suggest-edit-rarity');
  const box = document.getElementById('suggest-legendary-married-box');
  const btn = document.getElementById('btn-submit-edit-info');
  if (!raritySelect || !box) return;

  const isLegendary = raritySelect.value === 'LEGENDARY';
  const wasEverMarried = Boolean(activeSuggestCharacter?.wasEverMarried);

  if (wasEverMarried && isLegendary) {
    box.classList.remove('hidden');
    if (btn) btn.innerHTML = '<i class="fas fa-star"></i> Enviar Sugestão de Novo Personagem Lendário';
  } else {
    box.classList.add('hidden');
    if (btn) btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Sugestão de Dados';
  }
}

async function submitEditInfoSuggestion() {
  if (isSubmittingSuggestion) return;
  if (!activeSuggestCharacter) return;

  const suggestedName = document.getElementById('suggest-edit-name')?.value.trim();
  const suggestedSeries = document.getElementById('suggest-edit-series')?.value.trim();
  const suggestedGender = document.getElementById('suggest-edit-gender')?.value;
  const suggestedRarity = document.getElementById('suggest-edit-rarity')?.value;
  const suggestedTags = Array.isArray(suggestTagsState) ? suggestTagsState : [];
  const suggestedDescription = document.getElementById('suggest-edit-description')?.value.trim();
  const reason = document.getElementById('suggest-edit-reason')?.value.trim();

  if (!reason || reason.length < 5) {
    Api.showToast('Por favor, informe uma justificativa válida com pelo menos 5 caracteres.', '⚠️');
    return;
  }

  // Regra especial: Personagem já casado sugerido como LENDÁRIO cria NOVO personagem e exige foto
  const wasEverMarried = Boolean(activeSuggestCharacter.wasEverMarried);
  if (wasEverMarried && suggestedRarity === 'LEGENDARY') {
    const photoFile = document.getElementById('suggest-legendary-photo-input')?.files?.[0];
    if (!photoFile) {
      Api.showToast('É obrigatório fornecer uma nova foto para criar a versão lendária de um personagem já casado.', '⚠️');
      return;
    }

    const btnEdit = document.getElementById('btn-submit-edit-info');
    if (btnEdit) btnEdit.disabled = true;
    isSubmittingSuggestion = true;

    const formData = new FormData();
    formData.append('token', userSessionToken);
    formData.append('type', 'NEW_CHARACTER');
    formData.append('characterId', activeSuggestCharacter.id);
    formData.append('name', suggestedName || activeSuggestCharacter.name);
    formData.append('series', suggestedSeries || activeSuggestCharacter.series);
    formData.append('rarity', 'LEGENDARY');
    if (suggestedDescription) formData.append('description', suggestedDescription);
    formData.append('reason', reason ? `[Versão Lendária] ${reason}` : '[Versão Lendária]');
    formData.append('photo', photoFile);

    try {
      const res = await Api.post(`/api/web/user/${userPublicId}/suggestions`, formData);
      if (!res.success) {
        Api.showToast(res.error?.message || 'Falha ao enviar sugestão lendária.', '❌');
        return;
      }

      closeModal('modal-suggest');
      Api.showToast('Sugestão de novo personagem na versão Lendária enviada para moderação!', '⭐');
      if (typeof loadUserSuggestions === 'function') loadUserSuggestions();
    } catch (err) {
      Api.showToast('Erro de comunicação ao enviar sugestão.', '❌');
    } finally {
      if (btnEdit) btnEdit.disabled = false;
      isSubmittingSuggestion = false;
    }
    return;
  }

  // Validação: Garante que pelo menos um campo foi de fato alterado em relação aos dados atuais
  const nameChanged = suggestedName && suggestedName !== (activeSuggestCharacter.name || '').trim();
  const seriesChanged = suggestedSeries && suggestedSeries !== (activeSuggestCharacter.series || '').trim();
  const genderChanged = suggestedGender && suggestedGender !== (activeSuggestCharacter.gender || '');
  const rarityChanged = suggestedRarity && suggestedRarity !== (activeSuggestCharacter.baseRarity || '');
  const curTagsNorm = [...(activeSuggestCharacter.tags || [])].sort().join(',');
  const sugTagsNorm = [...suggestedTags].sort().join(',');
  const tagsChanged = sugTagsNorm !== curTagsNorm;
  const curDesc = (activeSuggestCharacter.description || '').trim();
  const sugDesc = (suggestedDescription || '').trim();
  const descChanged = sugDesc !== curDesc;

  if (!nameChanged && !seriesChanged && !genderChanged && !rarityChanged && !tagsChanged && !descChanged) {
    Api.showToast('Nenhum campo do personagem foi modificado! Altere a descrição, nome, série ou tags diretamente nos campos acima em vez de colocar apenas na justificativa.', '⚠️');
    return;
  }

  const btnEdit = document.getElementById('btn-submit-edit-info');
  if (btnEdit) btnEdit.disabled = true;
  isSubmittingSuggestion = true;

  try {
    const res = await Api.post(`/api/web/user/${userPublicId}/suggestions`, {
      token: userSessionToken,
      type: 'EDIT',
      characterId: activeSuggestCharacter.id,
      suggestedName,
      suggestedSeries,
      suggestedGender,
      suggestedRarity,
      suggestedTags,
      suggestedDescription,
      reason,
    });

    if (!res.success) {
      Api.showToast(res.error?.message || 'Falha ao enviar sugestão.', '❌');
      return;
    }

    closeModal('modal-suggest');
    Api.showToast('Sugestão de alteração de dados enviada para moderação!', '💡');
    if (typeof loadUserSuggestions === 'function') loadUserSuggestions();
  } catch (err) {
    Api.showToast('Erro de comunicação ao enviar sugestão.', '❌');
  } finally {
    if (btnEdit) btnEdit.disabled = false;
    isSubmittingSuggestion = false;
  }
}

async function submitRaritySuggestion() {
  // Alias de compatibilidade se acionado diretamente
  submitEditInfoSuggestion();
}

async function submitImageSuggestion() {
  // Alias de compatibilidade
  submitUserPhotoCropSuggestion();
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
        if (s.type === 'IMAGE') {
          detail += ` &rarr; Nova Foto`;
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

// ========================================================
// ABA 6: NOTIFICAÇÕES DO USUÁRIO
// ========================================================
let notificationsFilterUnreadOnly = false;
let userNotificationsCache = [];

async function loadUserNotifications() {
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

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
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
  if (cRarity && RARITY_CONFIG[cRarity]) {
    const r = RARITY_CONFIG[cRarity];
    rarityEl.innerHTML = `<span style="color:${r.color}; font-weight:800;">${r.emoji} ${r.label}</span>`;
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
    if (isClaimed) {
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

  // Botão de Wishlist
  const wishesCountEl = document.getElementById('waifu-preview-wishes-count');
  if (wishesCountEl) wishesCountEl.textContent = cWishes;
  const btnWish = document.getElementById('btn-preview-wish');
  if (btnWish) {
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

  // Tags
  const tagsEl = document.getElementById('waifu-preview-tags');
  if (tagsEl) {
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
      if (isMarriedToMe) {
        // Favoritar
        const isFav = (userSessionData?.harem || []).some(h => (h.character?.id || h.characterId) === charId && h.isFavorite);
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
        sellBtn.innerHTML = '<i class="fas fa-tag"></i> 💰 Vender nos Classificados';
        sellBtn.onclick = () => { closeModal('modal-waifu-preview'); openSellModal(charId, cName, images[0], cSeries); };
        actionsEl.appendChild(sellBtn);

        // Divorciar
        const divBtn = document.createElement('button');
        divBtn.className = 'btn-retro btn-sm btn-danger';
        divBtn.style.cssText = 'width: 100%; font-weight: 800;';
        divBtn.innerHTML = '<i class="fas fa-heart-crack"></i> Divorciar';
        divBtn.onclick = () => { closeModal('modal-waifu-preview'); openDivorceModal(charId, cName); };
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

function switchTab(tabId) {
  const tabBtn = document.querySelector(`.retro-tabs .retro-tab[data-tab="${tabId}"]`);
  if (tabBtn) tabBtn.click();
}

function openSellModal(characterId, characterName, imageUrl, series) {
  activeSellCharacter = { id: characterId, name: characterName };
  document.getElementById('sell-modal-char-name').textContent = characterName;
  document.getElementById('sell-modal-char-series').textContent = series || 'Sem série';
  document.getElementById('sell-modal-char-img').src = getCharImg(imageUrl);
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
          <img src="${getCharImg(char)}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)">
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
            <button class="btn-retro btn-sm ${offersBtnClass}" style="width: 100%;" onclick="openViewOffersModal('${listing.id}', '${escapeAttr(char.name)}')">
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
        if (Array.isArray(offered.waifus) && offered.waifus.length > 0) {
          parts.push(`<div><strong>Waifus (${offered.waifus.length}):</strong> ${offered.waifus.map(w => {
            const wImg = getCharImg(w);
            const wSeries = escapeAttr(w.series || '');
            const wRarity = w.baseRarity || '';
            const wName = escapeAttr(w.name || w.id);
            return `<button type="button" class="badge-tag" style="background:#8b5cf6;color:#fff;border:none;cursor:pointer;margin:2px;padding:3px 8px;font-size:12px;" onclick="openWaifuPreview('${w.id}', '${wName}', '${wImg}', '${wSeries}', '${wRarity}')"><i class="fas fa-image"></i> ${escapeHtml(w.name || w.id)}</button>`;
          }).join(' ')}</div>`);
        } else if (Array.isArray(offered.waifuIds) && offered.waifuIds.length > 0) {
          parts.push(`<div><strong>Waifus (${offered.waifuIds.length}):</strong> ${offered.waifuIds.map(wId => {
            return `<button type="button" class="badge-tag" style="background:#8b5cf6;color:#fff;border:none;cursor:pointer;margin:2px;padding:3px 8px;font-size:12px;" onclick="openWaifuPreview('${wId}', '${wId}', '', '', '')"><i class="fas fa-image"></i> ${escapeHtml(wId)}</button>`;
          }).join(' ')}</div>`);
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
          parts.push(`<div><strong>Itens de Fazenda:</strong> ${offered.farmItems.map(it => `${it.amount}x ${escapeHtml(it.name || it.itemId)}`).join(', ')}</div>`);
        }
        if (offered.zinthos && Number(offered.zinthos) > 0) {
          parts.push(`<div><strong>Moeda (Zinthos):</strong> <span style="color:#f59e0b;font-weight:800;">🪙 ${Number(offered.zinthos).toLocaleString('pt-BR')} Zinthos</span></div>`);
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
          <img src="${getCharImg(char)}" alt="${escapeHtml(char.name)}" onerror="handleImgError(this)">
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
              <button class="btn-retro btn-sm btn-gold" style="width: 100%;" onclick="openOfferModal('${listing.id}', '${escapeAttr(char.name)}', '${getCharImg(char)}', '${escapeAttr(listing.interest)}')">
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
  document.getElementById('offer-target-img').src = getCharImg(imageUrl);
  document.getElementById('offer-is-free-checkbox').checked = false;
  toggleFreeOffer(false);
  document.getElementById('offer-message-input').value = '';

  const auth = getActiveAuthUser();
  const buyerData = auth.isOwner ? userSessionData : (visitorSessionData || userSessionData);

  const zInput = document.getElementById('offer-zinthos-input');
  if (zInput) zInput.value = '0';
  const balanceEl = document.getElementById('offer-user-zinthos-balance');
  if (balanceEl) {
    balanceEl.textContent = Number(buyerData?.kakera || 0).toLocaleString('pt-BR');
  }

  // 1. Popula Waifus disponíveis do harém do comprador
  const waifusList = document.getElementById('offer-waifus-list');
  const harem = buyerData?.harem || [];
  if (harem.length === 0) {
    waifusList.innerHTML = '<div style="grid-column: 1 / -1; font-size: 12px; color: var(--text-muted); padding: 8px;">Você não possui waifus no harém para oferecer.</div>';
  } else {
    waifusList.innerHTML = harem.map(item => {
      const char = item.character;
      return `
        <label style="border: var(--border-retro); border-radius: 6px; padding: 6px; display: flex; flex-direction: column; align-items: center; cursor: pointer; background: var(--bg-card); font-size: 11px; text-align: center;">
          <img src="${getCharImg(char)}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; margin-bottom: 4px;" onerror="handleImgError(this)">
          <span style="font-weight: 700; max-width: 110px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(char.name)}</span>
          <input type="checkbox" name="offer-waifu-cb" value="${char.id}" style="margin-top: 4px;">
        </label>
      `;
    }).join('');
  }

  // 2. Popula Peixes da Pescaria (agrupados por espécie com quantidade)
  const fishesList = document.getElementById('offer-fishes-list');
  const rawFishes = userSessionData?.inventory?.fishes || [];
  const fishGroups = {};
  rawFishes.forEach(f => {
    const key = f.name || 'Peixe';
    if (!fishGroups[key]) {
      fishGroups[key] = { name: key, items: [], isRare: Boolean(f.is_rare || f.isRare) };
    }
    fishGroups[key].items.push(f);
  });
  const groupList = Object.values(fishGroups);

  if (groupList.length === 0) {
    fishesList.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 8px;">Nenhum peixe na sua mochila de pesca no momento.</div>';
    window.activeFishGroups = [];
  } else {
    window.activeFishGroups = groupList;
    fishesList.innerHTML = groupList.map((g, idx) => {
      const count = g.items.length;
      const avgWeight = (g.items.reduce((acc, it) => acc + (Number(it.weight) || 0), 0) / count).toFixed(1);
      const rareTag = g.isRare ? '⭐ RARO' : '';
      return `
        <div style="display: flex; align-items: center; justify-content: space-between; border: var(--border-retro); padding: 6px 10px; border-radius: 4px; background: var(--bg-card); font-size: 12px;">
          <div>
            🐟 <strong>${escapeHtml(g.name)}</strong>
            <span style="color: var(--text-muted); font-size: 11px; margin-left: 4px;">(~${avgWeight}kg | Em estoque: ${count})</span>
            ${rareTag ? `<span style="color:#eab308;font-weight:bold;margin-left:4px;">${rareTag}</span>` : ''}
          </div>
          <div class="retro-qty-control">
            <button type="button" class="btn-retro btn-sm" onclick="adjustOfferFishGroupQty(${idx}, -1, ${count})">-</button>
            <input type="text" inputmode="numeric" id="fish-group-qty-${idx}" value="0" readonly>
            <button type="button" class="btn-retro btn-sm" onclick="adjustOfferFishGroupQty(${idx}, 1, ${count})">+</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // 3. Popula Buffs Permanentes de Pesca (agrupados com descrição clara e quantidade)
  const buffsList = document.getElementById('offer-buffs-list');
  const rawBuffs = userSessionData?.inventory?.buffs || [];
  const buffGroups = {};
  rawBuffs.forEach(b => {
    const key = b.originalName || b.original_name || b.type || 'Buff';
    if (!buffGroups[key]) {
      buffGroups[key] = {
        name: key,
        type: b.type,
        description: b.description || getLocalBuffDescription(b.type),
        items: []
      };
    }
    buffGroups[key].items.push(b);
  });
  const buffGroupList = Object.values(buffGroups);

  if (buffGroupList.length === 0) {
    buffsList.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 8px;">Nenhum buff de pesca permanente no seu inventário.</div>';
    window.activeBuffGroups = [];
  } else {
    window.activeBuffGroups = buffGroupList;
    buffsList.innerHTML = buffGroupList.map((bg, idx) => {
      const count = bg.items.length;
      return `
        <div style="display: flex; align-items: center; justify-content: space-between; border: var(--border-retro); padding: 6px 10px; border-radius: 4px; background: var(--bg-card); font-size: 12px;">
          <div>
            ⚡ <strong>${escapeHtml(bg.name)}</strong>
            <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(bg.description)} <span style="font-weight:700;">(Estoque: ${count})</span></div>
          </div>
          <div class="retro-qty-control">
            <button type="button" class="btn-retro btn-sm" onclick="adjustOfferBuffGroupQty(${idx}, -1, ${count})">-</button>
            <input type="text" inputmode="numeric" id="buff-group-qty-${idx}" value="0" readonly>
            <button type="button" class="btn-retro btn-sm" onclick="adjustOfferBuffGroupQty(${idx}, 1, ${count})">+</button>
          </div>
        </div>
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
          <div class="retro-qty-control">
            <button type="button" class="btn-retro btn-sm" onclick="adjustOfferFarmQty('${it.itemId}', -1, ${maxQty})">-</button>
            <input type="text" inputmode="numeric" id="farm-qty-${it.itemId}" value="0" readonly>
            <button type="button" class="btn-retro btn-sm" onclick="adjustOfferFarmQty('${it.itemId}', 1, ${maxQty})">+</button>
          </div>
        </div>
      `;
    }).join('');
  }

  openModal('modal-market-offer');
}

function adjustOfferFishGroupQty(idx, delta, max) {
  const input = document.getElementById(`fish-group-qty-${idx}`);
  if (!input) return;
  let val = parseInt(input.value, 10) || 0;
  val = Math.max(0, Math.min(max, val + delta));
  input.value = val;
}

function adjustOfferBuffGroupQty(idx, delta, max) {
  const input = document.getElementById(`buff-group-qty-${idx}`);
  if (!input) return;
  let val = parseInt(input.value, 10) || 0;
  val = Math.max(0, Math.min(max, val + delta));
  input.value = val;
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

  const selectedFishes = [];
  if (Array.isArray(window.activeFishGroups)) {
    window.activeFishGroups.forEach((g, idx) => {
      const input = document.getElementById(`fish-group-qty-${idx}`);
      const qty = parseInt(input?.value, 10) || 0;
      if (qty > 0) {
        for (let i = 0; i < qty && i < g.items.length; i++) {
          const item = g.items[i];
          selectedFishes.push({
            id: item.id,
            name: item.name,
            weight: Number(item.weight) || 0,
            isRare: item.isRare,
          });
        }
      }
    });
  }

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

  const zinthos = parseInt(document.getElementById('offer-zinthos-input')?.value, 10) || 0;

  if (!isFree && selectedWaifuIds.length === 0 && selectedFishes.length === 0 && selectedBuffs.length === 0 && farmItems.length === 0 && zinthos <= 0) {
    Api.showToast('Selecione ao menos um item, waifu ou Zinthos para oferecer (ou marque "Pedir de graça").', '⚠️');
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
        if (offered.zinthos && Number(offered.zinthos) > 0) parts.push(`🪙 ${Number(offered.zinthos).toLocaleString('pt-BR')} zinthos`);
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

// Funções de controle de Zinthos no modal de oferta
function setOfferZinthosMax() {
  const max = Number(userSessionData?.kakera || 0);
  const input = document.getElementById('offer-zinthos-input');
  if (input) input.value = max;
}

function setOfferZinthosZero() {
  const input = document.getElementById('offer-zinthos-input');
  if (input) input.value = '0';
}

function addOfferZinthos(amount) {
  const input = document.getElementById('offer-zinthos-input');
  if (!input) return;
  const current = parseInt(input.value, 10) || 0;
  const max = Number(userSessionData?.kakera || 0);
  input.value = Math.min(max, current + amount);
}

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
      const actionBtn = !isIgnored
        ? `<button class="btn-retro btn-sm btn-danger" onclick="ignoreHaremCovet('${characterId}', '${covet.id}')"><i class="fas fa-eye-slash"></i> Ignorar</button>`
        : '<span style="color: var(--text-muted); font-size: 11px;">Ignorado</span>';

      return `
        <tr>
          <td><strong>${escapeHtml(covet.userName)}</strong></td>
          <td style="font-size: 12px; color: var(--text-muted);">${date}</td>
          <td>${statusHtml}</td>
          <td style="text-align: right;">${actionBtn}</td>
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
      rarityEl.innerHTML = `<span style="color: ${rarity.color};">${rarity.emoji} ${rarity.label}</span>`;
    }

    const cotaPriceEl = document.getElementById('invest-modal-cota-price');
    if (cotaPriceEl) {
      cotaPriceEl.textContent = `${Number(pricing.cotaPrice).toLocaleString('pt-BR')} Zinthos`;
    }

    const totalPriceEl = document.getElementById('invest-modal-total-price');
    if (totalPriceEl) {
      totalPriceEl.textContent = `${Number(pricing.dynamicPrice).toLocaleString('pt-BR')} Zinthos`;
    }

    const userSharesEl = document.getElementById('invest-modal-user-shares');
    if (userSharesEl) {
      userSharesEl.textContent = `${userShares} / 4 cotas (${userShares * 25}%)`;
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
      if (remainingShares === 0) {
        select.innerHTML = '<option value="0">Todas as 4 cotas já adquiridas</option>';
        select.disabled = true;
      } else {
        select.disabled = false;
        for (let i = 1; i <= remainingShares; i++) {
          const opt = document.createElement('option');
          opt.value = String(i);
          const pct = (userShares + i) * 25;
          opt.textContent = `${i} cota(s) (+${i * 25}% ➔ Total: ${pct}%)${userShares + i === 4 ? ' — 💍 Casamento Imediato' : ''}`;
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

      if (userShares + shares >= 4) {
        confirmBtn.innerHTML = '<i class="fas fa-ring"></i> Confirmar Casamento (4 Cotas)';
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

    if (res.data.acquired) {
      Api.showToast(`💍 Parabéns! Você adquiriu as 4 cotas (100%) e se casou com ${charName}! 🎉`, '✨');
      setTimeout(() => loadUserData(), 600);
    } else {
      Api.showToast(`📈 Sucesso! Você adquiriu ${shares} cota(s) de ${charName}. Total: ${res.data.totalShares} cotas.`, '✅');
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
async function loadRankings() {
  const tbodyZinthos = document.getElementById('tbody-ranking-zinthos');
  const tbodyWaifus = document.getElementById('tbody-ranking-waifus');
  if (!tbodyZinthos || !tbodyWaifus) return;

  if (userRankingsLoaded) return;

  try {
    const [resUsers, resHarem] = await Promise.all([
      Api.get('/leaderboard/users?limit=25'),
      Api.get('/leaderboard/harem?limit=25'),
    ]);

    // 1. Ranking por Zinthos
    const topRich = resUsers?.data?.topRich || [];
    if (topRich.length === 0) {
      tbodyZinthos.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 20px;">Nenhum registro ainda.</td></tr>`;
    } else {
      tbodyZinthos.innerHTML = topRich
        .map((u, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`;
          const nameHtml = u.publicId
            ? `<a href="/user/${u.publicId}" target="_blank" style="text-decoration:none; color:inherit; font-weight:800;">${escapeHtml(u.name)}</a>`
            : `<strong>${escapeHtml(u.name)}</strong>`;
          const zinthos = Number(u.kakera || 0).toLocaleString('pt-BR');
          const haremCount = u._count?.harem || 0;

          return `
            <tr>
              <td style="text-align: center; font-weight: 800;">${medal}</td>
              <td>${nameHtml}</td>
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
      tbodyWaifus.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 20px;">Nenhum registro ainda.</td></tr>`;
    } else {
      tbodyWaifus.innerHTML = topHarem
        .map((u, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`;
          const nameHtml = u.publicId
            ? `<a href="/user/${u.publicId}" target="_blank" style="text-decoration:none; color:inherit; font-weight:800;">${escapeHtml(u.name)}</a>`
            : `<strong>${escapeHtml(u.name)}</strong>`;
          const totalMarriages = Number(u.totalMarriages || 0).toLocaleString('pt-BR');
          const points = Number(u.collectionPoints || 0).toLocaleString('pt-BR');

          return `
            <tr>
              <td style="text-align: center; font-weight: 800;">${medal}</td>
              <td>${nameHtml}</td>
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
    tbodyZinthos.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 20px;">Erro ao carregar dados.</td></tr>`;
    tbodyWaifus.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 20px;">Erro ao carregar dados.</td></tr>`;
  }
}




