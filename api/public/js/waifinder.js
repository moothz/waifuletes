// js/waifinder.js - Motor de Gestos, Áudio Web e Lógica do Waifinder (Catálogo)

const RARITY_MAP = {
  COMMON:    { label: 'Comum',    color: '#94a3b8', bg: '#475569', class: 'rarity-common' },
  UNCOMMON:  { label: 'Incomum',  color: '#22c55e', bg: '#166534', class: 'rarity-uncommon' },
  RARE:      { label: 'Raro',     color: '#3b82f6', bg: '#1e40af', class: 'rarity-rare' },
  EPIC:      { label: 'Épico',    color: '#a855f7', bg: '#6b21a8', class: 'rarity-epic' },
  LEGENDARY: { label: 'Lendário', color: '#eab308', bg: '#854d0e', class: 'rarity-legendary' }
};

// Sintetizador Web Audio API Retrô
const WaifinderAudio = {
  ctx: null,
  isMuted: false,

  init() {
    this.isMuted = localStorage.getItem('waifinder_muted') === 'true';
    this.updateMuteButton();
  },

  getContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  },

  toggleMute() {
    this.isMuted = !this.isMuted;
    localStorage.setItem('waifinder_muted', String(this.isMuted));
    this.updateMuteButton();
    if (!this.isMuted) this.playPop();
  },

  updateMuteButton() {
    const btn = document.getElementById('btn-waifinder-mute');
    if (!btn) return;
    btn.innerHTML = this.isMuted
      ? '<i class="fas fa-volume-mute"></i>'
      : '<i class="fas fa-volume-up"></i>';
    btn.title = this.isMuted ? 'Desmutar efeitos' : 'Silenciar efeitos';
  },

  playTone(freq, duration, type = 'sine', gainVal = 0.08) {
    if (this.isMuted) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (_) {}
  },

  playSwipe() {
    if (this.isMuted) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(260, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.09, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (_) {}
  },

  playLike() {
    if (this.isMuted) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Arpeggio C5 -> E5 -> G5
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.05);

        gain.gain.setValueAtTime(0.08, now + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.05 + 0.15);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.05);
        osc.stop(now + idx * 0.05 + 0.15);
      });
    } catch (_) {}
  },

  playWishlist() {
    if (this.isMuted) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      [880, 1174.66, 1396.91].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.06);

        gain.gain.setValueAtTime(0.09, now + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.06 + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.06);
        osc.stop(now + idx * 0.06 + 0.22);
      });
    } catch (_) {}
  },

  playPop() {
    this.playTone(480, 0.06, 'sine', 0.06);
  }
};

