# -*- coding: utf-8 -*-
# v.935 [Jeremy: "a writer should also be able to be a beta reader even if they didn't get invited to the app this way. where is the
# best place for them to opt into the beta reader path, and can they also do it from the profile and get a prompt from a friend to
# get added?" → "yes next"]
#  • Your account has a "Beta reading" block: Not listed + Read for others, or a summary with Edit and Pause / Resume.
#  • Community → Friends shows one dismissible card to a writer who is not listed: "Also willing to read for others?"
#  • Find readers tells a writer who only looks for readers that listing themselves lets them ask the readers who only swap.
#  • All three open the v.934 questions, now with a "how would you like to take part" choice for writers (swap / read / both).
#  • Ask a friend: a book button on each friend, and "Ask a friend" in Beta readers → Group. The friend gets the ask in the app and
#    by email whether or not they are a beta reader; yes (with the 18+ box) makes them a private reader and leads to the questions,
#    where they choose whether other writers can find them. "Not now" is quiet. Needs migration 22.
import sys, os
P=os.environ.get('P','/home/claude/build377/index.html'); s=open(P,encoding='utf-8').read()
def one(o,n,w,c=1):
    global s
    k=s.count(o)
    if k!=c: sys.exit('MISMATCH %s: %d'%(w,k))
    s=s.replace(o,n)

# ---------------------------------------------------------------- the account page: a place for the block
one("""      + '<div class="ac-section">'+acHtml+planHtml+'</div>'
""","""      + '<div class="ac-section">'+acHtml+planHtml+'</div>'
      + (_si ? '<div class="ac-betarow"></div>' : '')   /* v.935 — Beta reading: opt in, edit, pause (filled by the beta module) */
""",'acct slot')
one("""  card.querySelector('.pf-x').addEventListener('click', closeAccount);
  { const so=card.querySelector('.ac-signout');""","""  card.querySelector('.pf-x').addEventListener('click', closeAccount);
  try { if (typeof window.dystBetaAcctRow === 'function') window.dystBetaAcctRow(); } catch(e){}   /* v.935 */
  { const so=card.querySelector('.ac-signout');""",'acct fill')

# ---------------------------------------------------------------- Friends: the card, and a book button on each friend
one("""  window.__dystPartners = { panel: panel, open: open, close: close, render: render, button: button, tabs: tabs, wireTabs: wireTabs, setView: function(v){ S.view = v; S.conv = null; } };""",
    """  window.__dystPartners = { panel: panel, open: open, close: close, render: render, button: button, tabs: tabs, wireTabs: wireTabs, setView: function(v){ S.view = v; S.conv = null; },
    list: function(){ return S.list; }, view: function(){ return S.open ? S.view : ''; } };   /* v.935 */""",'partners api')
one("""         : (p.unread ? '<span class="ch-n">' + p.unread + '</span>' : '')) + '</div>';
  }""","""         : (p.unread ? '<span class="ch-n">' + p.unread + '</span>' : ''))
      + (p.status === 'accepted' && typeof window.dystBetaFriendBtn === 'function' ? window.dystBetaFriendBtn(p.user_id) : '') + '</div>';   /* v.935 */
  }""",'friend row btn')
one("""    if (S.list === null) H += '<div class="ch-empty">Loading…</div>';
    /* v.861""","""    if (S.list === null) H += '<div class="ch-empty">Loading…</div>';
    try { if (typeof window.dystBetaFriendsCard === 'function') H += window.dystBetaFriendsCard(); } catch (e){}   /* v.935 */
    /* v.861""",'friends card')
one("""    el.innerHTML = H; wireTabs(el);
    el.querySelector('.ch-x').onclick = close;
    el.querySelector('.ch-set').onclick""","""    el.innerHTML = H; wireTabs(el);
    try { if (typeof window.dystBetaFriendsWire === 'function') window.dystBetaFriendsWire(el); } catch (e){}   /* v.935 */
    el.querySelector('.ch-x').onclick = close;
    el.querySelector('.ch-set').onclick""",'friends wire')

