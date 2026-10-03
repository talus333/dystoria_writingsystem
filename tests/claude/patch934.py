# -*- coding: utf-8 -*-
# v.934 [Jeremy: "what is the current path for someone who may want to be just a beta tester? They get an email link, but do they have
# a landing page with questions they can answer that will put them in the database for people searching? … willing to beta test for
# others. interested in specific genres? interested in reviewing sections or full stories?" → "yes"]
#  • an invited reader, after "Yes, I'll read", gets one short screen of questions (all optional): read for other writers too? what
#    they like to read, how much at a time, the kind of feedback they give, how many at once and how fast, what they won't read, a
#    line about them. "Other writers can find me" lists them under Find readers (volunteer), which until now nothing offered them.
#  • a public way in with no invitation: /?beta=reader (or #/beta-reader). Sign up, answer the same questions, listed as a volunteer.
#  • two new answers (portions, feedback) on the profile, in the directory cards, and in migration 21. Before migration 21 is run the
#    app saves everything else and skips those two.
import sys, os
P=os.environ.get('P','/home/claude/build376/index.html'); s=open(P,encoding='utf-8').read()
def one(o,n,w,c=1):
    global s
    k=s.count(o)
    if k!=c: sys.exit('MISMATCH %s: %d'%(w,k))
    s=s.replace(o,n)

# the public link, noted before anything else runs (like #/beta-join)
one("""localStorage.setItem('dystoria.pendingBetaJoin',_bjm[1].toLowerCase());history.replaceState(null,'',location.pathname+location.search);}}catch(e){}</script>""",
    """localStorage.setItem('dystoria.pendingBetaJoin',_bjm[1].toLowerCase());history.replaceState(null,'',location.pathname+location.search);}}catch(e){}</script>
<script>/* v.934 — /?beta=reader or #/beta-reader: "I'd like to be a beta reader", with no invitation */try{if(/[?&]beta=reader\\b/.test(location.search||'')||/^#\\/beta-reader\\b/.test(location.hash||'')){localStorage.setItem('dystoria.pendingBetaReader','1');history.replaceState(null,'',location.pathname);}}catch(e){}</script>""", 'route')

one("""  var TURN = ['about a week', 'two weeks', 'three weeks', 'a month'];""",
    """  var TURN = ['about a week', 'two weeks', 'three weeks', 'a month'];
  /* v.934 — how much a reader takes on at a time, and the kind of notes they give (migration 21) */
  var PORTIONS = [['section', 'A chapter or section'], ['short', 'A short story'], ['full', 'A whole novel']];
  var FEEDBACK = [['reader', 'Gut reactions as a reader'], ['story', 'Big-picture story notes'], ['line', 'Line-level notes']];
  function chipRow(cls, list, on){ return '<div class="bx-chips ' + cls + '">' + list.map(function(x){ var v = Array.isArray(x) ? x[0] : x, t = Array.isArray(x) ? x[1] : x; return '<button type="button" class="bx-chip' + ((on || []).indexOf(v) >= 0 ? ' on' : '') + '" data-v="' + h(v) + '">' + h(t) + '</button>'; }).join('') + '</div>'; }
  function chipVals(el, cls){ return Array.prototype.map.call(el.querySelectorAll('.' + cls + ' .bx-chip.on'), function(b){ return b.getAttribute('data-v'); }); }
  function labelsOf(list, vals){ return (vals || []).map(function(v){ var x = list.filter(function(l){ return l[0] === v; })[0]; return x ? x[1].charAt(0).toLowerCase() + x[1].slice(1) : ''; }).filter(Boolean).join(', '); }
  /* the profile is saved through here: a database that has not had migration 21 yet does not know the two new answers, so they are
     left out and everything else is still saved */
  async function profileSet(args){
    var r = await rpc('beta_profile_set', args);
    if (r && r.error && missingFn(r.error) && ('a_portions' in args)){ var a2 = {}; Object.keys(args).forEach(function(k){ if (k !== 'a_portions' && k !== 'a_feedback') a2[k] = args[k]; }); B.pre = false; r = await rpc('beta_profile_set', a2); }
    return r;
  }""", 'consts')

# the profile form: the two new rows
one("""      + '<div class="bx-two"><label><span class="bx-l">At a time</span>""",
    """      + '<div class="bx-l">How much at a time</div>' + chipRow('bx-ports', PORTIONS, p.portions)
      + '<div class="bx-l">The feedback you give</div>' + chipRow('bx-fb', FEEDBACK, p.feedback)
      + '<div class="bx-two"><label><span class="bx-l">At a time</span>""", 'profRows')