// Estado da Aplicação
const Waifinder = {
  cards: [],
  currentIndex: 0,
  isLoading: false,
  seenIds: [],
  token: '',
  publicId: '',
  userData: null,
  activePointerCard: null,
  isDragging: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  genderFilter: 'ALL',

  async init() {
    WaifinderAudio.init();
    this.initSession();
    this.genderFilter = localStorage.getItem('waifinder_gender') || 'ALL';
    this.updateGenderButton();
    this.setupEventListeners();
    await this.fetchNextBatch();
  },

  // Recupera token da query ou cookie de Manter Login
  initSession() {
    const params = new URLSearchParams(window.location.search);
    this.token = params.get('token') || '';
    this.publicId = params.get('publicId') || '';

    // Se não tiver na URL, confere cookies de persistência (Manter Login)
    if (!this.token) {
      const savedToken = this.getCookie('waifu_session');
      if (savedToken) {
        this.token = savedToken;
      }
    }

    if (this.token && !this.publicId) {
      const savedPublicId = this.getCookie('waifu_public_id');
      if (savedPublicId) {
        this.publicId = savedPublicId;
      }
    }
  },

  getCookie(name) {
    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
    }
    return null;
  },

  setupEventListeners() {
    // Alternar tema Dark/Light com auto-detecção
    const themeBtn = document.getElementById('btn-waifinder-theme');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        localStorage.setItem('waifu_theme', isDark ? 'dark' : 'light');
        themeBtn.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        WaifinderAudio.playPop();
      });
    }

    // Auto-detecção de tema inicial
    const savedTheme = localStorage.getItem('waifu_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      document.body.classList.add('dark-mode');
      if (themeBtn) themeBtn.innerHTML = '<i class="fas fa-sun"></i>';
    }

    // Mute áudio
    const muteBtn = document.getElementById('btn-waifinder-mute');
    if (muteBtn) {
      muteBtn.addEventListener('click', () => WaifinderAudio.toggleMute());
    }

    // Botões de Ação Inferiores
    const btnPass = document.getElementById('btn-action-pass');
    if (btnPass) {
      btnPass.addEventListener('click', () => this.swipeCard('left'));
    }

    const btnLike = document.getElementById('btn-action-like');
    if (btnLike) {
      btnLike.addEventListener('click', () => this.swipeCard('right'));
    }

    const btnWishlist = document.getElementById('btn-action-wishlist');
    if (btnWishlist) {
      btnWishlist.addEventListener('click', () => this.handleWishlist());
    }

    const btnGender = document.getElementById('btn-action-gender');
    if (btnGender) {
      btnGender.addEventListener('click', () => this.toggleGenderFilter());
    }

    // Atalhos de Teclado Desktop
    window.addEventListener('keydown', (e) => {
      // Ignora se estiver digitando em campos de texto/modal
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      const key = e.key.toLowerCase();
      if (key === 'arrowleft' || key === 'a') {
        e.preventDefault();
        this.swipeCard('left');
      } else if (key === 'arrowright' || key === 'd') {
        e.preventDefault();
        this.swipeCard('right');
      } else if (key === 'w') {
        e.preventDefault();
        this.handleWishlist();
      } else if (key === 'g' || key === 's') {
        e.preventDefault();
        this.toggleGenderFilter();
      } else if (key === 'escape') {
        this.closeModals();
      }
    });
  },

  updateGenderButton() {
    const btn = document.getElementById('btn-action-gender');
    const label = document.getElementById('label-gender-filter');
    const icon = document.getElementById('icon-gender-filter');
    if (!btn || !label || !icon) return;

    btn.classList.remove('filter-all', 'filter-waifus', 'filter-husbandos');

    if (this.genderFilter === 'FEMALE') {
      btn.classList.add('filter-waifus');
      label.textContent = 'Waifus';
      icon.className = 'fas fa-venus';
      btn.title = 'Filtro atual: Waifus (♀). Clique para alternar para Husbandos.';
    } else if (this.genderFilter === 'MALE') {
      btn.classList.add('filter-husbandos');
      label.textContent = 'Husbandos';
      icon.className = 'fas fa-mars';
      btn.title = 'Filtro atual: Husbandos (♂). Clique para alternar para Todos.';
    } else {
      btn.classList.add('filter-all');
      label.textContent = 'Todos';
      icon.className = 'fas fa-venus-mars';
      btn.title = 'Filtro atual: Todos os gêneros. Clique para alternar para Waifus.';
    }
  },

  toggleGenderFilter() {
    WaifinderAudio.playPop();

    if (this.genderFilter === 'ALL') {
      this.genderFilter = 'FEMALE';
      this.showToast('Filtrando: Apenas Waifus ♀', '🌸');
    } else if (this.genderFilter === 'FEMALE') {
      this.genderFilter = 'MALE';
      this.showToast('Filtrando: Apenas Husbandos ♂', '⚔️');
    } else {
      this.genderFilter = 'ALL';
      this.showToast('Filtrando: Todos os Gêneros ⚧', '✨');
    }

    localStorage.setItem('waifinder_gender', this.genderFilter);
    this.updateGenderButton();

    // Reinicia baralho com o novo filtro
    this.cards = [];
    this.currentIndex = 0;
    const deckEl = document.getElementById('waifinder-deck');
    if (deckEl) {
      deckEl.innerHTML = `
        <div class="waifinder-empty-state">
          <div class="empty-icon">✨</div>
          <h3 style="font-weight:800;font-size:17px;margin-bottom:6px;">Buscando ${this.genderFilter === 'FEMALE' ? 'Waifus' : (this.genderFilter === 'MALE' ? 'Husbandos' : 'personagens')}...</h3>
          <p style="font-size:12px;color:var(--text-muted);">Embaralhando catálogo com nova seleção...</p>
        </div>
      `;
    }
    this.fetchNextBatch();
  },

  async fetchNextBatch() {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const queryParams = new URLSearchParams();
      if (this.token) queryParams.set('token', this.token);
      if (this.publicId) queryParams.set('publicId', this.publicId);
      if (this.genderFilter) queryParams.set('gender', this.genderFilter);
      if (this.seenIds.length > 0) {
        queryParams.set('excludeIds', this.seenIds.slice(-40).join(','));
      }

      const res = await fetch(`/api/web/catalog/deck?${queryParams.toString()}`);
      const data = await res.json();

      if (data.success && Array.isArray(data.data?.characters)) {
        const newChars = data.data.characters;
        this.cards.push(...newChars);

        // Atualiza cabeçalho com dados de sessão caso autenticado
        if (data.data.authenticated && data.data.user) {
          this.userData = data.data.user;
          this.publicId = this.userData.publicId;
          const userBadge = document.getElementById('waifinder-user-badge');
          if (userBadge) {
            userBadge.innerHTML = `<i class="fas fa-user-circle"></i> <span>${this.userData.name}</span> <span style="color:#eab308;font-weight:800;">(${this.userData.kakera} 💎)</span>`;
            userBadge.classList.remove('hidden');
          }
          const haremLink = document.getElementById('waifinder-harem-link');
          if (haremLink) {
            haremLink.href = `/user/${this.userData.publicId}${this.token ? `?token=${encodeURIComponent(this.token)}` : ''}`;
            haremLink.classList.remove('hidden');
          }
        }

        this.renderDeck();
      } else if (this.cards.length === 0) {
        this.showEmptyState();
      }
    } catch (err) {
      console.error('Erro ao buscar lote do Waifinder:', err);
      if (this.cards.length === 0) this.showEmptyState();
    } finally {
      this.isLoading = false;
    }
  },

  renderDeck() {
    const deckEl = document.getElementById('waifinder-deck');
    if (!deckEl) return;

    // Mantém prefetch ativo quando restarem menos de 4 cards
    const remaining = this.cards.length - this.currentIndex;
    if (remaining <= 4 && !this.isLoading) {
      this.fetchNextBatch();
    }

    if (remaining <= 0) {
      this.showEmptyState();
      return;
    }

    deckEl.innerHTML = '';

    // Renderiza até 3 cards empilhados
    const visibleCount = Math.min(3, remaining);
    for (let i = visibleCount - 1; i >= 0; i--) {
      const cardIndex = this.currentIndex + i;
      const char = this.cards[cardIndex];
      const cardEl = this.createCardElement(char, i);
      deckEl.appendChild(cardEl);

      if (i === 0) {
        this.bindCardGestures(cardEl);
      }
    }
  },

  formatCardImg(url, charId) {
    if (!url) {
      return charId ? `/media/characters/${charId}/default.jpg` : '/media/characters/default.jpg';
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      try {
        const parsed = new URL(url);
        if (parsed.pathname.startsWith('/characters/')) {
          parsed.pathname = '/media' + parsed.pathname;
          return parsed.toString();
        }
      } catch (_) {}
      return url;
    }
    if (url.startsWith('/media/')) return url;
    if (url.startsWith('media/')) return `/${url}`;
    const clean = url.startsWith('/') ? url : `/${url}`;
    return `/media${clean}`;
  },

  createCardElement(char, layerIndex) {
    const rarity = RARITY_MAP[char.baseRarity] || RARITY_MAP.COMMON;
    const rawImg = (char.imageUrls && char.imageUrls[0]) || '';
    const imgUrl = this.formatCardImg(rawImg, char.id);
    const rankText = char.waifuRank ? `#${char.waifuRank}` : (char.rank ? `#${char.rank}` : '');

    const card = document.createElement('div');
    card.className = `waifinder-card card-layer-${layerIndex} ${rarity.class}`;
    card.dataset.id = char.id;

    card.innerHTML = `
      <div class="waifinder-card-img-wrap">
        <img class="waifinder-card-img" src="${imgUrl}" alt="${char.name}" onerror="window.handleImgError(this)">
        <div class="waifinder-card-gradient"></div>

        <div class="waifinder-badges-top">
          <span class="waifinder-rarity-badge" style="background:${rarity.bg};">${rarity.label}</span>
          ${rankText ? `<span class="waifinder-rank-badge">🏆 ${rankText}</span>` : ''}
        </div>

        <div class="waifinder-stamp stamp-like">CURTIR</div>
        <div class="waifinder-stamp stamp-nope">PASSAR</div>
        <div class="waifinder-stamp stamp-wishlist">⭐ WISHLIST</div>
      </div>

      <div class="waifinder-card-info">
        <div class="waifinder-char-name">
          <span>${char.name}</span>
          ${char.isWishlisted ? '<span title="Já na sua Wishlist!" style="font-size:15px;color:#eab308;">★</span>' : ''}
        </div>
        <div class="waifinder-char-series">
          <i class="fas fa-tv"></i> <span>${char.series || 'Origem desconhecida'}</span>
        </div>
        <div class="waifinder-char-stats">
          <span>❤️ ${char.likeCount || 0} curtidas</span>
          <span>💍 ${char.claimCount || 0} casamentos</span>
          ${char.gender ? `<span>${char.gender === 'FEMALE' ? '♀' : char.gender === 'MALE' ? '♂' : '⚧'}</span>` : ''}
        </div>
        <div class="waifinder-char-desc">
          ${char.description || 'Nenhuma descrição cadastrada para este personagem.'}
        </div>
      </div>
    `;

    return card;
  },

  bindCardGestures(cardEl) {
    this.activePointerCard = cardEl;

    const onPointerDown = (e) => {
      if (e.target.closest('.waifinder-char-desc')) {
        // Permite scroll dentro da descrição sem disparar swipe
        if (e.target.scrollHeight > e.target.clientHeight) return;
      }

      this.isDragging = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.currentX = 0;
      this.currentY = 0;

      cardEl.style.transition = 'none';
      cardEl.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e) => {
      if (!this.isDragging) return;

      this.currentX = e.clientX - this.startX;
      this.currentY = e.clientY - this.startY;

      const rotate = this.currentX * 0.08;
      cardEl.style.transform = `translate3d(${this.currentX}px, ${this.currentY}px, 0) rotate(${rotate}deg)`;

      // Atualiza opacidade dos selos de Like e Nope
      const likeStamp = cardEl.querySelector('.stamp-like');
      const nopeStamp = cardEl.querySelector('.stamp-nope');

      if (this.currentX > 0) {
        const opacity = Math.min(1, this.currentX / 80);
        if (likeStamp) likeStamp.style.opacity = opacity;
        if (nopeStamp) nopeStamp.style.opacity = 0;
      } else {
        const opacity = Math.min(1, Math.abs(this.currentX) / 80);
        if (nopeStamp) nopeStamp.style.opacity = opacity;
        if (likeStamp) likeStamp.style.opacity = 0;
      }
    };

    const onPointerUp = (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;

      try {
        cardEl.releasePointerCapture(e.pointerId);
      } catch (_) {}

      const threshold = 95;
      if (this.currentX > threshold) {
        this.animateCardExit('right');
      } else if (this.currentX < -threshold) {
        this.animateCardExit('left');
      } else {
        // Restaura ao centro suavemente
        cardEl.style.transition = 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        cardEl.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';

        const likeStamp = cardEl.querySelector('.stamp-like');
        const nopeStamp = cardEl.querySelector('.stamp-nope');
        if (likeStamp) likeStamp.style.opacity = 0;
        if (nopeStamp) nopeStamp.style.opacity = 0;
      }
    };

    cardEl.addEventListener('pointerdown', onPointerDown);
    cardEl.addEventListener('pointermove', onPointerMove);
    cardEl.addEventListener('pointerup', onPointerUp);
    cardEl.addEventListener('pointercancel', onPointerUp);
  },

  swipeCard(direction) {
    if (!this.activePointerCard) return;
    this.animateCardExit(direction);
  },

  animateCardExit(direction) {
    const cardEl = this.activePointerCard;
    if (!cardEl) return;

    this.activePointerCard = null;
    const currentChar = this.cards[this.currentIndex];
    this.seenIds.push(currentChar.id);

    const flyX = direction === 'right' ? window.innerWidth + 200 : -window.innerWidth - 200;
    const rotate = direction === 'right' ? 25 : -25;

    cardEl.style.transition = 'transform 0.32s ease-out, opacity 0.28s ease-out';
    cardEl.style.transform = `translate3d(${flyX}px, 0, 0) rotate(${rotate}deg)`;
    cardEl.style.opacity = '0';

    if (direction === 'right') {
      WaifinderAudio.playLike();
      this.submitLike(currentChar.id);
    } else {
      WaifinderAudio.playSwipe();
    }

    setTimeout(() => {
      if (cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
      this.currentIndex++;
      this.renderDeck();
    }, 280);
  },

  async submitLike(charId) {
    if (!this.token) {
      this.showAuthPrompt('Para curtir personagens e registrá-los na sua conta, entre com seu link do WhatsApp!');
      return;
    }

    try {
      const publicId = this.publicId || 'token-session';
      const res = await fetch(`/api/web/user/${publicId}/characters/${charId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token })
      });
      const data = await res.json();
      if (!data.success && data.error?.code === 'LIKE_ALREADY_GIVEN_TODAY') {
        this.showToast(data.error.message, '⏳');
      } else if (data.success) {
        this.showToast('Curtida registrada! ❤️', '✨');
      }
    } catch (_) {}
  },

  async handleWishlist() {
    const currentChar = this.cards[this.currentIndex];
    if (!currentChar) return;

    if (!this.token) {
      this.showAuthPrompt('Para adicionar waifus à sua Wishlist, entre com seu link do WhatsApp!');
      return;
    }

    const cardEl = this.activePointerCard;
    if (cardEl) {
      const stamp = cardEl.querySelector('.stamp-wishlist');
      if (stamp) {
        stamp.style.opacity = '1';
        setTimeout(() => { stamp.style.opacity = '0'; }, 600);
      }
    }

    WaifinderAudio.playWishlist();

    try {
      const publicId = this.publicId || 'token-session';
      const res = await fetch(`/api/web/user/${publicId}/wishlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token, characterId: currentChar.id })
      });
      const data = await res.json();

      if (data.success) {
        this.showToast(`${currentChar.name} adicionada à sua Wishlist!`, '⭐');
      } else {
        this.showToast(data.error?.message || 'Não foi possível adicionar à wishlist.', '⚠️');
      }
    } catch (err) {
      this.showToast('Erro ao comunicar com o servidor.', '❌');
    }
  },

  showAuthPrompt(customMsg) {
    WaifinderAudio.playPop();
    const msgEl = document.getElementById('auth-prompt-msg');
    if (msgEl && customMsg) msgEl.textContent = customMsg;
    const modal = document.getElementById('modal-waifinder-auth');
    if (modal) modal.classList.remove('hidden');
  },

  closeModals() {
    document.querySelectorAll('.modal-overlay').forEach((m) => m.classList.add('hidden'));
  },

  showEmptyState() {
    const deckEl = document.getElementById('waifinder-deck');
    if (!deckEl) return;
    deckEl.innerHTML = `
      <div class="waifinder-empty-state">
        <div class="empty-icon">✨</div>
        <h3 style="font-weight:800;font-size:18px;margin-bottom:6px;">Todos os cards foram vistos!</h3>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px;">Buscando mais waifus no catálogo...</p>
        <button class="waifinder-header-btn" onclick="Waifinder.seenIds = []; Waifinder.fetchNextBatch();">
          <i class="fas fa-redo"></i> Recarregar Baralho
        </button>
      </div>
    `;
  },

  showToast(message, icon = '✨') {
    let toast = document.getElementById('retro-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'retro-toast';
      toast.className = 'retro-toast hidden';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span style="font-size:18px;">${icon}</span> <span>${message}</span>`;
    toast.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 3200);
  }
};

window.addEventListener('DOMContentLoaded', () => {
  Waifinder.init();
});