# ---------------------------------------------------------------- the beta module
# someone with no reader profile still sees who is asking them
one("""    } else { B.group = []; B.reads = []; B.sends = []; }
    badge(); draw(false);""","""    } else { var g0 = await rpc('beta_group'); B.group = g0.error ? [] : (g0.data || []); B.reads = []; B.sends = []; }   /* v.935 — a friend may be asking */
    badge(); draw(false); acctRow();""",'loadAll')

one("""  var KEEP = ['Not really', 'Maybe', 'Probably', 'Yes', 'Couldn’t stop'];""","""  /* v.935 — listed = other writers can find you (you swap, or read for anyone) */
  function isListed(p){ return !!(p && (p.swap !== false || p.volunteer)); }
  function lsOn(k){ try { return localStorage.getItem(k) === '1'; } catch (e){ return false; } }
  function lsSet(k){ try { localStorage.setItem(k, '1'); } catch (e){} }
  var BOOK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5C10 5 7 4.6 4 5v13c3-.4 6 0 8 1.5 2-1.5 5-1.9 8-1.5V5c-3-.4-6 0-8 1.5z"/><path d="M12 6.5v13"/></svg>';
  var KEEP = ['Not really', 'Maybe', 'Probably', 'Yes', 'Couldn’t stop'];""",'helpers')

# the join form, for someone a friend is asking
one("""    if (!B.prof) H += '<div class="bx-intro"><div class="bx-h">Swap reads with other writers</div>""","""    if (!B.prof) H += incoming().map(function(g){ return '<div class="bx-fa" data-id="' + h(g.user_id) + '"><div class="bx-fa-t"><b>' + h(g.name) + '</b> would like you as a beta reader.' + (g.note ? ' <i>“' + h(g.note) + '”</i>' : '') + '</div><button type="button" class="ch-btn ch-go bx-fa-see">Answer</button></div>'; }).join('');
    if (!B.prof) H += '<div class="bx-intro"><div class="bx-h">Swap reads with other writers</div>""",'profile banner')

