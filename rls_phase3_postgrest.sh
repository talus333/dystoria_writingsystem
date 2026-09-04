#!/usr/bin/env bash
# =====================================================================================
#  Dystoria — RLS Phase 3: the same attacks, through PostgREST, with the publishable key
#  2026-09-03.
#
#  WHY THIS IS A SEPARATE PHASE FROM 2. Phase 2 impersonates inside the database, where the
#  policies are the only thing standing between a query and a row. Phase 3 goes in the way an
#  attacker actually would: the anon key is in the client bundle, PostgREST is a public endpoint,
#  and everything between — grants, exposed schemas, RPC security, the `Prefer` headers — is not
#  covered by a policy test at all. A policy can be perfect and a table still readable because
#  `anon` was granted SELECT on it and no policy exists to constrain the grant.
#
#  WHAT YOU NEED
#    SUPABASE_URL   https://<project>.supabase.co
#    ANON_KEY       the publishable / anon key (safe to hold; it is already in the client)
#    USER_JWT       a signed-in user's access_token  (optional but strongly recommended)
#    OTHER_STORY_ID a story UUID belonging to a DIFFERENT account (optional; the cross-account
#                   read is the sharpest test and needs a row the token's owner may not see)
#  NEVER put the service_role key in here. If a probe passes only with the service key, it has
#  proved nothing about what the public endpoint allows.
#
#  HOW TO GET USER_JWT: sign in to the app, open the console, and read
#      (await supabase.auth.getSession()).data.session.access_token
#  It expires in an hour, which is fine — this takes seconds.
#
#  USAGE
#    SUPABASE_URL=... ANON_KEY=... USER_JWT=... ./rls_phase3_postgrest.sh
#
#  READING THE RESULT: every line is PASS or FAIL. Nothing here writes anything that is meant to
#  succeed — every write below is an attack that must be refused.
# =====================================================================================
set -u

: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${ANON_KEY:?set ANON_KEY}"
USER_JWT="${USER_JWT:-}"
OTHER_STORY_ID="${OTHER_STORY_ID:-}"

REST="$SUPABASE_URL/rest/v1"
pass=0; fail=0; note=0

say_pass(){ printf '  PASS  %s\n' "$1"; pass=$((pass+1)); }
say_fail(){ printf '  FAIL  %s\n' "$1"; fail=$((fail+1)); }
say_note(){ printf '  NOTE  %s\n' "$1"; note=$((note+1)); }

# body + status in one call
req(){ # req METHOD PATH TOKEN [DATA]
  local m="$1" p="$2" tok="$3" data="${4:-}"
  : > /tmp/_b                       # so a failed connection reads as empty, never as stale
  local args=(-s -o /tmp/_b -w '%{http_code}' --connect-timeout 12 --max-time 40 -X "$m" "$REST/$p"
              -H "apikey: $ANON_KEY" -H "Authorization: Bearer $tok")
  # Prefer goes on EVERY write, not only those with a body: PostgREST answers a DELETE with 204
  # whether it removed nothing or removed everything, and a probe that cannot tell those apart
  # reports a pass.
  [ "$m" != "GET" ] && [ "$m" != "HEAD" ] && args+=(-H 'Prefer: return=representation')
  if [ -n "$data" ]; then args+=(-H 'Content-Type: application/json' -d "$data"); fi
  curl "${args[@]}"
}
rows(){ # how many JSON objects came back (0 for an error object or an empty array)
  python3 - <<'PY' 2>/dev/null || echo -1
import json,sys
try:
    d=json.load(open('/tmp/_b'))
    print(len(d) if isinstance(d,list) else 0)
except Exception:
    print(0)
PY
}
body(){ head -c 300 /tmp/_b 2>/dev/null; }
# curl writes 000 when it never reached the server; that is an inconclusive run, never a pass
unreachable(){ [ "$1" = "000" ]; }

echo "===================================================================="
echo " Phase 3 · PostgREST at $SUPABASE_URL"
echo " user token: $([ -n "$USER_JWT" ] && echo present || echo 'ABSENT — the signed-in half will be skipped')"
echo "===================================================================="

