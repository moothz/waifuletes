// js/admin.js - Lógica do Painel de Administração do Waifuletes (Edição de Personagens & Moderação)

const RARITY_CONFIG = {
  COMMON:    { emoji: '⚪', label: 'Comum',    color: '#94a3b8' },
  UNCOMMON:  { emoji: '🟢', label: 'Incomum',  color: '#22c55e' },
  RARE:      { emoji: '🔵', label: 'Raro',     color: '#3b82f6' },
  EPIC:      { emoji: '🟣', label: 'Épico',    color: '#a855f7' },
  LEGENDARY: { emoji: '⭐', label: 'Lendário', color: '#eab308' }
};

let adminToken = localStorage.getItem('waifu_admin_token') || '';
let adminCropperInstance = null;
let currentEditingCharacterId = null;
let currentEditingImages = [];
let adminPhotoAction = 'ADD';
let adminTargetPhoto = null;

const catalogState = {
  search: '',
  rarity: '',
  gender: '',
  maritalStatus: '',
  status: 'all',
  sort: 'ranking',
  page: 1,
  limit: 18,
  total: 0,
  totalPages: 1
};

const usersState = {
  search: '',
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 1
};

let selectedMarryTargetUser = null;
let suggestionFilterStatus = 'PENDING';

document.addEventListener('DOMContentLoaded', () => {
  setupAdminEvents();
  checkAdminSession();
});

function setupAdminEvents() {
  // Login form
  const loginForm = document.getElementById('admin-login-form');
  loginForm.addEventListener('submit', handleAdminLogin);

  // Logout button
  document.getElementById('btn-admin-logout').addEventListener('click', handleAdminLogout);

  // Theme toggle
  const themeToggle = document.getElementById('btn-theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      Api.toggleTheme();
    });
  }
  Api.initTheme();

  // Aprovar todas sugestões
  const btnApproveAll = document.getElementById('btn-approve-all-suggestions');
  if (btnApproveAll) {
    btnApproveAll.addEventListener('click', approveAllSuggestions);
  }

  // Navegação por abas
  const tabs = document.querySelectorAll('.retro-tabs .retro-tab[data-tab]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      const activeContent = document.getElementById(targetId);
      if (activeContent) activeContent.classList.remove('hidden');

      if (targetId === 'tab-suggestions') {
        loadSuggestions();
      } else if (targetId === 'tab-catalog') {
        loadAdminCatalog();
      } else if (targetId === 'tab-users') {
        loadAdminUsers();
      }
    });
  });

  // Filtros de sugestões
  const suggPills = document.querySelectorAll('#suggestion-filter-pills .retro-pill');
  suggPills.forEach(pill => {
    pill.addEventListener('click', () => {
      suggPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      suggestionFilterStatus = pill.dataset.status;
      loadSuggestions();
    });
  });

  // Filtros do catálogo admin
  let searchTimer = null;
  const adminSearchInput = document.getElementById('admin-search-input');
  adminSearchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      catalogState.search = adminSearchInput.value.trim();
      catalogState.page = 1;
      loadAdminCatalog();
    }, 300);
  });

  const adminRaritySelect = document.getElementById('admin-rarity-select');
  adminRaritySelect.addEventListener('change', () => {
    catalogState.rarity = adminRaritySelect.value;
    catalogState.page = 1;
    loadAdminCatalog();
  });

  const adminGenderPills = document.querySelectorAll('#admin-gender-pills .retro-pill');
  adminGenderPills.forEach(pill => {
    pill.addEventListener('click', () => {
      adminGenderPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      catalogState.gender = pill.dataset.gender;
      catalogState.page = 1;
      loadAdminCatalog();
    });
  });

  const adminMaritalPills = document.querySelectorAll('#admin-marital-pills .retro-pill');
  adminMaritalPills.forEach(pill => {
    pill.addEventListener('click', () => {
      adminMaritalPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      catalogState.maritalStatus = pill.dataset.status;
      catalogState.page = 1;
      loadAdminCatalog();
    });
  });

  const adminStatusPills = document.querySelectorAll('#admin-status-pills .retro-pill');
  adminStatusPills.forEach(pill => {
    pill.addEventListener('click', () => {
      adminStatusPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      catalogState.status = pill.dataset.activeStatus || 'all';
      catalogState.page = 1;
      loadAdminCatalog();
    });
  });

  const adminSortSelect = document.getElementById('admin-sort-select');
  if (adminSortSelect) {
    adminSortSelect.addEventListener('change', () => {
      catalogState.sort = adminSortSelect.value;
      catalogState.page = 1;
      loadAdminCatalog();
    });
  }

  // Paginação admin
  document.getElementById('admin-btn-prev').addEventListener('click', () => {
    if (catalogState.page > 1) {
      catalogState.page--;
      loadAdminCatalog();
    }
  });

  document.getElementById('admin-btn-next').addEventListener('click', () => {
    if (catalogState.page < catalogState.totalPages) {
      catalogState.page++;
      loadAdminCatalog();
    }
  });

  // Cropper no modal de edição
  const editFileInput = document.getElementById('edit-file-input');
  editFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const imgEl = document.getElementById('admin-cropper-img');
      imgEl.src = event.target.result;

      document.getElementById('admin-cropper-container').classList.remove('hidden');

      if (adminCropperInstance) {
        adminCropperInstance.destroy();
      }

      adminCropperInstance = new Cropper(imgEl, {
        aspectRatio: 225 / 350,
        viewMode: 1,
        autoCropArea: 0.95,
        preview: '#admin-crop-preview',
        responsive: true,
      });
    };
    reader.readAsDataURL(file);
  });

  // Salvar edição de personagem
  document.getElementById('edit-char-form').addEventListener('submit', handleSaveCharacterEdit);

  // Busca de usuários
  let userSearchTimer = null;
  const adminUserSearchInput = document.getElementById('admin-user-search-input');
  if (adminUserSearchInput) {
    adminUserSearchInput.addEventListener('input', () => {
      clearTimeout(userSearchTimer);
      userSearchTimer = setTimeout(() => {
        usersState.search = adminUserSearchInput.value.trim();
        usersState.page = 1;
        loadAdminUsers();
      }, 300);
    });
  }

  // Paginação de usuários
  const usersBtnPrev = document.getElementById('admin-users-btn-prev');
  if (usersBtnPrev) {
    usersBtnPrev.addEventListener('click', () => {
      if (usersState.page > 1) {
        usersState.page--;
        loadAdminUsers();
      }
    });
  }

  const usersBtnNext = document.getElementById('admin-users-btn-next');
  if (usersBtnNext) {
    usersBtnNext.addEventListener('click', () => {
      if (usersState.page < usersState.totalPages) {
        usersState.page++;
        loadAdminUsers();
      }
    });
  }

  // Formulário de Casamento Administrativo
  const adminMarryForm = document.getElementById('admin-marry-form');
  if (adminMarryForm) {
    adminMarryForm.addEventListener('submit', handleAdminMarrySubmit);
  }
}

// ========================================================
// AUTENTICAÇÃO DO ADMIN
// ========================================================
async function checkAdminSession() {
  if (!adminToken) {
    showLoginView();
    return;
  }

  try {
    const res = await Api.get('/api/admin/me', {
      'Authorization': `Bearer ${adminToken}`
    });

    if (res.success && res.data?.authenticated) {
      showAdminView();
      loadAdminCatalog();
      loadSuggestions();
    } else {
      showLoginView();
    }
  } catch (_) {
    showLoginView();
  }
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const password = document.getElementById('admin-password-input').value;

  try {
    const res = await Api.post('/api/admin/login', { password });

    if (!res.success) {
      Api.showToast(res.error?.message || 'Senha incorreta.', '❌');
      return;
    }

    adminToken = res.data.token;
    localStorage.setItem('waifu_admin_token', adminToken);

    Api.showToast('Login de administrador realizado!', '🔓');
    showAdminView();
    loadAdminCatalog();
    loadSuggestions();
  } catch (err) {
    Api.showToast('Erro de comunicação no login.', '❌');
  }
}

