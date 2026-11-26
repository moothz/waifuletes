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
    // 1. Extrai ID do personagem da URL ou da query string
    const parts = window.location.pathname.split('/').filter(Boolean);
    let extractedId = decodeURIComponent(parts[parts.length - 1] || '');
    if (!extractedId || extractedId === 'character' || extractedId === 'character.html') {
      const sp = new URLSearchParams(window.location.search);
      extractedId = sp.get('id') || '';
    }
    this.charId = extractedId;

    if (!this.charId) {
      document.getElementById('char-name').textContent = 'Personagem não informado.';
      return;
    }

    // 2. Extrai credenciais de autenticação da URL, cookies ou localStorage
    const sp = new URLSearchParams(window.location.search);
    this.userToken = sp.get('token') || getCookie('waifu_session') || localStorage.getItem('waifu_session');
    this.userPublicId = sp.get('publicId') || getCookie('waifu_user_public_id') || getCookie('waifu_public_id') || localStorage.getItem('waifu_user_public_id');

    // 3. Tenta validar sessão do usuário se houver token (com ou sem publicId)
    if (this.userToken) {
      try {
        const lookupPublicId = this.userPublicId || 'token-session';
        const res = await Api.get(`/api/web/user/${encodeURIComponent(lookupPublicId)}?token=${encodeURIComponent(this.userToken)}`);
        if (res?.success && res.data) {
          this.userSessionData = res.data;
          this.userPublicId = res.data.publicId || this.userPublicId;
          this.isAuthenticated = true;

          // Atualiza botão de Meu Harém no rodapé
          const btnHarem = document.getElementById('btn-harem-nav');
          if (btnHarem && this.userPublicId) {
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
    const seriesEl = document.getElementById('char-series');
    if (seriesEl) {
      const rawSeries = c.series ? String(c.series).trim() : '';
      if (rawSeries) {
        const filterUrl = `/?q=${encodeURIComponent(rawSeries)}`;
        seriesEl.innerHTML = `Série: <a href="${filterUrl}" class="series-filter-link" title="Filtrar catálogo por ${escapeHtml(rawSeries)}" style="color: var(--accent, #3b82f6); text-decoration: underline; font-weight: 700;">${escapeHtml(rawSeries)}</a>`;
      } else {
        seriesEl.textContent = `Série: ${cSeries}`;
      }
    }

    // Ranks
    const rankEl = document.getElementById('char-rank-line');
    if (rankEl) {
      rankEl.innerHTML = `
        <span class="char-badge-tag" style="background: #eab308; color: #000; font-weight: 800;" title="Rank Oficial Waifuletes">
          🏆 #${cWaifuRank ? cWaifuRank : '-'}
        </span>
        ${cMudaeRank ? `
          <span class="char-badge-tag" style="background: #1d4ed8; color: #fff; font-weight: 800;" title="Rank original do Mudae">
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
        FEMALE: '<span style="color: var(--text-pink, #ec4899);">♀ Feminino</span>',
        MALE: '<span style="color: var(--text-info, #3b82f6);">♂ Masculino</span>',
        OTHER: '<span style="color: var(--text-violet, #8b5cf6);">⚧ Outro</span>'
      };
      genderEl.innerHTML = gMap[cGender] || gMap.OTHER;
    }

    // Raridade
    const rarityEl = document.getElementById('char-rarity');
    const isMythic = Boolean(c.isMythic || c.rarity === 'MYTHIC' || c.baseRarity === 'MYTHIC');
    if (rarityEl) {
      if (isMythic) {
        rarityEl.innerHTML = `<span class="badge-rarity" style="position: static; display: inline-block; background: linear-gradient(135deg, #581c87, #3b0764); border: 1.5px solid #c084fc; color: #facc15; font-weight: 900; box-shadow: 0 0 8px rgba(168, 85, 247, 0.6); padding: 4px 10px; border-radius: 4px;">🔮 MÍTICO</span>`;
      } else {
        const rConfig = RARITY_CONFIG[cRarity] || RARITY_CONFIG.COMMON;
        const rKey = RARITY_CONFIG[cRarity] ? cRarity.toLowerCase() : 'common';
        rarityEl.innerHTML = `<span style="color: var(--rarity-text-${rKey}, ${rConfig.color}); font-weight:800;">${rConfig.emoji} ${rConfig.label}</span>`;
      }
    }

    // Linha de Casamento
    const marriageEl = document.getElementById('char-marriage-line');
    if (marriageEl) {
      if (isMythic) {
        const creator = c.creator || c.creatorUser;
        const creatorName = creator?.name || cOwner?.name || 'Apoiador';
        const creatorPublicId = creator?.publicId || cOwner?.publicId || null;
        const creatorHref = creatorPublicId
          ? (typeof Api !== 'undefined' && Api.getShareUrl ? Api.getShareUrl(`/user/${encodeURIComponent(creatorPublicId)}`) : `/user/${encodeURIComponent(creatorPublicId)}`)
          : null;
        const creatorLink = creatorHref
          ? `<a href="${escapeHtml(creatorHref)}" target="_blank" rel="noopener noreferrer" class="spouse-profile-link" title="Abrir perfil público de ${escapeHtml(creatorName)}" style="color: #facc15; text-decoration: underline; font-weight: 800;">${escapeHtml(creatorName)}</a>`
          : `<span style="color: #facc15; font-weight: 800;">${escapeHtml(creatorName)}</span>`;

        marriageEl.innerHTML = `
          <div style="margin-bottom: 6px;"><span style="color: #c084fc; font-weight: 800;">🔮 Forjado por:</span> ${creatorLink}</div>
          <div style="font-size: 13px; color: #ec4899; font-weight: 700;">💍 Eternamente Casada(o) com ${creatorLink}</div>
        `;
      } else if (isClaimed) {
        const ownerName = cOwner?.name || (typeof cOwner === 'string' ? cOwner : 'Outro jogador');
        const ownerPublicId = cOwner?.publicId || null;
        if (ownerPublicId) {
          const ownerHref = typeof Api !== 'undefined' && Api.getShareUrl ? Api.getShareUrl(`/user/${encodeURIComponent(ownerPublicId)}`) : `/user/${encodeURIComponent(ownerPublicId)}`;
          marriageEl.innerHTML = `💍 Casada(o) com <a href="${escapeHtml(ownerHref)}" target="_blank" rel="noopener noreferrer" class="spouse-profile-link" title="Abrir perfil público de ${escapeHtml(ownerName)}" style="color: #ec4899; text-decoration: underline; font-weight: 800;">${escapeHtml(ownerName)}</a>`;
        } else {
          marriageEl.innerHTML = `💍 Casada(o) com <span style="color: #ec4899; font-weight: 800;">${escapeHtml(ownerName)}</span>`;
        }
      } else {
        marriageEl.innerHTML = `<span style="color: var(--text-success, #22c55e); font-weight: 800;">💍 Solteira(o) (Livre para casamento!)</span>`;
      }
    }

    // Likes e Wishlists
    document.getElementById('char-likes-count').textContent = cLikes;
    document.getElementById('char-wishes-count').textContent = cWishes;

    // Tags
    const tagsEl = document.getElementById('char-tags');
    if (tagsEl) {
      if (isMythic) {
        tagsEl.innerHTML = '';
        tagsEl.style.display = 'none';
      } else {
        tagsEl.style.display = 'flex';
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

    const isMythic = Boolean(this.charData?.isMythic || this.charData?.rarity === 'MYTHIC' || this.charData?.baseRarity === 'MYTHIC');

    // Botão de Wishlist e Sugestão (ocultos para Míticos)
    const btnWishEl = document.getElementById('btn-char-wish');
    if (btnWishEl) {
      btnWishEl.style.display = isMythic ? 'none' : '';
    }
    const btnSuggestEl = document.getElementById('btn-char-suggest');
    if (btnSuggestEl) {
      btnSuggestEl.style.display = isMythic ? 'none' : '';
    }

    if (!this.isAuthenticated) {
      // MODO NÃO AUTENTICADO: Sem botões de ação que exigem autenticação
      authActionsEl.classList.add('hidden');
      authActionsEl.innerHTML = '';
      unauthBox.classList.remove('hidden');

      // Botão curtir/wishlist não autenticado exibe aviso
      document.getElementById('btn-char-like').onclick = () => {
        Api.showToast('Conecte sua conta com a Ravena AI para curtir personagens!', '🔒');
      };
      if (btnWishEl) {
        btnWishEl.onclick = () => {
          Api.showToast('Conecte sua conta com a Ravena AI para adicionar waifus à wishlist!', '🔒');
        };
      }
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
      const myHaremEntry = (this.userSessionData?.harem || []).find(
        (h) => (h.character?.id || h.characterId) === this.charId
      );
      const isFav = Boolean(myHaremEntry?.isFavorite);
      const favBtn = document.createElement('button');
      favBtn.type = 'button';
      favBtn.className = 'btn-retro btn-sm';
      favBtn.style.cssText = 'background: #ec4899; color: white; border-color: #db2777; font-weight: 800;';
      favBtn.innerHTML = `💖 ${isFav ? 'Desfavoritar' : 'Favoritar no Harém'}`;
      favBtn.onclick = () => this.toggleFavorite();
      authActionsEl.appendChild(favBtn);

      // 2. Anunciar nos Classificados (mesmo espaço do Cobiçar quando o casamento é seu)
      if (!isMythic) {
        const isListed = Array.isArray(this.userSessionData?.listedCharacterIds) &&
          this.userSessionData.listedCharacterIds.includes(this.charId);
        const isListBlocked = Boolean(myHaremEntry && (myHaremEntry.isLocked || myHaremEntry.collection?.isLocked));

        const sellBtn = document.createElement('button');
        sellBtn.type = 'button';
        sellBtn.id = 'btn-char-announce';
        sellBtn.className = 'btn-retro btn-sm btn-gold';
        sellBtn.style.cssText = 'font-weight: 800;';
        if (isListed) {
          sellBtn.disabled = true;
          sellBtn.style.opacity = '0.75';
          sellBtn.innerHTML = '<i class="fas fa-check"></i> Anunciada nos Classificados';
        } else if (isListBlocked) {
          sellBtn.style.opacity = '0.65';
          sellBtn.innerHTML = '🔒 Anúncio Bloqueado';
          sellBtn.onclick = () => {
            Api.showToast('Personagens bloqueados (ou em coleções bloqueadas) não podem ser anunciados nos classificados.', '🔒');
          };
        } else {
          sellBtn.innerHTML = '<i class="fas fa-bullhorn"></i> Anunciar nos Classificados';
          sellBtn.onclick = () => this.openAnnounceModal(sellBtn);
        }
        authActionsEl.appendChild(sellBtn);
      }

      // 3. Atalho para o Harém
      const haremBtn = document.createElement('a');
      haremBtn.href = `/user/${encodeURIComponent(this.userPublicId)}`;
      haremBtn.className = 'btn-retro btn-sm btn-gold';
      haremBtn.style.cssText = 'text-decoration: none; font-weight: 800;';
      haremBtn.innerHTML = '<i class="fas fa-ring"></i> Gerenciar no Meu Harém';
      authActionsEl.appendChild(haremBtn);
    } else if (isMythic) {
      const mythicNotice = document.createElement('div');
      mythicNotice.style.cssText = 'font-size: 13px; font-weight: 800; color: #facc15; background: rgba(168, 85, 247, 0.2); border: 1.5px solid #a855f7; border-radius: 6px; padding: 10px; text-align: center;';
      mythicNotice.innerHTML = '🔮 Criação Mítica forjada por um apoiador lendário da Ravena AI.';
      authActionsEl.appendChild(mythicNotice);
    } else {
      if (isClaimed) {
        // Cobiçar
        const isCoveted = Array.isArray(this.userSessionData?.covetedCharacterIds) &&
          this.userSessionData.covetedCharacterIds.includes(this.charId);
        const covBtn = document.createElement('button');
        covBtn.type = 'button';
        covBtn.id = 'btn-char-covet';
        covBtn.className = 'btn-retro btn-sm';
        covBtn.style.cssText = isCoveted
          ? 'border-color: #22c55e; color: #16a34a; font-weight: 800;'
          : 'border-color: #ec4899; color: #ec4899; font-weight: 800;';
        covBtn.innerHTML = isCoveted
          ? '<i class="fas fa-check"></i> 👀 Cobiçado'
          : '<i class="fas fa-eye"></i> Cobiçar Personagem';
        covBtn.disabled = isCoveted;
        covBtn.onclick = () => this.covetCharacter(covBtn);
        authActionsEl.appendChild(covBtn);
      } else {
        // Personagem Solteiro
        const ctaSingle = document.createElement('div');
        ctaSingle.style.cssText = 'font-size: 13px; font-weight: 800; color: var(--text-success, #22c55e); padding: 6px;';
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
          thumb.loading = 'lazy';
          thumb.decoding = 'async';
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

  async covetCharacter(btnEl) {
    try {
      const res = await Api.post(`/api/web/user/${encodeURIComponent(this.userPublicId)}/covet`, {
        token: this.userToken,
        characterId: this.charId,
      });
      if (res?.success) {
        if (!Array.isArray(this.userSessionData?.covetedCharacterIds)) {
          if (this.userSessionData) this.userSessionData.covetedCharacterIds = [];
        }
        if (this.userSessionData && !this.userSessionData.covetedCharacterIds.includes(this.charId)) {
          this.userSessionData.covetedCharacterIds.push(this.charId);
        }
        if (btnEl) {
          btnEl.disabled = true;
          btnEl.style.borderColor = '#22c55e';
          btnEl.style.color = '#16a34a';
          btnEl.innerHTML = '<i class="fas fa-check"></i> 👀 Cobiçado';
        }
        Api.showToast(res.data?.message || 'Interesse registrado no harém do jogador!', '👀');
      } else {
        Api.showToast(res.error?.message || 'Falha ao cobiçar.', '❌');
      }
    } catch (_) {
      Api.showToast('Erro ao registrar interesse.', '❌');
    }
  },

  openAnnounceModal(btnEl) {
    if (!this.isAuthenticated || !this.userToken) {
      Api.showToast('Conecte sua conta enviando !mu-adm para a Ravena para anunciar nos classificados!', '🔒');
      return;
    }
    if (!this.charData || this.charData.isMythic) {
      return;
    }
    if (!window.MarketSellModal) {
      Api.showToast('Componente de anúncio não carregado.', '❌');
      return;
    }

    const markListed = () => {
      if (this.userSessionData) {
        if (!Array.isArray(this.userSessionData.listedCharacterIds)) {
          this.userSessionData.listedCharacterIds = [];
        }
        if (!this.userSessionData.listedCharacterIds.includes(this.charId)) {
          this.userSessionData.listedCharacterIds.push(this.charId);
        }
      }
      if (btnEl) {
        btnEl.disabled = true;
        btnEl.style.opacity = '0.75';
        btnEl.innerHTML = '<i class="fas fa-check"></i> Anunciada nos Classificados';
      }
    };

    const myHaremEntry = (this.userSessionData?.harem || []).find(
      (h) => (h.character?.id || h.characterId) === this.charId
    );

    window.MarketSellModal.open({
      character: this.charData,
      keys: myHaremEntry?.keys ?? this.charData?.keys ?? 1,
      isSoulmate: Boolean(myHaremEntry?.isSoulmate || this.charData?.isSoulmate),
      token: this.userToken,
      publicId: this.userPublicId || 'token-session',
      onSuccess: () => markListed(),
      onAlreadyListed: () => markListed(),
    });
  },

  openSuggestModal() {
    if (!this.isAuthenticated || !this.userToken) {
      Api.showToast('Conecte sua conta enviando !mu-adm para a Ravena para sugerir alterações!', '🔒');
      return;
    }
    if (!this.charData || this.charData.isMythic) {
      return;
    }
    if (!window.SuggestionModal) {
      Api.showToast('Componente de sugestões não carregado.', '❌');
      return;
    }
    window.SuggestionModal.open({
      character: this.charData,
      token: this.userToken,
      publicId: this.userPublicId || 'token-session',
      onSuccess: () => {
        this.loadCharacterData();
      },
    });
  },

  openReportModal() {
    const modal = document.getElementById('modal-report-character');
    if (!modal) return;
    const charNameEl = document.getElementById('report-char-name');
    if (charNameEl) {
      charNameEl.textContent = this.charData?.name || this.charId;
    }
    const input = document.getElementById('report-reason-input');
    if (input) input.value = '';
    modal.classList.remove('hidden');
    if (input) input.focus();
  },

  closeReportModal() {
    const modal = document.getElementById('modal-report-character');
    if (modal) modal.classList.add('hidden');
  },

  async submitReport() {
    const btn = document.getElementById('btn-submit-report');
    const input = document.getElementById('report-reason-input');
    const reason = input ? input.value.trim() : '';

    if (!reason) {
      Api.showToast('Por favor, descreva o motivo da denúncia.', '⚠️');
      if (input) input.focus();
      return;
    }

    if (btn) btn.disabled = true;

    try {
      const targetId = this.charData?.id || this.charId;
      const res = await Api.post(`/characters/${encodeURIComponent(targetId)}/report`, {
        characterId: targetId,
        reason,
        userId: this.userSessionData?.id || undefined,
        userName: this.userSessionData?.name || undefined,
      });

      if (res?.success) {
        this.closeReportModal();
        Api.showToast(res.data?.message || 'Denúncia enviada com sucesso! A moderação irá avaliar.', '🛡️');
        const reportBtn = document.getElementById('btn-char-report');
        if (reportBtn) {
          reportBtn.disabled = true;
          reportBtn.innerHTML = '<i class="fas fa-check"></i> Denunciado';
          reportBtn.style.opacity = '0.6';
        }
      } else {
        Api.showToast(res.error?.message || 'Erro ao enviar denúncia.', '❌');
      }
    } catch (_) {
      Api.showToast('Erro de comunicação ao enviar denúncia.', '❌');
    } finally {
      if (btn) btn.disabled = false;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  CharacterPage.init();
});