# Group: ask a friend
one("""    return H + inviteHTML();
  }""","""    return H + friendsHTML() + inviteHTML();
  }
  /* v.935 — friends who are not your readers yet: ask them, whether or not they are in the exchange */
  function askable(){
    var L = []; try { L = (P() && P().list()) || []; } catch (e){}
    var has = {}; (B.group || []).forEach(function(g){ has[g.user_id] = 1; });
    return L.filter(function(p){ return p && p.status === 'accepted' && !has[p.user_id]; });
  }
  function friendsHTML(){
    var L = askable(); if (!L.length) return '';
    return '<div class="ch-grp bx-invgrp">Ask a friend</div><div class="bx-hint">A friend here can read for you even if they are not a beta reader yet. They get your ask in Dystoria and by email, and choose.</div>'
      + L.slice(0, 12).map(function(p){ return '<div class="ch-row bx-frow" data-id="' + h(p.user_id) + '" data-name="' + h(p.username) + '"><div class="ch-av" style="background:hsl(' + hue(p.user_id) + ',42%,42%)">' + h(initial(p.username)) + '</div>'
          + '<div class="ch-who"><div class="ch-name">' + h(p.username) + '</div></div><button class="ch-btn ch-go bx-fask2" type="button">Ask</button></div>'; }).join('');
  }
  function incoming(){ return (B.group || []).filter(function(g){ return g.status === 'pending' && !g.requested_by_me && (g.rel || '') === 'i_read_for'; }); }
  async function respond(other, accept, adult){
    var r = await rpc('beta_respond', { a_other: other, a_accept: !!accept, a_adult: !!adult });
    if (r.error && missingFn(r.error)){ B.pre = false; r = await rpc('beta_respond', { a_other: other, a_accept: !!accept }); if (r.error && missingFn(r.error)) B.pre = false; }
    return r.error ? 'error' : r.data;
  }
  async function askFriend(id, nm){
    if (!real() || !id) return;
    nm = nm || 'your friend';
    if (!B.prof){
      jCard({ title: 'Set up your reader profile first', line: 'To ask ' + nm + ' to read for you, join the beta readers yourself. It takes a minute, and you choose whether you read for others.',
              buttons: [{ label: 'Not now', fn: jClose }, { label: 'Set it up', go: true, fn: function(){ jClose(); window.dystBetaOpen('profile'); } }] });
      return;
    }
    var note = null; try { note = await sitePrompt('Ask ' + nm + ' to be your beta reader. Add a note if you like', '', 'Ask'); } catch (e){ note = ''; }
    if (note === null) return;
    var r = await rpc('beta_ask_friend', { a_to: id, a_note: String(note || '').trim() || null });
    var gone = !!(r.error && missingFn(r.error)); if (gone) B.pre = false;
    var st = r.error ? '' : r.data;
    var msg = gone ? 'Asking a friend needs the latest database update (migration 22).'
      : (r.error ? 'Couldn’t ask: ' + (r.error.message || r.error)
      : ({ ok: 'Asked ' + nm + '. You’ll see their answer in Beta readers.', accepted: nm + ' had already offered to read for you. It’s done.', already: 'You’ve asked ' + nm + ' in the last three weeks, or they already read for you.',
           opt_in: 'Set up your reader profile first.', not_friend: nm + ' isn’t one of your friends here yet.', rate: 'That’s a lot of asking for one day. Try tomorrow.', blocked: 'You can’t ask ' + nm + '.', self: 'That’s you.' }[st] || 'Couldn’t ask.'));
    if (st === 'ok'){ notify(); trk('beta_friend_asked', { note: !!note }); }
    flash(msg);
    await loadAll();
    try { if (P() && P().view()) P().render(); } catch (e){}
  }
  window.dystBetaAskFriend = askFriend;
  /* the friend's side: yes (18+ if they have no reader profile) or not now, which is quiet */
  function friendAsk(g){
    var who = g.name || 'A friend', need = !(B.prof && B.prof.adult);
    jCard({ who: who + ' would like you to be a', title: 'Beta reader', note: g.note || '', adult: need, adultOn: false,
            line: 'Say yes and ' + who + ' can send you their work to read. You’ll get an email when something is waiting, and nothing is owed back. Afterwards you choose whether other writers can find you too.',
            buttons: [{ label: 'Not now', fn: async function(){ jClose(); await respond(g.user_id, false); trk('beta_friend_declined'); B.last = 0; loadAll(); } },
                      { label: 'Yes, I’ll read', go: true, fn: async function(btn, c){
                          var ad = c.querySelector('.bx-ivad'), m = c.querySelector('.iv-msg');
                          if (need && !(ad && ad.checked)){ m.textContent = 'Beta reading on Dystoria is for readers 18 and over. Tick the box to go on.'; return; }
                          btn.disabled = true; var st = await respond(g.user_id, true, true); btn.disabled = false;
                          if (st === 'ok'){ trk('beta_friend_accepted'); B.last = 0; await loadAll(); readerSetup({ who: who }); return; }
                          m.textContent = st === 'adult' ? 'Beta reading on Dystoria is for readers 18 and over. Tick the box to go on.' : (st === 'not_found' ? 'That ask is no longer open.' : 'Couldn’t say yes just now. Try again in a moment.');
                        } }] });
  }
  window.dystBetaFriendAsk = function(id){ var g = incoming().filter(function(x){ return x.user_id === id; })[0]; if (g) friendAsk(g); };
  /* Friends: a book button on a friend who is not your reader yet */
  window.dystBetaFriendBtn = function(id){
    if (!real() || B.pre || B.prof === undefined || !Array.isArray(B.group)) return '';
    if (B.group.some(function(g){ return g.user_id === id; })) return '';
    return '<button class="ch-ic bx-fask" type="button" data-tip="Ask to be your beta reader" aria-label="Ask to be your beta reader">' + BOOK + '</button>';
  };
  /* Friends: one card for a writer who is not listed */
  var ALSO_F = 'dystoria.betaCardOff', ALSO_S = 'dystoria.betaSwapHintOff';
  function alsoHTML(key, t, sub, go){
    return '<div class="bx-also" data-k="' + key + '"><button type="button" class="bx-also-x" title="Dismiss" aria-label="Dismiss">' + XSVG + '</button><div class="bx-also-t">' + h(t) + '</div><div class="bx-also-s">' + h(sub) + '</div><button type="button" class="ch-btn ch-go bx-also-go">' + h(go) + '</button></div>';
  }
  function alsoWire(el, redraw){
    Array.prototype.forEach.call(el.querySelectorAll('.bx-also'), function(c){
      c.querySelector('.bx-also-x').onclick = function(e){ e.stopPropagation(); lsSet(c.getAttribute('data-k')); trk('beta_also_dismissed', { where: c.getAttribute('data-k') === ALSO_F ? 'friends' : 'find' }); c.remove(); if (redraw) redraw(); };
      c.querySelector('.bx-also-go').onclick = function(e){ e.stopPropagation(); trk('beta_also_start', { where: c.getAttribute('data-k') === ALSO_F ? 'friends' : 'find' }); readerSetup({ writer: true }); };
    });
  }
  window.dystBetaFriendsCard = function(){
    if (!real() || B.pre || B.prof === undefined || isListed(B.prof) || lsOn(ALSO_F)) return '';
    return alsoHTML(ALSO_F, 'Also willing to read for others?', 'Add yourself to the beta readers. Writers can ask you to read, and you can swap reads for your own work.', 'Add me');
  };
  window.dystBetaFriendsWire = function(el){
    alsoWire(el);
    Array.prototype.forEach.call(el.querySelectorAll('.bx-fask'), function(b){ b.onclick = function(e){ e.stopPropagation(); var r = b.closest('.ch-row'), n = r.querySelector('.ch-name'); askFriend(r.getAttribute('data-id'), n ? n.textContent : ''); }; });
  };
  /* Your account → Beta reading */
  function sumLine(p){
    var role = p.swap !== false && p.volunteer ? 'Swaps reads and reads for anyone' : (p.volunteer ? 'Reads for anyone' : 'Swaps reads');
    var rd = (p.reads || []).slice(0, 3).join(', ') + ((p.reads || []).length > 3 ? ' and ' + ((p.reads || []).length - 3) + ' more' : '');
    return [role, rd, (p.capacity || 2) + ' at a time'].filter(Boolean).join(' · ');
  }
  async function setOpen(on){
    var p = B.prof; if (!p) return false;
    var a = { a_reads: p.reads || [], a_lengths: p.lengths || [], a_capacity: p.capacity || 2, a_wont: p.wont || '', a_about: p.about || '', a_turnaround: p.turnaround || '', a_open: !!on, a_adult: true, a_swap: p.swap !== false, a_volunteer: !!p.volunteer };
    var r = await rpc('beta_profile_set', a);
    if (r.error || r.data !== 'ok'){ flash('Couldn’t save just now. Try again in a moment.'); return false; }
    trk(on ? 'beta_resumed' : 'beta_paused', { where: 'account' }); B.last = 0; await loadAll(); return true;
  }
  function acctClose(){ try { if (typeof closeAccount === 'function') closeAccount(); } catch (e){} }
  function acctRow(){
    var card = $i('profileCard'), box = card && card.querySelector('.ac-betarow'); if (!box) return;
    if (!real() || B.pre || B.prof === undefined){ box.innerHTML = ''; return; }
    var p = B.prof, H = '<div class="abr-h">Beta reading</div>';
    if (!isListed(p)){
      H += '<div class="abr-line"><b>Not listed.</b> Read other writers’ work before anyone else, and swap reads for your own. You say yes or no each time someone asks.</div>'
        + '<div class="abr-acts"><button type="button" class="abr-go">Read for others</button></div>';
    } else {
      H += '<div class="abr-line"><b>' + (p.open !== false ? 'Listed.' : 'Paused.') + '</b> ' + h(sumLine(p)) + (p.open !== false ? '' : '. Nobody can send you anything new until you resume.') + '</div>'
        + '<div class="abr-acts"><button type="button" class="abr-edit">Edit</button><button type="button" class="abr-pause">' + (p.open !== false ? 'Pause' : 'Resume') + '</button></div>';
    }
    box.innerHTML = H;
    var go = box.querySelector('.abr-go'), ed = box.querySelector('.abr-edit'), pz = box.querySelector('.abr-pause');
    if (go) go.onclick = function(){ trk('beta_also_start', { where: 'account' }); acctClose(); readerSetup({ writer: true }); };
    if (ed) ed.onclick = function(){ acctClose(); window.dystBetaOpen('profile'); };
    if (pz) pz.onclick = async function(){ pz.disabled = true; await setOpen(p.open === false); acctRow(); };
  }
  window.dystBetaAcctRow = function(){ acctRow(); if (real() && !B.pre && (B.prof === undefined || Date.now() - B.last > 30000)) loadAll(); };""",'group + friend ask + account')

