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
  // Compartilhar Harém (Link limpo sem token)
  document.getElementById('btn-share-public').addEventListener('click', () => {
    const cleanUrl = `${window.location.origin}/user/${userPublicId}`;
    Api.copyToClipboard(cleanUrl, 'Link público do harém copiado!');
  });

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

      if (targetId === 'tab-search') {
        loadPanelSearchResults();
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

  // Busca na aba de pesquisa
  let searchTimer = null;
  const panelSearchInput = document.getElementById('panel-search-input');
  if (panelSearchInput) {
    panelSearchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadPanelSearchResults, 300);
    });
  }

  const panelRaritySelect = document.getElementById('panel-rarity-select');
  if (panelRaritySelect) {
    panelRaritySelect.addEventListener('change', loadPanelSearchResults);
  }

  const panelGenderPills = document.querySelectorAll('#panel-gender-pills .retro-pill');
  panelGenderPills.forEach(pill => {
    pill.addEventListener('click', () => {
      panelGenderPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      loadPanelSearchResults();
    });
  });

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
  document.getElementById('btn-submit-image').addEventListener('click', submitImageSuggestion);
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

    if (isOwner) {
      // Inicia contador de sessão ativa
      renderSessionTimer(userSessionData.expiresIn);

      document.getElementById('private-panel').classList.remove('hidden');
      document.getElementById('public-panel').classList.add('hidden');

      renderPrivateHarem(harem);
      renderPrivateWishlist(userSessionData.wishlist || []);
    } else {
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

function renderPrivateHarem(harem) {
  const grid = document.getElementById('harem-grid');
  document.getElementById('harem-count').textContent = harem.length;

  if (harem.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; font-weight: bold;">Seu harém ainda está vazio. Jogue no WhatsApp usando !mu-roll para casar com waifus!</div>';
    return;
  }

  grid.innerHTML = '';
  harem.forEach(entry => {
    const char = entry.character;
    const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
    const card = document.createElement('div');
    card.className = 'waifu-card';
    card.id = `harem-card-${char.id}`;

    card.innerHTML = `
      <div class="card-img-wrapper">
        <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${char.name}" onerror="this.onerror=null;this.src='/media/characters/default.jpg';">
        <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
          ${rarity.emoji} ${rarity.label}
        </div>
        ${entry.keys ? `<div class="badge-wishes"><span>🔑</span> <span>${entry.keys}</span></div>` : ''}
        ${entry.isFavorite ? `<div class="badge-married" title="Favorita em destaque!">💖</div>` : ''}
      </div>
      <div class="card-info">
        <div class="card-name">${char.name}</div>
        <div class="card-series">${char.series || 'Sem série'}</div>
        <div class="card-actions">
          <button class="btn-retro btn-sm btn-danger" onclick="openDivorceModal('${char.id}', '${escapeHtml(char.name)}')">
            <i class="fas fa-heart-crack"></i> Divorciar
          </button>
          <button class="btn-retro btn-sm" onclick="openSuggestModal('${char.id}', '${escapeHtml(char.name)}', '${char.baseRarity}')">
            <i class="fas fa-lightbulb"></i> Sugerir
          </button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function renderPrivateWishlist(wishlist) {
  const grid = document.getElementById('wishlist-grid');
  document.getElementById('wishlist-count').textContent = wishlist.length;

  if (wishlist.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; font-weight: bold;">Sua wishlist está vazia. Use a aba "Buscar & Adicionar" para desejar personagens!</div>';
    return;
  }

  grid.innerHTML = '';
  wishlist.forEach(entry => {
    const char = entry.character;
    const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
    const card = document.createElement('div');
    card.className = 'waifu-card';
    card.id = `wish-card-${char.id}`;

    card.innerHTML = `
      <div class="card-img-wrapper">
        <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${char.name}">
        <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
          ${rarity.emoji} ${rarity.label}
        </div>
        ${entry.isStarWish ? '<div class="badge-married" title="Starwish!">⭐</div>' : ''}
      </div>
      <div class="card-info">
        <div class="card-name">${char.name}</div>
        <div class="card-series">${char.series || 'Sem série'}</div>
        <div class="card-actions">
          <button class="btn-retro btn-sm btn-danger" onclick="removeFromWishlist('${char.id}')">
            <i class="fas fa-times"></i> Remover
          </button>
          <button class="btn-retro btn-sm" onclick="openSuggestModal('${char.id}', '${escapeHtml(char.name)}', '${char.baseRarity}')">
            <i class="fas fa-lightbulb"></i> Sugerir
          </button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function renderPublicHarem(harem) {
  const grid = document.getElementById('public-harem-grid');
  if (harem.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 32px; font-weight: bold;">Este usuário ainda não possui personagens no harém.</div>';
    return;
  }

  grid.innerHTML = '';
  harem.forEach(entry => {
    const char = entry.character;
    const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
    const card = document.createElement('div');
    card.className = 'waifu-card';

    card.innerHTML = `
      <div class="card-img-wrapper">
        <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${char.name}">
        <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
          ${rarity.emoji} ${rarity.label}
        </div>
        ${entry.keys ? `<div class="badge-wishes"><span>🔑</span> <span>${entry.keys}</span></div>` : ''}
        ${entry.isFavorite ? `<div class="badge-married" title="Favorita em destaque!">💖</div>` : ''}
      </div>
      <div class="card-info">
        <div class="card-name">${char.name}</div>
        <div class="card-series">${char.series || 'Sem série'}</div>
      </div>
    `;
    grid.appendChild(card);
  });
}

// ========================================================
// ABA DE BUSCA & ADIÇÃO NA WISHLIST
// ========================================================
async function loadPanelSearchResults() {
  const grid = document.getElementById('panel-search-grid');
  const searchInput = document.getElementById('panel-search-input');
  const raritySelect = document.getElementById('panel-rarity-select');
  const activeGenderPill = document.querySelector('#panel-gender-pills .retro-pill.active');

  const params = new URLSearchParams({
    page: 1,
    limit: 18,
  });
  if (searchInput?.value) params.append('search', searchInput.value.trim());
  if (raritySelect?.value) params.append('rarity', raritySelect.value);
  if (activeGenderPill?.dataset.gender) params.append('gender', activeGenderPill.dataset.gender);

  try {
    const res = await Api.get(`/characters?${params.toString()}`);
    const characters = res?.data?.data || [];

    grid.innerHTML = '';
    if (characters.length === 0) {
      grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 24px;">Nenhum personagem encontrado.</div>';
      return;
    }

    const currentWishes = new Set((userSessionData?.wishlist || []).map(w => w.character?.id || w.characterId));

    characters.forEach(char => {
      const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
      const isAlreadyWish = currentWishes.has(char.id);
      const card = document.createElement('div');
      card.className = 'waifu-card';

      card.innerHTML = `
        <div class="card-img-wrapper">
          <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${char.name}">
          <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
            ${rarity.emoji} ${rarity.label}
          </div>
        </div>
        <div class="card-info">
          <div class="card-name">${char.name}</div>
          <div class="card-series">${char.series || 'Sem série'}</div>
          <div class="card-actions">
            <button class="btn-retro btn-sm ${isAlreadyWish ? '' : 'btn-gold'}" ${isAlreadyWish ? 'disabled' : ''} onclick="addToWishlist('${char.id}', this)">
              ${isAlreadyWish ? '<i class="fas fa-check"></i> Na Wishlist' : '<i class="fas fa-star"></i> Desejar'}
            </button>
            <button class="btn-retro btn-sm" onclick="openSuggestModal('${char.id}', '${escapeHtml(char.name)}', '${char.baseRarity}')">
              <i class="fas fa-lightbulb"></i>
            </button>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch (err) {
    console.error('Erro na busca:', err);
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

async function addToWishlist(charId, btn) {
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

    Api.showToast('Adicionado à sua Wishlist com sucesso!', '✨');
    loadUserData();
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
    document.getElementById('wishlist-count').textContent = userSessionData.wishlist.length;
  } catch (err) {
    Api.showToast('Erro de comunicação ao remover da wishlist.', '❌');
  }
}

// ========================================================
// MODAL DE SUGESTÕES (RARIDADE E FOTO CROPPER)
// ========================================================
function openSuggestModal(charId, charName, currentRarity) {
  activeSuggestCharacter = { id: charId, name: charName, currentRarity };

  document.getElementById('suggest-char-name').textContent = `Personagem: ${charName}`;
  const currBadge = document.getElementById('suggest-current-rarity');
  const cfg = RARITY_CONFIG[currentRarity] || RARITY_CONFIG.COMMON;
  currBadge.style.borderColor = cfg.color;
  currBadge.style.color = cfg.color;
  currBadge.textContent = `${cfg.emoji} ${cfg.label}`;

  document.getElementById('suggest-reason').value = '';
  document.getElementById('suggest-img-reason').value = '';
  document.getElementById('suggest-file-input').value = '';
  document.getElementById('cropper-container').classList.add('hidden');

  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }

  openModal('modal-suggest');
}

async function submitRaritySuggestion() {
  if (!activeSuggestCharacter) return;
  const newRarity = document.getElementById('suggest-new-rarity').value;
  const reason = document.getElementById('suggest-reason').value.trim();

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
  } catch (err) {
    Api.showToast('Erro de comunicação ao enviar sugestão.', '❌');
  }
}

async function submitImageSuggestion() {
  if (!activeSuggestCharacter || !cropperInstance) return;

  const reason = document.getElementById('suggest-img-reason').value.trim();

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
