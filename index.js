(function(){
'use strict';

/* ═══════════════════════════════════════
   CASINO ROYALE — SillyTavern Extension
   Рулетка · Слоты · Блэкджек
   Скрытая механика: смерть персонажа
═══════════════════════════════════════ */

var EXT_NAME = 'casino-royale';

// --- SillyTavern API helpers ---
function getCtx() {
    try { return window.SillyTavern ? window.SillyTavern.getContext() : null; } catch(e) { return null; }
}
function getES() {
    var c = getCtx();
    return (c && c.extensionSettings) || window.extension_settings || (window.extension_settings = {});
}
function S() { var e = getES(); if (!e[EXT_NAME]) e[EXT_NAME] = {}; return e[EXT_NAME]; }
function save() { var c = getCtx(); if (c && c.saveSettingsDebounced) c.saveSettingsDebounced(); }

// --- Defaults ---
var DEFAULTS = {
    enabled: true,
    balance: 5000,
    totalBets: 0,
    totalWins: 0,
    totalLosses: 0,
    lossStreak: 0,
    maxLossStreak: 0,
    deathTriggered: false,
    deathThreshold: 0,       // 0 = не установлен, рандомно выберется
    gamesPlayed: 0
};

function init() {
    var s = S();
    for (var k in DEFAULTS) {
        if (s[k] === undefined) s[k] = typeof DEFAULTS[k] === 'object' ? JSON.parse(JSON.stringify(DEFAULTS[k])) : DEFAULTS[k];
    }
    // Скрытый порог смерти — рандомно от 3 до 7 проигрышей подряд
    if (!s.deathThreshold) {
        s.deathThreshold = 3 + Math.floor(Math.random() * 5);
        save();
    }
    return s;
}

// --- Toast ---
function toast(msg, icon) {
    var t = document.getElementById('cas-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cas-toast'; t.className = 'cas-toast'; document.body.appendChild(t); }
    t.innerHTML = (icon || '') + ' ' + msg;
    t.classList.add('cas-toast-show');
    clearTimeout(t._tid);
    t._tid = setTimeout(function(){ t.classList.remove('cas-toast-show'); }, 2500);
}

// --- FAB кнопка ---
var FAB_SIZE = 52;
var lastDragTs = 0;

function vpW() { return window.visualViewport ? window.visualViewport.width : window.innerWidth; }
function vpH() { return window.visualViewport ? window.visualViewport.height : window.innerHeight; }

function clampPos(l, t) {
    return {
        left: Math.max(6, Math.min(l, vpW() - FAB_SIZE - 6)),
        top: Math.max(6, Math.min(t, vpH() - FAB_SIZE - 6))
    };
}

function saveFabPos(l, t) {
    try { localStorage.setItem('cas_fab_pos', JSON.stringify({left:l, top:t})); } catch(e) {}
}

function applyFabPos() {
    var el = document.getElementById('cas_fab');
    if (!el) return;
    el.style.right = 'auto'; el.style.bottom = 'auto';
    try {
        var raw = localStorage.getItem('cas_fab_pos');
        if (raw) { var p = JSON.parse(raw); var c = clampPos(p.left, p.top); el.style.left = c.left+'px'; el.style.top = c.top+'px'; return; }
    } catch(e) {}
    var left = vpW() - FAB_SIZE - 16;
    var top = Math.round(vpH() / 2) - 60;
    var c = clampPos(left, top);
    el.style.left = c.left + 'px'; el.style.top = c.top + 'px';
    saveFabPos(c.left, c.top);
}

function initFabDrag() {
    var fab = document.getElementById('cas_fab');
    var handle = document.getElementById('cas_fab_btn');
    if (!fab || !handle || fab.dataset.dragInit === '1') return;
    fab.dataset.dragInit = '1';
    var sx, sy, sl, st, moved = false;
    var onMove = function(ev) {
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) > 6) moved = true;
        if (!moved) return;
        var p = clampPos(sl + dx, st + dy);
        fab.style.left = p.left + 'px'; fab.style.top = p.top + 'px';
        fab.style.right = 'auto'; fab.style.bottom = 'auto';
        ev.preventDefault();
    };
    var onEnd = function(ev) {
        try { handle.releasePointerCapture(ev.pointerId); } catch(e) {}
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onEnd);
        document.removeEventListener('pointercancel', onEnd);
        if (moved) { saveFabPos(parseInt(fab.style.left)||0, parseInt(fab.style.top)||0); lastDragTs = Date.now(); }
        moved = false; fab.classList.remove('cas-dragging');
    };
    handle.addEventListener('pointerdown', function(ev) {
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        var curL = parseInt(fab.style.left) || 0;
        var curT = parseInt(fab.style.top) || 0;
        var p = clampPos(curL, curT);
        fab.style.left = p.left + 'px'; fab.style.top = p.top + 'px';
        sx = ev.clientX; sy = ev.clientY; sl = p.left; st = p.top; moved = false;
        try { handle.setPointerCapture(ev.pointerId); } catch(e) {}
        document.addEventListener('pointermove', onMove, {passive:false});
        document.addEventListener('pointerup', onEnd);
        document.addEventListener('pointercancel', onEnd);
        ev.preventDefault();
    }, {passive:false});
}

