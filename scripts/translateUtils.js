import translate from 'google-translate-api-x';

const translationCache = new Map();

/**
 * Traduz um texto em inglês para Português do Brasil (PT-BR) com retry e fallback.
 * @param {string} text Texto em inglês
 * @returns {Promise<string|null>} Texto traduzido para PT-BR
 */
export async function translateToPtBr(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }

  const trimmed = text.trim();

  // Cache em memória
  if (translationCache.has(trimmed)) {
    return translationCache.get(trimmed);
  }

  // Se o texto já estiver predominantemente em português (ex: contém palavras-chave típicas)
  if (/\b(?:ela|ele|uma|um|garota|estudante|espadachim|membro|mágica|governante)\b/i.test(trimmed)) {
    return trimmed;
  }

  // Tentativa 1: google-translate-api-x com retry
  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    try {
      const res = await translate(trimmed, { to: 'pt', forceBatch: false });
      const translated = res.text?.trim();
      if (translated && translated.length > 0) {
        translationCache.set(trimmed, translated);
        return translated;
      }
    } catch (err) {
      if (attempts < 3) {
        await new Promise(r => setTimeout(r, 1000 * attempts));
      }
    }
  }

  // Tentativa 2: Fallback MyMemory API
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed.slice(0, 500))}&langpair=en|pt-br`;
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      const fallbackText = json.responseData?.translatedText?.trim();
      if (fallbackText && !fallbackText.includes('MYMEMORY WARNING')) {
        translationCache.set(trimmed, fallbackText);
        return fallbackText;
      }
    }
  } catch (err) {
    // Ignorar erro do fallback
  }

  // Se todas as tentativas falharem, retorna o original limpo
  return trimmed;
}

/**
 * Traduz uma lista de textos em lote para PT-BR
 * @param {string[]} texts Lista de textos
 * @returns {Promise<string[]>} Lista de textos traduzidos
 */
export async function translateBatchToPtBr(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  try {
    const res = await translate(texts, { to: 'pt' });
    if (Array.isArray(res)) {
      return res.map(r => r.text);
    }
    return [res.text];
  } catch (err) {
    // Se o lote falhar, traduz individualmente
    const results = [];
    for (const t of texts) {
      results.push(await translateToPtBr(t));
      await new Promise(r => setTimeout(r, 150));
    }
    return results;
  }
}
