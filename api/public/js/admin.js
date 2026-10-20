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
  if (catalogState.sort) params.append('sort', catalogState.sort);

  try {
    const res = await Api.get(`/characters?${params.toString()}`);
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
      const card = document.createElement('div');
      card.className = `waifu-card rarity-${rarityKey.toLowerCase()}`;
      card.id = `admin-card-${char.id}`;
      card.style.borderColor = rarityKey === 'COMMON' ? '#000000' : rarity.color;

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
            <button class="btn-retro btn-sm btn-gold" style="width: 100%;" onclick="openEditCharacterModal('${char.id}')">
              <i class="fas fa-edit"></i> Editar
            </button>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch (err) {
    console.error('Erro ao carregar catálogo admin:', err);
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
    const res = await Api.get(`/characters/${encodeURIComponent(charId)}`);
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
    bodyContent = `
      <div style="margin: 10px 0; background: #fffdf5; border: 1.5px solid #2d241e; border-radius: 6px; padding: 12px;">
        <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 13px; font-weight: 700;">Raridade Atual:</span>
          <span class="badge-rarity" style="position: static; border-color: ${currentRarity.color}; color: ${currentRarity.color};">
            ${currentRarity.emoji} ${currentRarity.label}
          </span>
          <span>➡️</span>
          <span style="font-size: 13px; font-weight: 700;">Sugerida:</span>
          <span class="badge-rarity" style="position: static; border-color: ${suggestedRarity.color}; color: ${suggestedRarity.color};">
            ${suggestedRarity.emoji} ${suggestedRarity.label}
          </span>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: #475569;">
          <strong>Justificativa do Usuário:</strong> <em>"${escapeHtml(s.reason || 'Sem justificativa')}"</em>
        </div>
      </div>
    `;
  } else if (s.type === 'EDIT') {
    bodyContent = `
      <div style="margin: 10px 0; background: #eff6ff; border: 1.5px solid #3b82f6; border-radius: 6px; padding: 12px;">
        <div style="font-weight: 800; font-size: 14px; margin-bottom: 8px; color: #1e40af;">
          📝 Sugestão de Edição de Dados do Personagem
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; font-size: 13px;">
          ${s.suggestedName ? `<div><strong>Nome:</strong> <span style="text-decoration: line-through; color: #64748b;">${escapeHtml(char.name || '')}</span> ➡️ <strong style="color: #2563eb;">${escapeHtml(s.suggestedName)}</strong></div>` : ''}
          ${s.suggestedSeries ? `<div><strong>Série:</strong> <span style="text-decoration: line-through; color: #64748b;">${escapeHtml(char.series || '')}</span> ➡️ <strong style="color: #2563eb;">${escapeHtml(s.suggestedSeries)}</strong></div>` : ''}
          ${s.suggestedGender ? `<div><strong>Gênero:</strong> <span style="text-decoration: line-through; color: #64748b;">${char.gender || ''}</span> ➡️ <strong style="color: #2563eb;">${s.suggestedGender}</strong></div>` : ''}
          ${s.suggestedRarity ? `<div><strong>Raridade:</strong> <span style="text-decoration: line-through; color: #64748b;">${char.baseRarity || ''}</span> ➡️ <strong style="color: #2563eb;">${s.suggestedRarity}</strong></div>` : ''}
          ${s.suggestedTags && s.suggestedTags.length > 0 ? `<div><strong>Tags:</strong> <strong style="color: #2563eb;">${s.suggestedTags.join(', ')}</strong></div>` : ''}
        </div>
        ${s.suggestedDescription ? `
          <div style="margin-top: 8px; font-size: 12px; background: #fff; padding: 8px; border-radius: 4px; border: 1px solid #bfdbfe;">
            <strong>Nova Descrição Sugerida:</strong><br>${escapeHtml(s.suggestedDescription)}
          </div>
        ` : ''}
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
              <span style="background: #ef4444; color: #fff; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 4px;">🗑️ SUGESTÃO DE EXCLUSÃO DE FOTO</span>
              <p style="font-size: 13px; color: #475569; margin-top: 8px;"><strong>Motivo informado:</strong> <em>"${escapeHtml(s.reason || 'Foto incorreta ou com problema.')}"</em></p>
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
        <div style="margin: 10px 0; background: #fffdf5; border: 1.5px solid #2d241e; border-radius: 6px; padding: 12px;">
          <div style="display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap;">
            <div>
              <span style="font-size: 12px; font-weight: 700; display: block; margin-bottom: 4px;">Foto Antiga (a substituir):</span>
              <div style="width: 100px; aspect-ratio: 9/14; border: 1.5px solid #2d241e; border-radius: 4px; overflow: hidden; opacity: 0.7;">
                <img src="${targetSrc}" style="width: 100%; height: 100%; object-fit: cover;">
              </div>
            </div>
            <div>
              <span style="font-size: 12px; font-weight: 800; color: #22c55e; display: block; margin-bottom: 4px;">✨ Nova Foto Sugerida:</span>
              <div style="width: 100px; aspect-ratio: 9/14; border: 2px solid #22c55e; border-radius: 4px; overflow: hidden; box-shadow: 2px 2px 0px #2d241e;">
                <img src="${s.imageUrl}" style="width: 100%; height: 100%; object-fit: cover;">
              </div>
            </div>
            <div style="flex: 1; min-width: 200px;">
              <span style="background: #3b82f6; color: #fff; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 4px;">🔄 SUGESTÃO DE SUBSTITUIÇÃO</span>
              <p style="font-size: 13px; color: #475569; margin-top: 8px;"><strong>Motivo informado:</strong> <em>"${escapeHtml(s.reason || 'Substituição de foto.')}"</em></p>
            </div>
          </div>
        </div>
      `;
    } else {
      bodyContent = `
        <div style="margin: 10px 0; background: #fffdf5; border: 1.5px solid #2d241e; border-radius: 6px; padding: 12px;">
          <div style="display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap;">
            <div>
              <span style="font-size: 12px; font-weight: 700; display: block; margin-bottom: 4px;">Foto Atual:</span>
              <div style="width: 100px; aspect-ratio: 9/14; border: 1.5px solid #2d241e; border-radius: 4px; overflow: hidden;">
                <img src="${char.imageUrl || '/media/characters/default.jpg'}" style="width: 100%; height: 100%; object-fit: cover;">
              </div>
            </div>
            <div>
              <span style="font-size: 12px; font-weight: 700; display: block; margin-bottom: 4px;">Foto Sugerida (Recortada):</span>
              <div style="width: 100px; aspect-ratio: 9/14; border: 2px solid #e11d48; border-radius: 4px; overflow: hidden; box-shadow: 2px 2px 0px #2d241e;">
                <img src="${s.imageUrl}" style="width: 100%; height: 100%; object-fit: cover;">
              </div>
            </div>
            <div style="flex: 1; min-width: 200px;">
              <span style="font-size: 13px; font-weight: 700;">Comentário:</span>
              <p style="font-size: 13px; color: #475569; margin-top: 4px;"><em>"${escapeHtml(s.reason || 'Sem comentário')}"</em></p>
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

  card.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #cbd5e1; padding-bottom: 8px;">
      <div>
        <strong style="font-size: 15px;">${escapeHtml(charTitle)}</strong>
        <span style="font-size: 12px; color: #64748b; margin-left: 6px;">(${escapeHtml(charSeries)})</span>
      </div>
      <div style="font-size: 12px; font-weight: 700;">
        Sugerido por: <strong>${escapeHtml(userName)}</strong> em ${new Date(s.createdAt).toLocaleDateString('pt-BR')}
      </div>
    </div>

    ${bodyContent}

    ${isPending ? `
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
        <button class="btn-retro btn-sm btn-danger" onclick="rejectSuggestion('${s.id}')">
          <i class="fas fa-times"></i> Recusar
        </button>
        <button class="btn-retro btn-sm btn-gold" onclick="approveSuggestion('${s.id}')">
          <i class="fas fa-check"></i> Aceitar e Aplicar
        </button>
      </div>
    ` : `
      <div style="display: flex; justify-content: flex-end; font-size: 12px; font-weight: 800; color: ${s.status === 'APPROVED' ? '#16a34a' : '#dc2626'};">
        Status: ${s.status === 'APPROVED' ? 'APROVADA E APLICADA ✅' : 'RECUSADA ❌'}
      </div>
    `}
  `;

  return card;
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

async function approveSuggestion(suggestionId) {
  if (!confirm('Deseja aceitar esta sugestão e aplicar as alterações ao personagem imediatamente?')) return;

  try {
    const res = await Api.post(`/api/admin/suggestions/${suggestionId}/approve`, {}, {
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