function ensureFab() {
    if (document.getElementById('cas_fab')) return;
    var fab = document.createElement('div');
    fab.id = 'cas_fab';
    fab.innerHTML = '<button type="button" id="cas_fab_btn" title="Casino Royale">🎰</button>';
    document.body.appendChild(fab);
    document.getElementById('cas_fab_btn').addEventListener('click', function(ev) {
        if (Date.now() - lastDragTs < 350) return;
        ev.preventDefault(); ev.stopPropagation();
        toggleCasino();
    });
    applyFabPos();
    initFabDrag();
    window.addEventListener('resize', function(){ setTimeout(applyFabPos, 200); });
}

// --- Основное окно казино ---
var casinoOpen = false;
var currentTab = 'roulette';

function toggleCasino() {
    if (casinoOpen) closeCasino();
    else openCasino();
}

function openCasino() {
    ensureDrawer();
    casinoOpen = true;
    var d = document.getElementById('cas_drawer');
    var ov = document.getElementById('cas_overlay');
    if (!ov) {
        ov = document.createElement('div'); ov.id = 'cas_overlay';
        document.body.insertBefore(ov, d);
        ov.addEventListener('click', closeCasino);
    }
    ov.style.display = 'block';
    d.classList.add('cas-open');
    renderCasino();
}

function closeCasino() {
    casinoOpen = false;
    var d = document.getElementById('cas_drawer');
    if (d) d.classList.remove('cas-open');
    var ov = document.getElementById('cas_overlay');
    if (ov) ov.style.display = 'none';
}

function ensureDrawer() {
    if (document.getElementById('cas_drawer')) return;
    var d = document.createElement('aside');
    d.id = 'cas_drawer';
    d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<div id="cas_content"></div>';
    document.body.appendChild(d);
}

function updateBalanceDisplay() {
    var el = document.getElementById('cas-balance-val');
    if (el) el.textContent = S().balance;
}

// --- РЕНДЕР КАЗИНО ---
function renderCasino() {
    var cont = document.getElementById('cas_content');
    if (!cont) return;
    var s = S();

    var h = '';
    // Header
    h += '<div class="cas-header">';
    h += '<span class="cas-title">🎰 Casino Royale</span>';
    h += '<div class="cas-wallet">💰 <span id="cas-balance-val">' + s.balance + '</span></div>';
    h += '<button class="cas-close-btn" id="cas_close">✕</button>';
    h += '</div>';

    // Tabs
    h += '<div class="cas-tabs">';
    h += '<div class="cas-tab' + (currentTab==='roulette'?' cas-tab-active':'') + '" data-tab="roulette">🎡 Рулетка</div>';
    h += '<div class="cas-tab' + (currentTab==='slots'?' cas-tab-active':'') + '" data-tab="slots">🎰 Слоты</div>';
    h += '<div class="cas-tab' + (currentTab==='blackjack'?' cas-tab-active':'') + '" data-tab="blackjack">🃏 Блэкджек</div>';
    h += '<div class="cas-tab' + (currentTab==='stats'?' cas-tab-active':'') + '" data-tab="stats">📊 Стата</div>';
    h += '</div>';

    // Body
    h += '<div class="cas-body">';
    if (currentTab === 'roulette') h += renderRoulette();
    else if (currentTab === 'slots') h += renderSlots();
    else if (currentTab === 'blackjack') h += renderBlackjack();
    else if (currentTab === 'stats') h += renderStats();
    h += '</div>';

    cont.innerHTML = h;
    bindCasino();
}

// ═══════════════════════════════════════
//  РУЛЕТКА
// ═══════════════════════════════════════
var ROULETTE_NUMS = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
var RED_NUMS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
var rouletteBet = 100;
var roulettePick = 'red';
var rouletteSpinning = false;

function numColor(n) { return n===0?'green':RED_NUMS.indexOf(n)>=0?'red':'black'; }

function renderRoulette() {
    var s = S();
    var h = '<div class="cas-game-title">🎡 Европейская Рулетка</div>';
    h += '<div class="cas-roulette-wheel" id="cas-wheel">';
    h += '<div class="cas-wheel-result" id="cas-wheel-result">—</div>';
    h += '</div>';
    h += '<div class="cas-bet-section">';
    h += '<div class="cas-bet-row"><span>Ставка:</span>';
    h += '<button class="cas-chip" data-bet="50">50</button>';
    h += '<button class="cas-chip" data-bet="100">100</button>';
    h += '<button class="cas-chip" data-bet="250">250</button>';
    h += '<button class="cas-chip" data-bet="500">500</button>';
    h += '<button class="cas-chip" data-bet="1000">1K</button>';
    h += '</div>';
    h += '<div class="cas-bet-row"><span>На что:</span>';
    h += '<button class="cas-pick cas-pick-red' + (roulettePick==='red'?' active':'') + '" data-pick="red">🔴 Красное</button>';
    h += '<button class="cas-pick cas-pick-black' + (roulettePick==='black'?' active':'') + '" data-pick="black">⚫ Чёрное</button>';
    h += '<button class="cas-pick cas-pick-green' + (roulettePick==='green'?' active':'') + '" data-pick="green">🟢 Зеро</button>';
    h += '<button class="cas-pick cas-pick-even' + (roulettePick==='even'?' active':'') + '" data-pick="even">Чётное</button>';
    h += '<button class="cas-pick cas-pick-odd' + (roulettePick==='odd'?' active':'') + '" data-pick="odd">Нечётное</button>';
    h += '</div>';
    h += '<div class="cas-bet-row">';
    h += '<button class="cas-spin-btn" id="cas-spin">🎡 КРУТИТЬ (' + rouletteBet + '💰)</button>';
    h += '</div>';
    h += '</div>';
    h += '<div class="cas-result-msg" id="cas-roulette-msg"></div>';
    return h;
}

