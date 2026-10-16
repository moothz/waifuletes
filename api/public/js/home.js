// js/home.js - Lógica do Catálogo Geral do Waifuletes (Home) com Abas, Rankings e Denúncias

const RARITY_CONFIG = {
  COMMON:    { emoji: '⚪', label: 'Comum',    color: '#94a3b8' },
  UNCOMMON:  { emoji: '🟢', label: 'Incomum',  color: '#22c55e' },
  RARE:      { emoji: '🔵', label: 'Raro',     color: '#3b82f6' },
  EPIC:      { emoji: '🟣', label: 'Épico',    color: '#a855f7' },
  LEGENDARY: { emoji: '⭐', label: 'Lendário', color: '#eab308' }
};

const state = {
  search: '',
  gender: '',
  maritalStatus: '',
  rarity: '',
  sortBy: 'ranking',
  page: 1,
  limit: 24,
  total: 0,
  totalPages: 1,
  loading: false,
  pendingReportCharId: null,
  rankingsLoaded: false
};

document.addEventListener('DOMContentLoaded', () => {
  bindHomeEvents();
  loadCharacters();
  fetchRavenaContact();
});

function bindHomeEvents() {
  // Alternância de Abas na Home
  const tabs = document.querySelectorAll('.retro-tabs .retro-tab[data-tab]');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.dataset.tab;
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.add('hidden'));
      const activeContent = document.getElementById(targetId);
      if (activeContent) activeContent.classList.remove('hidden');

      if (targetId === 'tab-rankings' && !state.rankingsLoaded) {
        loadRankings();
      }
    });
  });

  const searchInput = document.getElementById('search-input');
  const genderPills = document.querySelectorAll('#gender-pills .retro-pill');
  const maritalPills = document.querySelectorAll('#marital-pills .retro-pill');
  const raritySelect = document.getElementById('rarity-select');
  const sortSelect = document.getElementById('sort-select');

  const btnFirst = document.getElementById('btn-first');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const btnLast = document.getElementById('btn-last');

  // Busca com debounce de 300ms
  let searchTimeout = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.search = e.target.value.trim();
      state.page = 1;
      loadCharacters();
    }, 300);
  });

  // Filtro de gênero
  genderPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      genderPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.gender = pill.dataset.gender;
      state.page = 1;
      loadCharacters();
    });
  });

  // Filtro de estado civil (Todos, Solteiros, Casados)
  maritalPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      maritalPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.maritalStatus = pill.dataset.status;
      state.page = 1;
      loadCharacters();
    });
  });

  // Filtro de raridade
  raritySelect.addEventListener('change', (e) => {
    state.rarity = e.target.value;
    state.page = 1;
    loadCharacters();
  });

  // Ordenação
  sortSelect.addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    state.page = 1;
    loadCharacters();
  });

  // Paginação
  btnFirst.addEventListener('click', () => {
    if (state.page > 1) {
      state.page = 1;
      loadCharacters();
    }
  });

  btnPrev.addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      loadCharacters();
    }
  });

  btnNext.addEventListener('click', () => {
    if (state.page < state.totalPages) {
      state.page++;
      loadCharacters();
    }
  });

  btnLast.addEventListener('click', () => {
    if (state.page < state.totalPages) {
      state.page = state.totalPages;
      loadCharacters();
    }
  });

  // Confirmação de Denúncia (🔞)
  document.getElementById('btn-confirm-report').addEventListener('click', submitReport);
}

