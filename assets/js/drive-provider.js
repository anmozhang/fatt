/* ============================================
   DRIVE-PROVIDER.JS - Optional slot for a customer's own data drive
   ============================================
   This file is intentionally empty of logic. It is loaded after storage-adapter.js
   on every page so a customer can connect their own drive by editing only this file.
   While it stays as it is, nothing happens and all data stays in this browser.

   Never commit real keys, tokens or addresses to a public repository.

   Shape of a provider (every method is optional, may be async):

   StorageAdapter.registerProvider({
     name: 'My Drive',
     save(key, record) { },        // key 'session_<id>', record { data, updatedAt }
     remove(key, deletedAt) { },   // an inspection was deleted at that time (ms). Keep a
                                   // record of the deletion; a missing file is not enough
     saveImage(key, dataUrl) { },  // key '<sessionId>_<photoId>'
     removeImage(key) { },
     pull() { return { sessions: {}, images: {}, deleted: {} }; } // called when the landing page opens
                                   // deleted: { 'session_<id>': deletedAt }
   });

   Whichever happened last wins: deleted after the last edit = removed everywhere;
   edited after a delete = it comes back. (Devices should have roughly correct clocks.)

   The browser copy is always kept; a failing provider never blocks saving.
   Failures are reported to StorageAdapter.onProviderError(op, error).
   ============================================ */