function doRouletteSpin() {
    if (rouletteSpinning) return;
    var s = S();
    if (s.balance < rouletteBet) { toast('Недостаточно средств!','❌'); return; }
    rouletteSpinning = true;
    s.balance -= rouletteBet;
    s.totalBets++;
    s.gamesPlayed++;
    save();
    updateBalanceDisplay();

    var wheel = document.getElementById('cas-wheel');
    var res = document.getElementById('cas-wheel-result');
    var msg = document.getElementById('cas-roulette-msg');
    if (wheel) wheel.classList.add('spinning');
    if (res) res.textContent = '...';
    if (msg) msg.textContent = '';

    var result = ROULETTE_NUMS[Math.floor(Math.random() * ROULETTE_NUMS.length)];
    var color = numColor(result);

    setTimeout(function() {
        if (wheel) wheel.classList.remove('spinning');
        if (res) { res.textContent = result; res.className = 'cas-wheel-result cas-color-' + color; }

        var win = false;
        var mult = 0;
        if (roulettePick === 'red' && color === 'red') { win = true; mult = 2; }
        else if (roulettePick === 'black' && color === 'black') { win = true; mult = 2; }
        else if (roulettePick === 'green' && color === 'green') { win = true; mult = 36; }
        else if (roulettePick === 'even' && result > 0 && result % 2 === 0) { win = true; mult = 2; }
        else if (roulettePick === 'odd' && result > 0 && result % 2 === 1) { win = true; mult = 2; }

        if (win) {
            var winnings = rouletteBet * mult;
            s.balance += winnings;
            s.totalWins++;
            s.lossStreak = 0;
            save();
            updateBalanceDisplay();
            if (msg) { msg.textContent = '🎉 Выпало ' + result + ' (' + color + ')! Выигрыш: +' + winnings + '💰'; msg.className = 'cas-result-msg cas-win'; }
            toast('Выигрыш +' + winnings + '💰!', '🎉');
        } else {
            s.totalLosses++;
            s.lossStreak++;
            if (s.lossStreak > s.maxLossStreak) s.maxLossStreak = s.lossStreak;
            save();
            if (msg) { msg.textContent = '😞 Выпало ' + result + ' (' + color + '). Проигрыш: -' + rouletteBet + '💰'; msg.className = 'cas-result-msg cas-lose'; }
            if (checkDeath()) { setTimeout(function(){ triggerDeath(); }, 1500); }
        }
        rouletteSpinning = false;
    }, 2000);
}

// ═══════════════════════════════════════
//  СЛОТЫ
// ═══════════════════════════════════════
var SLOT_SYMBOLS = ['🍒','🍋','🍊','🍇','💎','7️⃣','🔔','⭐'];
var SLOT_PAY = {'🍒':2,'🍋':3,'🍊':4,'🍇':5,'🔔':8,'⭐':10,'💎':15,'7️⃣':25};
var slotBet = 100;
var slotSpinning = false;
var slotReels = ['❓','❓','❓'];

function renderSlots() {
    var h = '<div class="cas-game-title">🎰 Слот-машина</div>';
    h += '<div class="cas-slot-machine">';
    h += '<div class="cas-slot-reel" id="cas-reel0">' + slotReels[0] + '</div>';
    h += '<div class="cas-slot-reel" id="cas-reel1">' + slotReels[1] + '</div>';
    h += '<div class="cas-slot-reel" id="cas-reel2">' + slotReels[2] + '</div>';
    h += '</div>';
    h += '<div class="cas-bet-section">';
    h += '<div class="cas-bet-row"><span>Ставка:</span>';
    h += '<button class="cas-chip" data-sbet="50">50</button>';
    h += '<button class="cas-chip" data-sbet="100">100</button>';
    h += '<button class="cas-chip" data-sbet="250">250</button>';
    h += '<button class="cas-chip" data-sbet="500">500</button>';
    h += '</div>';
    h += '<div class="cas-bet-row">';
    h += '<button class="cas-spin-btn" id="cas-slot-spin">🎰 КРУТИТЬ (' + slotBet + '💰)</button>';
    h += '</div></div>';
    h += '<div class="cas-result-msg" id="cas-slot-msg"></div>';
    h += '<div class="cas-slot-paytable"><b>Выплаты (3 в ряд):</b><br>';
    for (var sym in SLOT_PAY) h += sym + ' x' + SLOT_PAY[sym] + '  ';
    h += '<br>2 одинаковых = x1 (возврат)</div>';
    return h;
}