# Find readers: a writer who only looks for readers
one("""    B.msg = '';
    if (B.dir === null) return H + '<div class="ch-empty">Loading…</div>';""","""    B.msg = '';
    if (B.prof && !isListed(B.prof) && !lsOn(ALSO_S)) H += alsoHTML(ALSO_S, 'Swap instead?', 'Some readers only swap reads. List yourself too and you can ask them, a read for a read.', 'List me');
    if (B.dir === null) return H + '<div class="ch-empty">Loading…</div>';""",'find hint')

# wiring in the Beta view
one("""    var sv = el.querySelector('.bx-save'); if (sv) sv.onclick = async function(){""","""    alsoWire(el);
    Array.prototype.forEach.call(el.querySelectorAll('.bx-frow'), function(r){ var b = r.querySelector('.bx-fask2'); if (b) b.onclick = function(e){ e.stopPropagation(); askFriend(r.getAttribute('data-id'), r.getAttribute('data-name')); }; });
    Array.prototype.forEach.call(el.querySelectorAll('.bx-fa'), function(r){ r.querySelector('.bx-fa-see').onclick = function(){ window.dystBetaFriendAsk(r.getAttribute('data-id')); }; });
    var sv = el.querySelector('.bx-save'); if (sv) sv.onclick = async function(){""",'wire')