one("""      var r = await rpc('beta_profile_set', { a_reads: reads, a_lengths: lens,""",
    """      var r = await profileSet({ a_portions: chipVals(el, 'bx-ports'), a_feedback: chipVals(el, 'bx-fb'), a_reads: reads, a_lengths: lens,""", 'profSave')

# the directory card says them
one("""        + (d.about ? '<div class="bx-about">' + h(d.about) + '</div>' : '') + (d.wont ?""",
    """        + ((d.portions || []).length || (d.feedback || []).length ? '<div class="bx-meta bx-takes">' + [(d.portions || []).length ? 'Takes ' + h(labelsOf(PORTIONS, d.portions)) : '', (d.feedback || []).length ? 'gives ' + h(labelsOf(FEEDBACK, d.feedback)) : ''].filter(Boolean).join(' · ') + '</div>' : '')
        + (d.about ? '<div class="bx-about">' + h(d.about) + '</div>' : '') + (d.wont ?""", 'dirCard')

# after "Yes, I'll read": the questions instead of "Nothing to do until then"
one("""          trk('beta_invite_accepted'); B.last = 0; loadAll();
          jCard({ who: 'Welcome', title: 'You’re ' + who + '’s beta reader', line: 'When they send you something to read, you’ll get an email, and it waits in Community → Beta readers → To read. Nothing to do until then.',
                  buttons: [{ label: 'Later', fn: jClose }, { label: 'Open Beta readers', go: true, fn: function(){ jClose(); window.dystBetaOpen('toread'); } }] });
          return;""",
    """          trk('beta_invite_accepted'); B.last = 0; await loadAll();
          readerSetup({ who: who });   /* v.934 — a few questions, all optional */
          return;""", 'afterAccept')