function doSlotSpin() {
    if (slotSpinning) return;
    var s = S();
    if (s.balance < slotBet) { toast('Недостаточно средств!','❌'); return; }
    slotSpinning = true;
    s.balance -= slotBet;
    s.totalBets++;
    s.gamesPlayed++;
    save();
    updateBalanceDisplay();

    var reelEls = [document.getElementById('cas-reel0'),document.getElementById('cas-reel1'),document.getElementById('cas-reel2')];
    reelEls.forEach(function(el){ if(el) el.classList.add('cas-reel-spin'); });

    var results = [0,1,2].map(function(){ return SLOT_SYMBOLS[Math.floor(Math.random()*SLOT_SYMBOLS.length)]; });

    var delays = [600, 1200, 1800];
    delays.forEach(function(d, i) {
        setTimeout(function() {
            slotReels[i] = results[i];
            if (reelEls[i]) { reelEls[i].textContent = results[i]; reelEls[i].classList.remove('cas-reel-spin'); }
        }, d);
    });

    setTimeout(function() {
        var msg = document.getElementById('cas-slot-msg');
        if (results[0] === results[1] && results[1] === results[2]) {
            var mult = SLOT_PAY[results[0]] || 2;
            var winnings = slotBet * mult;
            s.balance += winnings; s.totalWins++; s.lossStreak = 0; save(); updateBalanceDisplay();
            if (msg) { msg.textContent = '🎉 ДЖЕКПОТ! ' + results.join(' ') + ' — Выигрыш: +' + winnings + '💰'; msg.className = 'cas-result-msg cas-win'; }
            toast('ДЖЕКПОТ +' + winnings + '💰!','🎉');
        } else if (results[0]===results[1] || results[1]===results[2] || results[0]===results[2]) {
            s.balance += slotBet; s.totalWins++; s.lossStreak = 0; save(); updateBalanceDisplay();
            if (msg) { msg.textContent = '😊 ' + results.join(' ') + ' — Пара! Возврат ставки'; msg.className = 'cas-result-msg cas-win'; }
        } else {
            s.totalLosses++; s.lossStreak++;
            if (s.lossStreak > s.maxLossStreak) s.maxLossStreak = s.lossStreak;
            save();
            if (msg) { msg.textContent = '😞 ' + results.join(' ') + ' — Проигрыш: -' + slotBet + '💰'; msg.className = 'cas-result-msg cas-lose'; }
            if (checkDeath()) { setTimeout(function(){ triggerDeath(); }, 1500); }
        }
        slotSpinning = false;
    }, 2200);
}

// ═══════════════════════════════════════
//  БЛЭКДЖЕК
// ═══════════════════════════════════════
var bjBet = 100;
var bjDeck = [];
var bjPlayerHand = [];
var bjDealerHand = [];
var bjGameActive = false;
var bjStand = false;

function bjNewDeck() {
    bjDeck = [];
    var suits = ['♠','♥','♦','♣'];
    var vals = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    for (var si=0;si<suits.length;si++) for (var vi=0;vi<vals.length;vi++) bjDeck.push({suit:suits[si],val:vals[vi]});
    for (var i=bjDeck.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=bjDeck[i];bjDeck[i]=bjDeck[j];bjDeck[j]=t;}
}

function bjCardVal(card) { if(card.val==='A') return 11; if(['K','Q','J'].indexOf(card.val)>=0) return 10; return parseInt(card.val); }

function bjHandVal(hand) {
    var total=0, aces=0;
    for(var i=0;i<hand.length;i++){total+=bjCardVal(hand[i]);if(hand[i].val==='A')aces++;}
    while(total>21&&aces>0){total-=10;aces--;}
    return total;
}

function bjCardStr(c) { var col=(c.suit==='♥'||c.suit==='♦')?'red':'wht'; return '<span class="cas-card cas-card-'+col+'">'+c.val+c.suit+'</span>'; }
function bjHandStr(hand,hideSecond) {
    var h='';for(var i=0;i<hand.length;i++){if(i===1&&hideSecond)h+='<span class="cas-card cas-card-back">🂠</span>';else h+=bjCardStr(hand[i]);}return h;
}

function renderBlackjack() {
    var h = '<div class="cas-game-title">🃏 Блэкджек</div>';
    if (!bjGameActive) {
        h += '<div class="cas-bet-section">';
        h += '<div class="cas-bet-row"><span>Ставка:</span>';
        h += '<button class="cas-chip" data-bjbet="50">50</button>';
        h += '<button class="cas-chip" data-bjbet="100">100</button>';
        h += '<button class="cas-chip" data-bjbet="250">250</button>';
        h += '<button class="cas-chip" data-bjbet="500">500</button>';
        h += '</div>';
        h += '<div class="cas-bet-row"><button class="cas-spin-btn" id="cas-bj-deal">🃏 РАЗДАТЬ (' + bjBet + '💰)</button></div>';
        h += '</div>';
    } else {
        h += '<div class="cas-bj-table">';
        h += '<div class="cas-bj-hand"><b>Дилер' + (!bjStand?' (?)':'') + ':</b> ' + bjHandStr(bjDealerHand, !bjStand) + (!bjStand?'':' <span class="cas-bj-val">(' + bjHandVal(bjDealerHand) + ')</span>') + '</div>';
        h += '<div class="cas-bj-hand"><b>Вы:</b> ' + bjHandStr(bjPlayerHand, false) + ' <span class="cas-bj-val">(' + bjHandVal(bjPlayerHand) + ')</span></div>';
        if (!bjStand) {
            h += '<div class="cas-bj-actions">';
            h += '<button class="cas-bj-btn" id="cas-bj-hit">👆 Ещё</button>';
            h += '<button class="cas-bj-btn" id="cas-bj-stand">✋ Хватит</button>';
            h += '</div>';
        }
        h += '</div>';
    }
    h += '<div class="cas-result-msg" id="cas-bj-msg"></div>';
    return h;
}

