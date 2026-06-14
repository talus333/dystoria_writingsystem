# Dystoria — Story Sharing (Step 1 of 2)

Two writers can now share a story through their Dystoria accounts. This first step
delivers **async sharing**: both writers can open, edit, and save the *same* cloud
story, the owner controls who's invited, and saves merge by most-recent. The **live
simultaneous** layer (presence, the planning baton, per-timeframe writing locks) is
the next step — see the bottom of this file.

## What you must do once (Supabase dashboard)

1. Open your project → **SQL Editor** → **New query**.
2. Paste the entire contents of `sharing_migration.sql` and press **Run**.
   - It's safe to re-run; every statement is guarded.
   - It adds: a private `profiles` email map, a `story_collaborators` table, a
     `planning_baton` column on `stories`, the row-level security that lets a
     collaborator read/write a shared story, and `share_story()` / `unshare_story()`.
3. Commit & push `index.html` (GitHub Desktop) so dystoria.net picks up the client changes.

## How sharing works for writers

- **Owner:** open **Archives**, find a story you own that's saved to the cloud, click
  **Share**, and enter the other writer's Dystoria account email. They must already
  have signed up. (Inviting resolves the email to their account server-side, so emails
  are never exposed to other users.)
- **Collaborator:** on their next sign-in, the shared story appears in their Archives
  tagged **"shared with you."** They open it and can edit and save like any story.
- Ownership never transfers — a collaborator's save updates the shared story without
  taking it over.

## Two-account test checklist

1. Account A (owner): sign in, create/open a story, save it (wait for **"Saved to cloud"**).
2. Account A: Archives → **Share** → enter Account B's email → expect
   *"Shared with … — it appears in their library on next sign-in."*
   - Wrong/unknown email should say *"No Dystoria account uses that email yet."*
3. Account B (incognito or other device): sign in → expect **"Cloud stories synced"**
   and the story in Archives marked **"shared with you."** Open it — map and prose load.
4. Account B: edit and save. Reload Account A and re-open from Archives — B's changes
   are present (last save wins for now).
5. In Supabase **Table Editor → story_collaborators** you should see one row linking
   the story to Account B.

## Next step — live co-editing (not in this build)

The migration already lays the groundwork (the `planning_baton` column and Realtime is
enabled on `stories`). The remaining client work, to build next:

- **Per-timeframe prose** — store each timeframe's text on its frame so two writers can
  hold different timeframes at once (you chose this model).
- **Realtime presence** — show who else is in the story and which timeframe they're on.
- **Planning baton** — only the holder (owner by default) edits the mindmap; a
  *Request* button asks for it, the holder grants/passes it.
- **Per-timeframe writing lock** — you can't start writing a timeframe another writer
  is currently writing.

This layer needs live testing with two accounts, so it's best built and verified as its
own pass.
