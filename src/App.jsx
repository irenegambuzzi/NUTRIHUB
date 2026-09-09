import React, { useState, useEffect } from 'react';
import { 
  ShoppingBag, Calendar, User, Home, BarChart2, Plus, Check, 
  Trash2, LogOut, Lock, Mail, Utensils, ArrowRight, DollarSign, Sparkles, BookOpen, Users, Copy, ChefHat, RefreshCw
} from 'lucide-react';
import { supabase } from './supabaseClient';

export default function App() {
  // --- Auth & Session States ---
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // --- Navigation State ---
  const [activeTab, setActiveTab] = useState('planner');
  const [recipeSubTab, setRecipeSubTab] = useState('ai'); // 'ai' or 'manual'
  const [grocerySubTab, setGrocerySubTab] = useState('items'); // 'items' or 'history'

  // --- Profile & Household State ---
  const [fullName, setFullName] = useState('');
  const [calories, setCalories] = useState(1350);
  const [householdCode, setHouseholdCode] = useState('');
  const [householdId, setHouseholdId] = useState(null);
  const [inputCode, setInputCode] = useState('');

  // --- Grocery State ---
  const [groceryItems, setGroceryItems] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('Kitchen');
  const [newItemPrice, setNewItemPrice] = useState('');

  // --- Home Base State ---
  const [essentials, setEssentials] = useState([]);
  const [newEssentialName, setNewEssentialName] = useState('');
  const [newEssentialCategory, setNewEssentialCategory] = useState('Casa');

  // --- Recipes State ---
  const [recipes, setRecipes] = useState([]);
  const [newRecipeTitle, setNewRecipeTitle] = useState('');
  const [newRecipeCalories, setNewRecipeCalories] = useState('');
  const [newRecipeInstructions, setNewRecipeInstructions] = useState('');
  const [fridgeIngredients, setFridgeIngredients] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);

  // --- Weekly Planner State ---
  const [selectedDay, setSelectedDay] = useState('Monday');
  const emptyPlanner = {
    Monday: { Breakfast: '', Lunch: '', Dinner: '' },
    Tuesday: { Breakfast: '', Lunch: '', Dinner: '' },
    Wednesday: { Breakfast: '', Lunch: '', Dinner: '' },
    Thursday: { Breakfast: '', Lunch: '', Dinner: '' },
    Friday: { Breakfast: '', Lunch: '', Dinner: '' },
    Saturday: { Breakfast: '', Lunch: '', Dinner: '' },
    Sunday: { Breakfast: '', Lunch: '', Dinner: '' }
  };

  const [weeklyPlan, setWeeklyPlan] = useState(() => {
    const savedPlan = localStorage.getItem('hub_weekly_plan');
    const savedWeekYear = localStorage.getItem('hub_weekly_plan_yearweek');
    
    const now = new Date();
    const currentWeekYear = `${now.getFullYear()}-${Math.ceil((((now - new Date(now.getFullYear(), 0, 1)) / 86400000) + 1) / 7)}`;

    if (savedPlan && savedWeekYear === currentWeekYear) {
      return JSON.parse(savedPlan);
    } else {
      localStorage.setItem('hub_weekly_plan_yearweek', currentWeekYear);
      return emptyPlanner;
    }
  });

  // History State
  const [history, setHistory] = useState([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) {
      loadAllData();
    }
  }, [session]);

  useEffect(() => {
    localStorage.setItem('hub_weekly_plan', JSON.stringify(weeklyPlan));
  }, [weeklyPlan]);

  const loadAllData = async () => {
    const userHId = await fetchProfile();
    fetchGroceryItems(userHId);
    fetchEssentials(userHId);
    fetchRecipes(userHId);
    fetchHistory(userHId);
  };

  // --- Handlers ---
  const fetchProfile = async () => {
    if (!session?.user) return null;
    const { data } = await supabase.from('user_profiles').select('*').eq('id', session.user.id).maybeSingle();
    let currentHId = null;
    if (data) {
      setFullName(data.full_name || '');
      setCalories(data.daily_calories || 1350);
      setHouseholdCode(data.household_code || '');
      setHouseholdId(data.household_id || null);
      currentHId = data.household_id;
    } else {
      // Se non esiste il profilo, crealo di base
      await supabase.from('user_profiles').insert([{
        id: session.user.id,
        email: session.user.email,
        full_name: '',
        daily_calories: 1350
      }]);
    }
    return currentHId;
  };

  const saveProfile = async () => {
    const { error } = await supabase.from('user_profiles').upsert({
      id: session.user.id,
      email: session.user.email,
      full_name: fullName,
      daily_calories: Number(calories),
      household_code: householdCode,
      household_id: householdId,
      created_at: new Date()
    });

    if (error) {
      alert('Errore nel salvataggio del profilo: ' + error.message);
    } else {
      alert('Profilo salvato con successo!');
    }
  };

  const createHouseholdCode = async () => {
    const generatedCode = 'HOME-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    
    // Crea household
    const { data: hData, error: hErr } = await supabase.from('households').insert([{
      name: 'Famiglia ' + (fullName || 'Nuova'),
      invite_code: generatedCode
    }]).select().single();

    if (hErr) {
      alert('Errore creazione codice: ' + hErr.message);
      return;
    }

    const hId = hData.id;
    setHouseholdCode(generatedCode);
    setHouseholdId(hId);

    await supabase.from('user_profiles').upsert({
      id: session.user.id,
      email: session.user.email,
      full_name: fullName,
      household_code: generatedCode,
      household_id: hId
    });

    alert(`Codice Famiglia Creato: ${generatedCode}`);
    loadAllData();
  };

  const joinHousehold = async () => {
    if (!inputCode.trim()) return;
    const cleanCode = inputCode.trim().toUpperCase();

    // Cerca household per invite_code
    const { data: hData } = await supabase.from('households').select('*').eq('invite_code', cleanCode).maybeSingle();

    let hId = hData?.id;

    const { error } = await supabase.from('user_profiles').upsert({
      id: session.user.id,
      email: session.user.email,
      full_name: fullName,
      household_code: cleanCode,
      household_id: hId || null
    });

    if (!error) {
      setHouseholdCode(cleanCode);
      setHouseholdId(hId || null);
      setInputCode('');
      alert(`Unito alla famiglia col codice: ${cleanCode}!`);
      loadAllData();
    } else {
      alert('Errore unione famiglia: ' + error.message);
    }
  };

  const fetchGroceryItems = async (hId = householdId) => {
    let query = supabase.from('grocery_items').select('*').order('created_at', { ascending: false });
    if (hId) {
      query = query.eq('household_id', hId);
    }
    const { data } = await query;
    if (data) setGroceryItems(data);
  };

  const handleAddGrocery = async (e) => {
    e.preventDefault();
    if (!newItemName.trim()) return;

    const price = parseFloat(newItemPrice) || 0;

    const { data, error } = await supabase.from('grocery_items').insert([{
      name: newItemName,
      category: newItemCategory,
      price: price,
      completed: false,
      household_id: householdId
    }]).select();

    if (!error && data) {
      setGroceryItems([data[0], ...groceryItems]);
      setNewItemName('');
      setNewItemPrice('');
    } else if (error) {
      alert('Errore salvataggio prodotto: ' + error.message);
    }
  };

  const toggleGroceryComplete = async (item) => {
    const updatedStatus = !item.completed;
    await supabase.from('grocery_items').update({ completed: updatedStatus }).eq('id', item.id);
    
    if (updatedStatus && (item.price || item.estimated_price) > 0) {
      const itemPrice = item.price || item.estimated_price || 0;
      await supabase.from('purchase_history').insert([{
        item_name: item.name,
        category: item.category,
        price: itemPrice,
        household_id: householdId
      }]);
      fetchHistory();
    }

    setGroceryItems(groceryItems.map(i => i.id === item.id ? { ...i, completed: updatedStatus } : i));
  };

  const deleteGroceryItem = async (id) => {
    await supabase.from('grocery_items').delete().eq('id', id);
    setGroceryItems(groceryItems.filter(i => i.id !== id));
  };

  const fetchEssentials = async (hId = householdId) => {
    let query = supabase.from('home_essentials').select('*').order('created_at', { ascending: false });
    if (hId) {
      query = query.eq('household_id', hId);
    }
    const { data } = await query;
    if (data) setEssentials(data);
  };

  const handleAddEssential = async (e) => {
    e.preventDefault();
    if (!newEssentialName.trim()) return;

    const { data, error } = await supabase.from('home_essentials').insert([{
      name: newEssentialName,
      category: newEssentialCategory,
      status: 'ok',
      household_id: householdId
    }]).select();

    if (!error && data) {
      setEssentials([data[0], ...essentials]);
      setNewEssentialName('');
    }
  };

  const toggleStock = async (id, currentStatus) => {
    const newStatus = currentStatus === 'ok' ? 'out' : 'ok';
    await supabase.from('home_essentials').update({ status: newStatus }).eq('id', id);
    setEssentials(essentials.map(e => e.id === id ? { ...e, status: newStatus } : e));
  };

  const sendEssentialToGrocery = async (essential) => {
    await supabase.from('grocery_items').insert([{
      name: essential.name,
      category: essential.category,
      price: 0,
      completed: false,
      household_id: householdId
    }]);
    fetchGroceryItems();
    setActiveTab('spesa');
  };

  const deleteEssential = async (id) => {
    await supabase.from('home_essentials').delete().eq('id', id);
    setEssentials(essentials.filter(e => e.id !== id));
  };

  const fetchRecipes = async (hId = householdId) => {
    let query = supabase.from('recipes').select('*').order('created_at', { ascending: false });
    if (hId) {
      query = query.eq('household_id', hId);
    }
    const { data } = await query;
    if (data) setRecipes(data);
  };

  const handleAddRecipeManually = async (e) => {
    e.preventDefault();
    if (!newRecipeTitle.trim()) return;

    const { data, error } = await supabase.from('recipes').insert([{
      title: newRecipeTitle,
      calories: parseInt(newRecipeCalories) || 400,
      instructions: newRecipeInstructions,
      is_ai_generated: false,
      household_id: householdId
    }]).select();

    if (!error && data) {
      setRecipes([data[0], ...recipes]);
      setNewRecipeTitle('');
      setNewRecipeCalories('');
      setNewRecipeInstructions('');
    }
  };

  // --- GEMINI AI GENERATOR ---
  const generateAIRecipe = async () => {
    if (!fridgeIngredients.trim()) {
      alert('Inserisci almeno un ingrediente disponibile!');
      return;
    }

    setAiGenerating(true);
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
      alert('Chiave API mancante! Verifica le variabili di ambiente su Vercel.');
      setAiGenerating(false);
      return;
    }

    try {
      const promptText = `Create a healthy recipe using these ingredients: ${fridgeIngredients}. Target: ${Math.round(calories * 0.35)} kcal. Return strictly valid JSON without markdown: {"title": "Recipe Name", "calories": 400, "instructions": "Step 1: ... Step 2: ..."}`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }]
        })
      });

      const jsonResult = await response.json();

      if (jsonResult.error) {
        throw new Error(jsonResult.error.message);
      }

      const rawText = jsonResult.candidates[0].content.parts[0].text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      const generatedRecipe = JSON.parse(rawText);

      const { data, error } = await supabase.from('recipes').insert([{
        title: generatedRecipe.title,
        calories: generatedRecipe.calories || Math.round(calories * 0.35),
        instructions: generatedRecipe.instructions,
        is_ai_generated: true,
        household_id: householdId
      }]).select();

      if (!error && data) {
        setRecipes([data[0], ...recipes]);
        setFridgeIngredients('');
        alert(`Ricetta IA creata: ${generatedRecipe.title}! Controlla la scheda Ricette IA.`);
      } else {
        fetchRecipes();
      }
    } catch (err) {
      console.error(err);
      alert('Errore: ' + err.message);
    } finally {
      setAiGenerating(false);
    }
  };

  const deleteRecipe = async (id) => {
    await supabase.from('recipes').delete().eq('id', id);
    setRecipes(recipes.filter(r => r.id !== id));
  };

  const resetPlanner = () => {
    if (window.confirm("Sei sicuro di voler svuotare il piano della settimana?")) {
      setWeeklyPlan(emptyPlanner);
    }
  };

  const fetchHistory = async (hId = householdId) => {
    let query = supabase.from('purchase_history').select('*').order('purchased_at', { ascending: false });
    if (hId) {
      query = query.eq('household_id', hId);
    }
    const { data } = await query;
    if (data) setHistory(data);
  };

  // Auth Handlers
  const handleSignUp = async (e) => {
    e.preventDefault();
    setAuthError('');
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setAuthError(error.message);
    else alert('Controlla la tua email per confermare la registrazione!');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
  };

  // Computed Values
  const filteredGrocery = selectedCategory === 'All' 
    ? groceryItems 
    : groceryItems.filter(i => i.category === selectedCategory);

  const totalGroceryBudget = filteredGrocery.reduce((sum, item) => sum + (Number(item.price || item.estimated_price) || 0), 0);
  const totalSpentHistory = history.reduce((sum, item) => sum + (Number(item.price || item.price_paid) || 0), 0);
  
  const aiRecipesList = recipes.filter(r => r.is_ai_generated === true);
  const manualRecipesList = recipes.filter(r => !r.is_ai_generated);

  // --- UNAUTHENTICATED SCREEN ---
  if (!session) {
    return (
      <div className="min-h-screen bg-[#F7F4EF] text-[#3D3A35] flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-white border border-[#E5DEC9] p-6 rounded-3xl shadow-lg space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold text-[#6E7F6B]">Home & Nutri Hub</h1>
            <p className="text-xs text-[#8C8275]">Gestore Famiglia & Spesa</p>
          </div>

          <div className="flex border-b border-[#E5DEC9]">
            <button onClick={() => { setAuthMode('login'); setAuthError(''); }} className={`flex-1 py-2 text-center text-sm font-semibold border-b-2 transition ${authMode === 'login' ? 'border-[#6E7F6B] text-[#6E7F6B]' : 'border-transparent text-[#8C8275]'}`}>
              Accedi
            </button>
            <button onClick={() => { setAuthMode('signup'); setAuthError(''); }} className={`flex-1 py-2 text-center text-sm font-semibold border-b-2 transition ${authMode === 'signup' ? 'border-[#6E7F6B] text-[#6E7F6B]' : 'border-transparent text-[#8C8275]'}`}>
              Registrati
            </button>
          </div>

          {authError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-600 text-xs">
              {authError}
            </div>
          )}

          <form onSubmit={authMode === 'login' ? handleLogin : handleSignUp} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[#6E655F] block mb-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 text-[#A0958B]" size={16} />
                <input type="email" required placeholder="nome@esempio.com" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl pl-9 pr-3 py-2 text-sm text-[#3D3A35] focus:outline-none focus:border-[#6E7F6B]" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[#6E655F] block mb-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 text-[#A0958B]" size={16} />
                <input type="password" required placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl pl-9 pr-3 py-2 text-sm text-[#3D3A35] focus:outline-none focus:border-[#6E7F6B]" />
              </div>
            </div>

            <button type="submit" className="w-full bg-[#6E7F6B] hover:bg-[#5C6C59] text-white font-bold py-2.5 rounded-xl transition text-sm shadow-sm">
              {authMode === 'login' ? 'Accedi' : 'Crea Account'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- MAIN DASHBOARD SCREEN ---
  return (
    <div className="min-h-screen bg-[#F7F4EF] text-[#3D3A35] font-sans pb-24">
      <header className="bg-white border-b border-[#E5DEC9] p-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-md mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold text-[#6E7F6B]">Home & Nutri Hub</h1>
            <p className="text-[10px] text-[#8C8275]">{fullName || session.user.email}</p>
          </div>
          <button onClick={() => supabase.auth.signOut()} className="text-[#8C8275] hover:text-rose-600 p-2 rounded-xl bg-[#FAF8F5] border border-[#E5DEC9] transition">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-4">
        
        {/* PROFILE */}
        {activeTab === 'profilo' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#6E7F6B]">Profilo & Famiglia</h2>
            
            <div className="bg-white p-4 rounded-2xl border border-[#E5DEC9] space-y-3 shadow-sm">
              <p className="text-xs font-bold text-[#8C5A3C] uppercase tracking-wider">Informazioni Personali</p>
              <div>
                <label className="text-xs text-[#6E655F] block mb-1">Nome Completo</label>
                <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="es. Irene" className="w-full bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl p-2.5 text-sm focus:outline-none focus:border-[#6E7F6B]" />
              </div>

              <div>
                <label className="text-xs text-[#6E655F] block mb-1">Calorie Giornaliere (kcal)</label>
                <input type="number" value={calories} onChange={(e) => setCalories(e.target.value)} className="w-full bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl p-2.5 font-mono text-sm text-[#8C5A3C] font-bold focus:outline-none focus:border-[#6E7F6B]" />
              </div>

              <button onClick={saveProfile} className="w-full bg-[#6E7F6B] hover:bg-[#5C6C59] text-white font-bold p-2.5 rounded-xl transition text-sm">
                Salva Impostazioni
              </button>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-[#E5DEC9] space-y-3 shadow-sm">
              <div className="flex items-center gap-2 text-[#8C5A3C]">
                <Users size={18} />
                <p className="text-xs font-bold uppercase tracking-wider">Condivisione Famiglia</p>
              </div>
              <p className="text-xs text-[#8C8275]">Condividi questo codice per sincronizzare lista spesa, dispensa e menu con il tuo partner.</p>

              {householdCode ? (
                <div className="bg-[#FAF8F5] border border-[#E5DEC9] p-3 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-[#8C8275] block">Codice Famiglia Attivo</span>
                    <span className="text-sm font-mono font-bold text-[#6E7F6B]">{householdCode}</span>
                  </div>
                  <button onClick={() => { navigator.clipboard.writeText(householdCode); alert('Codice copiato!'); }} className="p-2 text-[#8C8275] hover:text-[#6E7F6B] transition">
                    <Copy size={16} />
                  </button>
                </div>
              ) : (
                <button onClick={createHouseholdCode} className="w-full bg-[#8C5A3C] hover:bg-[#784A2E] text-white font-bold p-2.5 rounded-xl text-xs transition">
                  Genera Codice Famiglia
                </button>
              )}

              <div className="pt-2 border-t border-[#E5DEC9] space-y-2">
                <label className="text-xs text-[#6E655F] block">Unisciti a Famiglia Esistente</label>
                <div className="flex gap-2">
                  <input type="text" placeholder="Inserisci Codice (es. HOME-X9K2)" value={inputCode} onChange={(e) => setInputCode(e.target.value)} className="flex-1 bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl p-2 text-xs focus:outline-none" />
                  <button onClick={joinHousehold} className="bg-[#6E7F6B] hover:bg-[#5C6C59] text-white font-bold px-4 py-2 rounded-xl text-xs transition">
                    Unisciti
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* WEEKLY MEAL PLANNER */}
        {activeTab === 'planner' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-[#6E7F6B]">Piano Alimentare Settimanale</h2>
              <button 
                onClick={resetPlanner}
                className="bg-white border border-[#E5DEC9] text-[#8C8275] hover:text-rose-600 px-2.5 py-1 rounded-xl text-xs flex items-center gap-1 transition shadow-sm font-semibold"
              >
                <RefreshCw size={12} /> Reset
              </button>
            </div>

            <div className="flex gap-1 overflow-x-auto pb-1 text-xs">
              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => (
                <button key={day} onClick={() => setSelectedDay(day)} className={`px-3 py-2 rounded-xl border font-bold transition whitespace-nowrap ${selectedDay === day ? 'bg-[#6E7F6B] border-[#6E7F6B] text-white shadow-sm' : 'bg-white border-[#E5DEC9] text-[#8C8275]'}`}>
                  {day === 'Monday' ? 'Lun' : day === 'Tuesday' ? 'Mar' : day === 'Wednesday' ? 'Mer' : day === 'Thursday' ? 'Gio' : day === 'Friday' ? 'Ven' : day === 'Saturday' ? 'Sab' : 'Dom'}
                </button>
              ))}
            </div>

            <div className="bg-white p-4 rounded-2xl border border-[#E5DEC9] space-y-4 shadow-sm">
              <div className="flex justify-between items-center border-b border-[#E5DEC9] pb-2">
                <span className="text-xs font-bold text-[#8C5A3C] uppercase">Menu del Giorno</span>
                <span className="text-xs font-mono font-bold text-[#6E7F6B]">Obiettivo: {calories} kcal</span>
              </div>

              {['Breakfast', 'Lunch', 'Dinner'].map((meal) => (
                <div key={meal} className="bg-[#FAF8F5] p-3 rounded-xl border border-[#E5DEC9] space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-[#3D3A35]">{meal === 'Breakfast' ? 'Colazione' : meal === 'Lunch' ? 'Pranzo' : 'Cena'}</span>
                    <span className="text-[10px] text-[#8C8275]">~{Math.round(calories * (meal === 'Breakfast' ? 0.25 : 0.37))} kcal</span>
                  </div>

                  <input 
                    type="text" 
                    placeholder={`Pianifica ${meal}...`} 
                    value={weeklyPlan[selectedDay][meal]} 
                    onChange={(e) => setWeeklyPlan({ ...weeklyPlan, [selectedDay]: { ...weeklyPlan[selectedDay], [meal]: e.target.value } })} 
                    className="w-full bg-white border border-[#E5DEC9] rounded-lg p-2 text-xs text-[#3D3A35] focus:outline-none focus:border-[#6E7F6B]" 
                  />

                  {recipes.length > 0 && (
                    <select
                      onChange={(e) => {
                        if (e.target.value) {
                          const selected = recipes.find(r => r.id === e.target.value);
                          if (selected) {
                            setWeeklyPlan({
                              ...weeklyPlan,
                              [selectedDay]: { 
                                ...weeklyPlan[selectedDay], 
                                [meal]: `${selected.title} (${selected.calories} kcal)` 
                              }
                            });
                          }
                        }
                      }}
                      defaultValue=""
                      className="w-full bg-[#F0EBE1] border border-[#D9D0C1] rounded-lg p-1.5 text-[11px] text-[#8C5A3C] font-semibold focus:outline-none"
                    >
                      <option value="" disabled>+ Scegli da Ricette Salvate...</option>
                      {recipes.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.is_ai_generated ? '✨ ' : '🍳 '} {r.title} ({r.calories} kcal)
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RECIPES */}
        {activeTab === 'recipes' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#6E7F6B]">Ricette</h2>

            <div className="flex bg-white border border-[#E5DEC9] rounded-2xl p-1 shadow-sm text-xs font-bold">
              <button 
                onClick={() => setRecipeSubTab('ai')} 
                className={`flex-1 py-2 rounded-xl flex items-center justify-center gap-1.5 transition ${
                  recipeSubTab === 'ai' ? 'bg-[#6E7F6B] text-white shadow-sm' : 'text-[#8C8275]'
                }`}
              >
                <Sparkles size={14} /> AI Generator ({aiRecipesList.length})
              </button>
              <button 
                onClick={() => setRecipeSubTab('manual')} 
                className={`flex-1 py-2 rounded-xl flex items-center justify-center gap-1.5 transition ${
                  recipeSubTab === 'manual' ? 'bg-[#6E7F6B] text-white shadow-sm' : 'text-[#8C8275]'
                }`}
              >
                <ChefHat size={14} /> Ricette Miei ({manualRecipesList.length})
              </button>
            </div>

            {recipeSubTab === 'ai' && (
              <div className="space-y-4">
                <div className="bg-[#F0EBE1] border border-[#D9D0C1] p-4 rounded-2xl space-y-3 shadow-sm">
                  <div className="flex items-center gap-2 text-[#8C5A3C]">
                    <Sparkles size={18} />
                    <p className="text-xs font-bold uppercase tracking-wider">Crea Ricetta con IA</p>
                  </div>
                  <p className="text-xs text-[#8C8275]">Inserisci gli ingredienti nel frigo (es. zucchine, uova, aglio):</p>
                  <input 
                    type="text" 
                    placeholder="es. Zucchine, Uova, Aglio" 
                    value={fridgeIngredients}
                    onChange={(e) => setFridgeIngredients(e.target.value)}
                    className="w-full bg-white border border-[#E5DEC9] rounded-xl p-2.5 text-xs text-[#3D3A35] focus:outline-none focus:border-[#8C5A3C]"
                  />
                  <button 
                    onClick={generateAIRecipe}
                    disabled={aiGenerating}
                    className="w-full bg-[#8C5A3C] hover:bg-[#784A2E] text-white font-bold p-2.5 rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-2"
                  >
                    {aiGenerating ? <Sparkles className="animate-spin" size={16} /> : <Sparkles size={16} />}
                    {aiGenerating ? 'L\'IA sta cucinando la ricetta...' : `Genera Ricetta per Target ${Math.round(calories * 0.35)} kcal`}
                  </button>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-bold text-[#8C8275] uppercase tracking-wider">Ricette IA Salvate</p>
                  {aiRecipesList.length === 0 ? (
                    <div className="bg-white border border-[#E5DEC9] p-6 rounded-2xl text-center space-y-1">
                      <Sparkles className="mx-auto text-[#8C5A3C]" size={24} />
                      <p className="text-xs font-bold text-[#3D3A35]">Nessuna ricetta IA ancora</p>
                    </div>
                  ) : (
                    aiRecipesList.map((r) => (
                      <div key={r.id} className="bg-white border border-[#E5DEC9] p-4 rounded-2xl space-y-2 shadow-sm relative">
                        <div className="flex justify-between items-start pr-6">
                          <div>
                            <span className="text-[9px] bg-[#F0EBE1] text-[#8C5A3C] font-bold px-2 py-0.5 rounded-md border border-[#D9D0C1] inline-flex items-center gap-1 mb-1">
                              <Sparkles size={10} /> IA GENERATED
                            </span>
                            <h3 className="text-sm font-bold text-[#3D3A35]">{r.title}</h3>
                          </div>
                          <span className="text-xs font-mono font-bold text-[#8C5A3C] bg-[#FAF8F5] px-2 py-0.5 rounded-md border border-[#E5DEC9]">{r.calories} kcal</span>
                        </div>
                        {r.instructions && (
                          <div className="text-xs text-[#6E655F] leading-relaxed bg-[#FAF8F5] p-3 rounded-xl border border-[#E5DEC9] space-y-1">
                            <p className="font-bold text-[10px] text-[#8C8275] uppercase">Preparazione:</p>
                            <p>{r.instructions}</p>
                          </div>
                        )}
                        <button onClick={() => deleteRecipe(r.id)} className="absolute top-3 right-3 text-[#A0958B] hover:text-rose-600 transition">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {recipeSubTab === 'manual' && (
              <div className="space-y-4">
                <form onSubmit={handleAddRecipeManually} className="bg-white p-4 rounded-2xl border border-[#E5DEC9] space-y-3 shadow-sm">
                  <p className="text-xs font-bold text-[#6E7F6B] uppercase">Aggiungi Ricetta Manuale</p>
                  <input type="text" placeholder="Titolo Ricetta" value={newRecipeTitle} onChange={(e) => setNewRecipeTitle(e.target.value)} className="w-full bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl p-2.5 text-xs focus:outline-none" />
                  <input type="number" placeholder="Calorie per porzione (kcal)" value={newRecipeCalories} onChange={(e) => setNewRecipeCalories(e.target.value)} className="w-full bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl p-2.5 text-xs focus:outline-none" />
                  <textarea placeholder="Ingredienti e Passaggi..." value={newRecipeInstructions} onChange={(e) => setNewRecipeInstructions(e.target.value)} className="w-full bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl p-2.5 text-xs focus:outline-none h-20" />
                  <button type="submit" className="w-full bg-[#6E7F6B] text-white font-bold p-2.5 rounded-xl text-xs">
                    Salva Ricetta
                  </button>
                </form>

                <div className="space-y-3">
                  {manualRecipesList.map((r) => (
                    <div key={r.id} className="bg-white border border-[#E5DEC9] p-4 rounded-2xl space-y-2 shadow-sm relative">
                      <div className="flex justify-between items-start pr-6">
                        <h3 className="text-sm font-bold text-[#3D3A35]">{r.title}</h3>
                        <span className="text-xs font-mono font-bold text-[#8C5A3C] bg-[#FAF8F5] px-2 py-0.5 rounded-md border border-[#E5DEC9]">{r.calories} kcal</span>
                      </div>
                      {r.instructions && <p className="text-xs text-[#6E655F] leading-relaxed bg-[#FAF8F5] p-2.5 rounded-xl border border-[#E5DEC9]">{r.instructions}</p>}
                      <button onClick={() => deleteRecipe(r.id)} className="absolute top-3 right-3 text-[#A0958B] hover:text-rose-600 transition">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        {/* GROCERY & EXPENSES */}
        {activeTab === 'spesa' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-[#6E7F6B]">Spesa & Spese</h2>
              <span className="text-xs font-mono font-bold text-[#8C5A3C] bg-white px-3 py-1 rounded-xl border border-[#E5DEC9] shadow-sm">
                Previsto: €{totalGroceryBudget.toFixed(2)}
              </span>
            </div>

            <div className="flex bg-white border border-[#E5DEC9] rounded-2xl p-1 shadow-sm text-xs font-bold">
              <button 
                onClick={() => setGrocerySubTab('items')} 
                className={`flex-1 py-2 rounded-xl flex items-center justify-center gap-1.5 transition ${
                  grocerySubTab === 'items' ? 'bg-[#6E7F6B] text-white shadow-sm' : 'text-[#8C8275]'
                }`}
              >
                <ShoppingBag size={14} /> Lista Spesa
              </button>
              <button 
                onClick={() => setGrocerySubTab('history')} 
                className={`flex-1 py-2 rounded-xl flex items-center justify-center gap-1.5 transition ${
                  grocerySubTab === 'history' ? 'bg-[#6E7F6B] text-white shadow-sm' : 'text-[#8C8275]'
                }`}
              >
                <BarChart2 size={14} /> Registro Spese (€{totalSpentHistory.toFixed(2)})
              </button>
            </div>

            {grocerySubTab === 'items' && (
              <div className="space-y-4">
                <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
                  {['All', 'Kitchen', 'Beauty Care', 'Cleaning', 'Home'].map((cat) => (
                    <button key={cat} onClick={() => setSelectedCategory(cat)} className={`px-3 py-1.5 rounded-xl border whitespace-nowrap font-medium transition ${selectedCategory === cat ? 'bg-[#6E7F6B] border-[#6E7F6B] text-white font-bold' : 'bg-white border-[#E5DEC9] text-[#8C8275]'}`}>
                      {cat}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleAddGrocery} className="bg-white p-4 rounded-2xl border border-[#E5DEC9] space-y-3 shadow-sm">
                  <input type="text" placeholder="Nome prodotto (es. Olio D'Oliva)" value={newItemName} onChange={(e) => setNewItemName(e.target.value)} className="w-full bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl p-2.5 text-xs focus:outline-none" />
                  <div className="grid grid-cols-2 gap-2">
                    <select value={newItemCategory} onChange={(e) => setNewItemCategory(e.target.value)} className="bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl p-2 text-xs">
                      <option value="Kitchen">Cucina</option>
                      <option value="Beauty Care">Cura Persona</option>
                      <option value="Cleaning">Pulizie</option>
                      <option value="Home">Casa</option>
                    </select>
                    <input type="number" step="0.01" placeholder="Prezzo Stimato (€)" value={newItemPrice} onChange={(e) => setNewItemPrice(e.target.value)} className="bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl p-2 text-xs" />
                  </div>
                  <button type="submit" className="w-full bg-[#6E7F6B] text-white font-bold p-2.5 rounded-xl flex items-center justify-center gap-2 text-sm shadow-sm">
                    <Plus size={16} /> Aggiungi alla Spesa
                  </button>
                </form>

                <div className="space-y-2">
                  {filteredGrocery.map((item) => (
                    <div key={item.id} className={`flex items-center justify-between p-3 rounded-2xl border transition shadow-sm ${item.completed ? 'bg-[#FAF8F5] border-[#E5DEC9] opacity-50' : 'bg-white border-[#E5DEC9]'}`}>
                      <div className="flex items-center gap-3">
                        <button onClick={() => toggleGroceryComplete(item)} className={`w-5 h-5 rounded-lg flex items-center justify-center border ${item.completed ? 'bg-[#6E7F6B] border-[#6E7F6B] text-white' : 'border-[#C8C0B0]'}`}>
                          {item.completed && <Check size={14} />}
                        </button>
                        <div>
                          <p className={`text-xs font-semibold ${item.completed ? 'line-through text-[#A0958B]' : 'text-[#3D3A35]'}`}>{item.name}</p>
                          <span className="text-[10px] bg-[#FAF8F5] text-[#8C8275] px-2 py-0.5 rounded-md border border-[#E5DEC9]">{item.category}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {(item.price || item.estimated_price) > 0 && <span className="text-xs text-[#8C5A3C] font-mono font-bold">€{Number(item.price || item.estimated_price).toFixed(2)}</span>}
                        <button onClick={() => deleteGroceryItem(item.id)} className="text-[#A0958B] hover:text-rose-600 transition"><Trash2 size={16} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {grocerySubTab === 'history' && (
              <div className="space-y-3">
                <div className="bg-[#FAF8F5] border border-[#E5DEC9] p-4 rounded-2xl flex justify-between items-center">
                  <div>
                    <span className="text-xs text-[#8C8275] font-bold block uppercase">Totale Speso Registrato</span>
                    <span className="text-xl font-mono font-bold text-[#6E7F6B]">€{totalSpentHistory.toFixed(2)}</span>
                  </div>
                  <BarChart2 className="text-[#6E7F6B]" size={28} />
                </div>

                <div className="space-y-2">
                  {history.map((h) => (
                    <div key={h.id} className="bg-white border border-[#E5DEC9] p-3 rounded-2xl flex justify-between items-center text-xs shadow-sm">
                      <div>
                        <p className="font-bold text-[#3D3A35]">{h.item_name}</p>
                        <span className="text-[10px] text-[#8C8275]">{new Date(h.purchased_at).toLocaleDateString('it-IT')}</span>
                      </div>
                      <span className="font-mono font-bold text-[#8C5A3C]">€{Number(h.price || h.price_paid || 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* HOME BASE (PANTRY) */}
        {activeTab === 'homebase' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#6E7F6B]">Home Base (Dispensa)</h2>

            <form onSubmit={handleAddEssential} className="bg-white p-4 rounded-2xl border border-[#E5DEC9] space-y-3 shadow-sm">
              <p className="text-xs font-bold text-[#6E7F6B] uppercase">Aggiungi Prodotto in Dispensa</p>
              <div className="flex gap-2">
                <input type="text" placeholder="Nome (es. Detersivo, Carta)" value={newEssentialName} onChange={(e) => setNewEssentialName(e.target.value)} className="flex-1 bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl p-2 text-xs focus:outline-none" />
                <select value={newEssentialCategory} onChange={(e) => setNewEssentialCategory(e.target.value)} className="bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl p-2 text-xs">
                  <option value="Casa">Casa</option>
                  <option value="Cucina">Cucina</option>
                  <option value="Bagno">Bagno</option>
                </select>
              </div>
              <button type="submit" className="w-full bg-[#6E7F6B] text-white font-bold p-2 rounded-xl text-xs flex items-center justify-center gap-1">
                <Plus size={14} /> Salva in Dispensa
              </button>
            </form>

            <div className="space-y-2">
              {essentials.map((item) => (
                <div key={item.id} className="bg-white border border-[#E5DEC9] p-3 rounded-2xl flex items-center justify-between shadow-sm">
                  <div>
                    <p className="text-xs font-semibold text-[#3D3A35]">{item.name}</p>
                    <span className="text-[10px] bg-[#FAF8F5] text-[#8C8275] px-2 py-0.5 rounded-md border border-[#E5DEC9]">{item.category}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleStock(item.id, item.status)} className={`px-2.5 py-1 rounded-xl text-xs font-bold transition ${item.status === 'ok' ? 'bg-[#EBF2EA] text-[#4A6347]' : 'bg-rose-50 text-rose-600'}`}>
                      {item.status === 'ok' ? 'Disponibile' : 'Esaurito'}
                    </button>
                    {item.status !== 'ok' && (
                      <button onClick={() => sendEssentialToGrocery(item)} title="Manda a lista spesa" className="bg-[#FAF8F5] border border-[#E5DEC9] p-1.5 rounded-xl text-[#8C5A3C]">
                        <ArrowRight size={14} />
                      </button>
                    )}
                    <button onClick={() => deleteEssential(item.id)} className="text-[#A0958B] hover:text-rose-600 p-1"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#E5DEC9] p-2 z-20 shadow-lg">
        <div className="max-w-md mx-auto grid grid-cols-5 gap-1">
          <button onClick={() => setActiveTab('profilo')} className={`flex flex-col items-center p-2 rounded-xl transition ${activeTab === 'profilo' ? 'text-[#6E7F6B] bg-[#FAF8F5] font-bold' : 'text-[#8C8275]'}`}>
            <User size={18} />
            <span className="text-[10px] mt-1">Profilo</span>
          </button>
          <button onClick={() => setActiveTab('planner')} className={`flex flex-col items-center p-2 rounded-xl transition ${activeTab === 'planner' ? 'text-[#6E7F6B] bg-[#FAF8F5] font-bold' : 'text-[#8C8275]'}`}>
            <Calendar size={18} />
            <span className="text-[10px] mt-1">Planner</span>
          </button>
          <button onClick={() => setActiveTab('recipes')} className={`flex flex-col items-center p-2 rounded-xl transition ${activeTab === 'recipes' ? 'text-[#6E7F6B] bg-[#FAF8F5] font-bold' : 'text-[#8C8275]'}`}>
            <BookOpen size={18} />
            <span className="text-[10px] mt-1">Ricette</span>
          </button>
          <button onClick={() => setActiveTab('spesa')} className={`flex flex-col items-center p-2 rounded-xl transition ${activeTab === 'spesa' ? 'text-[#6E7F6B] bg-[#FAF8F5] font-bold' : 'text-[#8C8275]'}`}>
            <ShoppingBag size={18} />
            <span className="text-[10px] mt-1">Spesa</span>
          </button>
          <button onClick={() => setActiveTab('homebase')} className={`flex flex-col items-center p-2 rounded-xl transition ${activeTab === 'homebase' ? 'text-[#6E7F6B] bg-[#FAF8F5] font-bold' : 'text-[#8C8275]'}`}>
            <Home size={18} />
            <span className="text-[10px] mt-1">Dispensa</span>
          </button>
        </div>
      </nav>
    </div>
  );
}