function bjDeal() {
    var s = S();
    if (s.balance < bjBet) { toast('Недостаточно средств!','❌'); return; }
    s.balance -= bjBet; s.totalBets++; s.gamesPlayed++; save(); updateBalanceDisplay();
    bjNewDeck();
    bjPlayerHand = [bjDeck.pop(), bjDeck.pop()];
    bjDealerHand = [bjDeck.pop(), bjDeck.pop()];
    bjGameActive = true; bjStand = false;
    renderCasino();
    if (bjHandVal(bjPlayerHand) === 21) { bjStand = true; bjFinish(); }
}

function bjHit() {
    bjPlayerHand.push(bjDeck.pop());
    if (bjHandVal(bjPlayerHand) > 21) { bjStand = true; bjFinish(); }
    else if (bjHandVal(bjPlayerHand) === 21) { bjStand = true; bjFinish(); }
    else renderCasino();
}

function bjStandAction() { bjStand = true; bjFinish(); }

function bjFinish() {
    var s = S();
    var pVal = bjHandVal(bjPlayerHand);
    while (bjHandVal(bjDealerHand) < 17) bjDealerHand.push(bjDeck.pop());
    var dVal = bjHandVal(bjDealerHand);
    renderCasino();

    var msg = document.getElementById('cas-bj-msg');
    if (pVal > 21) {
        s.totalLosses++; s.lossStreak++;
        if (s.lossStreak > s.maxLossStreak) s.maxLossStreak = s.lossStreak;
        save();
        if (msg) { msg.textContent = '💥 Перебор! Вы проиграли -' + bjBet + '💰'; msg.className = 'cas-result-msg cas-lose'; }
        if (checkDeath()) setTimeout(function(){ triggerDeath(); }, 1500);
    } else if (dVal > 21 || pVal > dVal) {
        var w = (pVal===21 && bjPlayerHand.length===2) ? Math.floor(bjBet*2.5) : bjBet*2;
        s.balance += w; s.totalWins++; s.lossStreak = 0; save(); updateBalanceDisplay();
        if (msg) { msg.textContent = '🎉 Победа! +' + w + '💰'; msg.className = 'cas-result-msg cas-win'; }
        toast('Блэкджек +' + w + '💰!','🎉');
    } else if (pVal === dVal) {
        s.balance += bjBet; save(); updateBalanceDisplay();
        if (msg) { msg.textContent = '🤝 Ничья! Ставка возвращена'; msg.className = 'cas-result-msg'; }
    } else {
        s.totalLosses++; s.lossStreak++;
        if (s.lossStreak > s.maxLossStreak) s.maxLossStreak = s.lossStreak;
        save();
        if (msg) { msg.textContent = '😞 Дилер выиграл (' + dVal + ' vs ' + pVal + '). -' + bjBet + '💰'; msg.className = 'cas-result-msg cas-lose'; }
        if (checkDeath()) setTimeout(function(){ triggerDeath(); }, 1500);
    }
    bjGameActive = false;
    setTimeout(renderCasino, 3000);
}

// ═══════════════════════════════════════
//  СТАТИСТИКА
// ═══════════════════════════════════════
function renderStats() {
    var s = S();
    var fabSize = s.fabSize || 52;
    var fabOpacity = s.fabOpacity !== undefined ? s.fabOpacity : 100;
    var h = '<div class="cas-game-title">📊 Статистика</div>';
    h += '<div class="cas-stats-grid">';
    h += '<div class="cas-stat"><span class="cas-stat-val">' + s.balance + '</span><span class="cas-stat-lbl">💰 Баланс</span></div>';
    h += '<div class="cas-stat"><span class="cas-stat-val">' + s.gamesPlayed + '</span><span class="cas-stat-lbl">🎮 Игр</span></div>';
    h += '<div class="cas-stat"><span class="cas-stat-val">' + s.totalWins + '</span><span class="cas-stat-lbl">✅ Побед</span></div>';
    h += '<div class="cas-stat"><span class="cas-stat-val">' + s.totalLosses + '</span><span class="cas-stat-lbl">❌ Поражений</span></div>';
    h += '<div class="cas-stat"><span class="cas-stat-val">' + s.lossStreak + '</span><span class="cas-stat-lbl">🔥 Серия проигр.</span></div>';
    h += '<div class="cas-stat"><span class="cas-stat-val">' + s.maxLossStreak + '</span><span class="cas-stat-lbl">💀 Макс серия</span></div>';
    h += '</div>';

    // Редактирование золота
    h += '<div class="cas-settings-section">';
    h += '<div class="cas-setting-label">💰 Установить баланс:</div>';
    h += '<div class="cas-bet-row"><input type="number" id="cas-gold-input" class="cas-input" value="' + s.balance + '" min="0" step="100">';
    h += '<button class="cas-spin-btn" id="cas-set-gold" style="flex:0 0 auto;padding:8px 14px">✅</button></div>';
    h += '</div>';

    // Размер значка
    h += '<div class="cas-settings-section">';
    h += '<div class="cas-setting-label">📐 Размер значка: <span id="cas-size-val">' + fabSize + 'px</span></div>';
    h += '<input type="range" id="cas-fab-size" class="cas-slider" min="30" max="80" value="' + fabSize + '">';
    h += '</div>';

    // Прозрачность значка
    h += '<div class="cas-settings-section">';
    h += '<div class="cas-setting-label">👁 Прозрачность: <span id="cas-opacity-val">' + fabOpacity + '%</span></div>';
    h += '<input type="range" id="cas-fab-opacity" class="cas-slider" min="10" max="100" value="' + fabOpacity + '">';
    h += '</div>';

    h += '<div class="cas-bet-row" style="margin-top:12px;justify-content:center">';
    h += '<button class="cas-spin-btn" id="cas-add-money">💰 +1000 монет</button>';
    h += '<button class="cas-spin-btn cas-reset-btn" id="cas-reset-stats">🔄 Сброс</button>';
    h += '</div>';
    return h;
}

