import { useState, useEffect, useRef } from "react";
import {
  Search, Plus, X, Clock, ShoppingCart, ChefHat, Trash2, Check,
  EyeOff, Eye, Sun, Moon, Pencil, Repeat, RotateCcw, LogOut, Mail, Lock,
  Home, Utensils, Users, ListChecks, ChevronLeft, ChevronRight,
} from "lucide-react";
import { auth, db } from "./firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { doc, onSnapshot, setDoc, updateDoc, deleteField } from "firebase/firestore";

const UNITS = ["g", "kg", "ml", "l", "pièce(s)", "c. à soupe", "c. à café", "pincée"];
const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const JOURS_COURTS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

// Icône automatique selon le nom du plat (pas de photo à stocker)
const EMOJI_RULES = [
  [["pizza"], "🍕"],
  [["apéro", "apero", "apéritif", "aperitif", "dinatoire"], "🍺"],
  [["barbecue", "bbq", "grillade", "grillades"], "🍖"],
  [["kebab", "pita"], "🥙"],
  [["quiche"], "🥧"],
  [["moules", "huître", "huitre", "fruits de mer"], "🦪"],
  [["chili"], "🌶️"],
  [["pâtes", "pasta", "spaghetti", "tagliatelle", "lasagne", "nouille"], "🍝"],
  [["poulet", "volaille", "dinde", "canard"], "🍗"],
  [["boeuf", "bœuf", "steak", "viande", "entrecote", "entrecôte", "agneau", "porc"], "🥩"],
  [["poisson", "saumon", "thon", "cabillaud", "crevette"], "🐟"],
  [["salade"], "🥗"],
  [["soupe", "velouté", "veloute", "potage"], "🍲"],
  [["riz", "risotto"], "🍚"],
  [["gâteau", "gateau", "dessert", "tarte", "crumble", "cookie"], "🍰"],
  [["burger", "hamburger"], "🍔"],
  [["oeuf", "œuf", "omelette"], "🍳"],
  [["sandwich", "panini", "wrap"], "🥪"],
  [["curry"], "🍛"],
  [["taco", "burrito", "mexicain"], "🌮"],
  [["sushi"], "🍣"],
  [["fromage", "raclette", "fondue"], "🧀"],
  [["pain", "brioche"], "🍞"],
  [["légume", "legume", "gratin"], "🥦"],
  [["crêpe", "crepe", "galette"], "🥞"],
];
function getRecipeEmoji(name) {
  const n = (name || "").toLowerCase();
  for (const [keywords, emoji] of EMOJI_RULES) {
    if (keywords.some((k) => n.includes(k))) return emoji;
  }
  return "🍽️";
}

function fmtKey(d) {
  return d.toISOString().slice(0, 10);
}
function todayKey() {
  return fmtKey(new Date());
}
function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}
function daysSince(dateKey) {
  if (!dateKey) return null;
  const then = new Date(dateKey + "T00:00:00");
  const now = new Date(todayKey() + "T00:00:00");
  return Math.round((now - then) / 86400000);
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function normalizeSlot(s) {
  if (!s) return { hidden: false, recipeIds: [] };
  return { hidden: !!s.hidden, recipeIds: s.recipeIds || (s.recipeId ? [s.recipeId] : []) };
}
function getEffectiveSlot(dateKey, weekday, meal, planning, routine) {
  const override = planning[dateKey]?.[meal];
  if (override !== undefined) return normalizeSlot(override);
  return normalizeSlot(routine[weekday]?.[meal]);
}
function traduireErreur(code) {
  const map = {
    "auth/invalid-email": "Adresse email invalide.",
    "auth/user-not-found": "Aucun compte avec cet email.",
    "auth/wrong-password": "Mot de passe incorrect.",
    "auth/invalid-credential": "Email ou mot de passe incorrect.",
    "auth/email-already-in-use": "Un compte existe déjà avec cet email.",
    "auth/weak-password": "Mot de passe trop court (6 caractères min.).",
  };
  return map[code] || "Une erreur est survenue, réessayez.";
}

const GARDE_OPTIONS = [
  { id: "duarte", label: "Duarte", color: "#DA291C" },
  { id: "bernadou", label: "Bernadou", color: "#0055A4" },
  { id: "maison", label: "Maison", color: "#EC7FB0" },
  { id: "centre", label: "Centre", color: "#F5C518" },
];
const HOLIDAY_PERIODS = [
  { label: "Toussaint", start: "2026-10-17", end: "2026-11-02" },
  { label: "Noël", start: "2026-12-19", end: "2027-01-04" },
  { label: "Hiver", start: "2027-02-13", end: "2027-03-01" },
  { label: "Printemps", start: "2027-04-10", end: "2027-04-26" },
  { label: "Été", start: "2027-07-03", end: "2027-08-31" },
];
function isSchoolHoliday(dateKey) {
  return HOLIDAY_PERIODS.some((p) => dateKey >= p.start && dateKey <= p.end);
}
const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const JOURS_SEMAINE_COURT = ["L", "M", "M", "J", "V", "S", "D"];
function cycleGarde(current) {
  const ids = GARDE_OPTIONS.map((o) => o.id);
  if (!current) return ids[0];
  const idx = ids.indexOf(current);
  if (idx === -1 || idx === ids.length - 1) return null;
  return ids[idx + 1];
}

const emptyRecipe = () => ({
  id: uid(),
  name: "",
  link: "",
  lastCooked: null,
  ingredients: [{ id: uid(), name: "", qty: "1", unit: "pièce(s)" }],
});

// --- Racine : gère l'état de connexion ---
export default function App() {
  const [user, setUser] = useState(undefined); // undefined = vérification en cours, null = déconnecté

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);

  if (user === undefined) {
    return (
      <div style={S.loadingWrap}>
        <Home size={28} color="#8AA593" />
        <p style={{ color: "#8A8A82", fontSize: 14, marginTop: 8 }}>Chargement…</p>
      </div>
    );
  }
  if (!user) return <LoginScreen />;
  return <MealApp user={user} />;
}

function LoginScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await signInWithEmailAndPassword(auth, email, password);
      else await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(traduireErreur(err.code));
    }
    setBusy(false);
  }

  return (
    <div style={S.app}>
      <style>{`
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        input, button { font-family: inherit; }
        button { cursor: pointer; }
        ::placeholder { color: #B8B6AC; }
      `}</style>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <Home size={32} color="#4E6B57" />
          <p style={{ fontSize: 19, fontWeight: 600, color: "#2B2B26", marginTop: 8 }}>Lar Duarte</p>
          <p style={{ fontSize: 13, color: "#9B998F", marginTop: 4 }}>
            {mode === "login" ? "Connectez-vous pour retrouver votre espace famille" : "Créez votre compte"}
          </p>
        </div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={S.searchBox}>
            <Mail size={16} color="#9B998F" />
            <input style={S.searchInput} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div style={S.searchBox}>
            <Lock size={16} color="#9B998F" />
            <input
              style={S.searchInput}
              type="password"
              placeholder="Mot de passe (6 caractères min.)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          {error && <p style={{ color: "#B85C4A", fontSize: 12.5, margin: 0 }}>{error}</p>}
          <button type="submit" style={S.primaryBtn} disabled={busy}>
            {busy ? "…" : mode === "login" ? "Se connecter" : "Créer mon compte"}
          </button>
        </form>
        <button style={{ ...S.linkBtn, justifyContent: "center", marginTop: 14, width: "100%" }} onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Pas encore de compte ? Créez-en un" : "Déjà un compte ? Connectez-vous"}
        </button>
      </div>
    </div>
  );
}

