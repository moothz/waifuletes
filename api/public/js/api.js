// js/api.js - Utilitários de API e Notificações Toast para o Waifuletes

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
  }
};
