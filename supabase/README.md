# Gym sync setup

1. Run `gym-storage.sql` in the existing Supabase project's SQL Editor.
2. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `index.html` to the project's URL and publishable/public anon key. Never use a secret or service-role key.
3. Publish the updated app to the same URL used on iPhone and PC.
4. On the device containing previous local gym entries, open Gym and press Save Day to upload the migrated data. Other devices load the cloud copy on opening, returning to the app, or within 10 seconds while visible.

The table is a shared personal planner, matching the existing unauthenticated MassTracker setup. Anyone with this app's public connection details can access this shared dataset; this is not per-user account storage.

Save Day commits the entire planner, including dates, exercise names/order, deletions, and reps/weights, in one conditional update. A revision check prevents stale devices overwriting newer saves. On a conflict, the app automatically refreshes and merges the newest cloud snapshot with the local draft. Unedited fields follow the cloud; local edits remain unsaved until Save Day is pressed again. If both devices changed the same field, the local draft value is retained and the refresh message tells the user that saving will apply their edits. Local drafts are cached for recovery but are not presented as cloud-saved. Existing v1/v2 keys are retained during migration.

Fresh devices load cloud data automatically. If an older device has a separate local planner while the cloud already has data, it merges that planner into a local draft without overwriting the cloud. Background refresh also runs on focus, visibility changes, and reconnection. The manual Reload cloud button has been removed.