// --- Application (une fois connecté) ---
function MealApp({ user }) {
  const [recipes, setRecipes] = useState(null);
  const [planning, setPlanning] = useState(null);
  const [routine, setRoutine] = useState(null);
  const [bought, setBought] = useState(null);
  const [assignedTo, setAssignedTo] = useState(null);
  const [extraItems, setExtraItems] = useState(null);
  const [garde, setGarde] = useState(null);
  const [todos, setTodos] = useState(null);
  const [tab, setTab] = useState("repas");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [routineOpen, setRoutineOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Force un nouveau calcul de la liste de courses chaque minute, pour que les articles
  // achetés depuis plus de 24h réapparaissent tout seuls même si rien d'autre ne change.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);
  const autoUpdateDone = useRef(false);

  // Synchronisation en temps réel avec Firestore (fonctionne depuis n'importe quel appareil connecté au même compte)
  useEffect(() => {
    const ref = doc(db, "mealApp", user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.exists() ? snap.data() : {};
      const r = data.recipes || [];
      const p = data.planning || {};
      const rt = data.routine || {};
      const bt = data.bought || {};
      const at = data.assignedTo || {};
      const ex = data.extraItems || [];
      const gd = data.garde || {};
      const td = data.todos || [];

      if (!autoUpdateDone.current) {
        autoUpdateDone.current = true;
        const today = todayKey();
        let changed = false;
        const byId = {};
        r.forEach((rec) => (byId[rec.id] = rec));
        Object.keys(p).forEach((dateKey) => {
          if (dateKey >= today) return;
          const weekday = new Date(dateKey + "T00:00:00").getDay();
          ["midi", "soir"].forEach((meal) => {
            const slot = getEffectiveSlot(dateKey, weekday, meal, p, rt);
            if (slot.hidden) return;
            slot.recipeIds.forEach((id) => {
              const rec = byId[id];
              if (rec && (!rec.lastCooked || rec.lastCooked < dateKey)) {
                rec.lastCooked = dateKey;
                changed = true;
              }
            });
          });
        });
        if (changed) setDoc(ref, { recipes: r }, { merge: true }).catch(() => {});
      }

      setRecipes(r);
      setPlanning(p);
      setRoutine(rt);
      setBought(bt);
      setAssignedTo(at);
      setExtraItems(ex);
      setGarde(gd);
      setTodos(td);
      setLoaded(true);
    });
    return unsub;
  }, [user.uid]);

  function save(field, value) {
    setDoc(doc(db, "mealApp", user.uid), { [field]: value }, { merge: true }).catch(() => {});
  }
  // setDoc({merge:true}) fusionne les objets imbriqués en profondeur : une clé simplement
  // omise n'est jamais réellement supprimée côté serveur. Pour effacer une valeur (ex :
  // une couleur de garde, un "acheté"), il faut cibler précisément ce chemin avec deleteField().
  function deleteNestedField(path) {
    updateDoc(doc(db, "mealApp", user.uid), { [path]: deleteField() }).catch(() => {});
  }

  function saveRecipes(r) {
    setRecipes(r);
    save("recipes", r);
  }
  function savePlanning(p) {
    setPlanning(p);
    save("planning", p);
  }
  function saveRoutine(rt) {
    setRoutine(rt);
    save("routine", rt);
  }
  function saveBought(bt) {
    setBought(bt);
    save("bought", bt);
  }
  function toggleBought(itemKey, isCurrentlyVisibleBought, sourceIds) {
    if (isCurrentlyVisibleBought) {
      const next = { ...bought };
      delete next[itemKey];
      setBought(next);
      deleteNestedField(`bought.${itemKey}`);
    } else {
      saveBought({ ...bought, [itemKey]: { at: Date.now(), sources: sourceIds } });
    }
  }
  function saveAssignedTo(at) {
    setAssignedTo(at);
    save("assignedTo", at);
  }
  function cycleAssignee(itemKey) {
    const current = assignedTo[itemKey] || null;
    const next = current === null ? "C" : current === "C" ? "J" : null;
    if (next === null) {
      const nextMap = { ...assignedTo };
      delete nextMap[itemKey];
      setAssignedTo(nextMap);
      deleteNestedField(`assignedTo.${itemKey}`);
    } else {
      saveAssignedTo({ ...assignedTo, [itemKey]: next });
    }
  }
  function saveExtraItems(ex) {
    setExtraItems(ex);
    save("extraItems", ex);
  }
  function addExtraItem(name, qty, unit) {
    if (!name.trim()) return;
    saveExtraItems([...extraItems, { id: uid(), name: name.trim(), qty, unit }]);
  }
  function removeExtraItems(ids) {
    saveExtraItems(extraItems.filter((i) => !ids.includes(i.id)));
  }
  function saveGarde(g) {
    setGarde(g);
    save("garde", g);
  }
  function updateGarde(dateKey, nextVal) {
    if (nextVal === null) {
      const next = { ...garde };
      delete next[dateKey];
      setGarde(next);
      deleteNestedField(`garde.${dateKey}`);
    } else {
      saveGarde({ ...garde, [dateKey]: nextVal });
    }
  }
  function saveTodos(t) {
    setTodos(t);
    save("todos", t);
  }
  function addTodo(text) {
    if (!text.trim()) return;
    saveTodos([...todos, { id: uid(), text: text.trim(), done: false }]);
  }
  function toggleTodo(id) {
    saveTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }
  function deleteTodo(id) {
    saveTodos(todos.filter((t) => t.id !== id));
  }
  function cycleTodoAssignee(id) {
    saveTodos(
      todos.map((t) => {
        if (t.id !== id) return t;
        const current = t.assignee || null;
        const next = current === null ? "C" : current === "C" ? "J" : null;
        return { ...t, assignee: next };
      })
    );
  }
  function editTodoText(id, newText) {
    if (!newText.trim()) return;
    saveTodos(todos.map((t) => (t.id === id ? { ...t, text: newText.trim() } : t)));
  }

  function openNewRecipe() {
    setEditing(emptyRecipe());
  }
  function openEditRecipe(r) {
    setEditing(JSON.parse(JSON.stringify(r)));
  }
  function deleteRecipe(id) {
    if (!confirm("Supprimer cette recette ?")) return;
    saveRecipes(recipes.filter((r) => r.id !== id));
  }
  function markCookedToday(id) {
    saveRecipes(recipes.map((r) => (r.id === id ? { ...r, lastCooked: todayKey() } : r)));
  }
  function saveEditingRecipe() {
    if (!editing.name.trim()) return;
    const cleaned = {
      ...editing,
      name: editing.name.trim(),
      link: (editing.link || "").trim(),
      ingredients: editing.ingredients.filter((i) => i.name.trim()),
    };
    const exists = recipes.some((r) => r.id === cleaned.id);
    const next = exists ? recipes.map((r) => (r.id === cleaned.id ? cleaned : r)) : [...recipes, cleaned];
    saveRecipes(next);
    setEditing(null);
  }

  function updateIngredient(idx, field, value) {
    setEditing((prev) => {
      const ing = [...prev.ingredients];
      ing[idx] = { ...ing[idx], [field]: value };
      return { ...prev, ingredients: ing };
    });
  }
  function addIngredientRow() {
    setEditing((prev) => ({ ...prev, ingredients: [...prev.ingredients, { id: uid(), name: "", qty: "1", unit: "pièce(s)" }] }));
  }
  function removeIngredientRow(idx) {
    setEditing((prev) => ({ ...prev, ingredients: prev.ingredients.filter((_, i) => i !== idx) }));
  }

  // --- Planning (jours réels, avec héritage de la routine) ---
  function updateOverride(dateKey, weekday, meal, patch) {
    const eff = getEffectiveSlot(dateKey, weekday, meal, planning, routine);
    const merged = { ...eff, ...patch };
    const day = { ...(planning[dateKey] || {}) };
    day[meal] = merged;
    savePlanning({ ...planning, [dateKey]: day });
  }
  function resetOverride(dateKey, meal) {
    const day = { ...(planning[dateKey] || {}) };
    delete day[meal];
    setPlanning({ ...planning, [dateKey]: day });
    deleteNestedField(`planning.${dateKey}.${meal}`);
  }

  // --- Routine (par jour de semaine) ---
  function updateRoutineSlot(weekday, meal, patch) {
    const current = normalizeSlot(routine[weekday]?.[meal]);
    const merged = { ...current, ...patch };
    const day = { ...(routine[weekday] || {}) };
    day[meal] = merged;
    saveRoutine({ ...routine, [weekday]: day });
  }

  if (!loaded) {
    return (
      <div style={S.loadingWrap}>
        <Home size={28} color="#8AA593" />
        <p style={{ color: "#8A8A82", fontSize: 14, marginTop: 8 }}>Chargement…</p>
      </div>
    );
  }

  const next7 = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i));

  const filteredRecipes = recipes
    .filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b, "fr"));

  // Construction de la liste de courses : regroupe les produits identiques,
  // garde la date la plus proche pour le tri et pour la clé "déjà acheté"
  const shoppingMap = new Map();
  next7.forEach((d) => {
    const dateKey = fmtKey(d);
    const weekday = d.getDay();
    const label = JOURS_COURTS[weekday] + " " + d.getDate() + "/" + (d.getMonth() + 1);
    ["midi", "soir"].forEach((meal) => {
      const slot = getEffectiveSlot(dateKey, weekday, meal, planning, routine);
      if (slot.hidden) return;
      slot.recipeIds.forEach((rid) => {
        const rec = recipes.find((r) => r.id === rid);
        if (!rec) return;
        rec.ingredients.forEach((ing) => {
          if (!ing.name.trim()) return;
          const key = ing.name.trim().toLowerCase() + "|" + (ing.unit || "");
          const qty = parseFloat(ing.qty) || 0;
          if (!shoppingMap.has(key)) {
            shoppingMap.set(key, { name: ing.name.trim(), unit: ing.unit, qty: 0, days: [], manualIds: [], sourceIds: [] });
          }
          const entry = shoppingMap.get(key);
          entry.qty += qty;
          if (!entry.days.some((x) => x.dateKey === dateKey)) entry.days.push({ dateKey, label });
          if (!entry.sourceIds.includes(rid)) entry.sourceIds.push(rid);
        });
      });
    });
  });
  extraItems.forEach((item) => {
    if (!item.name.trim()) return;
    const key = item.name.trim().toLowerCase() + "|" + (item.unit || "");
    const qty = parseFloat(item.qty) || 0;
    if (!shoppingMap.has(key)) {
      shoppingMap.set(key, { name: item.name.trim(), unit: item.unit, qty: 0, days: [], manualIds: [], sourceIds: [] });
    }
    const entry = shoppingMap.get(key);
    entry.qty += qty;
    entry.manualIds.push(item.id);
    if (!entry.sourceIds.includes("extra:" + item.id)) entry.sourceIds.push("extra:" + item.id);
    if (!entry.days.some((x) => x.dateKey === "0000-00-00")) entry.days.push({ dateKey: "0000-00-00", label: "Achat libre" });
  });
  const shoppingList = Array.from(shoppingMap.entries())
    .map(([key, item]) => {
      const sortedDays = item.days.sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
      const itemKey = key; // clé stable (nom+unité) : ne dépend pas de la date, qui peut changer si les repas sont modifiés
      const record = bought[itemKey]; // { at, sources } ou undefined
      const hasNewSource = !!record && item.sourceIds.some((id) => !(record.sources || []).includes(id));
      let status = "normal"; // normal | grisé (acheté <24h) | caché (acheté >=24h, aucune nouvelle source)
      if (record && !hasNewSource) {
        status = now - record.at < 24 * 60 * 60 * 1000 ? "bought" : "hidden";
      }
      return { ...item, days: sortedDays, itemKey, status };
    })
    .filter((item) => item.status !== "hidden")
    .sort((a, b) => {
      if ((a.status === "bought") !== (b.status === "bought")) return a.status === "bought" ? 1 : -1;
      const da = a.days[0].dateKey;
      const db_ = b.days[0].dateKey;
      if (da !== db_) return da < db_ ? -1 : 1;
      return a.name.localeCompare(b.name, "fr");
    });

  return (
    <div style={S.app}>
      <style>{`
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        input, select, button, textarea { font-family: inherit; }
        button { cursor: pointer; }
        ::placeholder { color: #B8B6AC; }
      `}</style>

      <header style={S.header}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Home size={20} color="#4E6B57" />
          <span style={S.headerTitle}>Lar Duarte</span>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {tab === "repas" && (
            <button style={S.routineBtn} onClick={() => setRoutineOpen(true)}>
              <Repeat size={14} color="#4E6B57" />
              <span style={{ fontSize: 12.5, color: "#4E6B57", fontWeight: 500 }}>Routine</span>
            </button>
          )}
          <button style={S.iconBtnSm} onClick={() => signOut(auth)} title="Se déconnecter">
            <LogOut size={14} color="#7A7A70" />
          </button>
        </div>
      </header>

      <main style={S.main}>
        {tab === "recettes" && (
          <RecettesTab
            search={search}
            setSearch={setSearch}
            filteredRecipes={filteredRecipes}
            openNewRecipe={openNewRecipe}
            openEditRecipe={openEditRecipe}
            deleteRecipe={deleteRecipe}
            markCookedToday={markCookedToday}
          />
        )}
        {tab === "repas" && (
          <PlanningTab
            next7={next7}
            recipes={recipes}
            planning={planning}
            routine={routine}
            updateOverride={updateOverride}
            resetOverride={resetOverride}
            onOpenRecettes={() => setTab("recettes")}
          />
        )}
        {tab === "courses" && (
          <CoursesTab
            shoppingList={shoppingList}
            toggleBought={toggleBought}
            addExtraItem={addExtraItem}
            removeExtraItems={removeExtraItems}
            assignedTo={assignedTo}
            cycleAssignee={cycleAssignee}
          />
        )}
        {tab === "calendrier" && <CalendrierTab garde={garde} updateGarde={updateGarde} />}
        {tab === "todo" && (
          <TodoTab
            todos={todos}
            addTodo={addTodo}
            toggleTodo={toggleTodo}
            deleteTodo={deleteTodo}
            cycleTodoAssignee={cycleTodoAssignee}
            editTodoText={editTodoText}
          />
        )}
      </main>

      <nav style={S.nav}>
        <NavBtn icon={<Utensils size={20} />} label="Repas" active={tab === "repas"} onClick={() => setTab("repas")} />
        <NavBtn icon={<ShoppingCart size={20} />} label="Courses" active={tab === "courses"} onClick={() => setTab("courses")} />
        <NavBtn icon={<Users size={20} />} label="Garde" active={tab === "calendrier"} onClick={() => setTab("calendrier")} />
        <NavBtn icon={<ListChecks size={20} />} label="To-do" active={tab === "todo"} onClick={() => setTab("todo")} />
      </nav>

      {editing && (
        <RecipeModal
          editing={editing}
          setEditing={setEditing}
          onClose={() => setEditing(null)}
          onSave={saveEditingRecipe}
          updateIngredient={updateIngredient}
          addIngredientRow={addIngredientRow}
          removeIngredientRow={removeIngredientRow}
        />
      )}

      {routineOpen && <RoutineModal recipes={recipes} routine={routine} updateRoutineSlot={updateRoutineSlot} onClose={() => setRoutineOpen(false)} />}
    </div>
  );
}

