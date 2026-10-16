// js/api.js - Utilitários de API, Tema e Notificações Toast para o Waifuletes

const Api = {
  async get(url, headers = {}) {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...headers
      }
    });
    return res.json();
  },

  async post(url, data, headers = {}) {
    const isFormData = data instanceof FormData;
    const res = await fetch(url, {
      method: 'POST',
      headers: isFormData ? headers : { 'Content-Type': 'application/json', ...headers },
      body: isFormData ? data : JSON.stringify(data)
    });
    return res.json();
  },

  async put(url, data, headers = {}) {
    const isFormData = data instanceof FormData;
    const res = await fetch(url, {
      method: 'PUT',
      headers: isFormData ? headers : { 'Content-Type': 'application/json', ...headers },
      body: isFormData ? data : JSON.stringify(data)
    });
    return res.json();
  },

  async delete(url, headers = {}) {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json',
        ...headers
      }
    });
    return res.json();
  },

  showToast(message, icon = '✨') {
    let toast = document.getElementById('retro-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'retro-toast';
      toast.className = 'retro-toast hidden';
      document.body.appendChild(toast);
    }

    toast.innerHTML = `<span style="font-size: 18px;">${icon}</span> <span>${message}</span>`;
    toast.classList.remove('hidden');

    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 3500);
  },

  copyToClipboard(text, successMsg = 'Copiado para a área de transferência!') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => {
        this.showToast(successMsg, '📋');
      });
    }
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    this.showToast(successMsg, '📋');
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
      ? '<i class="fas fa-sun"></i> Claro'
      : '<i class="fas fa-moon"></i> Dark';
    btn.title = isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro (roxo)';
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
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Api.initTheme();
});
