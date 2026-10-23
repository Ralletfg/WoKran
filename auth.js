// Anmeldung der Mitarbeiter. Zeigt eine Anmeldemaske über der Seite, bis jemand
// angemeldet ist, und liefert dann { id, name, email }. Im Demo-Modus reicht ein Name.
// Statt einer E-Mail gibt man einen Benutzernamen oder die Personalnummer ein. Supabase
// braucht intern eine E-Mail-Adresse, daher wird daraus eine Kennung gebildet, an die
// nie Post geht ("Confirm email" ist aus). Eine echte E-Mail-Adresse geht weiterhin.
const LOGIN_DOMAIN = "wokran.ralletfg.github.io";
function loginEmail(user) {
  if (user.includes("@")) return user;
  const slug = user.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9._-]+/g, ".").replace(/^\.+|\.+$/g, "");
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
        <p class="muted">${demo ? "Demo-Modus: Name eingeben genügt." : "Mit deinem Benutzernamen oder deiner Personalnummer und deinem Passwort."}</p>
        <label data-for="name" ${demo ? "" : "hidden"}>Vor- und Nachname <input name="name" autocomplete="name"></label>
        <label ${demo ? "hidden" : ""}>Benutzername oder Personalnummer <input name="email" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
        <label ${demo ? "hidden" : ""}>Passwort <input name="password" type="password" autocomplete="current-password" minlength="6"></label>
        <p class="login-error" hidden></p>
        <button type="submit" class="primary">Anmelden</button>
        <button type="button" class="link" ${demo ? "hidden" : ""}>Noch kein Konto? Registrieren</button>
        <button type="button" class="microsoft" ${!demo && window.APP_CONFIG.MICROSOFT_LOGIN ? "" : "hidden"}>Mit Microsoft-Firmenkonto anmelden</button>
      </form>`;
    document.body.append(box);

    const form = box.querySelector("form");
    const errEl = box.querySelector(".login-error");
    const nameRow = box.querySelector('[data-for="name"]');
    const toggle = box.querySelector("button.link");
    const submit = box.querySelector("button[type=submit]");
    let register = demo;

    // Microsoft-Anmeldung: leitet zu Microsoft weiter und kommt mit Sitzung zurück
    box.querySelector("button.microsoft").addEventListener("click", async () => {
      try {
        await store.signInWithMicrosoft();
      } catch (err) {
        showError(translate(err));
      }
    });

    toggle.addEventListener("click", () => {
      register = !register;
      nameRow.hidden = !register;
      form.querySelector("h2").textContent = register ? "Registrieren" : "Anmelden";
      submit.textContent = register ? "Konto anlegen" : "Anmelden";
      toggle.textContent = register ? "Schon ein Konto? Anmelden" : "Noch kein Konto? Registrieren";
      form.password.autocomplete = register ? "new-password" : "current-password";
      errEl.hidden = true;
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errEl.hidden = true;
      const name = form.name.value.trim();
      const email = loginEmail(form.email.value.trim());
      const password = form.password.value;
      if (register && !name) return showError("Bitte deinen Namen eintragen.");
      if (!demo && !email) return showError("Bitte Benutzername oder Personalnummer eintragen.");
      submit.disabled = true;
      try {
        const u = register ? await store.signUp({ email, password, name }) : await store.signIn({ email, password });
        if (!u) return showError("Konto angelegt, aber Supabase verlangt noch eine E-Mail-Bestätigung. Bitte dort \"Confirm email\" ausschalten.");
        box.remove();
        resolve(u);
      } catch (err) {
        showError(translate(err));
      } finally {
        submit.disabled = false;
      }
    });

    function showError(text) {
      errEl.textContent = text;
      errEl.hidden = false;
    }
  });
};

function translate(err) {
  const m = String(err?.message || err);
  if (/invalid login credentials/i.test(m)) return "Benutzername oder Passwort falsch.";
  if (/email not confirmed/i.test(m)) return "Bitte zuerst den Link in der Bestätigungs-E-Mail öffnen.";
  if (/already registered/i.test(m)) return "Diesen Benutzernamen gibt es schon. Bitte anmelden oder einen anderen wählen.";
  if (/password/i.test(m)) return "Das Passwort muss mindestens 6 Zeichen haben.";
  return "Anmeldung fehlgeschlagen: " + m;
}
