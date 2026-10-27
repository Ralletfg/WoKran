// Anmeldung der Mitarbeiter. Zeigt eine Anmeldemaske über der Seite, bis jemand
// angemeldet ist, und liefert dann { id, name, email }. Im Demo-Modus reicht ein Name.
// Angemeldet wird mit Benutzername und Passwort. Den Benutzernamen bildet die App beim
// Registrieren selbst: erster Buchstabe des Vornamens + die ersten 4 des Nachnamens
// (Max Muster → mmust). Supabase braucht intern eine E-Mail-Adresse, daher wird daraus
// eine Kennung gebildet, an die nie Post geht ("Confirm email" ist aus).
const LOGIN_DOMAIN = "wokran.ralletfg.github.io";

const plain = (s) => s.toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .normalize("NFD").replace(/[̀-ͯ]/g, "");

function makeUsername(first, last) {
  const f = plain(first).replace(/[^a-z]/g, "");
  const l = plain(last).replace(/[^a-z]/g, "");
  return f.slice(0, 1) + l.slice(0, 4);
}

function loginEmail(user) {
  if (user.includes("@")) return user;
  const slug = plain(user).replace(/[^a-z0-9._-]+/g, ".").replace(/^\.+|\.+$/g, "");
  return slug && `${slug}@${LOGIN_DOMAIN}`;
}

window.requireLogin = function (store) {
  return new Promise(async (resolve) => {
    const user = await store.currentUser();
    if (user) return resolve(user);

    const demo = store.mode === "demo";
    const box = document.createElement("div");
    box.className = "login";
    box.innerHTML = `
      <form class="login-card">
        <h2>Anmelden</h2>
        <p class="muted intro">Mit deinem Benutzernamen und deinem Passwort.</p>
        <label data-reg>Vorname <input name="first" autocomplete="given-name"></label>
        <label data-reg>Nachname <input name="last" autocomplete="family-name"></label>
        <p class="muted" data-reg data-preview></p>
        <label data-login>Benutzername <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
        <label data-pw>Passwort <input name="password" type="password" autocomplete="current-password" minlength="6"></label>
        <p class="login-error" hidden></p>
        <button type="submit" class="primary">Anmelden</button>
        <button type="button" class="link">Noch kein Konto? Registrieren</button>
        <button type="button" class="microsoft">Mit Microsoft-Firmenkonto anmelden</button>
      </form>`;
    document.body.append(box);

    const form = box.querySelector("form");
    const errEl = box.querySelector(".login-error");
    const preview = box.querySelector("[data-preview]");
    const toggle = box.querySelector("button.link");
    const submit = box.querySelector("button[type=submit]");
    const msBtn = box.querySelector("button.microsoft");
    let register = false;

    function setMode(reg) {
      register = reg;
      box.querySelectorAll("[data-reg]").forEach((el) => (el.hidden = !reg));
      box.querySelectorAll("[data-login]").forEach((el) => (el.hidden = reg || demo));
      box.querySelector("[data-pw]").hidden = demo;
      toggle.hidden = demo;
      msBtn.hidden = demo || !window.APP_CONFIG.MICROSOFT_LOGIN;
      box.querySelector(".intro").textContent = demo
        ? "Demo-Modus: Name eingeben genügt."
        : reg
          ? "Gib deinen Namen ein. Den Benutzernamen erzeugt die App daraus."
          : "Mit deinem Benutzernamen und deinem Passwort.";
      form.querySelector("h2").textContent = reg && !demo ? "Registrieren" : "Anmelden";
      submit.textContent = reg && !demo ? "Konto anlegen" : "Anmelden";
      toggle.textContent = reg ? "Schon ein Konto? Anmelden" : "Noch kein Konto? Registrieren";
      form.password.autocomplete = reg ? "new-password" : "current-password";
      errEl.hidden = true;
      updatePreview();
    }

    function updatePreview() {
      const u = makeUsername(form.first.value, form.last.value);
      preview.textContent = demo || !u ? "" : `Dein Benutzername: ${u}`;
    }
    form.first.addEventListener("input", updatePreview);
    form.last.addEventListener("input", updatePreview);
    toggle.addEventListener("click", () => setMode(!register));
    setMode(demo);

    // Microsoft-Anmeldung: leitet zu Microsoft weiter und kommt mit Sitzung zurück
    msBtn.addEventListener("click", async () => {
      try {
        await store.signInWithMicrosoft();
      } catch (err) {
        showError(translate(err));
      }
    });

    // Gibt es den Benutzernamen schon, wird eine Zahl angehängt (mmust2, mmust3, …)
    async function registerAccount(first, last, password) {
      const name = `${first} ${last}`;
      const base = makeUsername(first, last);
      for (let i = 1; i <= 20; i++) {
        const username = i === 1 ? base : base + i;
        try {
          const u = await store.signUp({ email: loginEmail(username), password, name });
          return { u, username };
        } catch (err) {
          if (!/already registered/i.test(String(err?.message))) throw err;
        }
      }
      throw new Error("Kein freier Benutzername gefunden.");
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errEl.hidden = true;
      const first = form.first.value.trim();
      const last = form.last.value.trim();
      const password = form.password.value;
      if (register && (!first || !last)) return showError("Bitte Vor- und Nachnamen eintragen.");
      submit.disabled = true;
      try {
        if (demo) return done(await store.signUp({ name: `${first} ${last}` }));
        if (register) {
          if (!makeUsername(first, last)) return showError("Bitte den Namen mit Buchstaben eintragen.");
          const { u, username } = await registerAccount(first, last, password);
          if (!u) return showError("Konto angelegt, aber Supabase verlangt noch eine E-Mail-Bestätigung. Bitte dort \"Confirm email\" ausschalten.");
          return showUsername(u, username);
        }
        const email = loginEmail(form.username.value.trim());
        if (!email) return showError("Bitte deinen Benutzernamen eintragen.");
        done(await store.signIn({ email, password }));
      } catch (err) {
        showError(translate(err));
      } finally {
        submit.disabled = false;
      }
    });

    // Nach dem Registrieren den Benutzernamen deutlich zeigen, damit man ihn sich merkt
    function showUsername(u, username) {
      const card = document.createElement("div");
      card.className = "login-card";
      card.innerHTML = `
        <h2>Konto angelegt</h2>
        <p>Dein Benutzername für die Anmeldung:</p>
        <p class="username"></p>
        <p class="muted">Bitte merken oder notieren. Du bleibst auf diesem Gerät angemeldet.</p>
        <button type="button" class="primary">Weiter</button>`;
      card.querySelector(".username").textContent = username;
      card.querySelector("button").addEventListener("click", () => done(u));
      form.replaceWith(card);
    }

    function done(u) {
      box.remove();
      resolve(u);
    }

    function showError(text) {
      errEl.textContent = text;
      errEl.hidden = false;
    }
  });
};

function translate(err) {
  const m = String(err?.message || err);
  if (/invalid login credentials/i.test(m)) return "Benutzername oder Passwort falsch.";
  if (/banned/i.test(m)) return "Dein Konto ist gesperrt. Bitte wende dich an einen Admin.";
  if (/email not confirmed/i.test(m)) return "Bitte zuerst den Link in der Bestätigungs-E-Mail öffnen.";
  if (/password/i.test(m)) return "Das Passwort muss mindestens 6 Zeichen haben.";
  return "Anmeldung fehlgeschlagen: " + m;
}