# the questions: a writer chooses how to take part
one("""    var H = '<div class="iv-logo">Dystoria · Beta readers</div><div class="iv-title">' + (o.pub ? 'Become a beta reader' : 'A few questions') + '</div>'
      + '<div class="iv-role">' + (o.pub ? 'Tell writers what you like to read. They can then find you and ask you to read for them, and you say yes or no each time.'""",
    """    var H = '<div class="iv-logo">Dystoria · Beta readers</div><div class="iv-title">' + (o.writer ? 'Read for other writers' : (o.pub ? 'Become a beta reader' : 'A few questions')) + '</div>'
      + '<div class="iv-role">' + (o.pub || o.writer ? 'Tell writers what you like to read. They can then find you and ask you to read for them, and you say yes or no each time.'""",'setup head')
one("""    if (!o.pub) H += '<div class="bx-l">Would you read for other writers too?</div><div class="bq-radio">'""",
    """    if (o.writer){ var rl0 = roleOf(B.prof); if (rl0 === 'writer' || !B.prof) rl0 = 'swap';   /* v.935 */
      H += '<div class="bx-l">How would you like to take part?</div><div class="bq-radio">'
        + [['swap', 'Swap reads: I read theirs, they read mine'], ['volunteer', 'Read for others, nothing needed back'], ['both', 'Both']].map(function(x){ return '<label><input type="radio" name="bqRole" value="' + x[0] + '"' + (rl0 === x[0] ? ' checked' : '') + '><span>' + x[1] + '</span></label>'; }).join('') + '</div>'; }
    if (!o.pub && !o.writer) H += '<div class="bx-l">Would you read for other writers too?</div><div class="bq-radio">'""",'setup role')