# ---------------------------------------------------------------- ANONYMOUS -----------------
echo
echo "-- anonymous (publishable key only, no user) ------------------------"
for t in stories profiles subscriptions story_collaborators ai_usage story_comments story_impressions feedback; do
  code=$(req GET "$t?select=*&limit=5" "$ANON_KEY")
  n=$(rows)
  if unreachable "$code"; then
    say_note "$t — could not reach the server (check SUPABASE_URL and your network)"
  elif [ "$code" = "200" ] && [ "$n" = "0" ]; then
    say_pass "$t — 200 with an empty array (RLS returns nothing to anon)"
  elif [ "$code" = "401" ] || [ "$code" = "403" ] || [ "$code" = "404" ]; then
    say_pass "$t — refused outright ($code)"
  elif [ "$code" = "200" ]; then
    say_fail "$t — ANON READ $n ROWS. $(body)"
  else
    say_note "$t — unexpected $code: $(body)"
  fi
done

# `Prefer: return=representation` means a real insert comes back as the row it created, so a 2xx
# with nothing in it created nothing. Counting the status alone was a false FAIL waiting to happen.
code=$(req POST "subscriptions" "$ANON_KEY" '{"user_id":"00000000-0000-0000-0000-000000000000","plan":"pro","status":"active"}')
n=$(rows)
if unreachable "$code"; then say_note "anon subscription insert — server unreachable"
elif { [ "$code" = "200" ] || [ "$code" = "201" ]; } && [ "$n" != "0" ]; then say_fail "anon INSERTED a subscription ($code) — THE PAID GATE IS OPEN. $(body)"
else say_pass "anon cannot insert a subscription ($code, $n rows)"; fi

code=$(req PATCH "subscriptions?user_id=neq.00000000-0000-0000-0000-000000000000" "$ANON_KEY" '{"plan":"pro"}')
n=$(rows)
if unreachable "$code"; then say_note "anon subscription patch — server unreachable"
elif { [ "$code" = "200" ] || [ "$code" = "204" ]; } && [ "$n" != "0" ]; then
  say_fail "anon PATCHED $n subscription rows — THE PAID GATE IS OPEN"
else say_pass "anon cannot patch subscriptions ($code, $n rows)"; fi

code=$(req DELETE "stories?id=neq.00000000-0000-0000-0000-000000000000" "$ANON_KEY")
n=$(rows)
if unreachable "$code"; then say_note "anon story delete — server unreachable"
elif { [ "$code" = "200" ] || [ "$code" = "204" ]; } && [ "$n" != "0" ]; then
  say_fail "anon DELETED $n stories"
else say_pass "anon cannot delete stories ($code)"; fi

