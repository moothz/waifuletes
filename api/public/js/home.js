// js/home.js - Lógica do Catálogo Geral do Waifuletes (Home)

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
  loading: false
};

document.addEventListener('DOMContentLoaded', () => {
  bindHomeEvents();
  loadCharacters();
  fetchRavenaContact();
});

function bindHomeEvents() {
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
      genderPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.gender = pill.dataset.gender;
      state.page = 1;
      loadCharacters();
    });
  });

  // Filtro de estado civil (Todos, Solteiros, Casados)
  maritalPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      maritalPills.forEach(p => p.classList.remove('active'));
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
      limit: state.limit
    });
    if (state.search) params.append('search', state.search);
    if (state.gender) params.append('gender', state.gender);
    if (state.rarity) params.append('rarity', state.rarity);
    if (state.maritalStatus) params.append('maritalStatus', state.maritalStatus);

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
        <div style="grid-column: 1 / -1; text-align: center; padding: 48px; background: #fff; border: 2px solid #2d241e; border-radius: 6px; box-shadow: 3px 3px 0px #2d241e;">
          <div style="font-size: 40px; margin-bottom: 8px;">💔</div>
          <h3 style="font-size: 18px; font-weight: 800;">Nenhum personagem encontrado</h3>
          <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Tente alterar os termos da busca ou os filtros de raridade e estado.</p>
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
  const wishlistCount = char.wishlistCount || 0;
  const imgSrc = char.imageUrl || '/media/characters/default.jpg';

  const card = document.createElement('div');
  card.className = 'waifu-card';
  card.dataset.id = char.id;

  let marriedTooltip = '💍 Solteira(o)';
  if (isMarried) {
    marriedTooltip = spouse ? `💍 Casada(o) com ${spouse}` : '💍 Casada(o)';
  }

  card.innerHTML = `
    <div class="card-img-wrapper">
      <img src="${imgSrc}" loading="lazy" alt="${char.name}" onerror="this.onerror=null;this.src='/media/characters/default.jpg';">
      
      <div class="badge-rarity" style="border-color: ${rarityCfg.color}; color: ${rarityCfg.color};" title="Raridade: ${rarityCfg.label}">
        ${rarityCfg.emoji} ${rarityCfg.label}
      </div>

      ${isMarried ? `
        <div class="badge-married" title="${marriedTooltip}">
          💍
        </div>
      ` : ''}

      <div class="badge-wishes" title="${wishlistCount} pessoa(s) adicionaram à wishlist">
        <span>✨</span> <span>${wishlistCount}</span>
      </div>

      <button class="btn-card-fav" title="Copiar comando de desejar: !mu-desejar ${char.id}">
        <i class="far fa-star"></i>
      </button>
    </div>

    <div class="card-info">
      <div class="card-name" title="${char.name}">${char.name}</div>
      <div class="card-series" title="${char.series || 'Sem série'}">${char.series || 'Sem série'}</div>
    </div>
  `;

  // Ação de favoritar / desejar
  const favBtn = card.querySelector('.btn-card-fav');
  favBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const cmd = `!mu-desejar ${char.id}`;
    Api.copyToClipboard(cmd, `Copiado: ${cmd} (envie no WhatsApp da Ravena!)`);
  });

  // Ação do badge de casamento
  if (isMarried) {
    const marriedBadge = card.querySelector('.badge-married');
    if (marriedBadge) {
      marriedBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        Api.showToast(marriedTooltip, '💍');
      });
    }
  }

  return card;
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

