// js/sell-modal.js - Componente Compartilhado de Anúncio Rápido nos Classificados

(function (global) {
  'use strict';

  const MarketSellModal = {
    _initialized: false,
    _activeCharacter: null,
    _token: '',
    _publicId: 'token-session',
    _onSuccess: null,
    _onAlreadyListed: null,
    _isSubmitting: false,

    _ensureDom() {
      let overlay = document.getElementById('modal-quick-sell');
      if (overlay) return overlay;

      overlay = document.createElement('div');
      overlay.className = 'modal-overlay hidden';
      overlay.id = 'modal-quick-sell';
      overlay.innerHTML = `
        <div class="modal-box" style="max-width: min(440px, 94vw); width: 100%; box-sizing: border-box; height: auto; max-height: 85dvh;">
          <div class="modal-header">
            <span class="modal-title" style="font-size: clamp(13px, 3.8vw, 16px);">📢 Anunciar nos Classificados</span>
            <button type="button" class="modal-close" id="btn-quick-sell-close" aria-label="Fechar">&times;</button>
          </div>
          <div class="modal-body">
            <div style="text-align: center; margin-bottom: 14px;">
              <img id="quick-sell-char-img" src="/media/characters/default.jpg" alt="Personagem" style="width: 88px; height: 112px; object-fit: cover; object-position: top center; border-radius: 8px; border: var(--border-retro); margin: 0 auto; display: block;">
              <h4 id="quick-sell-char-name" style="font-weight: 800; font-size: 16px; margin: 8px 0 2px 0;">Nome</h4>
              <span id="quick-sell-char-series" style="font-size: 12.5px; color: var(--text-muted); font-weight: 600;">Série</span>
            </div>
            <div id="quick-sell-keys-warning" class="sell-keys-warning-badge hidden"></div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="retro-label" for="quick-sell-interest">O que você tem interesse em troca?</label>
              <textarea id="quick-sell-interest" class="retro-textarea" rows="3" maxlength="500" placeholder="Ex: Valor mínimo: 123.456z, outras waifus ou itens da fazenda..."></textarea>
              <small style="color: var(--text-muted); font-size: 11.5px; display: block; margin-top: 5px; line-height: 1.35;">
                Este texto será exibido nos classificados para orientar outros jogadores.
              </small>
            </div>
          </div>
          <div class="modal-footer" style="justify-content: flex-end; gap: 8px;">
            <button type="button" class="btn-retro btn-sm" id="btn-quick-sell-cancel">Cancelar</button>
            <button type="button" class="btn-retro btn-sm btn-gold" id="btn-quick-sell-submit">Publicar Anúncio ✨</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      this._bindEvents(overlay);
      return overlay;
    },

    _bindEvents(overlay) {
      if (this._initialized) return;
      this._initialized = true;

      const closeBtn = document.getElementById('btn-quick-sell-close');
      const cancelBtn = document.getElementById('btn-quick-sell-cancel');
      const submitBtn = document.getElementById('btn-quick-sell-submit');
      const imgEl = document.getElementById('quick-sell-char-img');
      const inputEl = document.getElementById('quick-sell-interest');

      if (imgEl) {
        imgEl.onerror = () => {
          if (typeof global.handleImgError === 'function') {
            global.handleImgError(imgEl);
          } else {
            imgEl.onerror = null;
            imgEl.src = '/media/characters/default.jpg';
          }
        };
      }

      closeBtn?.addEventListener('click', () => this.close());
      cancelBtn?.addEventListener('click', () => this.close());
      submitBtn?.addEventListener('click', () => this.submit());

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay && !this._isSubmitting) {
          this.close();
        }
      });

      inputEl?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this.submit();
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden') && !this._isSubmitting) {
          this.close();
        }
      });
    },

    _resolveImg(char) {
      const raw = (Array.isArray(char?.imageUrls) && char.imageUrls[0]) || char?.imageUrl || '';
      if (!raw) return '/media/characters/default.jpg';
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        try {
          const parsed = new URL(raw);
          if (parsed.pathname.startsWith('/characters/')) {
            parsed.pathname = '/media' + parsed.pathname;
            return parsed.toString();
          }
        } catch (_) {}
        return raw;
      }
      if (raw.startsWith('/media/')) return raw;
      if (raw.startsWith('media/')) return `/${raw}`;
      const clean = raw.startsWith('/') ? raw : `/${raw}`;
      return `/media${clean}`;
    },

    _toast(msg, icon = '✨') {
      if (global.Api && typeof global.Api.showToast === 'function') {
        global.Api.showToast(msg, icon);
      } else if (global.Waifinder && typeof global.Waifinder.showToast === 'function') {
        global.Waifinder.showToast(msg, icon);
      }
    },

    _updateKeysWarning(keys, isSoulmate = false) {
      const warnEl = document.getElementById('quick-sell-keys-warning');
      if (!warnEl) return;
      const count = Number(keys || 0);
      if (count > 1) {
        const soulmateNote = (isSoulmate || count >= 10)
          ? ' e o vínculo de Soulmate serão perdidos'
          : ' não são transferidas';
        warnEl.innerHTML = `
          <div class="sell-keys-warning-title">⚠️ ATENÇÃO! Você tem ${count} chaves deste personagem que está anunciando</div>
          <div class="sell-keys-warning-desc">Se alguém comprar ou trocar por este anúncio, a pessoa receberá o personagem com apenas <strong>1 chave</strong> (suas chaves extras${soulmateNote}).</div>
        `;
        warnEl.classList.remove('hidden');
      } else {
        warnEl.innerHTML = '';
        warnEl.classList.add('hidden');
      }
    },

    open(options = {}) {
      const char = options.character;
      if (!char || !char.id) return;

      if (char.isMythic || char.baseRarity === 'MYTHIC' || char.rarity === 'MYTHIC') {
        this._toast('Personagens Míticos pertencem exclusivamente ao criador e não podem ser anunciados nos classificados.', '⚠️');
        return;
      }

      if (!options.token) {
        this._toast('Conecte sua conta com a Ravena AI para anunciar nos classificados!', '🔒');
        return;
      }

      const overlay = this._ensureDom();
      this._activeCharacter = char;
      this._token = options.token;
      this._publicId = options.publicId || 'token-session';
      this._onSuccess = typeof options.onSuccess === 'function' ? options.onSuccess : null;
      this._onAlreadyListed = typeof options.onAlreadyListed === 'function' ? options.onAlreadyListed : null;

      const nameEl = document.getElementById('quick-sell-char-name');
      const seriesEl = document.getElementById('quick-sell-char-series');
      const imgEl = document.getElementById('quick-sell-char-img');
      const inputEl = document.getElementById('quick-sell-interest');
      const submitBtn = document.getElementById('btn-quick-sell-submit');

      const initialKeys = Number(options.keys ?? char.keys ?? 1);
      const initialSoulmate = Boolean(options.isSoulmate ?? char.isSoulmate ?? initialKeys >= 10);
      this._updateKeysWarning(initialKeys, initialSoulmate);

      if (nameEl) nameEl.textContent = char.name || 'Personagem';
      if (seriesEl) seriesEl.textContent = char.series || 'Sem série';
      if (imgEl) {
        imgEl.src = this._resolveImg(char);
        imgEl.alt = char.name || 'Personagem';
      }
      if (inputEl) {
        inputEl.value = 'Valor mínimo: calculando...';
        const pId = encodeURIComponent(this._publicId || 'token-session');
        const token = encodeURIComponent(this._token);
        fetch(`/api/web/user/${pId}/divorce/preview/${encodeURIComponent(char.id)}?token=${token}`)
          .then(r => r.json())
          .then(res => {
            if (res && res.success && res.data) {
              const currentKeys = Number(res.data.currentKeys ?? initialKeys);
              const isSoulmate = Boolean(res.data.isSoulmate || initialSoulmate || currentKeys >= 10);
              this._updateKeysWarning(currentKeys, isSoulmate);
              const val = res.data.refundedKakera ?? res.data.fullRefundKakera ?? 0;
              if (inputEl.value === 'Valor mínimo: calculando...' || inputEl.value === '') {
                inputEl.value = val > 0 ? `Valor mínimo: ${Number(val).toLocaleString('pt-BR')}z` : '';
                if (inputEl.value) inputEl.select();
              }
            } else if (inputEl.value === 'Valor mínimo: calculando...') {
              inputEl.value = '';
            }
          })
          .catch(() => {
            if (inputEl.value === 'Valor mínimo: calculando...') {
              inputEl.value = '';
            }
          });
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Publicar Anúncio ✨';
      }

      overlay.classList.remove('hidden');
      document.body.classList.add('modal-open');

      requestAnimationFrame(() => {
        inputEl?.focus();
        if (inputEl?.value) inputEl.select();
      });
    },

    close() {
      const overlay = document.getElementById('modal-quick-sell');
      if (overlay) overlay.classList.add('hidden');
      if (!document.querySelector('.modal-overlay:not(.hidden):not(#retro-loading-overlay)')) {
        document.body.classList.remove('modal-open');
      }
    },

    async submit() {
      if (this._isSubmitting || !this._activeCharacter) return;

      const inputEl = document.getElementById('quick-sell-interest');
      const submitBtn = document.getElementById('btn-quick-sell-submit');
      const interest = (inputEl?.value || '').trim();

      if (!interest || interest === 'Valor mínimo: calculando...') {
        this._toast('Por favor, informe o que você busca em troca.', '⚠️');
        inputEl?.focus();
        return;
      }

      this._isSubmitting = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publicando...';
      }

      try {
        const publicId = encodeURIComponent(this._publicId || 'token-session');
        const res = await fetch(`/api/web/user/${publicId}/market/listings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            token: this._token,
            characterId: this._activeCharacter.id,
            interest,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data?.success) {
          const cb = this._onSuccess;
          this.close();
          this._toast('Personagem anunciado nos classificados com sucesso!', '✨');
          if (cb) cb(data.data);
          return;
        }

        const errCode = data?.error?.code;
        const errMsg = data?.error?.message || 'Falha ao publicar anúncio nos classificados.';
        this._toast(errMsg, errCode === 'CANNOT_LIST_LOCKED' ? '🔒' : '❌');

        if (errCode === 'ALREADY_LISTED') {
          const alreadyCb = this._onAlreadyListed;
          this.close();
          if (alreadyCb) alreadyCb();
        }
      } catch (_) {
        this._toast('Erro de comunicação ao publicar anúncio.', '❌');
      } finally {
        this._isSubmitting = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Publicar Anúncio ✨';
        }
      }
    },
  };

  global.MarketSellModal = MarketSellModal;
})(window);