one("""  window.dystBetaJoinLink = joinLink;""", """  window.dystBetaJoinLink = joinLink;

  /* ---------------------------------------------------------------- v.934: the reader's questions, and the way in with no invitation */
  function readerDone(o, listed){
    var c = $i('invCard') && $i('invCard').querySelector('.iv-card'); if (c) c.classList.remove('bq');
    jCard({ who: 'Welcome', title: o.pub ? 'You’re a beta reader' : 'You’re ' + o.who + '’s beta reader',
            line: listed ? 'Writers looking for readers can now find you and ask. You say yes or no each time, and you’ll get an email when someone asks or sends you something. It all waits in Community → Beta readers.'
                         : 'When they send you something to read, you’ll get an email, and it waits in Community → Beta readers → To read. Nothing to do until then.',
            buttons: [{ label: 'Later', fn: jClose }, { label: 'Open Beta readers', go: true, fn: function(){ jClose(); window.dystBetaOpen(listed ? 'profile' : 'toread'); } }] });
  }
  function readerSetup(o){
    o = o || {};
    var p = B.prof || {}, needAdult = !p.adult;
    if (!$i('invCard')) jCard({ buttons: [] });
    var el = $i('invCard'), c = el.querySelector('.iv-card'); c.classList.add('bq');
    var H = '<div class="iv-logo">Dystoria · Beta readers</div><div class="iv-title">' + (o.pub ? 'Become a beta reader' : 'A few questions') + '</div>'
      + '<div class="iv-role">' + (o.pub ? 'Tell writers what you like to read. They can then find you and ask you to read for them, and you say yes or no each time.'
                                         : 'You’re ' + h(o.who) + '’s beta reader. These help writers send you the right things. Answer what you like and skip the rest.') + '</div><div class="bq-form">';
    if (!o.pub) H += '<div class="bx-l">Would you read for other writers too?</div><div class="bq-radio">'
      + '<label><input type="radio" name="bqVol" value="0"' + (p.volunteer ? '' : ' checked') + '><span>Just ' + h(o.who) + '</span></label>'
      + '<label><input type="radio" name="bqVol" value="1"' + (p.volunteer ? ' checked' : '') + '><span>Yes, other writers can find me and ask</span></label></div>';
    H += '<div class="bx-l">What do you like to read?</div>' + chipRow('bq-reads', READS, p.reads)
      + '<div class="bx-l">How much at a time?</div>' + chipRow('bq-ports', PORTIONS, p.portions)
      + '<div class="bx-l">What kind of feedback do you give?</div>' + chipRow('bq-fb', FEEDBACK, p.feedback)
      + '<div class="bq-two"><label><span class="bx-l">How many at once</span><select class="bq-cap">' + [1, 2, 3, 4, 5].map(function(n){ return '<option value="' + n + '"' + ((p.capacity || 2) === n ? ' selected' : '') + '>' + n + (n === 1 ? ' read' : ' reads') + '</option>'; }).join('') + '</select></label>'
      + '<label><span class="bx-l">Usually back in</span><select class="bq-turn">' + TURN.map(function(t){ return '<option' + ((p.turnaround || 'two weeks') === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></label></div>'
      + '<div class="bx-l">Anything you won’t read?</div><input class="bq-wont" type="text" maxlength="300" placeholder="e.g. graphic violence, horror" value="' + h(p.wont || '') + '">'
      + '<div class="bx-l">A line about you as a reader</div><textarea class="bq-about" rows="2" maxlength="300" placeholder="What you love in a story, what you’re good at noticing">' + h(p.about || '') + '</textarea>'
      + (needAdult ? '<label class="bx-ivadult"><input type="checkbox" class="bx-ivad"' + ((function(){ try { return localStorage.getItem(JA) === '1'; } catch (e){ return false; } })() ? ' checked' : '') + '> I’m 18 or older</label>' : '')
      + '</div><div class="iv-msg"></div><div class="iv-acts"><button type="button" class="iv-btn bq-skip">' + (o.pub ? 'Not now' : 'Skip for now') + '</button><button type="button" class="iv-btn iv-go bq-save">Save</button></div>';
    c.innerHTML = H;
    Array.prototype.forEach.call(c.querySelectorAll('.bx-chip'), function(b){ b.onclick = function(){ b.classList.toggle('on'); }; });
    el.classList.add('show');
    c.querySelector('.bq-skip').onclick = function(){ trk('beta_reader_questions_skipped', { pub: !!o.pub }); if (o.pub){ c.classList.remove('bq'); jClose(); } else readerDone(o, !!p.volunteer); };
    c.querySelector('.bq-save').onclick = async function(){
      var m = c.querySelector('.iv-msg'), ad = c.querySelector('.bx-ivad');
      if (needAdult && !(ad && ad.checked)){ m.textContent = 'Beta reading on Dystoria is for readers 18 and over. Tick the box to go on.'; return; }
      var vol = o.pub ? true : ((c.querySelector('input[name="bqVol"]:checked') || { value: '0' }).value === '1');
      var ports = chipVals(c, 'bq-ports'), lens = (p.lengths || []).slice();
      var add = function(v){ if (lens.indexOf(v) < 0) lens.push(v); };
      if (ports.indexOf('short') >= 0) add('short'); if (ports.indexOf('full') >= 0){ add('novella'); add('novel'); }
      var sv = c.querySelector('.bq-save'); sv.disabled = true; m.textContent = 'Saving…';
      var r = await profileSet({ a_portions: ports, a_feedback: chipVals(c, 'bq-fb'), a_reads: chipVals(c, 'bq-reads').concat((p.reads || []).filter(function(x){ return READS.indexOf(x) < 0; })), a_lengths: lens,
        a_capacity: +c.querySelector('.bq-cap').value, a_wont: c.querySelector('.bq-wont').value, a_about: c.querySelector('.bq-about').value, a_turnaround: c.querySelector('.bq-turn').value,
        a_open: p.open !== false, a_adult: true, a_swap: !!(B.prof && B.prof.swap), a_volunteer: vol || !!p.volunteer });
      sv.disabled = false;
      if (r.error || r.data === 'adult'){ m.textContent = r.error ? 'Couldn’t save just now. Try again in a moment.' : 'Beta reading on Dystoria is for readers 18 and over. Tick the box to go on.'; return; }
      trk('beta_reader_questions_saved', { pub: !!o.pub, listed: vol });
      B.last = 0; B.dir = null; await loadAll();
      readerDone(o, vol || !!p.volunteer);
    };
  }
  window.dystBetaReaderSetup = readerSetup;
  var RK = 'dystoria.pendingBetaReader', rAsked = false;
  function rDrop(){ try { localStorage.removeItem(RK); } catch (e){} }
  function pubJoin(){
    var on = ''; try { on = localStorage.getItem(RK) || ''; } catch (e){}
    if (!on || typeof supa === 'undefined' || !supa || document.body.classList.contains('guest')) return;
    if ($i('invCard') && $i('invCard').classList.contains('show')) return;
    if (!real()){
      if (rAsked) return; rAsked = true;
      var pre = false; try { pre = localStorage.getItem(JA) === '1'; } catch (e){}
      jCard({ who: 'Love reading new stories?', title: 'Become a beta reader', adult: true, adultOn: pre,
              line: 'Read writers’ work before anyone else and tell them how it lands. You don’t need to write. Make a free account, say what you like to read, and writers looking for readers can find you.',
              buttons: [{ label: 'Not now', fn: function(){ rDrop(); jClose(); } }, { label: 'Become a reader', go: true, fn: function(btn, c){
                var ad = c.querySelector('.bx-ivad'); if (!ad || !ad.checked){ c.querySelector('.iv-msg').textContent = 'Beta reading on Dystoria is for readers 18 and over. Tick the box to go on.'; return; }
                try { localStorage.setItem(JA, '1'); } catch (e){}
                trk('beta_reader_public_start');
                jClose(); try { if (typeof openAccount === 'function') openAccount(); else $i('accountBtn').click(); } catch (e){} } }] });
      return;
    }
    if (B.prof === undefined) return;   /* the profile has not loaded yet: next tick */
    rDrop();
    if (B.prof && B.prof.volunteer){ window.dystBetaOpen('profile'); return; }   /* already listed */
    readerSetup({ pub: true });
  }
  window.dystBetaPublicJoin = pubJoin;""", 'setup')

