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

const catalogState = {
  search: '',
  rarity: '',
  gender: '',
  page: 1,
  limit: 18,
  total: 0,
  totalPages: 1
};

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
      const rarity = RARITY_CONFIG[char.baseRarity] || RARITY_CONFIG.COMMON;
      const card = document.createElement('div');
      card.className = 'waifu-card';
      card.id = `admin-card-${char.id}`;

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
    document.getElementById('edit-rarity').value = char.baseRarity || 'COMMON';
    document.getElementById('edit-description').value = char.description || '';
    document.getElementById('edit-file-input').value = '';
    document.getElementById('admin-cropper-container').classList.add('hidden');

    if (adminCropperInstance) {
      adminCropperInstance.destroy();
      adminCropperInstance = null;
    }

    openModal('modal-edit-char');
  } catch (err) {
    Api.showToast('Erro ao buscar detalhes do personagem.', '❌');
  }
}

async function handleSaveCharacterEdit(e) {
  e.preventDefault();
  if (!currentEditingCharacterId) return;

  const name = document.getElementById('edit-name').value.trim();
  const baseRarity = document.getElementById('edit-rarity').value;
  const description = document.getElementById('edit-description').value.trim();

  const doSave = async (imageBlob = null) => {
    let payload;
    let headers = { 'Authorization': `Bearer ${adminToken}` };

    if (imageBlob) {
      payload = new FormData();
      payload.append('name', name);
      payload.append('baseRarity', baseRarity);
      payload.append('description', description);
      payload.append('image', imageBlob, 'admin_crop.png');
    } else {
      payload = { name, baseRarity, description };
    }

    try {
      const res = await Api.put(`/api/admin/characters/${encodeURIComponent(currentEditingCharacterId)}`, payload, headers);
      if (!res.success) {
        Api.showToast(res.error?.message || 'Falha ao salvar edição.', '❌');
        return;
      }

      closeModal('modal-edit-char');
      Api.showToast('Personagem atualizado com sucesso!', '💾');
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
  } else if (s.type === 'IMAGE') {
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

  card.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #cbd5e1; padding-bottom: 8px;">
      <div>
        <strong style="font-size: 15px;">${char.name || 'Personagem'}</strong>
        <span style="font-size: 12px; color: #64748b; margin-left: 6px;">(${char.series || 'Sem série'})</span>
      </div>
      <div style="font-size: 12px; font-weight: 700;">
        Sugerido por: <strong>${user.name || 'Jogador'}</strong> em ${new Date(s.createdAt).toLocaleDateString('pt-BR')}
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
