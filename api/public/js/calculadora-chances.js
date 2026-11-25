document.addEventListener('DOMContentLoaded', async () => {
  if (typeof Api !== 'undefined' && Api.initTheme) {
    Api.initTheme();
  }

  const els = {
    search: document.getElementById('char-search'),
    searchResults: document.getElementById('char-search-results'),
    selectedInfo: document.getElementById('selected-char-info'),
    rarity: document.getElementById('rarity'),
    rarityPoolInfo: document.getElementById('rarity-pool-info'),
    rankPos: document.getElementById('rank-pos'),
    rankPosVal: document.getElementById('rank-pos-val'),
    rankMultInfo: document.getElementById('rank-mult-info'),
    goalMode: document.getElementById('goal-mode'),
    keysRow: document.getElementById('keys-row'),
    keysCurrent: document.getElementById('keys-current'),
    keysTarget: document.getElementById('keys-target'),
    shares: document.getElementById('shares'),
    sharesVal: document.getElementById('shares-val'),
    donorReais: document.getElementById('donor-reais'),
    donorVal: document.getElementById('donor-val'),
    donorInfo: document.getElementById('donor-info'),
    wishSize: document.getElementById('wish-size'),
    wishSizeVal: document.getElementById('wish-size-val'),
    inWishlist: document.getElementById('in-wishlist'),
    genderFilter: document.getElementById('gender-filter'),
    weeklyLegWrap: document.getElementById('weekly-leg-wrap'),
    weeklyLeg: document.getElementById('weekly-leg'),
    weeklyLegVal: document.getElementById('weekly-leg-val'),
    rollsDay: document.getElementById('rolls-day'),
    rollsDayVal: document.getElementById('rolls-day-val'),
    zinthosDay: document.getElementById('zinthos-day'),
    zinthosDayVal: document.getElementById('zinthos-day-val'),
    resP1: document.getElementById('res-p1'),
    resAvgRolls: document.getElementById('res-avg-rolls'),
    resPday: document.getElementById('res-pday'),
    resP30: document.getElementById('res-p30'),
    resCost: document.getElementById('res-cost'),
    resDays: document.getElementById('res-days'),
    resHybrid: document.getElementById('res-hybrid'),
    resHybridHint: document.getElementById('res-hybrid-hint'),
    eqBox: document.getElementById('equation-box'),
    constTbody: document.getElementById('constants-tbody'),
  };

  let state = null;
  let searchTimer = null;

  const fmtInt = (n) => Math.round(n).toLocaleString('pt-BR');
  const fmtPct = (p) => {
    const pct = p * 100;
    if (pct >= 10) return `${pct.toFixed(2)}%`;
    if (pct >= 0.1) return `${pct.toFixed(3)}%`;
    return `${pct.toFixed(4)}%`;
  };

  async function loadConstants() {
    const res = await fetch('/public/calculator/constants');
    const json = await res.json();
    if (!json.success) throw new Error('Falha ao carregar constantes');
    state = json.data;
    renderConstantsTable();
    syncRankBounds();
    recalculate();
  }

  function renderConstantsTable() {
    const c = state.constants;
    const m = state.macro;
    const rows = [
      ['Pesos base de raridade', `C:${c.rarityBaseWeights.COMMON} · I:${c.rarityBaseWeights.UNCOMMON} · R:${c.rarityBaseWeights.RARE} · E:${c.rarityBaseWeights.EPIC} · L:${c.rarityBaseWeights.LEGENDARY}`, 'Proporção base de cada raridade no sorteio.'],
      ['Teto de chance Lendária', `${(c.legendaryChanceCap * 100).toFixed(2)}% por roll`, 'Segura a chance máxima de Lendárias mesmo com vários bônus somados.'],
      ['Hard Cap semanal Lendário', `${c.weeklyLegendaryHardCap} por semana`, 'Reduz a chance a cada Lendária pega na semana e zera ao bater o limite.'],
      ['Dificuldade de Rank no Roll', `1x a ${c.rollRankMaxDifficulty}x (corte #${fmtInt(c.rollRankRefCutoff)})`, 'Deixa personagens do topo do rank até 7x mais difíceis no sorteio.'],
      ['Multiplicador de Rank (Cotas/Divórcio)', `1x a ${c.rankMultiplierMax}x (expoente ${c.rankMultiplierExponent})`, 'Aumenta o divórcio e o piso das cotas para personagens populares.'],
      ['Inflação Monetária (M2)', `${m.inflationMultiplier}x (α = ${m.inflationAlpha})`, `Ajusta preços ao total de Zinthos em circulação (${fmtInt(m.circulatingKakera)}).`],
      ['Escassez por Raridade (β)', `C:${m.scarcityBeta.COMMON} · I:${m.scarcityBeta.UNCOMMON} · R:${m.scarcityBeta.RARE} · E:${m.scarcityBeta.EPIC} · L:${m.scarcityBeta.LEGENDARY}`, 'Sobe o custo de cotas conforme a raridade fica mais escassa no servidor.'],
      ['Diária base e Dias por raridade', `${fmtInt(c.baseDailyZinthos)}/dia · [${c.rarityDays.COMMON}, ${c.rarityDays.UNCOMMON}, ${c.rarityDays.RARE}, ${c.rarityDays.EPIC}, ${c.rarityDays.LEGENDARY}] dias`, 'Base de cálculo de 4 cotas (1 chave) antes de inflação, escassez e rank.'],
      ['Escada de Soulmate (chaves 1→10)', c.marriedKeyProgressionWeights.map((w) => `${w}x`).join(' → '), 'Cada chave sobe de preço até o valor cheio na 10ª (Soulmate).'],
    ];

    els.constTbody.innerHTML = rows
      .map(([name, val, reason]) => `<tr><td><strong>${name}</strong></td><td><code>${val}</code></td><td>${reason}</td></tr>`)
      .join('');
  }

  function syncRankBounds() {
    if (!state) return;
    const rar = els.rarity.value;
    const info = state.pool.byRarity[rar];
    const total = Math.max(1, info?.total || 1000);
    els.rankPos.max = String(total);
    if (Number(els.rankPos.value) > total) {
      els.rankPos.value = String(total);
    }
    els.rarityPoolInfo.textContent = `${fmtInt(info.total)} ativos (${fmtInt(info.claimed)} casados · escassez ${info.scarcityMultiplier}x)`;
  }

  function computeDonorBonuses(reais) {
    const extraMaxRolls = Math.floor(reais / 10);
    const rarityMultipliers = {
      COMMON: 1.0,
      UNCOMMON: 1.0,
      RARE: Math.min(10.0, Number((1 + reais * 0.02).toFixed(3))),
      EPIC: Math.min(10.0, Number((1 + reais * 0.035).toFixed(3))),
      LEGENDARY: Math.min(10.0, Number((1 + reais * 0.02).toFixed(3))),
    };
    const wishlistMultiplier = reais >= 50
      ? Math.min(20.0, Number((4.0 + (reais - 50) * 0.08).toFixed(3)))
      : 1.5;
    return { extraMaxRolls, rarityMultipliers, wishlistMultiplier };
  }

  function recalculate() {
    if (!state) return;
    const c = state.constants;
    const m = state.macro;
    const rar = els.rarity.value;
    const info = state.pool.byRarity[rar];
    const totalInRarity = Math.max(1, info.total || 1000);
    const pos = Math.max(1, Math.min(totalInRarity, Number(els.rankPos.value) || 1));
    els.rankPosVal.textContent = `#${fmtInt(pos)} / ${fmtInt(totalInRarity)}`;

    // Rank multiplier (divorce/cotas)
    const ratio = Math.max(0, 1.0 - (pos - 1) / totalInRarity);
    const rankMultiplier = pos === 1
      ? c.rankMultiplierMax
      : pos >= totalInRarity
        ? 1.0
        : Math.max(1.0, 1.0 + (c.rankMultiplierMax - 1.0) * Math.pow(ratio, c.rankMultiplierExponent));

    // Roll rank weight (1/7 para rank #1 até 1.0 para >= cutoff)
    const cutoff = c.rollRankRefCutoff || 20000;
    const maxDiff = c.rollRankMaxDifficulty || 7.0;
    const rawRollRank = pos >= cutoff ? maxDiff : pos <= 1 ? 1.0 : 1.0 + (maxDiff - 1.0) * ((pos - 1) / (cutoff - 1));
    const rollRankWeight = rawRollRank / maxDiff;

    els.rankMultInfo.textContent = `Rank (cotas): ${rankMultiplier.toFixed(2)}x | Fator no roll: ${(rollRankWeight * 100).toFixed(1)}%`;

    // Donor & wishlist
    const reais = Math.max(0, Number(els.donorReais.value) || 0);
    const donor = computeDonorBonuses(reais);
    const regenSec = Math.round(c.rollRegenSeconds / (1 + (c.rollRegenAccelFactor / 1000) * donor.extraMaxRolls));
    els.donorVal.textContent = `R$ ${fmtInt(reais)}`;
    els.donorInfo.textContent = `+${donor.extraMaxRolls} rolls máx. (recarga ${regenSec}s) · Raro/Lend ${donor.rarityMultipliers.RARE}x · Épico ${donor.rarityMultipliers.EPIC}x · Wish ${donor.wishlistMultiplier}x`;

    const wishSize = Math.max(0, Math.min(1000, Number(els.wishSize.value) || 0));
    els.wishSizeVal.textContent = fmtInt(wishSize);

    const shares = Math.max(0, Math.min(3, Number(els.shares.value) || 0));
    const shareMult = shares === 0 ? 1 : shares === 1 ? 4 : shares === 2 ? 10 : 25;
    els.sharesVal.textContent = `${shares} cota${shares === 1 ? '' : 's'} (${shareMult}x)`;

    const inWish = els.inWishlist.checked;
    const wMult = inWish ? donor.wishlistMultiplier : 1.0;

    // Weekly legendary diminishing returns
    const weeklyCount = Math.max(0, Math.min(c.weeklyLegendaryHardCap, Number(els.weeklyLeg.value) || 0));
    els.weeklyLegVal.textContent = `${weeklyCount} / ${c.weeklyLegendaryHardCap}`;
    els.weeklyLegWrap.style.display = rar === 'LEGENDARY' ? 'block' : 'none';
    const weeklyMult = weeklyCount >= c.weeklyLegendaryHardCap
      ? 0
      : weeklyCount <= 0
        ? 1.0
        : Math.pow((c.weeklyLegendaryHardCap - weeklyCount) / c.weeklyLegendaryHardCap, 1.5);

    // Gender filter ratio
    const gFilter = els.genderFilter.value;
    const genderRatio = gFilter === 'FEMALE'
      ? state.pool.femaleEligibleRatio
      : gFilter === 'MALE'
        ? state.pool.maleEligibleRatio
        : 1.0;

    // Pool weights
    let nonLegPool = 0;
    for (const r of ['COMMON', 'UNCOMMON', 'RARE', 'EPIC']) {
      const cnt = (state.pool.byRarity[r]?.total || 0) * genderRatio;
      nonLegPool += cnt * c.rarityBaseWeights[r] * donor.rarityMultipliers[r];
    }
    // Pequena diluição proporcional dos itens na wishlist
    const wishDilution = 1 + (wishSize / Math.max(1, state.pool.totalActive)) * (donor.wishlistMultiplier - 1) * 0.5;
    nonLegPool *= wishDilution;

    const rawLegPool = (state.pool.byRarity.LEGENDARY?.total || 0) * genderRatio * c.rarityBaseWeights.LEGENDARY * donor.rarityMultipliers.LEGENDARY * weeklyMult;
    const capFrac = weeklyMult <= 0 ? 0 : c.legendaryChanceCap * weeklyMult;
    let legScale = 1.0;
    let effLegPool = rawLegPool;
    if (nonLegPool > 0 && rawLegPool > 0 && capFrac < 1.0 && (rawLegPool / (nonLegPool + rawLegPool)) > capFrac) {
      effLegPool = (capFrac / (1 - capFrac)) * nonLegPool;
      legScale = effLegPool / rawLegPool;
    }
    const grandTotal = nonLegPool + effLegPool;

    // Target character weight
    let targetWeight = 0;
    if (rar === 'LEGENDARY') {
      const combMult = Math.max(1.0, donor.rarityMultipliers.LEGENDARY + Math.max(0, wMult - 1.0));
      targetWeight = c.rarityBaseWeights.LEGENDARY * combMult * weeklyMult * shareMult * rollRankWeight * legScale;
    } else {
      targetWeight = c.rarityBaseWeights[rar] * donor.rarityMultipliers[rar] * wMult * shareMult * rollRankWeight;
    }

    const p1 = grandTotal > 0 && targetWeight > 0 ? targetWeight / (grandTotal + targetWeight) : 0;
    const rollsDay = Math.max(1, Number(els.rollsDay.value) || 150);
    const zinthosDay = Math.max(1, Number(els.zinthosDay.value) || 500000);
    els.rollsDayVal.textContent = fmtInt(rollsDay);
    els.zinthosDayVal.textContent = fmtInt(zinthosDay);

    const pDay = 1 - Math.pow(1 - p1, rollsDay);
    const p7 = 1 - Math.pow(1 - p1, rollsDay * 7);
    const p30 = 1 - Math.pow(1 - p1, rollsDay * 30);

    els.resP1.textContent = p1 > 0 ? fmtPct(p1) : '0% (Cap semanal)';
    els.resAvgRolls.textContent = p1 > 0 ? `Média: ~${fmtInt(1 / p1)} rolls (~${(1 / (p1 * rollsDay)).toFixed(1)} dias)` : 'Bloqueado até segunda-feira';
    els.resPday.textContent = `${fmtPct(pDay)} / ${fmtPct(p7)}`;
    els.resP30.textContent = `Em 30 dias: ${fmtPct(p30)}`;

    // Cost via Cotas
    const goalMode = els.goalMode.value;
    els.keysRow.style.display = goalMode === 'evolve' ? 'flex' : 'none';

    const soulmateBase = c.soulmateDivorceValues[rar];
    const keyBonus = c.rarityKeyDivorceBonus[rar];
    const divBase = c.rarityDivorceValues[rar];
    const rawBeforeInf = soulmateBase + (divBase + 10 * keyBonus) * rankMultiplier;
    const rawSoulmateDiv = Math.round(rawBeforeInf * m.inflationMultiplier);
    const refDyn = Math.max(info.dynamicPrice, Math.round(rawSoulmateDiv * info.scarcityMultiplier));

    let totalCost = 0;
    let keysNeeded = 1;
    if (goalMode === 'acquire') {
      totalCost = refDyn;
      keysNeeded = 1;
    } else {
      const kCur = Math.max(1, Math.min(9, Number(els.keysCurrent.value) || 1));
      const kTar = Math.max(kCur + 1, Math.min(10, Number(els.keysTarget.value) || 10));
      els.keysCurrent.value = String(kCur);
      els.keysTarget.value = String(kTar);
      keysNeeded = kTar - kCur;
      for (let k = kCur; k < kTar; k++) {
        const wIdx = Math.max(0, Math.min(c.marriedKeyProgressionWeights.length - 1, k - 1));
        totalCost += Math.round(refDyn * c.marriedKeyProgressionWeights[wIdx]);
      }
    }

    const daysByZinthos = totalCost / zinthosDay;
    els.resCost.textContent = `${fmtInt(totalCost)} Z`;
    els.resDays.textContent = `${daysByZinthos.toFixed(1)} dias a ${fmtInt(zinthosDay)}/dia (${keysNeeded} chave${keysNeeded > 1 ? 's' : ''})`;

    // Combined (Hybrid)
    if (goalMode === 'acquire') {
      const costWith3Cotas = Math.ceil(refDyn * 0.75);
      const days3Cotas = costWith3Cotas / zinthosDay;
      els.resHybrid.textContent = `${fmtInt(costWith3Cotas)} Z`;
      els.resHybridHint.textContent = `Com 3 cotas (${days3Cotas.toFixed(1)}d juntando), economiza 25% e casa no roll sem cooldown.`;
    } else {
      const expectedKeysFromRoll = p1 * rollsDay * daysByZinthos;
      const savedRatio = Math.min(1, expectedKeysFromRoll / keysNeeded);
      const estDays = daysByZinthos * (1 - savedRatio * 0.5);
      els.resHybrid.textContent = `~${estDays.toFixed(1)} dias`;
      els.resHybridHint.textContent = `Expectativa de ${expectedKeysFromRoll.toFixed(2)} chave(s) grátis no roll durante o período.`;
    }

    // Pretty Equation
    els.eqBox.innerHTML = [
      `<div><span class="eq-pink">Peso_Roll</span> = Base(<span class="eq-hl">${c.rarityBaseWeights[rar]}</span>) × Raridade(<span class="eq-hl">${donor.rarityMultipliers[rar]}x</span>) ${rar === 'LEGENDARY' ? '+' : '×'} Wishlist(<span class="eq-hl">${wMult}x</span>) × Cotas(<span class="eq-hl">${shareMult}x</span>) × Rank(<span class="eq-hl">${rollRankWeight.toFixed(3)}</span>)${rar === 'LEGENDARY' ? ` × EscalaCap(<span class="eq-hl">${legScale.toFixed(3)}</span>)` : ''} = <span class="eq-ok">${targetWeight.toFixed(2)}</span></div>`,
      `<div><span class="eq-pink">Chance_1_Roll</span> = ${targetWeight.toFixed(2)} / ${fmtInt(grandTotal + targetWeight)} = <span class="eq-ok">${fmtPct(p1)}</span></div>`,
      `<div><span class="eq-pink">Ref_4_Cotas</span> = max(${fmtInt(info.dynamicPrice)}, (${fmtInt(soulmateBase)} + ${fmtInt(divBase + 10 * keyBonus)} × <span class="eq-hl">${rankMultiplier.toFixed(2)}</span>) × <span class="eq-hl">${m.inflationMultiplier}</span> × <span class="eq-hl">${info.scarcityMultiplier}</span>) = <span class="eq-ok">${fmtInt(refDyn)} Z</span></div>`,
    ].join('');
  }

  // Character Search
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = els.search.value.trim();
    if (q.length < 2) {
      els.searchResults.style.display = 'none';
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/characters?search=${encodeURIComponent(q)}&limit=8`);
        const json = await res.json();
        const list = json?.data?.data || json?.data?.characters || json?.data?.items || [];
        if (!list.length) {
          els.searchResults.style.display = 'none';
          return;
        }
        els.searchResults.innerHTML = list.map((ch, idx) => `
          <div class="search-item" data-idx="${idx}">
            <img src="${ch.imageUrl || '/default.jpg'}" alt="">
            <div>
              <div style="font-weight:800;font-size:0.9rem;">${ch.name}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);">${ch.series || ''} · ${ch.baseRarity} · Rank #${ch.rarityRank || ch.rank || '—'}</div>
            </div>
          </div>
        `).join('');
        els.searchResults.style.display = 'block';
        els.searchResults.querySelectorAll('.search-item').forEach((node) => {
          node.addEventListener('click', () => {
            const ch = list[Number(node.dataset.idx)];
            if (ch.baseRarity && state?.pool?.byRarity?.[ch.baseRarity]) {
              els.rarity.value = ch.baseRarity;
              syncRankBounds();
            }
            const total = Number(els.rankPos.max) || 1000;
            const pos = ch.rarityRank || ch.rank || total;
            els.rankPos.value = String(Math.max(1, Math.min(total, pos)));
            if (ch.gender === 'FEMALE') els.genderFilter.value = 'FEMALE';
            else if (ch.gender === 'MALE') els.genderFilter.value = 'MALE';
            els.selectedInfo.textContent = `Selecionado: ${ch.name} (${ch.baseRarity}, considerando livre para simulação)`;
            els.searchResults.style.display = 'none';
            recalculate();
          });
        });
      } catch {
        els.searchResults.style.display = 'none';
      }
    }, 250);
  });

  document.addEventListener('click', (e) => {
    if (!els.search.contains(e.target) && !els.searchResults.contains(e.target)) {
      els.searchResults.style.display = 'none';
    }
  });

  // Bind inputs
  els.rarity.addEventListener('change', () => { syncRankBounds(); recalculate(); });
  [
    els.rankPos, els.goalMode, els.keysCurrent, els.keysTarget,
    els.shares, els.donorReais, els.wishSize, els.inWishlist,
    els.genderFilter, els.weeklyLeg, els.rollsDay, els.zinthosDay,
  ].forEach((el) => el.addEventListener('input', recalculate));

  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      if (target) {
        target.value = btn.dataset.val;
        recalculate();
      }
    });
  });

  try {
    await loadConstants();
  } catch (err) {
    els.constTbody.innerHTML = `<tr><td colspan="3">Erro ao carregar constantes: ${err.message}</td></tr>`;
  }
});