async function handleAdminLogout() {
  try {
    await Api.post('/api/admin/logout', {}, {
      'Authorization': `Bearer ${adminToken}`
    });
  } catch (_) {}

  adminToken = '';
  localStorage.removeItem('waifu_admin_token');
  showLoginView();
  Api.showToast('Sessão encerrada.', '🔒');
}

function showLoginView() {
  document.getElementById('admin-login-section').classList.remove('hidden');
  document.getElementById('admin-main-section').classList.add('hidden');
  document.getElementById('btn-admin-logout').classList.add('hidden');
}

function showAdminView() {
  document.getElementById('admin-login-section').classList.add('hidden');
  document.getElementById('admin-main-section').classList.remove('hidden');
  document.getElementById('btn-admin-logout').classList.remove('hidden');
}

// ========================================================
// CATÁLOGO E EDIÇÃO DE PERSONAGENS
// ========================================================
async function loadAdminCatalog() {
  const grid = document.getElementById('admin-catalog-grid');
  const totalCountEl = document.getElementById('admin-total-count');
  const pageIndicatorEl = document.getElementById('admin-page-indicator');
  const btnPrev = document.getElementById('admin-btn-prev');
  const btnNext = document.getElementById('admin-btn-next');

  const params = new URLSearchParams({
    page: catalogState.page,
    limit: catalogState.limit
  });
  if (catalogState.search) params.append('search', catalogState.search);
  if (catalogState.rarity) params.append('rarity', catalogState.rarity);
  if (catalogState.gender) params.append('gender', catalogState.gender);
  if (catalogState.maritalStatus) params.append('maritalStatus', catalogState.maritalStatus);
  if (catalogState.status) params.append('status', catalogState.status);
  if (catalogState.sort) params.append('sort', catalogState.sort);

  try {
    let res = await Api.get(`/api/admin/characters?${params.toString()}`, {
      'Authorization': `Bearer ${adminToken}`,
      'Cache-Control': 'no-cache'
    });
    if (!res?.success && (res?.statusCode === 404 || res?.error === 'Not Found')) {
      res = await Api.get(`/characters?${params.toString()}`);
    }
    const resultData = res?.data;
    const characters = resultData?.data || [];

    catalogState.total = resultData?.total || 0;
    catalogState.totalPages = Math.max(1, resultData?.totalPages || 1);

    totalCountEl.textContent = `${catalogState.total.toLocaleString('pt-BR')} personagens`;
    pageIndicatorEl.textContent = `${catalogState.page} / ${catalogState.totalPages}`;
    btnPrev.disabled = catalogState.page <= 1;
    btnNext.disabled = catalogState.page >= catalogState.totalPages;

    grid.innerHTML = '';
    if (characters.length === 0) {
      grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 24px;">Nenhum personagem encontrado.</div>';
      return;
    }

    characters.forEach(char => {
      const rarityKey = char.baseRarity || 'COMMON';
      const rarity = RARITY_CONFIG[rarityKey] || RARITY_CONFIG.COMMON;
      const isInactive = char.isActive === false;
      const card = document.createElement('div');
      card.className = `waifu-card rarity-${rarityKey.toLowerCase()}`;
      card.id = `admin-card-${char.id}`;
      card.style.borderColor = isInactive ? '#94a3b8' : (rarityKey === 'COMMON' ? '#000000' : rarity.color);
      if (isInactive) {
        card.style.opacity = '0.85';
        card.style.filter = 'grayscale(25%)';
      }

      card.innerHTML = `
        <div class="card-img-wrapper" style="position: relative;">
          <img src="${char.imageUrl || '/media/characters/default.jpg'}" alt="${escapeHtml(char.name)}">
          <div class="badge-rarity" style="border-color: ${rarity.color}; color: ${rarity.color};">
            ${rarity.emoji} ${rarity.label}
          </div>
          ${isInactive ? `
            <div style="position: absolute; top: 6px; left: 6px; background: #dc2626; color: #fff; font-size: 11px; font-weight: 800; padding: 2px 6px; border-radius: 4px; border: 1.5px solid #000; z-index: 2; box-shadow: 1px 1px 0 #000;">
              🚫 Desabilitada
            </div>
          ` : ''}
        </div>
        <div class="card-info">
          <div class="card-name">${escapeHtml(char.name)}</div>
          <div class="card-series">${escapeHtml(char.series || 'Sem série')}</div>
          <div class="card-actions" style="display: flex; gap: 4px; margin-top: 8px;">
            <button class="btn-retro btn-sm btn-gold" style="flex: 1;" onclick="openEditCharacterModal('${char.id}')">
              <i class="fas fa-edit"></i> Editar
            </button>
            ${isInactive ? `
              <button class="btn-retro btn-sm" style="background: #22c55e; color: #fff; font-weight: 700; padding: 4px 8px;" title="Reativar waifu" onclick="quickToggleActive('${char.id}', true)">
                <i class="fas fa-undo"></i>
              </button>
            ` : ''}
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch (err) {
    console.error('Erro ao carregar catálogo admin:', err);
  }
}

async function quickToggleActive(charId, newStatus) {
  try {
    const res = await Api.put(`/api/admin/characters/${encodeURIComponent(charId)}`, {
      isActive: newStatus
    }, {
      'Authorization': `Bearer ${adminToken}`
    });

    if (!res.success) {
      Api.showToast(res.error?.message || 'Falha ao alterar status.', '❌');
      return;
    }

    Api.showToast(newStatus ? 'Personagem reativada com sucesso! ✨' : 'Personagem desabilitada.', '✅');
    loadAdminCatalog();
  } catch (err) {
    Api.showToast('Erro de comunicação com o servidor.', '❌');
  }
}

function renderAdminPhotosGrid() {
  const container = document.getElementById('admin-photos-grid');
  const countEl = document.getElementById('admin-photos-count');
  if (countEl) countEl.textContent = currentEditingImages.length;
  if (!container) return;

  container.innerHTML = '';
  if (currentEditingImages.length === 0) {
    container.innerHTML = '<div style="grid-column: 1 / -1; font-size: 12px; color: #64748b; font-style: italic; padding: 10px; background: #fff; border: 1px dashed #cbd5e1; border-radius: 4px; text-align: center;">Nenhuma foto cadastrada.</div>';
    return;
  }

  currentEditingImages.forEach((imgUrl, idx) => {
    const isPrimary = idx === 0;
    const item = document.createElement('div');
    item.style.position = 'relative';
    item.style.border = isPrimary ? '2px solid #eab308' : '1.5px solid #2d241e';
    item.style.borderRadius = '4px';
    item.style.overflow = 'hidden';
    item.style.background = '#111';
    item.style.boxShadow = isPrimary ? '0 0 6px rgba(234, 179, 8, 0.4)' : 'none';

    item.innerHTML = `
      <div style="aspect-ratio: 9/14; width: 100%; position: relative;">
        <img src="${imgUrl}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='/media/characters/default.jpg'">
        ${isPrimary ? '<span style="position: absolute; top: 4px; left: 4px; background: #eab308; color: #000; font-weight: 800; font-size: 10px; padding: 2px 6px; border-radius: 3px; border: 1px solid #000;">⭐ Principal</span>' : ''}
      </div>
      <div style="padding: 4px; background: #fff; border-top: 1px solid #2d241e; display: flex; flex-direction: column; gap: 3px;">
        ${!isPrimary ? `
          <button type="button" class="btn-retro btn-sm btn-gold" style="padding: 2px 4px; font-size: 10px; width: 100%;" onclick="adminSetPrimaryPhoto(${idx})">
            ⭐ Tornar Principal
          </button>
        ` : ''}
        <button type="button" class="btn-retro btn-sm" style="padding: 2px 4px; font-size: 10px; width: 100%;" onclick="triggerAdminReplacePhoto('${escapeAttr(imgUrl)}', ${idx})">
          🔄 Substituir
        </button>
        <button type="button" class="btn-retro btn-sm btn-danger" style="padding: 2px 4px; font-size: 10px; width: 100%;" onclick="adminDeletePhoto(${idx})">
          🗑️ Excluir
        </button>
      </div>
    `;
    container.appendChild(item);
  });
}

function triggerAdminAddPhoto() {
  adminPhotoAction = 'ADD';
  adminTargetPhoto = null;
  const section = document.getElementById('admin-photo-upload-section');
  const title = document.getElementById('admin-photo-action-title');
  if (title) title.innerHTML = '➕ <b>Adicionar Nova Foto Oficial:</b>';
  if (section) section.classList.remove('hidden');
  const input = document.getElementById('edit-file-input');
  if (input) {
    input.value = '';
    input.click();
  }
}

function triggerAdminReplacePhoto(photoUrl, index) {
  adminPhotoAction = 'REPLACE';
  adminTargetPhoto = photoUrl;
  const section = document.getElementById('admin-photo-upload-section');
  const title = document.getElementById('admin-photo-action-title');
  if (title) title.innerHTML = `🔄 <b>Substituir Foto #${index + 1}:</b>`;
  if (section) section.classList.remove('hidden');
  const input = document.getElementById('edit-file-input');
  if (input) {
    input.value = '';
    input.click();
  }
}

function cancelAdminPhotoUpload() {
  const section = document.getElementById('admin-photo-upload-section');
  if (section) section.classList.add('hidden');
  const container = document.getElementById('admin-cropper-container');
  if (container) container.classList.add('hidden');
  if (adminCropperInstance) {
    adminCropperInstance.destroy();
    adminCropperInstance = null;
  }
  const input = document.getElementById('edit-file-input');
  if (input) input.value = '';
}

function adminDeletePhoto(index) {
  if (index >= 0 && index < currentEditingImages.length) {
    if (!confirm('Deseja realmente remover esta foto da lista do personagem?')) return;
    currentEditingImages.splice(index, 1);
    renderAdminPhotosGrid();
  }
}

function adminSetPrimaryPhoto(index) {
  if (index > 0 && index < currentEditingImages.length) {
    const selected = currentEditingImages.splice(index, 1)[0];
    currentEditingImages.unshift(selected);
    renderAdminPhotosGrid();
  }
}

async function openEditCharacterModal(charId) {
  try {
    let res = await Api.get(`/api/admin/characters/${encodeURIComponent(charId)}`, {
      'Authorization': `Bearer ${adminToken}`,
      'Cache-Control': 'no-cache'
    });
    if (!res?.success && (res?.statusCode === 404 || res?.error === 'Not Found')) {
      res = await Api.get(`/characters/${encodeURIComponent(charId)}`);
    }
    const char = res?.data;
    if (!char) {
      Api.showToast('Personagem não encontrado.', '❌');
      return;
    }

    currentEditingCharacterId = char.id;
    document.getElementById('edit-name').value = char.name || '';
    const seriesEl = document.getElementById('edit-series');
    if (seriesEl) seriesEl.value = char.series || '';
    document.getElementById('edit-rarity').value = char.baseRarity || 'COMMON';
    const genderEl = document.getElementById('edit-gender');
    if (genderEl) genderEl.value = char.gender || 'FEMALE';
    document.getElementById('edit-description').value = char.description || '';
    const tagsEl = document.getElementById('edit-tags');
    if (tagsEl) tagsEl.value = Array.isArray(char.tags) ? char.tags.join(', ') : (char.tags || '');
    const activeEl = document.getElementById('edit-active');
    if (activeEl) activeEl.checked = char.isActive !== false;

    // Carrega galeria de fotos
    currentEditingImages = Array.isArray(char.imageUrls) ? [...char.imageUrls] : (char.imageUrl ? [char.imageUrl] : []);
    renderAdminPhotosGrid();
    cancelAdminPhotoUpload();

    openModal('modal-edit-char');
  } catch (err) {
    Api.showToast('Erro ao buscar detalhes do personagem.', '❌');
  }
}

async function handleSaveCharacterEdit(e) {
  e.preventDefault();
  if (!currentEditingCharacterId) return;

  const name = document.getElementById('edit-name').value.trim();
  const series = document.getElementById('edit-series')?.value.trim() || '';
  const baseRarity = document.getElementById('edit-rarity').value;
  const gender = document.getElementById('edit-gender')?.value || 'OTHER';
  const description = document.getElementById('edit-description').value.trim();
  const tagsStr = document.getElementById('edit-tags')?.value.trim() || '';
  const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
  const isActive = document.getElementById('edit-active')?.checked ?? true;

  const doSave = async (imageBlob = null) => {
    let payload;
    let headers = { 'Authorization': `Bearer ${adminToken}` };

    if (imageBlob) {
      payload = new FormData();
      payload.append('name', name);
      payload.append('series', series);
      payload.append('baseRarity', baseRarity);
      payload.append('gender', gender);
      payload.append('description', description);
      payload.append('tags', tags.join(','));
      payload.append('isActive', isActive ? 'true' : 'false');
      payload.append('imageUrls', JSON.stringify(currentEditingImages));
      payload.append('photoAction', adminPhotoAction);
      if (adminTargetPhoto) {
        payload.append('targetPhoto', adminTargetPhoto);
      }
      payload.append('image', imageBlob, 'admin_crop.png');
    } else {
      payload = {
        name,
        series,
        baseRarity,
        gender,
        description,
        tags,
        isActive,
        imageUrls: currentEditingImages,
      };
    }

    try {
      const res = await Api.put(`/api/admin/characters/${encodeURIComponent(currentEditingCharacterId)}`, payload, headers);
      if (!res.success) {
        Api.showToast(res.error?.message || 'Falha ao salvar edição.', '❌');
        return;
      }

      closeModal('modal-edit-char');
      Api.showToast('Personagem e fotos atualizados com sucesso!', '💾');
      loadAdminCatalog();
    } catch (err) {
      Api.showToast('Erro de comunicação ao salvar alterações.', '❌');
    }
  };

  if (adminCropperInstance) {
    const canvas = adminCropperInstance.getCroppedCanvas({ width: 450, height: 700 });
    canvas.toBlob(blob => doSave(blob), 'image/png');
  } else {
    doSave(null);
  }
}

// ========================================================
// MODERAÇÃO DE SUGESTÕES
// ========================================================
async function loadSuggestions() {
  const container = document.getElementById('suggestions-list');
  const pendingBadge = document.getElementById('pending-badge');

  try {
    const res = await Api.get(`/api/admin/suggestions?status=${encodeURIComponent(suggestionFilterStatus)}`, {
      'Authorization': `Bearer ${adminToken}`
    });

    const suggestions = res?.data?.data || [];
    
    // Atualiza badge de pendentes se disponível
    if (suggestionFilterStatus === 'PENDING') {
      pendingBadge.textContent = suggestions.length;
    }

    container.innerHTML = '';
    if (suggestions.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 36px; background: #fff; border: 2px solid #2d241e; border-radius: 6px;">
          <div style="font-size: 32px; margin-bottom: 6px;">✨</div>
          <p style="font-weight: 700;">Nenhuma sugestão encontrada com status "${suggestionFilterStatus}".</p>
        </div>
      `;
      return;
    }

    suggestions.forEach(s => {
      container.appendChild(createSuggestionItem(s));
    });
  } catch (err) {
    console.error('Erro ao carregar sugestões:', err);
  }
}

function createSuggestionItem(s) {
  const card = document.createElement('div');
  card.style.background = '#ffffff';
  card.style.border = '2px solid #2d241e';
  card.style.borderRadius = '6px';
  card.style.boxShadow = '3px 3px 0px #2d241e';
  card.style.padding = '16px';
  card.id = `suggestion-${s.id}`;

  const isPending = s.status === 'PENDING';
  const char = s.character || {};
  const user = s.user || {};
  const currentRarity = RARITY_CONFIG[s.currentRarity || char.baseRarity] || RARITY_CONFIG.COMMON;
  const suggestedRarity = RARITY_CONFIG[s.suggestedRarity] || RARITY_CONFIG.COMMON;

  let bodyContent = '';

  if (s.type === 'RARITY') {
    const fromRarityStr = s.currentRarity || char.baseRarity || 'COMMON';
    const toRarityStr = s.suggestedRarity || 'COMMON';
    bodyContent = `
      <div style="margin: 10px 0; background: #fffdf5; border: 1.5px solid #2d241e; border-radius: 6px; padding: 12px;">
        <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;">
          <span style="font-size: 13px; font-weight: 700;">Mudança de Raridade:</span>
          <span class="badge-rarity" style="position: static; border-color: ${currentRarity.color}; color: ${currentRarity.color};">
            ${currentRarity.emoji} ${currentRarity.label}
          </span>
          <span style="font-weight: 800; font-size: 14px;">➔</span>
          <span class="badge-rarity" style="position: static; border-color: ${suggestedRarity.color}; color: ${suggestedRarity.color};">
            ${suggestedRarity.emoji} ${suggestedRarity.label}
          </span>
          <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: 800; font-size: 12px;">${fromRarityStr} -> ${toRarityStr}</code>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: #475569;">
          <strong>Justificativa do Usuário:</strong> <em>"${escapeHtml(s.reason || 'Sem justificativa')}"</em>
        </div>
      </div>
    `;
  } else if (s.type === 'EDIT') {
    const nameChanged = s.suggestedName && s.suggestedName.trim() !== (char.name || '').trim();
    const seriesChanged = s.suggestedSeries && s.suggestedSeries.trim() !== (char.series || '').trim();
    const genderChanged = s.suggestedGender && s.suggestedGender !== char.gender;
    const rarityChanged = s.suggestedRarity && s.suggestedRarity !== (char.baseRarity || s.currentRarity);
    const curTagsNorm = [...(char.tags || [])].sort().join(',');
    const sugTagsNorm = [...(s.suggestedTags || [])].sort().join(',');
    const tagsChanged = s.suggestedTags && s.suggestedTags.length > 0 && sugTagsNorm !== curTagsNorm;
    const curDesc = (char.description || '').trim();
    const sugDesc = (s.suggestedDescription || '').trim();
    const descChanged = s.suggestedDescription !== undefined && s.suggestedDescription !== null && sugDesc !== curDesc;

    const hasAnyChange = nameChanged || seriesChanged || genderChanged || rarityChanged || tagsChanged || descChanged;

    bodyContent = `
      <div style="margin: 10px 0; background: #eff6ff; border: 1.5px solid #3b82f6; border-radius: 6px; padding: 12px;">
        <div style="font-weight: 800; font-size: 14px; margin-bottom: 8px; color: #1e40af;">
          📝 Sugestão de Edição de Dados do Personagem
        </div>
        ${!hasAnyChange ? `
          <div style="margin-bottom: 10px; background: #fef3c7; border: 1.5px solid #f59e0b; color: #92400e; padding: 10px; border-radius: 6px; font-size: 13px;">
            <strong>⚠️ Nenhum campo com alteração direta detectada!</strong><br>
            Os valores enviados para nome, série, gênero, raridade, tags e biografia são idênticos aos já cadastrados no catálogo.<br>
            <span style="font-size: 12px; color: #78350f;">O usuário colocou a proposta/informação apenas na <strong>Justificativa</strong> abaixo.</span>
          </div>
          <div style="margin-bottom: 10px; font-size: 12px; background: #fff; padding: 8px; border-radius: 4px; border: 1px solid #cbd5e1;">
            <strong>Descrição / Biografia Atual no Catálogo:</strong><br>
            <em style="color: #475569;">"${escapeHtml(char.description || s.suggestedDescription || 'Sem biografia cadastrada')}"</em>
          </div>
        ` : `
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; font-size: 13px;">
            ${nameChanged ? `<div><strong>Nome:</strong> <span style="text-decoration: line-through; color: #64748b;">${escapeHtml(char.name || '')}</span> ➔ <strong style="color: #2563eb;">${escapeHtml(s.suggestedName)}</strong></div>` : ''}
            ${seriesChanged ? `<div><strong>Série:</strong> <span style="text-decoration: line-through; color: #64748b;">${escapeHtml(char.series || '')}</span> ➔ <strong style="color: #2563eb;">${escapeHtml(s.suggestedSeries)}</strong></div>` : ''}
            ${genderChanged ? `<div><strong>Gênero:</strong> <span style="text-decoration: line-through; color: #64748b;">${char.gender || '(não definido)'}</span> ➔ <strong style="color: #2563eb;">${s.suggestedGender}</strong></div>` : ''}
            ${rarityChanged ? `<div><strong>Raridade:</strong> <span style="text-decoration: line-through; color: #64748b;">${char.baseRarity || ''}</span> ➔ <strong style="color: #2563eb;">${char.baseRarity} -> ${s.suggestedRarity}</strong></div>` : ''}
            ${tagsChanged ? `<div><strong>Tags:</strong> <strong style="color: #2563eb;">${(char.tags || []).join(', ') || '(nenhuma)'} ➔ ${s.suggestedTags.join(', ')}</strong></div>` : ''}
          </div>
          ${descChanged ? `
            <div style="margin-top: 8px; font-size: 12px; background: #fff; padding: 8px; border-radius: 4px; border: 1px solid #bfdbfe;">
              <strong>Nova Descrição Sugerida:</strong><br>${escapeHtml(s.suggestedDescription)}
            </div>
          ` : ''}
        `}
        <div style="margin-top: 8px; font-size: 13px; font-weight: 600; color: #334155;">
          <strong>Justificativa do Usuário:</strong> <em>"${escapeHtml(s.reason || 'Sem justificativa')}"</em>
        </div>
      </div>
    `;
  } else if (s.type === 'IMAGE') {
    const act = s.actionData?.action;
    const target = s.actionData?.targetPhoto;
    if (act === 'DELETE') {
      const targetSrc = target ? (target.startsWith('http') ? target : `/media/${target}`) : (char.imageUrl || '/media/characters/default.jpg');
      bodyContent = `
        <div style="margin: 10px 0; background: #fef2f2; border: 1.5px solid #ef4444; border-radius: 6px; padding: 12px;">
          <div style="display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap;">
            <div>
              <span style="font-size: 12px; font-weight: 800; color: #dc2626; display: block; margin-bottom: 4px;">⚠️ Foto Apontada para Remoção:</span>
              <div style="width: 100px; aspect-ratio: 9/14; border: 2px solid #ef4444; border-radius: 4px; overflow: hidden;">
                <img src="${targetSrc}" style="width: 100%; height: 100%; object-fit: cover;">
              </div>
            </div>
            <div style="flex: 1; min-width: 200px;">
              <span style="background: #ef4444; color: #fff; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 4px;">🗑️ SUGESTÃO: EXCLUSÃO DE FOTO</span>
              <p style="font-size: 13px; color: #1e293b; margin-top: 6px;">O usuário sugeriu <strong>excluir</strong> uma foto da galeria do personagem.</p>
              <p style="font-size: 13px; color: #475569; margin-top: 6px;"><strong>Motivo informado:</strong> <em>"${escapeHtml(s.reason || 'Foto incorreta ou com problema.')}"</em></p>
              <div style="margin-top: 8px; font-size: 12px; color: #b91c1c; font-weight: bold; background: #fee2e2; padding: 6px 10px; border-radius: 4px; border: 1px solid #fca5a5;">
                Ao aceitar, esta foto específica será desvinculada do personagem.
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (act === 'REPLACE') {
      const targetSrc = target ? (target.startsWith('http') ? target : `/media/${target}`) : (char.imageUrl || '/media/characters/default.jpg');
      bodyContent = `
        <div style="margin: 10px 0; background: #eff6ff; border: 1.5px solid #3b82f6; border-radius: 6px; padding: 12px;">
          <div style="display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap;">
            <div>
              <span style="font-size: 12px; font-weight: 700; color: #64748b; display: block; margin-bottom: 4px;">Foto Atual (a ser substituída):</span>
              <div style="width: 100px; aspect-ratio: 9/14; border: 1.5px solid #2d241e; border-radius: 4px; overflow: hidden; opacity: 0.75;">
                <img src="${targetSrc}" style="width: 100%; height: 100%; object-fit: cover;">
              </div>
            </div>
            <div>
              <span style="font-size: 12px; font-weight: 800; color: #2563eb; display: block; margin-bottom: 4px;">🔄 Nova Foto Sugerida (Troca):</span>
              <div style="width: 100px; aspect-ratio: 9/14; border: 2px solid #2563eb; border-radius: 4px; overflow: hidden; box-shadow: 2px 2px 0px #2d241e;">
                <img src="${s.imageUrl}" style="width: 100%; height: 100%; object-fit: cover;">
              </div>
            </div>
            <div style="flex: 1; min-width: 200px;">
              <span style="background: #2563eb; color: #fff; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 4px;">🔄 SUGESTÃO: TROCAR FOTO ATUAL</span>
              <p style="font-size: 13px; color: #1e293b; margin-top: 6px;">O usuário sugeriu <strong>SUBSTITUIR</strong> a foto atual do personagem por esta nova foto enviada.</p>
              <p style="font-size: 13px; color: #475569; margin-top: 6px;"><strong>Motivo informado:</strong> <em>"${escapeHtml(s.reason || 'Substituição de foto.')}"</em></p>
              <div style="margin-top: 8px; font-size: 12px; color: #1d4ed8; font-weight: 600; background: #dbeafe; padding: 6px 10px; border-radius: 4px; border: 1px solid #bfdbfe;">
                💡 Você pode aceitar substituindo a foto atual OU forçar adicioná-la como foto nova na galeria pelos botões abaixo.
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      bodyContent = `
        <div style="margin: 10px 0; background: #f0fdf4; border: 1.5px solid #22c55e; border-radius: 6px; padding: 12px;">
          <div style="display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap;">
            <div>
              <span style="font-size: 12px; font-weight: 700; color: #64748b; display: block; margin-bottom: 4px;">Foto Atual:</span>
              <div style="width: 100px; aspect-ratio: 9/14; border: 1.5px solid #2d241e; border-radius: 4px; overflow: hidden;">
                <img src="${char.imageUrl || '/media/characters/default.jpg'}" style="width: 100%; height: 100%; object-fit: cover;">
              </div>
            </div>
            <div>
              <span style="font-size: 12px; font-weight: 800; color: #16a34a; display: block; margin-bottom: 4px;">➕ Nova Foto Sugerida (Adição):</span>
              <div style="width: 100px; aspect-ratio: 9/14; border: 2px solid #16a34a; border-radius: 4px; overflow: hidden; box-shadow: 2px 2px 0px #2d241e;">
                <img src="${s.imageUrl}" style="width: 100%; height: 100%; object-fit: cover;">
              </div>
            </div>
            <div style="flex: 1; min-width: 200px;">
              <span style="background: #16a34a; color: #fff; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 4px;">➕ SUGESTÃO: ADICIONAR NOVA FOTO</span>
              <p style="font-size: 13px; color: #1e293b; margin-top: 6px;">O usuário sugeriu <strong>ADICIONAR</strong> esta foto à galeria do personagem (mantendo a foto atual).</p>
              <p style="font-size: 13px; color: #475569; margin-top: 6px;"><strong>Comentário / Motivo:</strong> <em>"${escapeHtml(s.reason || 'Sem comentário')}"</em></p>
              <div style="margin-top: 8px; font-size: 12px; color: #15803d; font-weight: 600; background: #dcfce7; padding: 6px 10px; border-radius: 4px; border: 1px solid #bbf7d0;">
                💡 Você pode aceitar adicionando como nova foto OU forçar a troca da foto atual pelos botões abaixo.
              </div>
            </div>
          </div>
        </div>
      `;
    }
  } else if (s.type === 'NEW_CHARACTER') {
    bodyContent = `
      <div style="margin: 10px 0; background: #fffdf5; border: 1.5px solid #2d241e; border-radius: 6px; padding: 12px;">
        <div style="display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap;">
          ${s.imageUrl ? `
            <div>
              <span style="font-size: 12px; font-weight: 700; display: block; margin-bottom: 4px;">Foto Sugerida:</span>
              <div style="width: 100px; aspect-ratio: 9/14; border: 2px solid #22c55e; border-radius: 4px; overflow: hidden; box-shadow: 2px 2px 0px #2d241e;">
                <img src="${s.imageUrl}" style="width: 100%; height: 100%; object-fit: cover;">
              </div>
            </div>
          ` : ''}
          <div style="flex: 1; min-width: 200px;">
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px;">
              <span class="badge-rarity" style="position: static; border-color: ${suggestedRarity.color}; color: ${suggestedRarity.color};">
                ${suggestedRarity.emoji} ${suggestedRarity.label}
              </span>
              <span style="font-weight: 800; font-size: 15px;">${escapeHtml(s.characterName || 'Sem nome')}</span>
              <span style="font-size: 12px; color: #64748b;">(${escapeHtml(s.series || 'Sem série')})</span>
            </div>
            ${s.description ? `<p style="font-size: 12px; color: #475569; margin-bottom: 6px;"><strong>Descrição:</strong> ${escapeHtml(s.description)}</p>` : ''}
            <p style="font-size: 12px; color: #475569;"><strong>Motivo do Usuário:</strong> <em>"${escapeHtml(s.reason || 'Sem motivo informado')}"</em></p>
            <div style="margin-top: 8px; font-size: 12px; color: #16a34a; font-weight: bold; background: #f0fdf4; padding: 6px 10px; border-radius: 4px; border: 1px solid #bbf7d0;">
              ✨ Ao aceitar, o personagem será adicionado ao catálogo oficial e adicionado na Wishlist do autor automaticamente (se houver vaga).
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (s.type === 'DELETE_CHARACTER') {
    bodyContent = `
      <div style="margin: 10px 0; background: #fef2f2; border: 1.5px solid #ef4444; border-radius: 6px; padding: 12px;">
        <div style="display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap;">
          <div>
            <div style="width: 80px; aspect-ratio: 9/14; border: 1.5px solid #2d241e; border-radius: 4px; overflow: hidden;">
              <img src="${char.imageUrl || '/media/characters/default.jpg'}" style="width: 100%; height: 100%; object-fit: cover;">
            </div>
          </div>
          <div style="flex: 1; min-width: 200px;">
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px;">
              <span style="background: #ef4444; color: #fff; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 4px;">🔞 DENÚNCIA / EXCLUSÃO</span>
              <strong style="font-size: 15px;">${escapeHtml(char.name || s.characterName || 'Personagem')}</strong>
            </div>
            <p style="font-size: 13px; color: #991b1b; font-weight: 600; margin-top: 4px;">
              <strong>Motivo da Denúncia:</strong> <em>"${escapeHtml(s.reason || 'Conteúdo impróprio / pedido de exclusão.')}"</em>
            </p>
            <div style="margin-top: 8px; font-size: 12px; color: #b91c1c; font-weight: bold; background: #fee2e2; padding: 6px 10px; border-radius: 4px; border: 1px solid #fca5a5;">
              ⚠️ Ao aceitar, o personagem será excluído permanentemente do jogo, haréns e wishlists.
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const charTitle = s.type === 'NEW_CHARACTER' ? (s.characterName || 'Novo Personagem') : (char.name || 'Personagem');
  const charSeries = s.type === 'NEW_CHARACTER' ? (s.series || 'Sem série') : (char.series || 'Sem série');
  const userName = user.name || (s.type === 'DELETE_CHARACTER' ? 'Denúncia Pública / Jogador' : 'Jogador');

  // Informações de casamento
  let marriageHtml = '';
  if (s.isMarriedToSuggester) {
    marriageHtml = `
      <div style="margin: 10px 0; background: #fee2e2; border: 2px solid #ef4444; border-radius: 6px; padding: 10px; font-weight: 800; color: #991b1b; display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 24px;">⚠️</span>
        <div>
          <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">ALERTA DE CASAMENTO</div>
          <div style="font-size: 13px; font-weight: 700; margin-top: 2px;">
            Este personagem é <u>CASADO COM QUEM SUGERIU</u> (<strong>${escapeHtml(s.marriage?.name || user.name || 'Autor')}</strong>)! As pessoas tentam alterar a raridade para levar vantagem indevida.
          </div>
        </div>
      </div>
    `;
  } else if (s.marriage) {
    marriageHtml = `
      <div style="margin: 8px 0; font-size: 12px; font-weight: 700; color: #475569; background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 4px; padding: 6px 10px;">
        💍 <strong>Casado com:</strong> ${escapeHtml(s.marriage.name)}
      </div>
    `;
  }

  // Controles de bloqueio de sugestões
  const targetUserId = s.userId || user.id;
  let userBlockHtml = '';
  if (targetUserId) {
    if (s.isUserBlocked) {
      const dur = s.userBlockInfo?.duration === 'forever' ? 'Pra sempre' : `Até ${new Date(s.userBlockInfo?.expiresAt).toLocaleDateString('pt-BR')}`;
      userBlockHtml = `
        <span style="background: #fee2e2; border: 1.5px solid #dc2626; color: #991b1b; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 800; margin-left: 6px;" title="Bloqueado de enviar sugestões">
          🚫 Bloqueado (${dur})
        </span>
        <button class="btn-retro btn-sm" style="margin-left: 4px; font-size: 11px; padding: 2px 6px;" onclick="unblockUserSuggestions('${targetUserId}')" title="Desbloquear envio de sugestões deste usuário">
          <i class="fas fa-unlock"></i> Desbloquear
        </button>
      `;
    } else {
      userBlockHtml = `
        <button class="btn-retro btn-sm btn-danger" style="margin-left: 6px; font-size: 11px; padding: 2px 6px;" onclick="openBlockSuggestionsModal('${targetUserId}', '${escapeHtml(userName)}')" title="Bloquear este usuário de enviar sugestões por suspeita de spam">
          <i class="fas fa-ban"></i> Bloquear
        </button>
      `;
    }
  }

  let aiAdvisorHtml = '';
  if (s.aiAdvisor) {
    aiAdvisorHtml = `
      <div style="margin: 10px 0; background: #fdf4ff; border: 1.5px solid #d946ef; border-radius: 6px; padding: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="toggleAiAdvisor('${s.id}')">
          <div style="font-weight: 800; font-size: 13px; color: #86198f; display: flex; align-items: center; gap: 6px;">
            <i class="fas fa-robot"></i> 🤖 Parecer da IA (Gemma 4 12B)
            <span style="font-size: 11px; background: #fae8ff; color: #a21caf; border: 1px solid #e879f9; padding: 1px 6px; border-radius: 4px; font-weight: 700;">Rank Mudae integrado</span>
          </div>
          <button class="btn-retro btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="event.stopPropagation(); toggleAiAdvisor('${s.id}')">
            <i class="fas fa-chevron-down" id="ai-arrow-${s.id}"></i> Ver Parecer & Prompt
          </button>
        </div>
        <div id="ai-advisor-content-${s.id}" class="hidden" style="margin-top: 10px; border-top: 1px dashed #e879f9; padding-top: 8px;">
          <div style="background: #ffffff; border: 1px solid #f0abfc; border-radius: 4px; padding: 10px; font-size: 13px; line-height: 1.5;">
            ${s.aiAdvisor.response}
          </div>
          <details style="margin-top: 8px; font-size: 12px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 4px; padding: 6px 8px;">
            <summary style="font-weight: 700; color: #7e22ce; cursor: pointer;">
              📜 Ver Prompt de IA Enviado ao Modelo
            </summary>
            <div style="margin-top: 6px; font-family: monospace; font-size: 11px; white-space: pre-wrap; background: #f3e8ff; padding: 8px; border-radius: 4px; color: #3b0764; max-height: 250px; overflow-y: auto;">
<strong>--- SYSTEM PROMPT ---</strong>
${escapeHtml(s.aiAdvisor.systemPrompt || '')}

<strong>--- USER PROMPT ---</strong>
${escapeHtml(s.aiAdvisor.userPrompt || '')}
${s.aiAdvisor.searchedQueries?.length ? `\n<strong>--- BUSCAS WEB REALIZADAS ---</strong>\n${escapeHtml(s.aiAdvisor.searchedQueries.join('\n'))}` : ''}
            </div>
          </details>
        </div>
      </div>
    `;
  } else if (s.type === 'RARITY' || s.suggestedRarity || s.type === 'EDIT' || s.type === 'NEW_CHARACTER') {
    aiAdvisorHtml = `
      <div style="margin: 8px 0;" id="ai-advisor-container-${s.id}">
        <button class="btn-retro btn-sm" style="font-size: 11px; background: #fdf4ff; border-color: #d946ef; color: #86198f; font-weight: 700;" onclick="fetchAiAdvisor('${s.id}')" id="btn-ai-${s.id}">
          <i class="fas fa-robot"></i> 🤖 Consultar Parecer da IA (Rank Mudae)
        </button>
      </div>
    `;
  }

  let actionButtonsHtml = '';
  if (isPending) {
    if (s.type === 'IMAGE' && s.imageUrl) {
      const isReplaceProposal = s.actionData?.action === 'REPLACE';
      const proposedLabel = isReplaceProposal ? 'Trocar' : 'Adicionar';
      actionButtonsHtml = `
        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; flex-wrap: wrap;">
          <button class="btn-retro btn-sm btn-danger" onclick="rejectSuggestion('${s.id}')">
            <i class="fas fa-times"></i> Recusar
          </button>
          <button class="btn-retro btn-sm" style="background: #2563eb; color: #fff; font-weight: 700;" onclick="approveSuggestion('${s.id}', { overridePhotoAction: 'ADD' })" title="Adiciona como foto nova na galeria do personagem sem remover a foto atual">
            <i class="fas fa-plus"></i> Aceitar (Nova Foto)
          </button>
          <button class="btn-retro btn-sm" style="background: #d97706; color: #fff; font-weight: 700;" onclick="approveSuggestion('${s.id}', { overridePhotoAction: 'REPLACE' })" title="Substitui a foto atual do personagem pela nova foto enviada">
            <i class="fas fa-sync-alt"></i> Aceitar (Trocar Foto Atual)
          </button>
          <button class="btn-retro btn-sm btn-gold" onclick="approveSuggestion('${s.id}')" title="Aceita conforme a solicitação original (${proposedLabel})">
            <i class="fas fa-check"></i> Aceitar Proposto (${proposedLabel})
          </button>
        </div>
      `;
    } else {
      actionButtonsHtml = `
        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
          <button class="btn-retro btn-sm btn-danger" onclick="rejectSuggestion('${s.id}')">
            <i class="fas fa-times"></i> Recusar
          </button>
          <button class="btn-retro btn-sm btn-gold" onclick="approveSuggestion('${s.id}')">
            <i class="fas fa-check"></i> Aceitar e Aplicar
          </button>
        </div>
      `;
    }
  } else {
    actionButtonsHtml = `
      <div style="display: flex; justify-content: flex-end; font-size: 12px; font-weight: 800; color: ${s.status === 'APPROVED' ? '#16a34a' : '#dc2626'};">
        Status: ${s.status === 'APPROVED' ? 'APROVADA E APLICADA ✅' : 'RECUSADA ❌'}
      </div>
    `;
  }

  card.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #cbd5e1; padding-bottom: 8px; flex-wrap: wrap; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        ${(char.id || s.characterId) ? `
          <a href="/character/${encodeURIComponent(char.id || s.characterId)}" target="_blank" rel="noopener noreferrer" style="color: #1d4ed8; text-decoration: none; font-size: 15px; font-weight: 800; display: inline-flex; align-items: center; gap: 4px;" title="Abrir página do personagem em nova aba">
            <span>${escapeHtml(charTitle)}</span>
            <i class="fas fa-external-link-alt" style="font-size: 11px; opacity: 0.7;"></i>
          </a>
          <a href="/character/${encodeURIComponent(char.id || s.characterId)}" target="_blank" rel="noopener noreferrer" class="btn-retro btn-sm" style="font-size: 11px; padding: 2px 8px; text-decoration: none; background: #eff6ff; border-color: #3b82f6; color: #1d4ed8; font-weight: 700;" title="Abrir página do personagem em nova aba">
            <i class="fas fa-eye"></i> Ver Waifu
          </a>
        ` : `
          <strong style="font-size: 15px;">${escapeHtml(charTitle)}</strong>
        `}
        <span style="font-size: 12px; color: #64748b;">(${escapeHtml(charSeries)})</span>
      </div>
      <div style="font-size: 12px; font-weight: 700; display: flex; align-items: center; flex-wrap: wrap;">
        <span>Sugerido por: <strong>${escapeHtml(userName)}</strong> em ${new Date(s.createdAt).toLocaleDateString('pt-BR')}</span>
        ${userBlockHtml}
      </div>
    </div>

    ${marriageHtml}

    ${bodyContent}

    ${aiAdvisorHtml}

    ${actionButtonsHtml}
  `;

  return card;
}

function openBlockSuggestionsModal(userId, userName) {
  const modal = document.getElementById('modal-block-suggestions');
  if (!modal) return;
  document.getElementById('block-suggestions-user-id').value = userId;
  document.getElementById('block-suggestions-user-name').textContent = userName;
  modal.classList.remove('hidden');
}

async function confirmBlockSuggestions() {
  const userId = document.getElementById('block-suggestions-user-id').value;
  const durationInput = document.querySelector('input[name="block-suggestions-duration"]:checked');
  const duration = durationInput ? durationInput.value : '24h';

  if (!userId) {
    Api.showToast('ID do usuário não identificado.', '❌');
    return;
  }

  const btn = document.getElementById('btn-confirm-block-suggestions');
  if (btn) btn.disabled = true;

  try {
    const res = await Api.post(`/api/admin/users/${encodeURIComponent(userId)}/block-suggestions`, {
      duration,
      reason: 'Suspeita de spam',
    }, {
      'Authorization': `Bearer ${adminToken}`,
    });

    if (res.success) {
      Api.showToast(res.data?.message || 'Usuário bloqueado de enviar sugestões!', '🚫');
      closeModal('modal-block-suggestions');
      loadSuggestions();
    } else {
      Api.showToast(res.error?.message || 'Falha ao bloquear usuário.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao bloquear usuário.', '❌');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function unblockUserSuggestions(userId) {
  if (!confirm('Deseja realmente desbloquear este usuário para que ele volte a enviar sugestões?')) return;

  try {
    const res = await Api.post(`/api/admin/users/${encodeURIComponent(userId)}/unblock-suggestions`, {}, {
      'Authorization': `Bearer ${adminToken}`,
    });

    if (res.success) {
      Api.showToast('Usuário desbloqueado com sucesso!', '✨');
      loadSuggestions();
    } else {
      Api.showToast(res.error?.message || 'Falha ao desbloquear usuário.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao desbloquear usuário.', '❌');
  }
}

async function approveAllSuggestions() {
  if (!confirm('Deseja aceitar e aplicar TODAS as sugestões pendentes agora?')) return;

  try {
    const res = await Api.post('/api/admin/suggestions/approve-all', {}, {
      'Authorization': `Bearer ${adminToken}`
    });

    if (!res.success) {
      Api.showToast(res.error?.message || 'Falha ao aprovar sugestões.', '❌');
      return;
    }

    Api.showToast(res.data?.message || 'Todas as sugestões foram aceitas e aplicadas!', '✅');
    loadSuggestions();
  } catch (err) {
    console.error('Erro ao aprovar todas as sugestões:', err);
    Api.showToast('Erro de comunicação com o servidor.', '❌');
  }
}

async function approveSuggestion(suggestionId, options = {}) {
  let confirmMsg = 'Deseja aceitar esta sugestão e aplicar as alterações ao personagem imediatamente?';
  if (options.overridePhotoAction === 'ADD') {
    confirmMsg = 'Confirmar aprovação ADICIONANDO como nova foto na galeria?';
  } else if (options.overridePhotoAction === 'REPLACE') {
    confirmMsg = 'Confirmar aprovação SUBSTITUINDO a foto atual pela nova foto enviada?';
  }
  if (!confirm(confirmMsg)) return;

  try {
    const res = await Api.post(`/api/admin/suggestions/${suggestionId}/approve`, options, {
      'Authorization': `Bearer ${adminToken}`
    });

    if (!res.success) {
      Api.showToast(res.error?.message || 'Falha ao aprovar.', '❌');
      return;
    }

    Api.showToast('Sugestão aceita e aplicada com sucesso!', '✅');
    loadSuggestions();
  } catch (err) {
    Api.showToast('Erro de comunicação ao aprovar.', '❌');
  }
}

function toggleAiAdvisor(id) {
  const content = document.getElementById(`ai-advisor-content-${id}`);
  const arrow = document.getElementById(`ai-arrow-${id}`);
  if (!content) return;
  const isHidden = content.classList.contains('hidden');
  if (isHidden) {
    content.classList.remove('hidden');
    if (arrow) {
      arrow.classList.remove('fa-chevron-down');
      arrow.classList.add('fa-chevron-up');
    }
  } else {
    content.classList.add('hidden');
    if (arrow) {
      arrow.classList.remove('fa-chevron-up');
      arrow.classList.add('fa-chevron-down');
    }
  }
}

async function fetchAiAdvisor(id, refresh = false) {
  const container = document.getElementById(`ai-advisor-container-${id}`);
  const btn = document.getElementById(`btn-ai-${id}`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Consultando IA (Gemma 4 & Web)...';
  }

  try {
    const res = await Api.get(`/api/admin/suggestions/${id}/ai-advisor${refresh ? '?refresh=true' : ''}`, {
      'Authorization': `Bearer ${adminToken}`,
    });

    if (res.success && res.data) {
      const adv = res.data;
      if (container) {
        container.innerHTML = `
          <div style="background: #fdf4ff; border: 1.5px solid #d946ef; border-radius: 6px; padding: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="toggleAiAdvisor('${id}')">
              <div style="font-weight: 800; font-size: 13px; color: #86198f; display: flex; align-items: center; gap: 6px;">
                <i class="fas fa-robot"></i> 🤖 Parecer da IA (Gemma 4 12B)
                <span style="font-size: 11px; background: #fae8ff; color: #a21caf; border: 1px solid #e879f9; padding: 1px 6px; border-radius: 4px; font-weight: 700;">Rank Mudae integrado</span>
              </div>
              <div style="display: flex; gap: 6px;">
                <button class="btn-retro btn-sm" style="font-size: 11px; padding: 2px 6px;" onclick="event.stopPropagation(); fetchAiAdvisor('${id}', true)" title="Reconsultar IA">
                  <i class="fas fa-sync-alt"></i>
                </button>
                <button class="btn-retro btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="event.stopPropagation(); toggleAiAdvisor('${id}')">
                  <i class="fas fa-chevron-up" id="ai-arrow-${id}"></i> Ocultar
                </button>
              </div>
            </div>
            <div id="ai-advisor-content-${id}" style="margin-top: 10px; border-top: 1px dashed #e879f9; padding-top: 8px;">
              <div style="background: #ffffff; border: 1px solid #f0abfc; border-radius: 4px; padding: 10px; font-size: 13px; line-height: 1.5;">
                ${adv.response}
              </div>
              <details style="margin-top: 8px; font-size: 12px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 4px; padding: 6px 8px;">
                <summary style="font-weight: 700; color: #7e22ce; cursor: pointer;">
                  📜 Ver Prompt de IA Enviado ao Modelo
                </summary>
                <div style="margin-top: 6px; font-family: monospace; font-size: 11px; white-space: pre-wrap; background: #f3e8ff; padding: 8px; border-radius: 4px; color: #3b0764; max-height: 250px; overflow-y: auto;">
<strong>--- SYSTEM PROMPT ---</strong>
${escapeHtml(adv.systemPrompt || '')}

<strong>--- USER PROMPT ---</strong>
${escapeHtml(adv.userPrompt || '')}
${adv.searchedQueries?.length ? `\n<strong>--- BUSCAS WEB REALIZADAS ---</strong>\n${escapeHtml(adv.searchedQueries.join('\n'))}` : ''}
                </div>
              </details>
            </div>
          </div>
        `;
      }
      Api.showToast('Parecer da IA obtido com sucesso!', '🤖');
    } else {
      Api.showToast(res.error?.message || 'Falha ao obter parecer da IA.', '❌');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-robot"></i> 🤖 Consultar Parecer da IA (Rank Mudae)';
      }
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao consultar IA.', '❌');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-robot"></i> 🤖 Consultar Parecer da IA (Rank Mudae)';
    }
  }
}

async function rejectSuggestion(suggestionId) {
  const reason = prompt('Motivo da recusa (opcional):');
  if (reason === null) return; // cancelou o prompt

  try {
    const res = await Api.post(`/api/admin/suggestions/${suggestionId}/reject`, {
      rejectionReason: reason
    }, {
      'Authorization': `Bearer ${adminToken}`
    });

    if (!res.success) {
      Api.showToast(res.error?.message || 'Falha ao recusar.', '❌');
      return;
    }

    Api.showToast('Sugestão recusada.', '❌');
    loadSuggestions();
  } catch (err) {
    Api.showToast('Erro de comunicação ao recusar.', '❌');
  }
}

// ========================================================
// GESTÃO DE USUÁRIOS
// ========================================================
async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  const totalCountEl = document.getElementById('admin-users-total-count');
  const pageIndicatorEl = document.getElementById('admin-users-page-indicator');
  const btnPrev = document.getElementById('admin-users-btn-prev');
  const btnNext = document.getElementById('admin-users-btn-next');

  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 24px;"><i class="fas fa-spinner fa-spin"></i> Carregando lista de usuários...</td></tr>';

  try {
    const params = new URLSearchParams({
      page: usersState.page,
      limit: usersState.limit,
    });
    if (usersState.search) params.append('search', usersState.search);

    const res = await Api.get(`/api/admin/users?${params.toString()}`, {
      Authorization: `Bearer ${adminToken}`,
    });

    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px; color: red;">${res.error?.message || 'Erro ao carregar usuários.'}</td></tr>`;
      return;
    }

    const { users, pagination } = res.data;
    usersState.total = pagination.total;
    usersState.totalPages = pagination.totalPages;

    if (totalCountEl) totalCountEl.textContent = `${usersState.total.toLocaleString('pt-BR')} usuários`;
    if (pageIndicatorEl) pageIndicatorEl.textContent = `${usersState.page} / ${usersState.totalPages}`;
    if (btnPrev) btnPrev.disabled = usersState.page <= 1;
    if (btnNext) btnNext.disabled = usersState.page >= usersState.totalPages;

    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 24px;">Nenhum usuário encontrado com os filtros atuais.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    users.forEach((u) => {
      const tr = document.createElement('tr');
      const cleanNumber = (u.id || '').replace('@s.whatsapp.net', '').replace('@c.us', '');
      const platformBadge = u.platform === 'WHATSAPP'
        ? '<span style="color: #16a34a; font-weight: 700;"><i class="fab fa-whatsapp"></i> WhatsApp</span>'
        : `<span style="font-weight: 700;">${u.platform}</span>`;

      tr.innerHTML = `
        <td style="font-weight: 800;">
          ${escapeHtml(u.name)}
        </td>
        <td>
          <div style="font-family: monospace; font-size: 13px; font-weight: 700;">${escapeHtml(cleanNumber)}</div>
          <small style="font-size: 11px;">${platformBadge}</small>
        </td>
        <td style="text-align: center; font-weight: 800;">
          <span class="badge-rarity" style="position: static; border-color: #2563eb; color: #2563eb; display: inline-block;">
            💍 ${u.totalHarem}
          </span>
        </td>
        <td style="text-align: center; font-weight: 800;">
          <span class="badge-rarity" style="position: static; border-color: #f59e0b; color: #f59e0b; display: inline-block;">
            ⭐ ${u.totalWishlist}
          </span>
        </td>
        <td style="text-align: center; font-weight: 800;">
          <span class="badge-rarity" style="position: static; border-color: #9333ea; color: #9333ea; display: inline-block;" title="Total Harém + Total Wishlist">
            ✨ ${u.totalScore !== undefined ? u.totalScore : (u.totalHarem + u.totalWishlist)}
          </span>
        </td>
        <td style="text-align: center;">
          <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
            <button class="btn-retro btn-sm" onclick="impersonateUser('${escapeHtml(u.id)}')" title="Acessar painel web deste usuário">
              <i class="fas fa-external-link-alt"></i> Acessar Painel
            </button>
            <button class="btn-retro btn-sm btn-gold" onclick="openAdminMarryModal('${escapeHtml(u.id)}', '${escapeHtml(u.name)}')" title="Casar personagem com este usuário">
              <i class="fas fa-ring"></i> Casar
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 24px; color: red;">Erro de comunicação ao carregar lista de usuários.</td></tr>';
  }
}

async function impersonateUser(userId) {
  try {
    const res = await Api.post(`/api/admin/users/${encodeURIComponent(userId)}/session`, {}, {
      Authorization: `Bearer ${adminToken}`,
    });

    if (!res.success) {
      Api.showToast(res.error?.message || 'Falha ao gerar link de acesso.', '❌');
      return;
    }

    Api.showToast('Link de acesso gerado com sucesso! Abrindo painel...', '🚀');
    window.open(res.data.url, '_blank');
  } catch (err) {
    Api.showToast('Erro ao acessar painel do usuário.', '❌');
  }
}

function openAdminMarryModal(userId, userName) {
  selectedMarryTargetUser = { id: userId, name: userName };
  const cleanNumber = (userId || '').replace('@s.whatsapp.net', '');
  document.getElementById('marry-user-display-name').textContent = `${userName} (${cleanNumber})`;
  document.getElementById('admin-marry-char-input').value = '';
  openModal('modal-admin-marry');
}

async function handleAdminMarrySubmit(e) {
  e.preventDefault();
  if (!selectedMarryTargetUser) return;

  const charInput = document.getElementById('admin-marry-char-input').value.trim();
  if (!charInput) {
    Api.showToast('Por favor, informe o ID ou nome da personagem.', '⚠️');
    return;
  }

  const btnConfirm = document.getElementById('btn-confirm-admin-marry');
  btnConfirm.disabled = true;
  btnConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Casando...';

  try {
    const res = await Api.post(
      `/api/admin/users/${encodeURIComponent(selectedMarryTargetUser.id)}/marry`,
      { characterId: charInput },
      { Authorization: `Bearer ${adminToken}` }
    );

    if (!res.success) {
      Api.showToast(res.error?.message || 'Não foi possível casar este personagem.', '❌');
      return;
    }

    const charName = res.data?.character?.name || charInput;
    Api.showToast(`Casamento de ${charName} com ${selectedMarryTargetUser.name} realizado com sucesso!`, '💍');
    closeModal('modal-admin-marry');
    loadAdminUsers();
  } catch (err) {
    Api.showToast('Erro de comunicação ao realizar casamento.', '❌');
  } finally {
    btnConfirm.disabled = false;
    btnConfirm.innerHTML = '<i class="fas fa-ring"></i> Confirmar Casamento';
  }
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

function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;');
}