async function loadCharacters() {
  if (state.loading) return;
  state.loading = true;

  const grid = document.getElementById('waifu-grid');
  const totalCountEl = document.getElementById('total-count');
  const pageIndicatorEl = document.getElementById('page-indicator');
  const btnFirst = document.getElementById('btn-first');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const btnLast = document.getElementById('btn-last');

  try {
    const params = new URLSearchParams({
      page: state.page,
      limit: state.limit,
    });
    if (state.search) params.append('search', state.search);
    if (state.gender) params.append('gender', state.gender);
    if (state.rarity) params.append('rarity', state.rarity);
    if (state.maritalStatus) params.append('maritalStatus', state.maritalStatus);
    if (state.sortBy) params.append('sort', state.sortBy);

    const res = await Api.get(`/characters?${params.toString()}`);
    const resultData = res?.data;
    let characters = resultData?.data || [];

    // Fallback de ordenação em memória se solicitado por nome
    if (state.sortBy === 'name') {
      characters.sort((a, b) => a.name.localeCompare(b.name));
    }

    state.total = resultData?.total || 0;
    state.totalPages = Math.max(1, resultData?.totalPages || 1);
    state.page = resultData?.page || state.page;

    totalCountEl.textContent = `${state.total.toLocaleString('pt-BR')} personagens encontrados`;
    pageIndicatorEl.textContent = `${state.page} / ${state.totalPages}`;

    btnFirst.disabled = state.page <= 1;
    btnPrev.disabled = state.page <= 1;
    btnNext.disabled = state.page >= state.totalPages;
    btnLast.disabled = state.page >= state.totalPages;

    if (characters.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 48px; background: var(--bg-card); border: var(--border-retro); border-radius: 6px; box-shadow: var(--shadow-retro);">
          <div style="font-size: 40px; margin-bottom: 8px;">💔</div>
          <h3 style="font-size: 18px; font-weight: 800;">Nenhum personagem encontrado</h3>
          <p style="color: var(--text-muted); font-size: 14px; margin-top: 4px;">Tente alterar os termos da busca ou os filtros de raridade e estado.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = '';
    characters.forEach((char) => {
      grid.appendChild(createWaifuCard(char));
    });
  } catch (err) {
    console.error('Erro ao carregar catálogo:', err);
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 32px; background: #fee2e2; border: 2px solid #2d241e; border-radius: 6px;">
        <p style="font-weight: 700; color: #991b1b;">Não foi possível carregar os personagens no momento.</p>
        <button class="btn-retro btn-sm" style="margin-top: 10px;" onclick="loadCharacters()">Tentar Novamente</button>
      </div>
    `;
  } finally {
    state.loading = false;
  }
}

function createWaifuCard(char) {
  const rarityKey = char.baseRarity || 'COMMON';
  const rarityCfg = RARITY_CONFIG[rarityKey] || RARITY_CONFIG.COMMON;
  const isMarried = Boolean(char.isClaimed || char.owner);
  const spouse = char.owner?.name || (typeof char.owner === 'string' ? char.owner : null);
  const spousePublicId = char.owner?.publicId || null;
  const wishlistCount = char.wishlistCount || 0;
  const imgSrc = char.imageUrl || '/media/characters/default.jpg';

  const card = document.createElement('div');
  card.className = `waifu-card rarity-${rarityKey.toLowerCase()}`;
  card.dataset.id = char.id;
  card.style.borderColor = rarityKey === 'COMMON' ? '#000000' : rarityCfg.color;

  let marriedTooltip = '💍 Solteira(o)';
  if (isMarried) {
    marriedTooltip = spouse
      ? `💍 Casada(o) com ${spouse}${spousePublicId ? ' (Clique para abrir perfil público)' : ''}`
      : '💍 Casada(o)';
  }

  card.innerHTML = `
    <div class="card-img-wrapper">
      <img src="${imgSrc}" loading="lazy" alt="${escapeHtml(char.name)}" onerror="this.onerror=null;this.src='/media/characters/default.jpg';">
      
      <div class="badge-rarity" style="border-color: ${rarityCfg.color}; color: ${rarityCfg.color};" title="Raridade: ${rarityCfg.label}">
        ${rarityCfg.emoji} ${rarityCfg.label}
      </div>

      ${
        isMarried
          ? `<div class="badge-married ${spousePublicId ? 'badge-married-link' : ''}" title="${marriedTooltip}">💍</div>`
          : ''
      }

      <div class="badge-wishes" title="${wishlistCount} pessoa(s) adicionaram à wishlist">
        <span>✨</span> <span>${wishlistCount}</span>
      </div>

      <button class="btn-card-report" title="Denunciar este personagem (🔞)">
        🔞
      </button>
    </div>

    <div class="card-info">
      <div class="card-name" title="${escapeHtml(char.name)}">${escapeHtml(char.name)}</div>
      <div class="card-series" title="${escapeHtml(char.series || 'Sem série')}">${escapeHtml(char.series || 'Sem série')}</div>
    </div>
  `;

  // Ação de denúncia (🔞)
  const reportBtn = card.querySelector('.btn-card-report');
  reportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openReportModal(char.id, char.name);
  });

  // Ação do badge de casamento (Abre perfil público se existir)
  if (isMarried) {
    const marriedBadge = card.querySelector('.badge-married');
    if (marriedBadge) {
      marriedBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        if (spousePublicId) {
          const shareUrl = Api.getShareUrl(`/user/${spousePublicId}`);
          window.open(shareUrl, '_blank');
        } else {
          Api.showToast(marriedTooltip, '💍');
        }
      });
    }
  }

  return card;
}

// ========================================================
// RANKINGS EM 2 COLUNAS (ZINTHOS & WAIFUS)
// ========================================================
async function loadRankings() {
  const tbodyZinthos = document.getElementById('tbody-ranking-zinthos');
  const tbodyWaifus = document.getElementById('tbody-ranking-waifus');

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

    state.rankingsLoaded = true;
  } catch (err) {
    console.error('Erro ao carregar rankings:', err);
    tbodyZinthos.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 20px;">Erro ao carregar dados.</td></tr>`;
    tbodyWaifus.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 20px;">Erro ao carregar dados.</td></tr>`;
  }
}

// ========================================================
// MODAL DE DENÚNCIA (🔞)
// ========================================================
function openReportModal(charId, charName) {
  state.pendingReportCharId = charId;
  document.getElementById('report-char-name').textContent = `"${charName}"`;
  document.getElementById('report-reason').value = '';
  document.getElementById('modal-report').classList.remove('hidden');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
  state.pendingReportCharId = null;
}

async function submitReport() {
  if (!state.pendingReportCharId) return;

  const reason = document.getElementById('report-reason').value.trim();
  const btn = document.getElementById('btn-confirm-report');
  btn.disabled = true;

  try {
    const res = await Api.post(`/characters/${encodeURIComponent(state.pendingReportCharId)}/report`, {
      reason: reason || 'Denúncia de personagem pelo catálogo da web (🔞).',
    });

    closeModal('modal-report');

    if (res.success) {
      Api.showToast('Denúncia enviada! A moderação e o Telegram foram notificados.', '🔞');
    } else {
      Api.showToast(res.error?.message || 'Falha ao enviar denúncia.', '❌');
    }
  } catch (err) {
    Api.showToast('Erro de comunicação ao enviar denúncia.', '❌');
  } finally {
    btn.disabled = false;
  }
}

async function fetchRavenaContact() {
  const btn = document.getElementById('btn-whatsapp-ravena');
  try {
    const res = await fetch('/api/web/ravena-contact');
    if (res.ok) {
      const json = await res.json();
      if (json && json.success && json.data && json.data.waLink) {
        if (btn) {
          btn.href = json.data.waLink;
        }
        return;
      }
    }
  } catch {
    // Falha silenciosa
  }
  if (btn) {
    btn.removeAttribute('href');
    btn.removeAttribute('target');
    btn.style.cursor = 'default';
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