function applyFabStyle() {
    var s = S();
    var btn = document.getElementById('cas_fab_btn');
    if (!btn) return;
    var size = s.fabSize || 52;
    var opacity = s.fabOpacity !== undefined ? s.fabOpacity : 100;
    btn.style.width = size + 'px';
    btn.style.height = size + 'px';
    btn.style.fontSize = Math.max(14, Math.round(size * 0.46)) + 'px';
    btn.style.opacity = (opacity / 100).toString();
}

// ═══════════════════════════════════════
//  BIND — привязка событий
// ═══════════════════════════════════════
function bindCasino() {
    var cont = document.getElementById('cas_content');
    if (!cont) return;

    // Close
    var closeBtn = document.getElementById('cas_close');
    if (closeBtn) closeBtn.addEventListener('click', closeCasino);

    // Tabs
    cont.querySelectorAll('.cas-tab').forEach(function(t) {
        t.addEventListener('click', function() { currentTab = t.getAttribute('data-tab') || 'roulette'; renderCasino(); });
    });

    // Roulette
    cont.querySelectorAll('[data-bet]').forEach(function(b) {
        b.addEventListener('click', function() { rouletteBet = parseInt(b.getAttribute('data-bet')); renderCasino(); });
    });
    cont.querySelectorAll('[data-pick]').forEach(function(b) {
        b.addEventListener('click', function() { roulettePick = b.getAttribute('data-pick'); renderCasino(); });
    });
    var spinBtn = document.getElementById('cas-spin');
    if (spinBtn) spinBtn.addEventListener('click', doRouletteSpin);

    // Slots
    cont.querySelectorAll('[data-sbet]').forEach(function(b) {
        b.addEventListener('click', function() { slotBet = parseInt(b.getAttribute('data-sbet')); renderCasino(); });
    });
    var slotBtn = document.getElementById('cas-slot-spin');
    if (slotBtn) slotBtn.addEventListener('click', doSlotSpin);

    // Blackjack
    cont.querySelectorAll('[data-bjbet]').forEach(function(b) {
        b.addEventListener('click', function() { bjBet = parseInt(b.getAttribute('data-bjbet')); renderCasino(); });
    });
    var dealBtn = document.getElementById('cas-bj-deal');
    if (dealBtn) dealBtn.addEventListener('click', bjDeal);
    var hitBtn = document.getElementById('cas-bj-hit');
    if (hitBtn) hitBtn.addEventListener('click', bjHit);
    var standBtn = document.getElementById('cas-bj-stand');
    if (standBtn) standBtn.addEventListener('click', bjStandAction);

    // Stats
    var addBtn = document.getElementById('cas-add-money');
    if (addBtn) addBtn.addEventListener('click', function() { S().balance += 1000; save(); updateBalanceDisplay(); toast('+1000💰','💰'); renderCasino(); });
    var resetBtn = document.getElementById('cas-reset-stats');
    if (resetBtn) resetBtn.addEventListener('click', function() { if(!confirm('Сбросить всю статистику?')) return; var s=S(); for(var k in DEFAULTS) s[k]=typeof DEFAULTS[k]==='object'?JSON.parse(JSON.stringify(DEFAULTS[k])):DEFAULTS[k]; s.deathThreshold=3+Math.floor(Math.random()*5); save(); toast('Сброшено!','🔄'); renderCasino(); });

    // Установить золото
    var setGoldBtn = document.getElementById('cas-set-gold');
    if (setGoldBtn) setGoldBtn.addEventListener('click', function() {
        var inp = document.getElementById('cas-gold-input');
        if (!inp) return;
        var val = parseInt(inp.value) || 0;
        if (val < 0) val = 0;
        S().balance = val; save(); updateBalanceDisplay(); toast('Баланс: ' + val + '💰','💰'); renderCasino();
    });

    // Размер значка
    var sizeSlider = document.getElementById('cas-fab-size');
    if (sizeSlider) sizeSlider.addEventListener('input', function() {
        var val = parseInt(sizeSlider.value) || 52;
        S().fabSize = val; save(); applyFabStyle();
        var lbl = document.getElementById('cas-size-val');
        if (lbl) lbl.textContent = val + 'px';
    });

    // Прозрачность значка
    var opacitySlider = document.getElementById('cas-fab-opacity');
    if (opacitySlider) opacitySlider.addEventListener('input', function() {
        var val = parseInt(opacitySlider.value) || 100;
        S().fabOpacity = val; save(); applyFabStyle();
        var lbl = document.getElementById('cas-opacity-val');
        if (lbl) lbl.textContent = val + '%';
    });
}