function NavBtn({ icon, label, active, onClick }) {
  return (
    <button style={{ ...S.navBtn, color: active ? "#4E6B57" : "#9B998F" }} onClick={onClick}>
      {icon}
      <span style={{ fontSize: 11, marginTop: 2 }}>{label}</span>
    </button>
  );
}

function RecettesTab({ search, setSearch, filteredRecipes, openNewRecipe, openEditRecipe, deleteRecipe, markCookedToday }) {
  return (
    <div style={{ padding: "12px 16px 90px" }}>
      <div style={S.searchRow}>
        <div style={S.searchBox}>
          <Search size={16} color="#9B998F" />
          <input style={S.searchInput} placeholder="Rechercher une recette…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button style={S.addBtn} onClick={openNewRecipe} aria-label="Ajouter une recette">
          <Plus size={20} color="#fff" />
        </button>
      </div>

      {filteredRecipes.length === 0 && (
        <p style={{ color: "#9B998F", fontSize: 14, marginTop: 24, textAlign: "center" }}>
          {search ? "Aucune recette trouvée." : "Aucune recette. Ajoutez-en une !"}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {filteredRecipes.map((r) => {
          const d = daysSince(r.lastCooked);
          return (
            <div key={r.id} style={S.recipeCard}>
              {r.link ? (
                <a
                  href={r.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...S.recipeThumb, textDecoration: "none", cursor: "pointer" }}
                  title="Ouvrir la recette"
                >
                  <span style={{ fontSize: 24 }}>{getRecipeEmoji(r.name)}</span>
                </a>
              ) : (
                <div style={S.recipeThumb}>
                  <span style={{ fontSize: 24 }}>{getRecipeEmoji(r.name)}</span>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={S.recipeName}>{r.name}</p>
                <p style={S.recipeMeta}>
                  <Clock size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                  {d === null ? "Jamais cuisinée" : d === 0 ? "Aujourd'hui" : d === 1 ? "Hier" : `Il y a ${d} jours`}
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button style={S.iconBtnSm} onClick={() => markCookedToday(r.id)} title="Marquer comme cuisinée aujourd'hui">
                  <Check size={14} color="#4E6B57" />
                </button>
                <button style={S.iconBtnSm} onClick={() => openEditRecipe(r)} title="Modifier">
                  <Pencil size={14} color="#7A7A70" />
                </button>
                <button style={S.iconBtnSm} onClick={() => deleteRecipe(r.id)} title="Supprimer">
                  <Trash2 size={14} color="#B85C4A" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlanningTab({ next7, recipes, planning, routine, updateOverride, resetOverride, onOpenRecettes }) {
  const [expanded, setExpanded] = useState({});
  return (
    <div style={{ padding: "12px 16px 90px" }}>
      <button style={{ ...S.routineBtn, marginBottom: 12 }} onClick={onOpenRecettes}>
        <ChefHat size={13} color="#4E6B57" />
        <span style={{ fontSize: 12.5, color: "#4E6B57", fontWeight: 500 }}>Recettes</span>
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {next7.map((d) => {
          const dateKey = fmtKey(d);
          const weekday = d.getDay();
          const label = `${JOURS[weekday]} ${d.getDate()}/${d.getMonth() + 1}`;
          const isOverrideMidi = planning[dateKey]?.midi !== undefined;
          const isOverrideSoir = planning[dateKey]?.soir !== undefined;
          const midi = getEffectiveSlot(dateKey, weekday, "midi", planning, routine);
          const soir = getEffectiveSlot(dateKey, weekday, "soir", planning, routine);
          const fullyAbsent = midi.hidden && soir.hidden;

          if (fullyAbsent && !expanded[dateKey]) {
            return (
              <button key={dateKey} style={S.dayCollapsed} onClick={() => setExpanded((p) => ({ ...p, [dateKey]: true }))}>
                <span style={{ fontSize: 13, color: "#B0AEA3", textTransform: "capitalize" }}>{label}</span>
                <span style={{ fontSize: 12, color: "#C9C7BC", fontStyle: "italic" }}>Journée absente</span>
              </button>
            );
          }

          return (
            <div key={dateKey} style={S.dayCard}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={S.dayLabel}>{label}</p>
                {fullyAbsent && (
                  <button style={S.linkBtnSm} onClick={() => setExpanded((p) => ({ ...p, [dateKey]: false }))}>
                    Réduire
                  </button>
                )}
              </div>
              <MealEditor
                icon={<Sun size={14} color="#C98A3D" />}
                label="Midi"
                recipes={recipes}
                hidden={midi.hidden}
                recipeIds={midi.recipeIds}
                onToggleHidden={() => updateOverride(dateKey, weekday, "midi", { hidden: !midi.hidden })}
                onAddDish={(id) => updateOverride(dateKey, weekday, "midi", { recipeIds: [...midi.recipeIds, id] })}
                onRemoveDish={(id) => updateOverride(dateKey, weekday, "midi", { recipeIds: midi.recipeIds.filter((x) => x !== id) })}
                showReset={isOverrideMidi}
                onReset={() => resetOverride(dateKey, "midi")}
              />
              <MealEditor
                icon={<Moon size={14} color="#6B7FA8" />}
                label="Soir"
                recipes={recipes}
                hidden={soir.hidden}
                recipeIds={soir.recipeIds}
                onToggleHidden={() => updateOverride(dateKey, weekday, "soir", { hidden: !soir.hidden })}
                onAddDish={(id) => updateOverride(dateKey, weekday, "soir", { recipeIds: [...soir.recipeIds, id] })}
                onRemoveDish={(id) => updateOverride(dateKey, weekday, "soir", { recipeIds: soir.recipeIds.filter((x) => x !== id) })}
                showReset={isOverrideSoir}
                onReset={() => resetOverride(dateKey, "soir")}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MealEditor({ icon, label, recipes, hidden, recipeIds, onToggleHidden, onAddDish, onRemoveDish, showReset, onReset }) {
  if (hidden) {
    return (
      <div style={S.mealBlockHidden}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.6 }}>
          {icon}
          <span style={{ fontSize: 12.5, color: "#B0AEA3" }}>{label} — absent</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {showReset && (
            <button style={S.iconBtnXs} onClick={onReset} title="Revenir à la routine">
              <RotateCcw size={12} color="#B0AEA3" />
            </button>
          )}
          <button style={S.iconBtnXs} onClick={onToggleHidden} title="Réactiver ce repas">
            <Eye size={12} color="#B0AEA3" />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div style={S.mealBlock}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, width: 52 }}>
          {icon}
          <span style={{ fontSize: 13, color: "#5A5A52" }}>{label}</span>
        </div>
        <div style={{ flex: 1 }} />
        {showReset && (
          <button style={S.iconBtnSm} onClick={onReset} title="Revenir à la routine">
            <RotateCcw size={13} color="#7A7A70" />
          </button>
        )}
        <button style={S.iconBtnSm} onClick={onToggleHidden} title="Marquer comme absent">
          <EyeOff size={14} color="#7A7A70" />
        </button>
      </div>
      <div style={{ marginTop: 6 }}>
        <DishPicker recipes={recipes} selectedIds={recipeIds} onAdd={onAddDish} onRemove={onRemoveDish} />
      </div>
    </div>
  );
}

function CalendrierTab({ garde, updateGarde }) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [editMode, setEditMode] = useState(false);
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (firstDay.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const today = todayKey();

  return (
    <div style={{ padding: "12px 16px 90px" }}>
      <button
        style={{ ...S.routineBtn, marginBottom: 12, background: editMode ? "#4E6B57" : "#EAF1EC" }}
        onClick={() => setEditMode(!editMode)}
      >
        {editMode ? <Check size={13} color="#fff" /> : <Pencil size={13} color="#4E6B57" />}
        <span style={{ fontSize: 12.5, color: editMode ? "#fff" : "#4E6B57", fontWeight: 500 }}>
          {editMode ? "Terminé" : "Modifier"}
        </span>
      </button>
      <p style={{ fontSize: 13, color: "#9B998F", marginBottom: 10, marginTop: 0 }}>
        {editMode ? "Appuyez sur un jour pour changer sa couleur." : "Calendrier verrouillé — appuyez sur \"Modifier\" pour changer les couleurs."}
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
        {GARDE_OPTIONS.map((o) => (
          <span key={o.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#5A5A52" }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: o.color, display: "inline-block" }} />
            {o.label}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#5A5A52", marginBottom: 16 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: "#7F77DD", display: "inline-block" }} />
        Vacances scolaires (zone A)
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button style={S.iconBtnSm} onClick={() => setViewMonth(new Date(year, month - 1, 1))} aria-label="Mois précédent">
          <ChevronLeft size={16} color="#5A5A52" />
        </button>
        <p style={{ fontSize: 14.5, fontWeight: 600, color: "#2B2B26", margin: 0, textTransform: "capitalize" }}>
          {MOIS[month]} {year}
        </p>
        <button style={S.iconBtnSm} onClick={() => setViewMonth(new Date(year, month + 1, 1))} aria-label="Mois suivant">
          <ChevronRight size={16} color="#5A5A52" />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 6 }}>
        {JOURS_SEMAINE_COURT.map((j, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 11, color: "#B0AEA3" }}>
            {j}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const dateKey = fmtKey(new Date(year, month, d));
          const val = garde[dateKey];
          const opt = GARDE_OPTIONS.find((o) => o.id === val);
          const isToday = dateKey === today;
          const holiday = isSchoolHoliday(dateKey);
          return (
            <button
              key={i}
              onClick={() => editMode && updateGarde(dateKey, cycleGarde(val))}
              style={{
                aspectRatio: "1",
                borderRadius: 999,
                border: isToday ? "2px solid #4E6B57" : "1px solid #EAE8DF",
                background: opt ? opt.color : "#EFEDE4",
                color: opt ? "#fff" : "#5A5A52",
                fontSize: 13,
                fontWeight: isToday ? 700 : 500,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: editMode ? "pointer" : "default",
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <span>{d}</span>
                {holiday && (
                  <span style={{ width: 4, height: 4, borderRadius: 999, background: opt ? "rgba(255,255,255,0.85)" : "#7F77DD" }} />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TodoTab({ todos, addTodo, toggleTodo, deleteTodo, cycleTodoAssignee, editTodoText }) {
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");

  function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    addTodo(text);
    setText("");
  }
  function startEdit(t) {
    setEditingId(t.id);
    setDraft(t.text);
  }
  function confirmEdit() {
    editTodoText(editingId, draft);
    setEditingId(null);
  }

  const pending = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <div style={{ padding: "12px 16px 90px" }}>
      <form onSubmit={submit} style={S.addItemRow}>
        <input style={{ ...S.input, flex: 1 }} placeholder="Ajouter une tâche…" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" style={S.addBtnSm} aria-label="Ajouter">
          <Plus size={16} color="#fff" />
        </button>
      </form>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {pending.map((t) => (
          <TodoRow
            key={t.id}
            t={t}
            isEditing={editingId === t.id}
            draft={draft}
            setDraft={setDraft}
            onStartEdit={() => startEdit(t)}
            onConfirmEdit={confirmEdit}
            toggleTodo={toggleTodo}
            deleteTodo={deleteTodo}
            cycleTodoAssignee={cycleTodoAssignee}
          />
        ))}

        {done.length > 0 && (
          <>
            <p style={{ fontSize: 12, color: "#9B998F", marginTop: 10, marginBottom: 0 }}>Terminées</p>
            {done.map((t) => (
              <TodoRow
                key={t.id}
                t={t}
                isEditing={editingId === t.id}
                draft={draft}
                setDraft={setDraft}
                onStartEdit={() => startEdit(t)}
                onConfirmEdit={confirmEdit}
                toggleTodo={toggleTodo}
                deleteTodo={deleteTodo}
                cycleTodoAssignee={cycleTodoAssignee}
              />
            ))}
          </>
        )}

        {todos.length === 0 && <p style={{ color: "#9B998F", fontSize: 14, textAlign: "center", marginTop: 24 }}>Aucune tâche pour l'instant.</p>}
      </div>
    </div>
  );
}

function TodoRow({ t, isEditing, draft, setDraft, onStartEdit, onConfirmEdit, toggleTodo, deleteTodo, cycleTodoAssignee }) {
  return (
    <div style={{ ...S.shopItem, opacity: t.done ? 0.55 : 1 }}>
      <button style={S.iconBtnSm} onClick={() => deleteTodo(t.id)} title="Supprimer">
        <Trash2 size={13} color="#B85C4A" />
      </button>
      <button
        style={{
          ...S.assigneeCircle,
          ...(t.assignee === "C" ? { background: "#EC7FB0", borderColor: "#EC7FB0" } : {}),
          ...(t.assignee === "J" ? { background: "#5AC8E8", borderColor: "#5AC8E8" } : {}),
        }}
        onClick={() => cycleTodoAssignee(t.id)}
        aria-label="Qui doit s'en occuper"
      >
        {t.assignee || <span style={{ color: "#C9C7BC", fontSize: 8, letterSpacing: -0.3 }}>C/J</span>}
      </button>

      {isEditing ? (
        <input
          autoFocus
          style={{ ...S.input, flex: 1, padding: "5px 8px" }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onConfirmEdit();
            }
          }}
          onBlur={onConfirmEdit}
        />
      ) : (
        <p style={{ flex: 1, fontSize: 14, color: "#2B2B26", margin: 0, textDecoration: t.done ? "line-through" : "none" }}>{t.text}</p>
      )}

      <button style={S.iconBtnSm} onClick={onStartEdit} title="Modifier le texte">
        <Pencil size={13} color="#7A7A70" />
      </button>
      <button
        style={{ ...S.checkCircle, ...(t.done ? S.checkCircleDone : {}) }}
        onClick={() => toggleTodo(t.id)}
        aria-label={t.done ? "Marquer comme à faire" : "Marquer comme terminée"}
      >
        {t.done && <Check size={13} color="#fff" />}
      </button>
    </div>
  );
}

function DishPicker({ recipes, selectedIds, onAdd, onRemove }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const inputRef = useRef(null);
  const selected = selectedIds.map((id) => recipes.find((r) => r.id === id)).filter(Boolean);
  const available = recipes
    .filter((r) => !selectedIds.includes(r.id))
    .filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b, "fr"))
    .slice(0, 6);
  const showSearch = adding || selected.length === 0;

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {selected.map((r) => (
        <span key={r.id} style={S.chip}>
          <span aria-hidden="true">{getRecipeEmoji(r.name)}</span> {r.name}
          <button style={S.chipX} onClick={() => onRemove(r.id)} aria-label={`Retirer ${r.name}`}>
            <X size={18} color="#4E6B57" />
          </button>
        </span>
      ))}

      {showSearch ? (
        <div style={{ position: "relative", flex: selected.length === 0 ? "1 1 100%" : "0 0 auto", minWidth: 140 }}>
          <div style={S.searchBoxSm}>
            <Search size={13} color="#9B998F" />
            <input
              ref={inputRef}
              style={S.searchInputSm}
              placeholder="Ajouter un plat…"
              value={query}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onBlur={() =>
                setTimeout(() => {
                  setOpen(false);
                  if (selected.length > 0) setAdding(false);
                }, 150)
              }
            />
          </div>
          {open && available.length > 0 && (
            <div style={S.dropdown}>
              {available.map((r) => (
                <div
                  key={r.id}
                  style={S.dropdownItem}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onAdd(r.id);
                    setQuery("");
                    setOpen(false);
                    setAdding(false);
                  }}
                >
                  {r.name}
                </div>
              ))}
            </div>
          )}
          {open && query && available.length === 0 && (
            <div style={S.dropdown}>
              <div style={{ ...S.dropdownItem, color: "#9B998F", cursor: "default" }}>Aucune recette trouvée</div>
            </div>
          )}
        </div>
      ) : (
        <button style={S.addDishBtn} onClick={() => setAdding(true)} aria-label="Ajouter un autre plat">
          <Plus size={13} color="#4E6B57" />
        </button>
      )}
    </div>
  );
}

function RoutineModal({ recipes, routine, updateRoutineSlot, onClose }) {
  return (
    <div style={S.modalOverlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Routine hebdomadaire</p>
          <button style={S.iconBtnSm} onClick={onClose}>
            <X size={18} color="#7A7A70" />
          </button>
        </div>
        <div style={S.modalBody}>
          <p style={{ fontSize: 13, color: "#9B998F", marginTop: 0, marginBottom: 14 }}>
            Ce modèle s'applique par défaut chaque semaine. Vous pourrez toujours modifier un jour précis dans le planning.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[1, 2, 3, 4, 5, 6, 0].map((weekday) => {
              const midi = normalizeSlot(routine[weekday]?.midi);
              const soir = normalizeSlot(routine[weekday]?.soir);
              return (
                <div key={weekday} style={S.dayCard}>
                  <p style={S.dayLabel}>{JOURS[weekday]}</p>
                  <MealEditor
                    icon={<Sun size={14} color="#C98A3D" />}
                    label="Midi"
                    recipes={recipes}
                    hidden={midi.hidden}
                    recipeIds={midi.recipeIds}
                    onToggleHidden={() => updateRoutineSlot(weekday, "midi", { hidden: !midi.hidden })}
                    onAddDish={(id) => updateRoutineSlot(weekday, "midi", { recipeIds: [...midi.recipeIds, id] })}
                    onRemoveDish={(id) => updateRoutineSlot(weekday, "midi", { recipeIds: midi.recipeIds.filter((x) => x !== id) })}
                    showReset={false}
                  />
                  <MealEditor
                    icon={<Moon size={14} color="#6B7FA8" />}
                    label="Soir"
                    recipes={recipes}
                    hidden={soir.hidden}
                    recipeIds={soir.recipeIds}
                    onToggleHidden={() => updateRoutineSlot(weekday, "soir", { hidden: !soir.hidden })}
                    onAddDish={(id) => updateRoutineSlot(weekday, "soir", { recipeIds: [...soir.recipeIds, id] })}
                    onRemoveDish={(id) => updateRoutineSlot(weekday, "soir", { recipeIds: soir.recipeIds.filter((x) => x !== id) })}
                    showReset={false}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div style={S.modalFooter}>
          <button style={S.primaryBtn} onClick={onClose}>
            Terminé
          </button>
        </div>
      </div>
    </div>
  );
}

function CoursesTab({ shoppingList, toggleBought, addExtraItem, removeExtraItems, assignedTo, cycleAssignee }) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("pièce(s)");
  const remaining = shoppingList.filter((i) => i.status !== "bought").length;

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    addExtraItem(name, qty, unit);
    setName("");
    setQty("");
  }

  return (
    <div style={{ padding: "12px 16px 90px" }}>
      <p style={{ fontSize: 13, color: "#9B998F", marginBottom: 10 }}>
        Courses pour les 7 prochains jours{shoppingList.length > 0 ? ` — ${remaining} restant${remaining !== 1 ? "s" : ""}` : ""}
      </p>

      <form onSubmit={submit} style={S.addItemRow}>
        <input style={{ ...S.input, flex: 2 }} placeholder="Ajouter un article (ex : dentifrice)…" value={name} onChange={(e) => setName(e.target.value)} />
        <input style={{ ...S.input, flex: 1 }} placeholder="Qté" type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
        <select style={{ ...S.select, flex: 1, padding: "8px 4px" }} value={unit} onChange={(e) => setUnit(e.target.value)}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <button type="submit" style={S.addBtnSm} aria-label="Ajouter">
          <Plus size={16} color="#fff" />
        </button>
      </form>

      {shoppingList.length === 0 ? (
        <p style={{ color: "#9B998F", fontSize: 14, textAlign: "center", marginTop: 24 }}>Rien à acheter pour l'instant.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {shoppingList.map((item) => (
            <div key={item.itemKey} style={{ ...S.shopItem, opacity: item.status === "bought" ? 0.55 : 1 }}>
              {item.manualIds.length > 0 && (
                <button style={S.iconBtnSm} onClick={() => removeExtraItems(item.manualIds)} title="Retirer cet article">
                  <Trash2 size={13} color="#B85C4A" />
                </button>
              )}
              <button
                style={{
                  ...S.assigneeCircle,
                  ...(assignedTo[item.itemKey] === "C" ? { background: "#EC7FB0", borderColor: "#EC7FB0" } : {}),
                  ...(assignedTo[item.itemKey] === "J" ? { background: "#5AC8E8", borderColor: "#5AC8E8" } : {}),
                }}
                onClick={() => cycleAssignee(item.itemKey)}
                aria-label="Qui doit acheter ce produit"
              >
                {assignedTo[item.itemKey] || <span style={{ color: "#C9C7BC", fontSize: 8, letterSpacing: -0.3 }}>C/J</span>}
              </button>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, color: "#2B2B26", margin: 0, textDecoration: item.status === "bought" ? "line-through" : "none" }}>
                  {item.name}
                  {item.qty > 0 && (
                    <span style={{ color: "#9B998F" }}>
                      {" "}
                      — {Math.round(item.qty * 100) / 100} {item.unit}
                    </span>
                  )}
                </p>
                <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  {item.days.map((day) => (
                    <span key={day.dateKey} style={day.dateKey === "0000-00-00" ? S.dayBadgeManual : S.dayBadge}>
                      {day.label}
                    </span>
                  ))}
                </div>
              </div>
              <button
                style={{ ...S.checkCircle, ...(item.status === "bought" ? S.checkCircleDone : {}) }}
                onClick={() => toggleBought(item.itemKey, item.status === "bought", item.sourceIds)}
                aria-label={item.status === "bought" ? "Marquer comme non acheté" : "Marquer comme acheté"}
              >
                {item.status === "bought" && <Check size={13} color="#fff" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecipeModal({ editing, setEditing, onClose, onSave, updateIngredient, addIngredientRow, removeIngredientRow }) {
  const inputRefs = useRef([]);
  const prevLen = useRef(editing.ingredients.length);

  useEffect(() => {
    if (editing.ingredients.length > prevLen.current) {
      inputRefs.current[editing.ingredients.length - 1]?.focus();
    }
    prevLen.current = editing.ingredients.length;
  }, [editing.ingredients.length]);

  return (
    <div style={S.modalOverlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{editing.name ? "Modifier la recette" : "Nouvelle recette"}</p>
          <button style={S.iconBtnSm} onClick={onClose}>
            <X size={18} color="#7A7A70" />
          </button>
        </div>

        <div style={S.modalBody}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ ...S.recipeThumb, width: 52, height: 52 }}>
              <span style={{ fontSize: 26 }}>{getRecipeEmoji(editing.name)}</span>
            </div>
            <p style={{ fontSize: 12, color: "#9B998F", margin: 0 }}>Une icône est choisie automatiquement selon le nom du plat.</p>
          </div>

          <label style={S.label}>Nom de la recette</label>
          <input
            style={S.input}
            placeholder="Ex : Poulet rôti aux légumes"
            value={editing.name}
            onChange={(e) => setEditing((prev) => ({ ...prev, name: e.target.value }))}
          />

          <label style={{ ...S.label, marginTop: 12 }}>Lien de la recette (optionnel)</label>
          <input
            style={S.input}
            placeholder="https://…"
            type="url"
            value={editing.link || ""}
            onChange={(e) => setEditing((prev) => ({ ...prev, link: e.target.value }))}
          />

          <label style={{ ...S.label, marginTop: 16 }}>Ingrédients</label>
          {editing.ingredients.map((ing, idx) => (
            <div key={ing.id} style={S.ingredientRow}>
              <input
                ref={(el) => (inputRefs.current[idx] = el)}
                style={{ ...S.input, flex: 2 }}
                placeholder="Nom"
                value={ing.name}
                onChange={(e) => updateIngredient(idx, "name", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addIngredientRow();
                  }
                }}
              />
              <input
                style={{ ...S.input, flex: 1 }}
                placeholder="Qté"
                type="number"
                value={ing.qty}
                onChange={(e) => updateIngredient(idx, "qty", e.target.value)}
              />
              <select style={{ ...S.select, flex: 1, padding: "8px 4px" }} value={ing.unit} onChange={(e) => updateIngredient(idx, "unit", e.target.value)}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <button style={S.iconBtnSm} onClick={() => removeIngredientRow(idx)}>
                <X size={14} color="#B85C4A" />
              </button>
            </div>
          ))}
          <button style={S.linkBtn} onClick={addIngredientRow}>
            <Plus size={14} /> Ajouter un ingrédient
          </button>
        </div>

        <div style={S.modalFooter}>
          <button style={S.secondaryBtn} onClick={onClose}>
            Annuler
          </button>
          <button style={S.primaryBtn} onClick={onSave} disabled={!editing.name.trim()}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

const S = {
  app: { display: "flex", flexDirection: "column", height: "100vh", maxWidth: 480, margin: "0 auto", background: "#FBFAF6", position: "relative" },
  loadingWrap: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh" },
  header: {
    padding: "14px 16px 12px",
    borderBottom: "1px solid #EAE8DF",
    background: "#FBFAF6",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: { fontSize: 17, fontWeight: 600, color: "#2B2B26" },
  routineBtn: { display: "flex", alignItems: "center", gap: 5, background: "#EAF1EC", border: "none", borderRadius: 8, padding: "6px 10px" },
  main: { flex: 1, overflowY: "auto" },
  nav: { display: "flex", borderTop: "1px solid #EAE8DF", background: "#FFFFFF", position: "sticky", bottom: 0 },
  navBtn: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0 8px", background: "none", border: "none" },
  searchRow: { display: "flex", gap: 8, alignItems: "center" },
  searchBox: { flex: 1, display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #EAE8DF", borderRadius: 10, padding: "9px 12px" },
  searchInput: { border: "none", outline: "none", flex: 1, fontSize: 14, background: "transparent" },
  searchBoxSm: { display: "flex", alignItems: "center", gap: 5, background: "#fff", border: "1px solid #EAE8DF", borderRadius: 8, padding: "6px 8px" },
  searchInputSm: { border: "none", outline: "none", flex: 1, fontSize: 12.5, background: "transparent" },
  addBtn: { width: 38, height: 38, borderRadius: 10, background: "#4E6B57", border: "none", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  addItemRow: { display: "flex", gap: 6, alignItems: "center" },
  addBtnSm: { width: 36, height: 36, borderRadius: 8, background: "#4E6B57", border: "none", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  recipeCard: { display: "flex", gap: 12, background: "#fff", border: "1px solid #EAE8DF", borderRadius: 12, padding: 10, alignItems: "center" },
  recipeThumb: { width: 52, height: 52, borderRadius: 8, background: "#EFF3EE", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 },
  recipeName: { fontSize: 14.5, fontWeight: 500, color: "#2B2B26", margin: 0 },
  recipeMeta: { fontSize: 12, color: "#9B998F", marginTop: 3 },
  iconBtnSm: { width: 26, height: 26, borderRadius: 7, border: "1px solid #EAE8DF", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  dayCard: { background: "#fff", border: "1px solid #EAE8DF", borderRadius: 12, padding: 12 },
  dayCollapsed: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "#F4F3EE",
    border: "1px dashed #DDDAD0",
    borderRadius: 10,
    padding: "8px 12px",
    width: "100%",
  },
  linkBtnSm: { background: "none", border: "none", color: "#4E6B57", fontSize: 12, fontWeight: 500, padding: 0 },
  dayLabel: { fontSize: 13.5, fontWeight: 600, color: "#2B2B26", margin: "0 0 8px", textTransform: "capitalize" },
  mealBlock: { padding: "6px 0", borderTop: "1px solid #F1EFE6" },
  mealBlockHidden: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0", borderTop: "1px solid #F1EFE6" },
  iconBtnXs: { width: 20, height: 20, borderRadius: 6, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  select: { flex: 1, fontSize: 13, border: "1px solid #EAE8DF", borderRadius: 8, padding: "7px 8px", background: "#FBFAF6", color: "#2B2B26" },
  shopItem: { display: "flex", gap: 10, alignItems: "flex-start", background: "#fff", border: "1px solid #EAE8DF", borderRadius: 10, padding: "10px 12px" },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 999,
    border: "1.5px solid #C9C7BC",
    background: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  checkCircleDone: { background: "#4E6B57", borderColor: "#4E6B57" },
  assigneeCircle: {
    width: 22,
    height: 22,
    borderRadius: 999,
    border: "1.5px solid #C9C7BC",
    background: "#fff",
    color: "#fff",
    fontSize: 11,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  addDishBtn: { width: 24, height: 24, borderRadius: 999, border: "1px solid #CFE0D4", background: "#EAF1EC", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  dayBadge: { fontSize: 11, color: "#4E6B57", background: "#EAF1EC", borderRadius: 5, padding: "2px 7px" },
  dayBadgeManual: { fontSize: 11, color: "#8A6A3C", background: "#F5EBDA", borderRadius: 5, padding: "2px 7px" },
  chip: { display: "inline-flex", alignItems: "center", gap: 7, background: "#EAF1EC", color: "#3C5443", fontSize: 24, fontWeight: 500, borderRadius: 10, padding: "9px 9px 9px 14px" },
  chipX: { width: 28, height: 28, borderRadius: 7, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" },
  dropdown: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    right: 0,
    background: "#fff",
    border: "1px solid #EAE8DF",
    borderRadius: 8,
    boxShadow: "0 4px 14px rgba(20,20,15,0.08)",
    zIndex: 5,
    maxHeight: 180,
    overflowY: "auto",
  },
  dropdownItem: { padding: "8px 10px", fontSize: 13, color: "#2B2B26" },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(20,20,15,0.4)", display: "flex", alignItems: "flex-end", zIndex: 50 },
  modal: { background: "#FBFAF6", width: "100%", maxHeight: "88vh", borderRadius: "16px 16px 0 0", display: "flex", flexDirection: "column", overflow: "hidden" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid #EAE8DF" },
  modalBody: { padding: 16, overflowY: "auto" },
  modalFooter: { display: "flex", gap: 10, padding: 14, borderTop: "1px solid #EAE8DF" },
  label: { fontSize: 12.5, color: "#7A7A70", fontWeight: 500, display: "block", marginBottom: 6 },
  input: { width: "100%", border: "1px solid #EAE8DF", borderRadius: 8, padding: "9px 10px", fontSize: 14, background: "#fff", color: "#2B2B26", outline: "none" },
  ingredientRow: { display: "flex", gap: 6, marginBottom: 8, alignItems: "center" },
  linkBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#4E6B57", fontSize: 13, fontWeight: 500, padding: "4px 0" },
  secondaryBtn: { flex: 1, padding: "11px 0", borderRadius: 9, border: "1px solid #EAE8DF", background: "#fff", color: "#5A5A52", fontSize: 14, fontWeight: 500 },
  primaryBtn: { flex: 2, padding: "11px 0", borderRadius: 9, border: "none", background: "#4E6B57", color: "#fff", fontSize: 14, fontWeight: 500 },
};
