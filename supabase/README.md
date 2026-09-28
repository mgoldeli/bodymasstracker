# Gym sync setup

1. Run `gym-storage.sql` in the existing Supabase project's SQL Editor.
2. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `index.html` to the project's URL and publishable/public anon key. Never use a secret or service-role key.
3. Publish the updated app to the same URL used on iPhone and PC.
4. On the device containing previous local gym entries, open Gym and press Save Day to upload the migrated data. Other devices load the cloud copy on opening, returning to the app, or within 30 seconds while visible.

The table is a shared personal planner, matching the existing unauthenticated MassTracker setup. Anyone with this app's public connection details can access this shared dataset; this is not per-user account storage.

Save Day commits the entire planner, including dates, exercise names/order, deletions, and reps/weights, in one conditional update. A revision check prevents stale devices overwriting newer saves. On a conflict, the UI keeps the local draft and offers Reload cloud with confirmation before discarding edits. Local drafts are cached for recovery but are not presented as cloud-saved. Existing v1/v2 keys are retained during migration.

Fresh devices load cloud data automatically. If an older device has a separate local planner while the cloud already has data, it keeps that local draft and asks the user to reload the cloud version instead of overwriting either copy silently.