// ═══════════════════════════════════════
//  СКРЫТАЯ МЕХАНИКА — СМЕРТЬ ПЕРСОНАЖА
//  Когда серия проигрышей достигает порога,
//  персонаж "неожиданно" умирает.
//  Порог рандомный (3-7), игрок не знает.
// ═══════════════════════════════════════
var DEATH_CAUSES_FALLBACK = [
    'внезапно хватается за сердце и падает замертво — сердечный приступ от стресса проигрыша',
    'неожиданно теряет сознание и перестаёт дышать — аневризма мозга от азартного напряжения',
    'вдруг бледнеет, из носа идёт кровь, и через секунду валится на пол — инсульт',
    'начинает задыхаться, хватаясь за горло — внезапная остановка дыхания',
    'роняет фишки, глаза закатываются — мгновенная смерть от остановки сердца',
    'вдруг замирает с пустым взглядом, медленно оседает на стул и больше не двигается',
    'улыбается, делая последнюю ставку, и вдруг падает лицом вниз на стол — мгновенная смерть',
    'вздрагивает всем телом, словно от удара молнии, и падает навзничь — необъяснимая внезапная смерть'
];

// Контекстные причины смерти на основе ключевых слов из чата
var CONTEXT_DEATH_MAP = [
    { keys: ['бой','драк','удар','мечом','оружие','атак','сраж','бит','кулак','нож','клинок','выстрел','пистолет'], causes: [
        'получает фатальный удар — старые раны от недавнего боя открываются и кровь хлещет без остановки',
        'падает от внутреннего кровотечения — повреждения от сражения оказались смертельными',
        'вздрагивает от резкой боли — боевые раны воспалились, началось заражение крови'
    ]},
    { keys: ['магия','закл','колдов','заклинание','мана','чары','волшеб','проклят','порча','ритуал'], causes: [
        'начинает светиться тёмным светом — магическая энергия пожирает изнутри, превращая органы в пепел',
        'кричит от невыносимой боли — скрытое проклятие активировалось и разрывает душу',
        'покрывается магическими рунами, которые прожигают кожу — откат от магии убивает мгновенно'
    ]},
    { keys: ['яд','отрав','зелье','выпи','напит','бокал','вино','пить','еда','пищ'], causes: [
        'хватается за живот — яд в организме наконец добрался до сердца',
        'начинает задыхаться, губы синеют — отравление проявило себя слишком поздно',
        'выплёвывает кровь — скрытый яд разъел внутренности'
    ]},
    { keys: ['секс','поцелу','обним','постел','кроват','страст','любов','близост','нагот','раздел','ласк','интим'], causes: [
        'замирает в объятиях — сердце просто останавливается в момент наивысшего блаженства',
        'тихо вздыхает и больше не двигается — разрыв аорты от прилива эмоций',
        'закатывает глаза и обмякает — инсульт от резкого скачка давления'
    ]},
    { keys: ['лес','гор','пещер','дорог','путешеств','поход','идти','бежать','карабк','скал','река','озер','мост'], causes: [
        'спотыкается и падает — скрытая травма головы от путешествия оказалась смертельной',
        'внезапно хватается за грудь и оседает на землю — истощение оказалось фатальным',
        'бледнеет и падает на дорогу — обезвоживание и усталость убили тихо'
    ]},
    { keys: ['ночь','сон','спать','тёмн','темно','луна','звёзд','тих','покой','отдых'], causes: [
        'тихо засыпает и больше не просыпается — смерть во сне',
        'дыхание замедляется... и прекращается. Тишина. Навсегда',
        'во сне лицо искажается гримасой боли — сердце остановилось'
    ]},
    { keys: ['страх','ужас','монстр','демон','тварь','чудовищ','кошмар','кричать','кричит','паник'], causes: [
        'кричит от ужаса и замолкает навсегда — сердце не выдержало страха',
        'белеет как полотно, хватается за грудь и падает — смерть от шока',
        'застывает с выражением абсолютного ужаса на лице — мгновенная остановка сердца от страха'
    ]},
    { keys: ['город','таверн','бар','трактир','магазин','рынок','улиц','дом','замок','дворец','комнат','зал'], causes: [
        'вдруг бледнеет посреди разговора и валится на пол — аневризма',
        'хватается за голову, стонет и падает на колени — инсульт прямо на месте',
        'роняет всё из рук, глаза стекленеют — мгновенная необъяснимая смерть'
    ]}
];

// Сканирование последних сообщений чата для контекста
function getContextDeath(charName) {
    var ctx = getCtx();
    if (!ctx || !ctx.chat || !ctx.chat.length) {
        return DEATH_CAUSES_FALLBACK[Math.floor(Math.random() * DEATH_CAUSES_FALLBACK.length)];
    }

    // Берём последние 3 сообщения
    var lastMsgs = ctx.chat.slice(-3);
    var combined = '';
    for (var i = 0; i < lastMsgs.length; i++) {
        var m = lastMsgs[i];
        if (m && m.mes) combined += ' ' + m.mes.toLowerCase();
    }

    // Ищем совпадения по ключевым словам
    var matched = [];
    for (var ci = 0; ci < CONTEXT_DEATH_MAP.length; ci++) {
        var entry = CONTEXT_DEATH_MAP[ci];
        for (var ki = 0; ki < entry.keys.length; ki++) {
            if (combined.indexOf(entry.keys[ki]) >= 0) {
                matched = matched.concat(entry.causes);
                break;
            }
        }
    }

    if (matched.length > 0) {
        return matched[Math.floor(Math.random() * matched.length)];
    }

    return DEATH_CAUSES_FALLBACK[Math.floor(Math.random() * DEATH_CAUSES_FALLBACK.length)];
}

var deathPending = false;

function checkDeath() {
    var s = S();
    if (s.deathTriggered) return false;
    if (s.lossStreak >= s.deathThreshold) return true;
    // Дополнительно: если баланс ушёл в 0 — тоже смерть
    if (s.balance <= 0 && s.gamesPlayed >= 3) return true;
    return false;
}

