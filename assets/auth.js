/* Shared Google Sign-In helper (GIS ID-token flow).
   The client only ever receives a Google credential; /api/auth/google verifies
   it against Google's JWKS and sets the HttpOnly session cookie. */
(function () {
  "use strict";

  var configPromise = null;
  var gisPromise = null;
  var clientId = "";

  function getConfig() {
    if (!configPromise) {
      configPromise = fetch("/api/auth/config", { cache: "no-store" })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          clientId = (d && d.google_client_id) || "";
          return clientId;
        })
        .catch(function () {
          clientId = "";
          return "";
        });
    }
    return configPromise;
  }

  function loadGis() {
    if (gisPromise) return gisPromise;
    gisPromise = new Promise(function (resolve, reject) {
      if (window.google && google.accounts && google.accounts.id) return resolve();
      var s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Google Sign-In could not load. Check your connection and refresh.")); };
      document.head.appendChild(s);
    });
    return gisPromise;
  }

  function session() {
    return fetch("/api/auth/session", { cache: "no-store" })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) { return d && d.ok === true ? d : { ok: false, account: null, orders: [] }; })
      .catch(function () { return { ok: false, account: null, orders: [] }; });
  }

  function signIn(container, options) {
    options = options || {};
    return getConfig().then(function (id) {
      if (!id) throw new Error("Google sign-in is not configured yet.");
      return loadGis().then(function () {
        return new Promise(function (resolve, reject) {
          var settled = false;
          function fail(message) {
            if (settled) return;
            settled = true;
            reject(new Error(message));
          }
          if (!window.google || !google.accounts || !google.accounts.id) {
            return fail("Google Sign-In is unavailable in this browser.");
          }
          google.accounts.id.initialize({
            client_id: id,
            callback: function (res) {
              if (!res || !res.credential) return fail("Sign-in was cancelled.");
              fetch("/api/auth/google", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ credential: res.credential }),
              })
                .then(function (r) { return r.json().catch(function () { return {}; }); })
                .then(function (d) {
                  if (!d || d.ok !== true || !d.account) {
                    return fail((d && d.error) || "Sign-in could not be verified. Try again.");
                  }
                  if (settled) return;
                  settled = true;
                  resolve(d.account);
                })
                .catch(function () { fail("Could not reach the server. Check your connection and retry."); });
            },
            auto_select: false,
            cancel_on_tap_outside: true,
            use_fedcm_for_prompt: true,
          });
          google.accounts.id.renderButton(
            container,
            Object.assign(
              {
                type: "standard",
                theme: "outline",
                size: "large",
                text: "signin_with",
                shape: "rectangular",
                logo_alignment: "left",
                width: 280,
              },
              options.button || {}
            )
          );
        });
      });
    });
  }

  function logout() {
    return fetch("/api/auth/logout", { method: "POST" })
      .catch(function () {})
      .then(function () { return session(); });
  }

  window.AIBundleAuth = { session: session, signIn: signIn, logout: logout, configured: getConfig };
})();
