/**
 * Lógica do Card Dedicado de Personagem (Página Standalone /character/:id)
 */

const RARITY_CONFIG = {
  LEGENDARY: { label: 'Lendário', color: '#eab308', emoji: '⭐' },
  EPIC: { label: 'Épico', color: '#a855f7', emoji: '🟣' },
  RARE: { label: 'Raro', color: '#3b82f6', emoji: '🔵' },
  UNCOMMON: { label: 'Incomum', color: '#22c55e', emoji: '🟢' },
  COMMON: { label: 'Comum', color: '#94a3b8', emoji: '⚪' },
};

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

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const CharacterPage = {
  charId: null,
  charData: null,
  images: [],
  currentIndex: 0,
  userPublicId: null,
  userToken: null,
  userSessionData: null,
  isAuthenticated: false,

  async init() {
    // 1. Extrai ID do personagem da URL
    const parts = window.location.pathname.split('/').filter(Boolean);
    this.charId = decodeURIComponent(parts[parts.length - 1] || '');

    if (!this.charId) {
      document.getElementById('char-name').textContent = 'Personagem não informado.';
      return;
    }

    // 2. Extrai credenciais de autenticação da URL, cookies ou localStorage
    const sp = new URLSearchParams(window.location.search);
    this.userToken = sp.get('token') || getCookie('waifu_session') || localStorage.getItem('waifu_session');
    this.userPublicId = sp.get('publicId') || getCookie('waifu_user_public_id') || getCookie('waifu_public_id') || localStorage.getItem('waifu_user_public_id');

    // 3. Tenta validar sessão do usuário se houver token e publicId
    if (this.userPublicId && this.userToken) {
      try {
        const res = await Api.get(`/api/web/user/${encodeURIComponent(this.userPublicId)}?token=${encodeURIComponent(this.userToken)}`);
        if (res?.success && res.data?.isAdmin) {
          this.userSessionData = res.data;
          this.isAuthenticated = true;

          // Atualiza botão de Meu Harém no rodapé
          const btnHarem = document.getElementById('btn-harem-nav');
          if (btnHarem) {
            btnHarem.href = `/user/${encodeURIComponent(this.userPublicId)}`;
            btnHarem.classList.remove('hidden');
          }
        }
      } catch (_) {}
    }

    // 4. Carrega link de contato da Ravena
    this.fetchRavenaContact();

    // 5. Carrega dados do personagem
    await this.loadCharacterData();
  },

  async fetchRavenaContact() {
    try {
      const res = await Api.get('/api/web/ravena-contact');
      if (res?.success && res.data?.waLink) {
        const btnWa = document.getElementById('btn-char-whatsapp');
        if (btnWa) btnWa.href = res.data.waLink;
      }
    } catch (_) {}
  },

  async loadCharacterData() {
    try {
      const res = await Api.get(`/characters/${encodeURIComponent(this.charId)}`);
      if (!res?.success || !res.data) {
        document.getElementById('char-name').textContent = 'Personagem não encontrado.';
        return;
      }

      this.charData = res.data;
      this.render();
    } catch (err) {
      document.getElementById('char-name').textContent = 'Erro ao carregar waifu.';
    }
  },

  render() {
    const c = this.charData;
    const cName = c.name || this.charId;
    const cSeries = c.series || 'Sem série informada';
    const cRarity = c.baseRarity || 'COMMON';
    const cGender = c.gender || 'OTHER';
    const cDesc = c.description || '';
    const cLikes = Number(c.likeCount || 0);
    const cWishes = Number(c.wishlistCount || 0);
    const cWaifuRank = c.waifuRank || null;
    const cMudaeRank = c.rank || null;
    const cScore = Number(c.popularityScore || 0);
    const cTags = Array.isArray(c.tags) ? c.tags : [];
    const cOwner = c.owner || null;
    const isClaimed = Boolean(c.isClaimed || cOwner);

    document.title = `${cName} • Waifuletes ✨`;
    document.getElementById('char-card-title').textContent = cName;
    document.getElementById('char-name').textContent = cName;
    document.getElementById('char-series').textContent = `Série: ${cSeries}`;

    // Ranks
    const rankEl = document.getElementById('char-rank-line');
    if (rankEl) {
      rankEl.innerHTML = `
        <span class="char-badge-tag" style="background: #eab308; color: #000; font-weight: 800;" title="Rank Oficial Waifuletes">
          🏆 #${cWaifuRank ? cWaifuRank : '-'}
        </span>
        ${cMudaeRank ? `
          <span class="char-badge-tag" style="background: #3b82f6; color: #fff; font-weight: 800;" title="Rank original do Mudae">
            🌐 Mudae #${cMudaeRank}
          </span>
        ` : ''}
        <span class="char-badge-tag" style="background: #64748b; color: #fff; font-weight: 800;" title="Pontuação de popularidade">
          ⭐ ${cScore} pts
        </span>
      `;
    }

    // Gênero
    const genderEl = document.getElementById('char-gender');
    if (genderEl) {
      const gMap = {
        FEMALE: '<span style="color:#ec4899;">♀ Feminino</span>',
        MALE: '<span style="color:#3b82f6;">♂ Masculino</span>',
        OTHER: '<span style="color:#8b5cf6;">⚧ Outro</span>'
      };
      genderEl.innerHTML = gMap[cGender] || gMap.OTHER;
    }

    // Raridade
    const rarityEl = document.getElementById('char-rarity');
    const rConfig = RARITY_CONFIG[cRarity] || RARITY_CONFIG.COMMON;
    if (rarityEl) {
      rarityEl.innerHTML = `<span style="color:${rConfig.color}; font-weight:800;">${rConfig.emoji} ${rConfig.label}</span>`;
    }

    // Linha de Casamento
    const marriageEl = document.getElementById('char-marriage-line');
    if (marriageEl) {
      if (isClaimed) {
        const ownerName = cOwner?.name || (typeof cOwner === 'string' ? cOwner : 'Outro jogador');
        const ownerPublicId = cOwner?.publicId || null;
        if (ownerPublicId) {
          marriageEl.innerHTML = `💍 Casada(o) com <a href="/user/${ownerPublicId}" target="_blank" style="color: #ec4899; text-decoration: underline; font-weight: 800;">${escapeHtml(ownerName)}</a>`;
        } else {
          marriageEl.innerHTML = `💍 Casada(o) com <span style="color: #ec4899; font-weight: 800;">${escapeHtml(ownerName)}</span>`;
        }
      } else {
        marriageEl.innerHTML = `<span style="color: #22c55e; font-weight: 800;">💍 Solteira(o) (Livre para casamento!)</span>`;
      }
    }

    // Likes e Wishlists
    document.getElementById('char-likes-count').textContent = cLikes;
    document.getElementById('char-wishes-count').textContent = cWishes;

    // Tags
    const tagsEl = document.getElementById('char-tags');
    if (tagsEl) {
      tagsEl.innerHTML = '';
      if (cTags.length > 0) {
        cTags.forEach((t) => {
          const span = document.createElement('span');
          span.className = 'char-badge-tag';
          span.style.cssText = 'background: rgba(255,255,255,0.1); color: var(--text-muted); font-size: 11px;';
          span.textContent = `#${t}`;
          tagsEl.appendChild(span);
        });
      } else {
        tagsEl.innerHTML = '<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">Nenhuma tag cadastrada</span>';
      }
    }

    // Descrição
    const descEl = document.getElementById('char-description');
    if (descEl) {
      if (cDesc) {
        descEl.textContent = cDesc;
        descEl.style.display = 'block';
      } else {
        descEl.style.display = 'none';
      }
    }

    // Imagens e carrossel
    if (Array.isArray(c.imageUrls) && c.imageUrls.length > 0) {
      this.images = c.imageUrls;
    } else if (c.imageUrl) {
      this.images = [c.imageUrl];
    } else {
      this.images = ['/media/characters/default.jpg'];
    }
    this.currentIndex = 0;
    this.updateCarouselDisplay();

    // Renderiza ações contextuais baseadas em autenticação
    this.renderActions(isClaimed, cOwner);
  },

  renderActions(isClaimed, cOwner) {
    const authActionsEl = document.getElementById('char-actions-authenticated');
    const unauthBox = document.getElementById('char-unauth-box');

    if (!this.isAuthenticated) {
      // MODO NÃO AUTENTICADO: Sem botões de ação que exigem autenticação
      authActionsEl.classList.add('hidden');
      authActionsEl.innerHTML = '';
      unauthBox.classList.remove('hidden');

      // Botão curtir/wishlist não autenticado exibe aviso
      document.getElementById('btn-char-like').onclick = () => {
        Api.showToast('Conecte sua conta com a Ravena AI para curtir personagens!', '🔒');
      };
      document.getElementById('btn-char-wish').onclick = () => {
        Api.showToast('Conecte sua conta com a Ravena AI para adicionar waifus à wishlist!', '🔒');
      };
      return;
    }

    // MODO AUTENTICADO: Exibe botões operacionais
    unauthBox.classList.add('hidden');
    authActionsEl.classList.remove('hidden');
    authActionsEl.innerHTML = '';

    const isMarriedToMe = (this.userSessionData?.harem || []).some(
      (h) => (h.character?.id || h.characterId) === this.charId
    ) || cOwner?.publicId === this.userPublicId;

    if (isMarriedToMe) {
      // 1. Favoritar / Desfavoritar
      const isFav = (this.userSessionData?.harem || []).some(
        (h) => (h.character?.id || h.characterId) === this.charId && h.isFavorite
      );
      const favBtn = document.createElement('button');
      favBtn.className = 'btn-retro btn-sm';
      favBtn.style.cssText = 'background: #ec4899; color: white; border-color: #db2777; font-weight: 800;';
      favBtn.innerHTML = `💖 ${isFav ? 'Desfavoritar' : 'Favoritar no Harém'}`;
      favBtn.onclick = () => this.toggleFavorite();
      authActionsEl.appendChild(favBtn);

      // 2. Atalho para o Harém
      const haremBtn = document.createElement('a');
      haremBtn.href = `/user/${encodeURIComponent(this.userPublicId)}`;
      haremBtn.className = 'btn-retro btn-sm btn-gold';
      haremBtn.style.cssText = 'text-decoration: none; font-weight: 800;';
      haremBtn.innerHTML = '<i class="fas fa-ring"></i> Gerenciar no Meu Harém';
      authActionsEl.appendChild(haremBtn);
    } else {
      if (isClaimed) {
        // Cobiçar
        const covBtn = document.createElement('button');
        covBtn.className = 'btn-retro btn-sm';
        covBtn.style.cssText = 'border-color: #ec4899; color: #ec4899; font-weight: 800;';
        covBtn.innerHTML = '<i class="fas fa-eye"></i> Cobiçar Personagem';
        covBtn.onclick = () => this.covetCharacter();
        authActionsEl.appendChild(covBtn);
      } else {
        // Personagem Solteiro
        const ctaSingle = document.createElement('div');
        ctaSingle.style.cssText = 'font-size: 13px; font-weight: 800; color: #22c55e; padding: 6px;';
        ctaSingle.innerHTML = '✨ Esta waifu está livre para casamento no WhatsApp via <code>!mu-roll</code>!';
        authActionsEl.appendChild(ctaSingle);
      }
    }

    // Configura botões de Curtir e Wishlist para usuário logado
    const isAlreadyWish = Array.isArray(this.userSessionData?.wishlist) &&
      this.userSessionData.wishlist.some((w) => (w.character?.id || w.characterId) === this.charId);

    const btnWish = document.getElementById('btn-char-wish');
    if (btnWish) {
      if (isAlreadyWish) {
        btnWish.className = 'btn-retro btn-sm btn-wish-active';
        btnWish.innerHTML = `<i class="fas fa-check"></i> <span id="char-wishes-count">${this.charData.wishlistCount || 0}</span> Na Wishlist`;
      } else {
        btnWish.className = 'btn-retro btn-sm btn-gold';
        btnWish.innerHTML = `<i class="fas fa-star"></i> <span id="char-wishes-count">${this.charData.wishlistCount || 0}</span> Wishlist`;
      }
      btnWish.onclick = () => this.toggleWishlist();
    }

    const btnLike = document.getElementById('btn-char-like');
    if (btnLike) {
      btnLike.onclick = () => this.registerLike();
    }
  },

  updateCarouselDisplay() {
    const imgEl = document.getElementById('char-main-img');
    const countEl = document.getElementById('char-photo-count');
    const btnPrev = document.getElementById('btn-char-prev');
    const btnNext = document.getElementById('btn-char-next');
    const thumbsRow = document.getElementById('char-thumbs-row');

    if (!imgEl || this.images.length === 0) return;

    imgEl.src = this.images[this.currentIndex] || '/media/characters/default.jpg';

    if (this.images.length > 1) {
      if (countEl) {
        countEl.textContent = `Foto ${this.currentIndex + 1} de ${this.images.length}`;
        countEl.style.display = 'block';
      }
      if (btnPrev) btnPrev.style.display = 'flex';
      if (btnNext) btnNext.style.display = 'flex';
    } else {
      if (countEl) countEl.style.display = 'none';
      if (btnPrev) btnPrev.style.display = 'none';
      if (btnNext) btnNext.style.display = 'none';
    }

    if (thumbsRow) {
      thumbsRow.innerHTML = '';
      if (this.images.length > 1) {
        this.images.forEach((imgUrl, idx) => {
          const thumb = document.createElement('img');
          thumb.src = imgUrl;
          thumb.className = `char-thumb ${idx === this.currentIndex ? 'active' : ''}`;
          thumb.onerror = () => handleImgError(thumb);
          thumb.onclick = () => {
            this.currentIndex = idx;
            this.updateCarouselDisplay();
          };
          thumbsRow.appendChild(thumb);
        });
      }
    }
  },

  changePhoto(delta) {
    if (this.images.length <= 1) return;
    this.currentIndex = (this.currentIndex + delta + this.images.length) % this.images.length;
    this.updateCarouselDisplay();
  },

  async registerLike() {
    try {
      const res = await Api.post(`/api/web/user/${encodeURIComponent(this.userPublicId)}/characters/${encodeURIComponent(this.charId)}/like`, {
        token: this.userToken,
      });
      if (res?.success) {
        Api.showToast('Curtida registrada!', '💖');
        const countEl = document.getElementById('char-likes-count');
        if (countEl && res.data?.likeCount !== undefined) {
          countEl.textContent = res.data.likeCount;
        }
      } else {
        Api.showToast(res.error?.message || 'Falha ao curtir.', '❌');
      }
    } catch (_) {
      Api.showToast('Erro de comunicação.', '❌');
    }
  },

  async toggleWishlist() {
    try {
      const res = await Api.post(`/api/web/user/${encodeURIComponent(this.userPublicId)}/wishlist`, {
        token: this.userToken,
        characterId: this.charId,
      });
      if (res?.success) {
        Api.showToast(res.data?.message || 'Wishlist atualizada!', '⭐');
        setTimeout(() => window.location.reload(), 600);
      } else {
        Api.showToast(res.error?.message || 'Falha ao atualizar wishlist.', '❌');
      }
    } catch (_) {
      Api.showToast('Erro ao atualizar wishlist.', '❌');
    }
  },

  async toggleFavorite() {
    try {
      const res = await Api.post(`/api/web/user/${encodeURIComponent(this.userPublicId)}/favorite`, {
        token: this.userToken,
        characterId: this.charId,
      });
      if (res?.success) {
        Api.showToast(res.data?.message || 'Favorito atualizado!', '💖');
        setTimeout(() => window.location.reload(), 600);
      } else {
        Api.showToast(res.error?.message || 'Falha ao favoritar.', '❌');
      }
    } catch (_) {
      Api.showToast('Erro ao favoritar.', '❌');
    }
  },

  async covetCharacter() {
    try {
      const res = await Api.post(`/api/web/user/${encodeURIComponent(this.userPublicId)}/covet`, {
        token: this.userToken,
        characterId: this.charId,
      });
      if (res?.success) {
        Api.showToast(res.data?.message || 'Interesse registrado no harém do jogador!', '👀');
      } else {
        Api.showToast(res.error?.message || 'Falha ao cobiçar.', '❌');
      }
    } catch (_) {
      Api.showToast('Erro ao registrar interesse.', '❌');
    }
  },

  copyShareLink() {
    const url = window.location.origin + `/character/${encodeURIComponent(this.charId)}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => Api.showToast('Link do personagem copiado!', '📋'))
        .catch(() => Api.showToast(url, '📋'));
    } else {
      prompt('Copie o link do personagem:', url);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  CharacterPage.init();
});