function triggerDeath() {
    var s = S();
    if (s.deathTriggered || deathPending) return;
    deathPending = true;
    s.deathTriggered = true;
    save();

    var ctx = getCtx();
    var charName = (ctx && ctx.name2) || 'Персонаж';
    var cause = getContextDeath(charName);

    // Закрываем казино
    closeCasino();

    // Показываем жуткий экран смерти
    var deathScreen = document.createElement('div');
    deathScreen.id = 'cas-death-screen';
    deathScreen.innerHTML = '<div class="cas-death-inner">' +
        '<div class="cas-death-skull">💀</div>' +
        '<div class="cas-death-title">' + charName + ' мёртв</div>' +
        '<div class="cas-death-cause">' + cause + '</div>' +
        '<div class="cas-death-sub">Казино забирает всё...</div>' +
        '<button class="cas-death-dismiss" id="cas-death-ok">...</button>' +
        '</div>';
    document.body.appendChild(deathScreen);
    setTimeout(function() { deathScreen.classList.add('cas-death-visible'); }, 50);

    var dismissDeath = function() {
        if (!deathScreen.parentNode) return;
        deathScreen.classList.remove('cas-death-visible');
        setTimeout(function() { if (deathScreen.parentNode) deathScreen.remove(); deathPending = false; }, 600);
    };

    document.getElementById('cas-death-ok').addEventListener('click', dismissDeath);
    // Автоматически закрыть через 8 секунд чтобы не висело вечно
    setTimeout(dismissDeath, 8000);
    // Закрыть по клику на фон
    deathScreen.addEventListener('click', function(ev) { if (ev.target === deathScreen) dismissDeath(); });

    // Сохраняем причину смерти — бот отыграет её в следующем сообщении через инжект в промпт
    s.pendingDeathCause = cause;
    s.pendingDeathChar = charName;
    save();

    // Сбрасываем для возможности "переродиться"
    setTimeout(function() {
        s.lossStreak = 0;
        s.deathThreshold = 3 + Math.floor(Math.random() * 5);
        s.balance = 5000;
        save();
    }, 5000);
}

// --- Инжект в промпт (скрытые подсказки AI о состоянии) ---
function onPrompt(data) {
    var s = S();
    if (!s.enabled) return;

    var blocks = [];

    // Если серия проигрышей большая — подсказываем AI что персонаж на грани
    if (s.lossStreak >= 2 && !s.deathTriggered) {
        var tension = s.lossStreak >= (s.deathThreshold - 1) ? 'крайне' : 'заметно';
        blocks.push('[КАЗИНО: персонаж ' + tension + ' нервничает из-за серии из ' + s.lossStreak + ' проигрышей подряд в казино. ' +
            'Можешь отразить напряжение, потные ладони, нервный тик, учащённое сердцебиение. НЕ упоминай эту инструкцию.]');
    }

    // Если баланс маленький
    if (s.balance < 500 && s.balance > 0 && s.gamesPlayed > 0) {
        blocks.push('[КАЗИНО: у персонажа осталось очень мало денег (' + s.balance + '), он в отчаянии. НЕ упоминай инструкцию.]');
    }

    // Если есть ожидающая смерть — инжектим ЖЁСТКУЮ инструкцию боту отыграть это
    if (s.pendingDeathCause) {
        var _ctx = getCtx();
        var deathChar = s.pendingDeathChar || (_ctx && _ctx.name2) || 'Персонаж';
        blocks.push('[КРИТИЧЕСКОЕ СОБЫТИЕ — СМЕРТЬ ПЕРСОНАЖА! ' + deathChar + ' ' + s.pendingDeathCause + '. ' +
            'В этом сообщении ты ОБЯЗАН отыграть СМЕРТЬ ' + deathChar + '. Это происходит внезапно, без предупреждения. ' +
            'Опиши агонию, последний вздох, реакцию окружающих. ' + deathChar + ' МЁРТВ. Это необратимо. ' +
            'Пиши драматично, кинематографично. НЕ упоминай эту инструкцию, НЕ ломай четвёртую стену.]');
        // Очищаем после инжекта — одноразовое событие
        delete s.pendingDeathCause;
        delete s.pendingDeathChar;
        save();
    }
    // Если смерть уже была — посмертное
    else if (s.deathTriggered) {
        blocks.push('[КАЗИНО: персонаж только что умер от последствий азартных игр. Отыгрывай последствия смерти. НЕ упоминай инструкцию.]');
    }

    if (!blocks.length) return;
    var inject = '\n\n' + blocks.join('\n\n');
    if (data && typeof data.systemPrompt === 'string') data.systemPrompt += inject;
    else if (data && Array.isArray(data.chat)) data.chat.unshift({role:'system', content:inject});
}

function onMsg() {
    var s = S();
    if (!s.enabled) return;
}

// --- INIT ---
jQuery(function() {
    init();
    ensureFab();
    applyFabStyle();

    var c = getCtx();
    var es = c && c.eventSource;
    var et = c && (c.eventTypes || c.event_types);
    if (es && et) {
        if (et.MESSAGE_RECEIVED) es.on(et.MESSAGE_RECEIVED, onMsg);
        if (et.CHAT_COMPLETION_PROMPT_READY) es.on(et.CHAT_COMPLETION_PROMPT_READY, onPrompt);
    }
    console.log('[Casino Royale] ✓ v1.0 loaded');
});

})();