one("""      if (pj && jTries < 3 && !jBusy){ jTries++; joinLink(); }""", """      if (pj && jTries < 3 && !jBusy){ jTries++; joinLink(); }
      if (!pj) pubJoin();   /* v.934 */""", 'tick')
one("""      if (u !== B.uid){ B.uid = u; jTries = 0;""", """      if (u !== B.uid){ B.uid = u; jTries = 0; rAsked = false;""", 'uid')

one("""#invCard .bx-ivadult input{ accent-color:#f08c1f; }""", """#invCard .bx-ivadult input{ accent-color:#f08c1f; }
/* v.934 — the reader's questions: the invitation card, wider, left-aligned, scrolling inside */
#invCard .iv-card.bq{ width:min(560px,100%); text-align:left; overflow:hidden; }
#invCard .iv-card.bq .iv-logo, #invCard .iv-card.bq .iv-title, #invCard .iv-card.bq .iv-role{ text-align:center; }
#invCard .bq-form{ overflow-y:auto; min-height:0; padding:2px 4px 2px 0; display:flex; flex-direction:column; gap:6px; }
#invCard .bq-form .bx-l{ font:700 10.5px/1.5 system-ui,-apple-system,sans-serif; letter-spacing:.12em; text-transform:uppercase; color:#c9a35c; margin-top:8px; }
#invCard .bq-form .bx-chips{ display:flex; flex-wrap:wrap; gap:6px; }
#invCard .bx-chip{ border:1px solid rgba(250,154,49,.25); background:transparent; color:#e7e2d8; border-radius:999px; padding:5px 11px; cursor:pointer; font:500 12.5px/1.3 system-ui,-apple-system,sans-serif; }
#invCard .bx-chip:hover{ border-color:rgba(250,154,49,.55); }
#invCard .bx-chip.on{ background:rgba(250,154,49,.16); border-color:rgba(250,154,49,.65); color:#f6d9a8; }
#invCard .bq-radio{ display:flex; flex-direction:column; gap:5px; font:14px/1.35 system-ui,-apple-system,sans-serif; }
#invCard .bq-radio label{ display:flex; gap:8px; align-items:center; cursor:pointer; }
#invCard .bq-radio input{ accent-color:#f08c1f; }
#invCard .bq-two{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
#invCard .bq-two label{ display:flex; flex-direction:column; }
#invCard .bq-form select, #invCard .bq-form input[type=text], #invCard .bq-form textarea{ width:100%; box-sizing:border-box; background:#221f1c; color:#ece6d9; border:1px solid rgba(255,255,255,.12); border-radius:9px; padding:8px 10px; font:14px/1.4 system-ui,-apple-system,sans-serif; }
#invCard .bq-form textarea{ resize:vertical; }
#invCard .iv-card.bq .bx-ivadult{ justify-content:flex-start; }
#chatPanel .bx-takes{ margin-top:2px; }""", 'css')

one("APP_VERSION = '2026.07.20.856'","APP_VERSION = '2026.07.20.857'","version")
one("""    { v:'2026.07.20.856', date:'October 1, 2026', notes:[""","""    { v:'2026.07.20.857', date:'October 3, 2026', notes:[
      '**Beta readers are asked what they like.** Someone who accepts your reader invitation now gets a few optional questions: what they like to read, a chapter or a whole novel, the kind of feedback they give, and whether other writers may ask them too.',
      '**Anyone can sign up to be a beta reader.** There is a link on the welcome page for people who want to read rather than write. Those who say yes appear under Community → Beta readers → Find readers, with what they take on and the feedback they give.'
    ]},
    { v:'2026.07.20.856', date:'October 1, 2026', notes:[""","changelog")
open(P,'w',encoding='utf-8').write(s); print('ok', len(s.encode()))