one("""class="iv-btn bq-skip">' + (o.pub ? 'Not now' : 'Skip for now') + '</button>""","""class="iv-btn bq-skip">' + (o.pub || o.writer ? 'Not now' : 'Skip for now') + '</button>""",'setup skip label')
one("""trk('beta_reader_questions_skipped', { pub: !!o.pub }); if (o.pub){ c.classList.remove('bq'); jClose(); }""","""trk('beta_reader_questions_skipped', { pub: !!o.pub, writer: !!o.writer }); if (o.pub || o.writer){ c.classList.remove('bq'); jClose(); }""",'setup skip')
one("""      var vol = o.pub ? true : ((c.querySelector('input[name="bqVol"]:checked') || { value: '0' }).value === '1');""",
    """      var role = o.writer ? (c.querySelector('input[name="bqRole"]:checked') || { value: 'swap' }).value : '';
      var vol = o.writer ? (role !== 'swap') : (o.pub ? true : ((c.querySelector('input[name="bqVol"]:checked') || { value: '0' }).value === '1'));""",'setup vol')
one("""a_open: p.open !== false, a_adult: true, a_swap: !!(B.prof && B.prof.swap), a_volunteer: vol || !!p.volunteer });""",
    """a_open: p.open !== false, a_adult: true, a_swap: o.writer ? (role !== 'volunteer') : !!(B.prof && B.prof.swap), a_volunteer: o.writer ? vol : (vol || !!p.volunteer) });""",'setup save')
one("""      trk('beta_reader_questions_saved', { pub: !!o.pub, listed: vol });
      B.last = 0; B.dir = null; await loadAll();
      readerDone(o, vol || !!p.volunteer);""","""      trk('beta_reader_questions_saved', { pub: !!o.pub, writer: !!o.writer, role: role || null, listed: vol });
      B.last = 0; B.dir = null; await loadAll();
      readerDone(o, o.writer ? true : (vol || !!p.volunteer));""",'setup done')
one("""    jCard({ who: 'Welcome', title: o.pub ? 'You’re a beta reader' : 'You’re ' + o.who + '’s beta reader',""","""    jCard({ who: 'Welcome', title: o.pub || o.writer ? 'You’re a beta reader' : 'You’re ' + o.who + '’s beta reader',""",'done title')
one("""fn: function(){ jClose(); window.dystBetaOpen(listed ? 'profile' : 'toread'); } }] });
  }
  function readerSetup(o){""","""fn: function(){ jClose(); window.dystBetaOpen(o.writer ? 'find' : (listed ? 'profile' : 'toread')); } }] });
  }
  function readerSetup(o){""",'done open')

# a friend's ask shows itself once to someone with no reader profile
one("""      if (!u || B.pre) return;
      if (Date.now() - B.last > (isOpenHere() ? 60000 : 180000)) loadAll();""","""      if (!u || B.pre) return;
      /* v.935 — a friend is asking someone who has no reader profile: show it once this visit (it stays in Beta readers until answered) */
      if (B.prof === null && !pj && !document.body.classList.contains('guest') && !document.body.classList.contains('onb-live') && !($i('invCard') && $i('invCard').classList.contains('show'))){
        var fa = incoming()[0];
        if (fa){ var fk = 'dystoria.betaAskSeen.' + fa.user_id, seen = false; try { seen = sessionStorage.getItem(fk) === '1'; sessionStorage.setItem(fk, '1'); } catch (e){ seen = !!B['seen' + fa.user_id]; B['seen' + fa.user_id] = 1; }
          if (!seen) friendAsk(fa); }
      }
      if (Date.now() - B.last > (isOpenHere() ? 60000 : 180000)) loadAll();""",'tick')

