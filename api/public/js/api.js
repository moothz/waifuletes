// js/api.js - Utilitários de API, Tema e Notificações Toast para o Waifuletes

const Api = {
  _loadingCount: 0,
  _lastToastMsg: null,
  _lastToastTime: 0,
  _toastTimer: null,
  _errorCatchingInitialized: false,

  showLoading(title = 'Aguarde... Enviando...', subtext = 'Processando sua solicitação...') {
    let overlay = document.getElementById('retro-loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'retro-loading-overlay';
      overlay.className = 'retro-loading-overlay hidden';
      overlay.innerHTML = `
        <div class="retro-loading-box">
          <div class="retro-spinner"></div>
          <div class="retro-loading-title" id="retro-loading-title">Aguarde... Enviando...</div>
          <div class="retro-loading-subtext" id="retro-loading-subtext">Processando sua solicitação...</div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    const titleEl = document.getElementById('retro-loading-title');
    const subEl = document.getElementById('retro-loading-subtext');
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = subtext;

    overlay.classList.remove('hidden');
    this._loadingCount = (this._loadingCount || 0) + 1;
  },

  hideLoading(force = false) {
    this._loadingCount = Math.max(0, (this._loadingCount || 1) - 1);
    if (force || this._loadingCount === 0) {
      this._loadingCount = 0;
      const overlay = document.getElementById('retro-loading-overlay');
      if (overlay) {
        overlay.classList.add('hidden');
      }
    }
  },

  async request(url, method, data = null, headers = {}, options = {}) {
    const isFormData = data instanceof FormData;
    const isModalOpen = Boolean(document.querySelector('.modal-overlay:not(.hidden):not(#retro-loading-overlay)'));
    const isMutedUrl = typeof url === 'string' && (url.includes('/persist-session') || url.includes('/notifications/read'));
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
    const shouldShowLoading = options.loading === true || (options.loading !== false && isMutation && isModalOpen && !isMutedUrl);

    if (shouldShowLoading) {
      this.showLoading(options.loadingTitle || 'Aguarde... Enviando...', options.loadingSubtext || 'Processando sua solicitação...');
    }

    try {
      const fetchHeaders = isFormData ? { ...headers } : { 'Content-Type': 'application/json', ...headers };
      if (!isFormData && !fetchHeaders['Accept']) {
        fetchHeaders['Accept'] = 'application/json';
      }

      const fetchConfig = {
        method,
        headers: fetchHeaders,
        ...options.fetchOptions
      };

      if (data !== null && data !== undefined) {
        fetchConfig.body = isFormData ? data : JSON.stringify(data);
      }

      const res = await fetch(url, fetchConfig);
      const contentType = res.headers.get('content-type') || '';
      let json;
      if (contentType.includes('application/json')) {
        json = await res.json();
      } else {
        const text = await res.text();
        try {
          json = JSON.parse(text);
        } catch {
          json = { success: res.ok, rawText: text };
        }
      }

      if (!res.ok) {
        if (!json || typeof json !== 'object') json = {};
        const isTooLarge =
          res.status === 413 ||
          json.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ||
          json.error?.code === 'PAYLOAD_TOO_LARGE' ||
          (typeof json.message === 'string' && json.message.toLowerCase().includes('too large')) ||
          (typeof json.error?.message === 'string' && json.error.message.toLowerCase().includes('too large'));

        if (isTooLarge) {
          const customMsg = 'A imagem enviada é muito grande! Compacte ela antes';
          json.success = false;
          json.error = { code: 'PAYLOAD_TOO_LARGE', message: customMsg };
          json.message = customMsg;
        } else if (!json.error && !json.message) {
          json.error = { message: `Erro HTTP ${res.status}: ${res.statusText || 'Falha na resposta do servidor'}` };
        }
      }
      return json;
    } catch (err) {
      const errMsg = err?.message || 'Falha de comunicação com o servidor.';
      this.showToast(errMsg, '❌');
      this.hideLoading(true);
      throw err;
    } finally {
      if (shouldShowLoading) {
        this.hideLoading();
      }
    }
  },

  async get(url, headers = {}, options = {}) {
    const isAuthOrNoCache = Boolean(headers['Authorization'] || headers['authorization'] || headers['Cache-Control']);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...headers
      },
      cache: options.cache || (isAuthOrNoCache ? 'no-store' : 'default'),
      ...options
    });
    return res.json();
  },

  async post(url, data, headers = {}, options = {}) {
    return this.request(url, 'POST', data, headers, options);
  },

  async put(url, data, headers = {}, options = {}) {
    return this.request(url, 'PUT', data, headers, options);
  },

  async patch(url, data, headers = {}, options = {}) {
    return this.request(url, 'PATCH', data, headers, options);
  },

  async delete(url, headers = {}, options = {}) {
    return this.request(url, 'DELETE', null, headers, options);
  },

  showToast(message, icon = '✨') {
    if (!message) return;
    const now = Date.now();
    if (this._lastToastMsg === message && (now - (this._lastToastTime || 0)) < 2500) {
      return;
    }
    this._lastToastMsg = message;
    this._lastToastTime = now;

    let toast = document.getElementById('retro-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'retro-toast';
      toast.className = 'retro-toast hidden';
      document.body.appendChild(toast);
    }

    // Mensagens podem conter nomes/textos de jogadores: renderiza sempre como texto puro
    const iconEl = document.createElement('span');
    iconEl.style.fontSize = '18px';
    iconEl.textContent = icon == null ? '' : String(icon);
    const msgEl = document.createElement('span');
    msgEl.textContent = String(message);
    toast.replaceChildren(iconEl, document.createTextNode(' '), msgEl);
    toast.classList.remove('hidden');

    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 3500);
  },

  initGlobalErrorCatching() {
    if (this._errorCatchingInitialized) return;
    this._errorCatchingInitialized = true;

    window.addEventListener('error', (event) => {
      if (!event || !event.message) return;
      const msg = String(event.message || '');
      if (
        msg.includes('ResizeObserver') ||
        msg.includes('Script error.') ||
        event.filename?.includes('extension://') ||
        event.filename?.includes('chrome-extension://')
      ) {
        return;
      }
      this.hideLoading(true);
      this.showToast(`Erro na página: ${msg}`, '⚠️');
    });

    window.addEventListener('unhandledrejection', (event) => {
      this.hideLoading(true);
      const reason = event?.reason;
      let msg = reason?.message || (typeof reason === 'string' ? reason : null);
      if (!msg && reason && typeof reason === 'object') {
        msg = reason.error?.message || reason.statusText || null;
      }
      if (!msg) {
        msg = 'Erro inesperado na operação.';
      }
      const strMsg = String(msg);
      if (strMsg.includes('ResizeObserver') || strMsg.includes('Script error.')) {
        return;
      }
      this.showToast(`Erro na requisição: ${strMsg}`, '⚠️');
    });
  },

  copyToClipboard(text, successMsg = 'Copiado para a área de transferência!') {
    const fallbackCopy = () => {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.top = '-9999px';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (copied) {
          this.showToast(successMsg, '📋');
          return true;
        }
      } catch (e) {
        // fallback falhou, caller pode abrir modal de cópia manual
      }
      return false;
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
        .then(() => {
          this.showToast(successMsg, '📋');
          return true;
        })
        .catch(() => fallbackCopy());
    }
    return Promise.resolve(fallbackCopy());
  },

  _dialogState: {
    activeSettle: null,
    keyHandler: null,
    observer: null
  },

  _escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /**
   * Escape HTML completo (& < > " ') para texto e valores de atributo entre aspas.
   */
  escapeHtml(str) {
    return this._escapeHtml(str);
  },

  /**
   * Escapa um valor para uma string JS entre aspas simples embutida em atributo HTML
   * entre aspas duplas, ex.: onclick="f('${Api.escapeJsAttr(x)}')".
   * Primeiro escapa para JS (o parser HTML decodifica entidades antes do JS rodar),
   * depois escapa para o atributo HTML.
   */
  escapeJsAttr(str) {
    if (str === null || str === undefined) return '';
    const js = String(str)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
      .replace(/</g, '\\x3C')
      .replace(/>/g, '\\x3E');
    return this._escapeHtml(js);
  },

  /**
   * Escapa tudo e reabilita apenas tags de formatação simples SEM atributos
   * (b, i, u, s, em, strong, code, pre, br). Útil para textos gerados com
   * formatação HTML estilo Telegram que podem conter conteúdo de jogadores.
   */
  sanitizeBasicHtml(str) {
    return this._escapeHtml(str).replace(
      /&lt;(\/?)(b|i|u|s|em|strong|code|pre|br)\s*\/?&gt;/gi,
      (_, slash, tag) => `<${slash}${tag.toLowerCase()}>`
    );
  },

  _formatMultilineText(str) {
    return this._escapeHtml(str).replace(/\r?\n/g, '<br>');
  },

  _ensureDialogModal() {
    let overlay = document.getElementById('retro-dialog-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'retro-dialog-overlay';
    overlay.className = 'modal-overlay hidden';
    overlay.innerHTML = `
      <div class="modal-box retro-dialog-box" role="dialog" aria-modal="true" aria-labelledby="retro-dialog-title">
        <div class="modal-header">
          <h3 id="retro-dialog-title" class="modal-title"></h3>
          <button type="button" id="retro-dialog-close" class="modal-close" aria-label="Fechar">✕</button>
        </div>
        <div id="retro-dialog-body" class="modal-body retro-dialog-body"></div>
        <div id="retro-dialog-footer" class="modal-footer retro-dialog-footer"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && this._dialogState.activeSettle) {
        e.stopPropagation();
        this._dialogState.activeSettle(undefined, true);
      }
    });

    const observer = new MutationObserver(() => {
      if (overlay.classList.contains('hidden') && this._dialogState.activeSettle) {
        this._dialogState.activeSettle(undefined, true);
      }
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    this._dialogState.observer = observer;

    return overlay;
  },

  _openDialog(mode, messageOrOptions) {
    const opts = typeof messageOrOptions === 'string'
      ? { message: messageOrOptions }
      : (messageOrOptions || {});

    const defaults = {
      confirm: { title: 'Confirmação', confirmText: 'Confirmar', cancelText: 'Cancelar', confirmClass: 'btn-primary' },
      alert: { title: 'Aviso', confirmText: 'Entendi', cancelText: '', confirmClass: 'btn-primary' },
      prompt: { title: 'Informação', confirmText: 'Confirmar', cancelText: 'Cancelar', confirmClass: 'btn-primary' }
    }[mode];

    const title = opts.title || defaults.title;
    const icon = opts.icon ? `${opts.icon} ` : '';
    const confirmText = opts.confirmText || defaults.confirmText;
    const cancelText = opts.cancelText || defaults.cancelText;
    const confirmClass = opts.confirmClass || defaults.confirmClass;
    const hideCancel = mode === 'alert' || Boolean(opts.hideCancel);
    const cancelValue = mode === 'prompt' ? null : (mode === 'confirm' ? false : undefined);

    if (this._dialogState.activeSettle) {
      this._dialogState.activeSettle(undefined, true);
    }

    const overlay = this._ensureDialogModal();
    const titleEl = document.getElementById('retro-dialog-title');
    const closeBtn = document.getElementById('retro-dialog-close');
    const bodyEl = document.getElementById('retro-dialog-body');
    const footerEl = document.getElementById('retro-dialog-footer');

    titleEl.textContent = `${icon}${title}`;

    const bodyParts = [];
    if (opts.message) {
      bodyParts.push(`<p class="retro-dialog-message">${this._formatMultilineText(opts.message)}</p>`);
    }

    if (Array.isArray(opts.details) && opts.details.length > 0) {
      const rowsHtml = opts.details.map((item) => `
        <div class="retro-dialog-detail-row">
          <span class="retro-dialog-detail-label">${this._escapeHtml(item.label)}</span>
          <span class="retro-dialog-detail-value">${this._escapeHtml(item.value)}</span>
        </div>
      `).join('');
      bodyParts.push(`<div class="retro-dialog-details">${rowsHtml}</div>`);
    }

    if (Array.isArray(opts.steps) && opts.steps.length > 0) {
      const stepsHtml = opts.steps.map((step) => `<li>${this._escapeHtml(step)}</li>`).join('');
      bodyParts.push(`<ol class="retro-dialog-steps">${stepsHtml}</ol>`);
    }

    if (opts.notice) {
      const tone = ['info', 'warning', 'danger', 'success'].includes(opts.noticeTone) ? opts.noticeTone : 'info';
      bodyParts.push(`<div class="retro-dialog-notice retro-dialog-notice--${tone}">${this._formatMultilineText(opts.notice)}</div>`);
    }

    if (mode === 'prompt') {
      const labelHtml = opts.inputLabel
        ? `<label for="retro-dialog-input" class="retro-dialog-label">${this._escapeHtml(opts.inputLabel)}</label>`
        : '';
      const placeholderAttr = opts.placeholder ? ` placeholder="${this._escapeHtml(opts.placeholder)}"` : '';
      const valueAttr = opts.defaultValue !== undefined && opts.defaultValue !== null
        ? ` value="${this._escapeHtml(opts.defaultValue)}"`
        : '';
      const readOnlyAttr = opts.readOnly ? ' readonly' : '';
      bodyParts.push(`
        <div class="retro-dialog-field">
          ${labelHtml}
          <input type="text" id="retro-dialog-input" class="retro-dialog-input"${placeholderAttr}${valueAttr}${readOnlyAttr} autocomplete="off">
        </div>
      `);
    }

    bodyEl.innerHTML = bodyParts.join('');

    footerEl.className = hideCancel
      ? 'modal-footer retro-dialog-footer retro-dialog-footer--single'
      : 'modal-footer retro-dialog-footer';
    footerEl.innerHTML = `
      ${hideCancel ? '' : `<button type="button" id="retro-dialog-cancel" class="btn-retro">${this._escapeHtml(cancelText)}</button>`}
      <button type="button" id="retro-dialog-confirm" class="btn-retro ${this._escapeHtml(confirmClass)}">${this._escapeHtml(confirmText)}</button>
    `;

    const prevFocus = document.activeElement;
    const cancelBtn = document.getElementById('retro-dialog-cancel');
    const confirmBtn = document.getElementById('retro-dialog-confirm');
    const inputEl = document.getElementById('retro-dialog-input');

    return new Promise((resolve) => {
      let settled = false;
      // Elementos de fundo tornados inertes enquanto o diálogo está aberto
      // (impede foco/clique fora do modal; restaurado ao fechar)
      const inertEls = [];

      const settle = (value, isCancel = false) => {
        if (settled) return;
        settled = true;

        this._dialogState.activeSettle = null;
        if (this._dialogState.keyHandler) {
          window.removeEventListener('keydown', this._dialogState.keyHandler, true);
          this._dialogState.keyHandler = null;
        }

        inertEls.forEach((el) => { el.inert = false; });
        overlay.classList.add('hidden');
        if (!document.querySelector('.modal-overlay:not(.hidden)')) {
          document.body.classList.remove('modal-open');
        }

        if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) {
          try {
            prevFocus.focus();
          } catch (e) {
            // ignorar falha de foco
          }
        }

        resolve(isCancel ? cancelValue : value);
      };

      this._dialogState.activeSettle = settle;

      closeBtn.onclick = () => settle(undefined, true);
      if (cancelBtn) {
        cancelBtn.onclick = () => settle(undefined, true);
      }
      confirmBtn.onclick = () => {
        if (mode === 'prompt') {
          settle(inputEl ? inputEl.value : '');
        } else if (mode === 'confirm') {
          settle(true);
        } else {
          settle(undefined);
        }
      };

      const keyHandler = (e) => {
        if (overlay.classList.contains('hidden')) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          settle(undefined, true);
        } else if (e.key === 'Enter' && mode === 'prompt' && e.target === inputEl) {
          e.preventDefault();
          e.stopImmediatePropagation();
          settle(inputEl.value);
        } else if (e.key === 'Enter' && mode === 'alert' && e.target !== closeBtn && e.target !== confirmBtn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          settle(undefined);
        } else if (e.key === 'Tab') {
          // Mantém o foco circulando apenas dentro do diálogo
          const box = overlay.querySelector('.retro-dialog-box') || overlay;
          const focusables = Array.from(
            box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
          ).filter((el) => !el.disabled && el.offsetParent !== null);
          const active = document.activeElement;
          if (focusables.length === 0) {
            e.preventDefault();
            return;
          }
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (!box.contains(active)) {
            e.preventDefault();
            (e.shiftKey ? last : first).focus();
          } else if (e.shiftKey && active === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };
      this._dialogState.keyHandler = keyHandler;
      window.addEventListener('keydown', keyHandler, true);

      Array.from(document.body.children).forEach((el) => {
        if (el === overlay || el.inert || el.tagName === 'SCRIPT') return;
        el.inert = true;
        inertEls.push(el);
      });

      overlay.classList.remove('hidden');
      document.body.classList.add('modal-open');

      requestAnimationFrame(() => {
        if (inputEl) {
          inputEl.focus();
          if (opts.selectOnOpen || opts.readOnly) {
            inputEl.select();
          }
        } else if (mode === 'confirm' && confirmClass.includes('btn-danger') && cancelBtn) {
          cancelBtn.focus();
        } else {
          confirmBtn.focus();
        }
      });
    });
  },

  showConfirm(messageOrOptions) {
    return this._openDialog('confirm', messageOrOptions);
  },

  showAlert(messageOrOptions) {
    return this._openDialog('alert', messageOrOptions);
  },

  showPrompt(messageOrOptions) {
    return this._openDialog('prompt', messageOrOptions);
  },

  initTheme() {
    const urlParams = new URLSearchParams(window.location.search);
    const themeParam = urlParams.get('theme') || urlParams.get('dark');
    const isDarkParam = themeParam === 'dark' || themeParam === 'true' || themeParam === '1';
    const savedTheme = localStorage.getItem('waifu_theme');

    if (isDarkParam || savedTheme === 'dark') {
      document.body.classList.add('dark-mode');
    }

    const themeBtn = document.getElementById('btn-toggle-theme');
    if (themeBtn) {
      this.updateThemeButton(themeBtn);
      themeBtn.addEventListener('click', () => this.toggleTheme());
    }
  },

  updateThemeButton(btn) {
    if (!btn) return;
    const isDark = document.body.classList.contains('dark-mode');
    btn.innerHTML = isDark
      ? '<i class="fas fa-sun"></i>'
      : '<i class="fas fa-moon"></i>';
    btn.title = isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro (roxo)';
    btn.setAttribute('aria-label', btn.title);
  },

  toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('waifu_theme', isDark ? 'dark' : 'light');
    const themeBtn = document.getElementById('btn-toggle-theme');
    if (themeBtn) {
      this.updateThemeButton(themeBtn);
    }
    this.showToast(isDark ? 'Modo Escuro (Roxo) ativado!' : 'Modo Claro ativado!', isDark ? '🌙' : '☀️');
  },

  getShareUrl(baseUrl) {
    if (!baseUrl) baseUrl = window.location.href;
    const url = new URL(baseUrl, window.location.origin);
    if (document.body.classList.contains('dark-mode')) {
      url.searchParams.set('theme', 'dark');
    } else {
      url.searchParams.delete('theme');
      url.searchParams.delete('dark');
    }
    return url.toString();
  },

  /**
   * Centraliza a aba ativa dentro de uma barra de abas com rolagem horizontal (mobile).
   * Não faz nada quando a barra cabe inteira na tela (desktop) ou está oculta.
   */
  centerActiveTab(container) {
    if (!container || container.scrollWidth <= container.clientWidth + 1) return;
    const active = container.querySelector(':scope > .retro-tab.active');
    if (!active) return;
    const cRect = container.getBoundingClientRect();
    const aRect = active.getBoundingClientRect();
    const target = container.scrollLeft + (aRect.left - cRect.left) - (cRect.width - aRect.width) / 2;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.scrollTo({ left: Math.max(0, target), behavior: reduceMotion ? 'auto' : 'smooth' });
  },

  initTabScroller() {
    if (this._tabScrollerInitialized) return;
    this._tabScrollerInitialized = true;

    const pending = new Set();
    let scheduled = false;
    const schedule = (container) => {
      if (container) pending.add(container);
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        pending.forEach((c) => this.centerActiveTab(c));
        pending.clear();
      });
    };
    const scheduleWithin = (root) => {
      root.querySelectorAll('.retro-tabs').forEach((c) => schedule(c));
    };

    scheduleWithin(document);

    // Reage à troca de aba ativa e à exibição de painéis/modais que contêm barras de abas
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const el = m.target;
        if (!(el instanceof Element)) continue;
        if (el.classList.contains('retro-tab')) {
          if (el.classList.contains('active') && el.parentElement) schedule(el.parentElement);
        } else if (el.matches('.tab-content, .subtab-content, .public-tab-content, .modal-overlay, [id$="-panel"]')) {
          scheduleWithin(el);
        }
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => scheduleWithin(document), 150);
    });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Api.initTheme();
  Api.initGlobalErrorCatching();
  Api.initTabScroller();
});