# ---------------------------------------------------------------- SIGNED IN -----------------
if [ -n "$USER_JWT" ]; then
  echo
  echo "-- signed in as a real user -----------------------------------------"

  code=$(req GET "stories?select=id,owner&limit=50" "$USER_JWT"); mine=$(rows)
  if [ "$code" = "200" ]; then say_pass "user reads their own stories ($mine rows)"
  else say_fail "user cannot read their own stories ($code): $(body)"; fi

  # every row that comes back must be theirs or shared with them — PostgREST will happily
  # return whatever the policy allows, so count the ones that are neither
  code=$(req GET "stories?select=id,owner&limit=200" "$USER_JWT")
  strangers=$(python3 - "$USER_JWT" <<'PY' 2>/dev/null || echo -1
import json,sys,base64
tok=sys.argv[1].split('.')
def dec(s): return json.loads(base64.urlsafe_b64decode(s + '='*(-len(s)%4)))
uid=dec(tok[1]).get('sub')
try: d=json.load(open('/tmp/_b'))
except Exception: d=[]
print(sum(1 for r in d if isinstance(r,dict) and r.get('owner') != uid))
PY
)
  if [ "$strangers" = "0" ]; then
    say_pass "every story the user can read is their own (collaborations, if any, will show here as not-owned — check them by hand)"
  else
    say_note "$strangers of the readable stories are owned by someone else — confirm each is a story genuinely shared with this user"
  fi

  code=$(req GET "profiles?select=id,email&limit=50" "$USER_JWT"); n=$(rows)
  if [ "$n" = "1" ] || [ "$n" = "0" ]; then say_pass "user reads at most their own profile row ($n)"
  else say_fail "user reads $n profile rows — that is the email list"; fi

  code=$(req GET "subscriptions?select=*&limit=50" "$USER_JWT"); n=$(rows)
  if [ "$n" -le 1 ] 2>/dev/null; then say_pass "user reads at most their own subscription ($n)"
  else say_fail "user reads $n subscription rows"; fi

  code=$(req PATCH "subscriptions?plan=eq.free" "$USER_JWT" '{"plan":"pro","status":"active"}'); n=$(rows)
  if unreachable "$code"; then say_note "user self-upgrade probe — server unreachable"
  elif { [ "$code" = "200" ] || [ "$code" = "204" ]; } && [ "$n" != "0" ]; then
    say_fail "user UPGRADED THEMSELVES to pro via PostgREST ($n rows) — THE PAID GATE IS OPEN"
  else say_pass "user cannot upgrade themselves ($code, $n rows)"; fi

  code=$(req POST "subscriptions" "$USER_JWT" '{"plan":"pro","status":"active"}'); n=$(rows)
  if unreachable "$code"; then say_note "user subscription insert — server unreachable"
  elif { [ "$code" = "200" ] || [ "$code" = "201" ]; } && [ "$n" != "0" ]; then say_fail "user INSERTED a subscription ($code) — THE PAID GATE IS OPEN"
  else say_pass "user cannot insert a subscription ($code, $n rows)"; fi

  code=$(req GET "ai_usage?select=user_id&limit=200" "$USER_JWT")
  others=$(python3 - "$USER_JWT" <<'PY' 2>/dev/null || echo -1
import json,sys,base64
tok=sys.argv[1].split('.')
def dec(s): return json.loads(base64.urlsafe_b64decode(s + '='*(-len(s)%4)))
uid=dec(tok[1]).get('sub')
try: d=json.load(open('/tmp/_b'))
except Exception: d=[]
print(sum(1 for r in d if isinstance(r,dict) and r.get('user_id') != uid))
PY
)
  if [ "$others" = "0" ]; then say_pass "user reads no one else's ai_usage"
  else say_fail "user reads $others ai_usage rows belonging to other people"; fi

  if [ -n "$OTHER_STORY_ID" ]; then
    code=$(req GET "stories?id=eq.$OTHER_STORY_ID&select=id" "$USER_JWT"); n=$(rows)
    if [ "$n" = "0" ]; then say_pass "user cannot read a story belonging to another account"
    else say_fail "user READ another account's story ($n rows)"; fi

    code=$(req PATCH "stories?id=eq.$OTHER_STORY_ID" "$USER_JWT" '{"planning_baton":null}'); n=$(rows)
    if [ "$n" = "0" ]; then say_pass "user cannot patch another account's story"
    else say_fail "user PATCHED another account's story ($n rows)"; fi

    code=$(req DELETE "stories?id=eq.$OTHER_STORY_ID" "$USER_JWT"); n=$(rows)
    if [ "$n" = "0" ]; then say_pass "user cannot delete another account's story"
    else say_fail "user DELETED another account's story ($n rows)"; fi
  else
    say_note "OTHER_STORY_ID not set — the cross-account read/patch/delete probes were skipped, and they are the sharpest ones"
  fi
else
  echo
  say_note "USER_JWT not set — only the anonymous half ran"
fi

# ---------------------------------------------------------------- the open question ----------
echo
echo "-- the revoke question (roadmap, still open) ------------------------"
echo "  set_story_public(sid,false) clears is_public but leaves public_token live."
echo "  To settle it: unshare a test story in the app, then fetch its old public link."
echo "  If the page still opens, the token is a stable link by design and should be documented"
echo "  as one; if it should not open, set_story_public needs 'public_token = null' on revoke."

echo
echo "===================================================================="
printf ' RESULT   %d passed, %d failed, %d to check by hand\n' "$pass" "$fail" "$note"
[ "$fail" -gt 0 ] && echo " Phase 3 has NOT passed."
echo "===================================================================="
exit $([ "$fail" -gt 0 ] && echo 1 || echo 0)