# ---------------------------------------------------------------- styles
one("""#chatPanel .bx-takes{ margin-top:2px; }""","""#chatPanel .bx-takes{ margin-top:2px; }
/* v.935 — opting in from where you are, and asking a friend */
#chatPanel .bx-also{ position:relative; margin:10px 0 12px; padding:12px 34px 12px 14px; border:1px solid rgba(243,169,74,.32); border-radius:10px; background:rgba(243,169,74,.07); }
#chatPanel .bx-also-t{ font:600 14px/1.35 system-ui,-apple-system,sans-serif; color:#f0e6cf; }
#chatPanel .bx-also-s{ margin:3px 0 10px; font:13.5px/1.45 system-ui,-apple-system,sans-serif; color:#cfc5b1; }
#chatPanel .bx-also-x{ position:absolute; top:6px; right:6px; width:24px; height:24px; padding:4px; background:none; border:0; color:#8f8676; cursor:pointer; }
#chatPanel .bx-also-x:hover{ color:#f3c77e; }
#chatPanel .bx-also-x svg{ width:100%; height:100%; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; }
#chatPanel .ch-row .bx-fask{ flex:none; width:30px; height:30px; padding:5px; color:#8f8676; }
#chatPanel .ch-row .bx-fask:hover{ color:#f3c77e; }
#chatPanel .ch-row .bx-fask svg{ width:100%; height:100%; display:block; }
#chatPanel .bx-frow{ cursor:default; }
#chatPanel .bx-fa{ display:flex; align-items:center; gap:10px; margin:10px 0 4px; padding:11px 12px; border:1px solid rgba(243,169,74,.32); border-radius:10px; background:rgba(243,169,74,.07); }
#chatPanel .bx-fa-t{ flex:1; min-width:0; font:14px/1.45 system-ui,-apple-system,sans-serif; color:#e6dcc6; }
#chatPanel .bx-fa-t i{ color:#cfc5b1; }
body.eink #chatPanel .bx-also, body.eink #chatPanel .bx-fa{ background:#fff; border:2px solid #000; }
body.eink #chatPanel .bx-also-t, body.eink #chatPanel .bx-also-s, body.eink #chatPanel .bx-fa-t, body.eink #chatPanel .bx-fa-t i{ color:#000; }
#profileCard .ac-betarow{ display:flex; flex-direction:column; gap:7px; padding:14px 0 16px; border-top:1px solid var(--line); font-family:var(--sans); }
#profileCard .ac-betarow:empty{ display:none; }
#profileCard .abr-h{ font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--gold); font-weight:600; }
#profileCard .abr-line{ font-size:13.5px; line-height:1.55; color:var(--ink-soft); }
#profileCard .abr-line b{ color:inherit; font-weight:700; }
body:not(.eink) #profileCard .abr-line b{ color:#f3c77e; }
body:not(.eink) #profileCard .ac-betarow{ border-top-color:var(--em-gold-a16, rgba(250,154,49,.16)); }
#profileCard .abr-acts{ display:flex; flex-wrap:wrap; gap:9px; margin-top:2px; }
#profileCard .abr-acts button{ font-family:var(--sans); font-size:12px; letter-spacing:.04em; border:1px solid var(--line); background:transparent; color:var(--ink-soft); border-radius:8px; padding:8px 18px; cursor:pointer; }
#profileCard .abr-acts button:hover{ border-color:var(--gold); }
#profileCard .abr-acts button:disabled{ opacity:.5; cursor:default; }
body:not(.eink) #profileCard .abr-acts .abr-go{ background:linear-gradient(180deg,var(--em-grad-hi,#ffb44f),var(--em-grad-lo,#f08c1f)); color:var(--em-ink-on-gold,#1a140d); border-color:#f5a637; }
body.eink #profileCard .abr-acts button{ border:2px solid #000; color:#000; }""",'css')

one("APP_VERSION = '2026.07.20.857'","APP_VERSION = '2026.07.20.858'","version")
one("""    { v:'2026.07.20.857', date:'October 3, 2026', notes:[""","""    { v:'2026.07.20.858', date:'October 7, 2026', notes:[
      '**Writers can read for others, from where they are.** Your account has a Beta reading section: add yourself, edit what you read, or pause. Community shows the same offer once, and Find readers offers it when listing yourself would let you ask the readers who only swap.',
      '**Ask a friend to be your beta reader.** Each friend in Community has a book button, and Beta readers has Ask a friend. They get your ask in Dystoria and by email, whether or not they are a beta reader yet. If they say yes they read for you, and choose for themselves whether other writers can find them.'
    ]},
    { v:'2026.07.20.857', date:'October 3, 2026', notes:[""","changelog")
open(P,'w',encoding='utf-8').write(s); print('ok', len(s.encode()))
