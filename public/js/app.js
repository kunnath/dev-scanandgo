/**
 * ScanAndGo – Frontend Application
 * Trivandrum Bus Tracking & Digital Ticketing
 * Author: Kunnath Sreelesh
 */

// ─── Burger Menu ─────────────────────────────────────────────────────────────
function toggleBurgerMenu(e) {
  e.stopPropagation();
  const dropdown = document.getElementById('burger-dropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
}
document.addEventListener('click', function () {
  const dropdown = document.getElementById('burger-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
});

// ─── State ──────────────────────────────────────────────────────────────────
let token = localStorage.getItem('scanandgo_token');
let currentUser = null;
let socket = null;
let map = null;
let busMarkers = {};
let stopMarkers = {};
let routePolyline = null;
let allRoutes = [];
let routeDetailsCache = {};
let currentRouteStops = [];
let currentRouteBuses = [];
let currentTrackingRouteId = null;
let pendingBooking = null;  // { routeId, stopId } for book-from-stop flow
let userLocationMarker = null;
let destinationSearchInitialized = false;
let destinationSearchDebounceTimer = null;
let originSearchDebounceTimer = null;
let busSearchDebounceTimer = null;
let originStop = null;
let destinationStop = null;
let searchedBusNumber = null;
let activeTripTab = 'track'; // 'track' or 'map'
let ownerDashboardRefreshTimer = null;
const OWNER_DASHBOARD_REFRESH_MS = 15000;
let ticketsRefreshTimer = null;
let walletRefreshTimer = null;
const TICKETS_WALLET_REFRESH_MS = 30000; // 30 seconds
const CHAT_ROOMS = ['general', 'movies', 'dating', 'politics'];
let profileChatInitialized = false;
let profileChatSocketBound = false;
let activeProfileChatRoom = 'general';
let profileChatMessagesByRoom = { general: [], movies: [], dating: [], politics: [] };
let joinedProfileChatRooms = new Set();

// ─── Owner Assignment Data Cache ─────────────────────────────────────────────
// Populated once per login; zone switches re-filter from memory (zero extra API calls).
// Cleared on logout and after every successful assignment (so next load is fresh).
let _ownerDropdownCache = null; // response from /owner/dropdown-data
let _ownerBusesCache    = null; // buses[] from /owner/buses-with-conductors

// ─── Zone Management ────────────────────────────────────────────────────────
// Populated dynamically from /api/zones – do NOT add hardcoded entries here.
const ZONE_CENTERS = {};
let currentZone = localStorage.getItem('scanandgo_zone') || 'trivandrum';

async function loadZones() {
  try {
    const data = await api('/zones');
    const zones = data.zones || [];
    const select = document.getElementById('zone-select');
    if (select) select.innerHTML = ''; // clear any static placeholders
    for (const z of zones) {
      ZONE_CENTERS[z.key] = { lat: z.center[0], lng: z.center[1], zoom: z.zoom };
      if (select) {
        const opt = document.createElement('option');
        opt.value = z.key;
        opt.textContent = `\uD83D\uDCCD ${z.name}`;
        select.appendChild(opt);
      }
    }
    // Validate stored zone is still valid; fall back to first available
    if (!ZONE_CENTERS[currentZone]) {
      currentZone = zones[0]?.key || 'trivandrum';
      localStorage.setItem('scanandgo_zone', currentZone);
    }
    if (select) select.value = currentZone;
  } catch (e) {
    console.error('[loadZones] Failed to load zones from API:', e);
  }
}

// Production: API on Render, Dev: same origin
const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.')
  ? ''
  //: 'https://scanandgo-mhzn.onrender.com';
  : 'https://scanandgo-api-s4y4.onrender.com';
const API = `${BACKEND_URL}/api`;

// ─── Console suppression in production ──────────────────────────────────────
// Prevents leaking internal API paths, error details, and data shapes
// to users via browser DevTools. Also guards against prototype pollution
// restoring the originals after this runs.
(function suppressConsoleInProduction() {
  const isLocal = window.location.hostname === 'localhost' ||
                  window.location.hostname === '127.0.0.1' ||
                  window.location.hostname.startsWith('192.168.');
  if (isLocal) return;

  const noop = function () {};
  Object.freeze(noop); // prevent tampering with the noop itself

  // Overwrite and lock each console method so external scripts
  // cannot restore originals via console.log = originalFn
  ['log', 'info', 'debug', 'dir', 'table', 'trace', 'group', 'groupEnd', 'groupCollapsed'].forEach(function (method) {
    try {
      Object.defineProperty(console, method, {
        value: noop,
        writable: false,
        configurable: false,
      });
    } catch (_) {
      // Fallback for environments where defineProperty on console is restricted
      console[method] = noop;
    }
  });
})();

// ─── Utility ────────────────────────────────────────────────────────────────
// Format a number as rupees with two decimals
function formatRupees(val) {
  return Number(val).toFixed(2);
}

// Get user location with zone center fallback if geolocation fails
function getUserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      const center = ZONE_CENTERS[currentZone] || { lat: 8.5241, lng: 76.9366 };
      resolve({ latitude: center.lat, longitude: center.lng });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
      },
      (error) => {
        console.warn('Geolocation failed, falling back to zone center:', error);
        const center = ZONE_CENTERS[currentZone] || { lat: 8.5241, lng: 76.9366 };
        resolve({ latitude: center.lat, longitude: center.lng });
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
      }
    );
  });
}

function getOwnerSubscription(user) {
  return user?.ownerSubscription || null;
}

function isOwnerSubscriptionActive(user) {
  if (!user || user.role !== 'owner') return true;
  return !!getOwnerSubscription(user)?.canAccessOwnerFeatures;
}

function formatDateTimeDisplay(dateValue) {
  if (!dateValue) return '-';
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function applyOwnerFeatureVisibility() {
  if (!currentUser || currentUser.role !== 'owner') return;
  const allowed = isOwnerSubscriptionActive(currentUser);
  const navOwner = document.getElementById('nav-owner-dashboard');
  if (navOwner) navOwner.style.display = allowed ? '' : 'none';

  const ownerAssignSection = document.getElementById('owner-assign-section');
  if (ownerAssignSection && !allowed) {
    ownerAssignSection.classList.add('hidden');
  }
}

function updateOwnerPlanPriceLabel() {
  if (!currentUser || currentUser.role !== 'owner') return;
  const ownerSub = getOwnerSubscription(currentUser) || {};
  const pricing = ownerSub.pricing || { thirty_days: 0, monthly: 0, yearly: 0 };
  const planSel = document.getElementById('owner-sub-plan');
  const priceEl = document.getElementById('owner-sub-price');
  if (!planSel || !priceEl) return;
  const selectedPlan = planSel.value || 'monthly';
  const amount = selectedPlan === 'yearly'
    ? (pricing.yearly || 0)
    : selectedPlan === 'thirty_days'
      ? (pricing.thirty_days || 0)
      : (pricing.monthly || 0);
  priceEl.textContent = `Amount: INR ${formatRupees(amount)}`;
}

function openOwnerSubscriptionCheckout(orderData) {
  const preferredMethod = document.getElementById('owner-sub-pay-method')?.value || 'upi';

  const options = {
    key: orderData.key,
    amount: orderData.amount,
    currency: orderData.currency,
    name: 'ScanAndGo',
    description: `${(orderData.subscriptionPlan || 'monthly').toUpperCase()} Owner Subscription`,
    order_id: orderData.order_id,
    prefill: {
      name: currentUser?.name || '',
      email: currentUser?.email || '',
      contact: currentUser?.phone || '',
    },
    config: {
      display: {
        blocks: {
          upi: {
            name: 'Pay using UPI',
            instruments: [{ method: 'upi', flows: ['qrcode', 'collect', 'intent'] }],
          },
        },
        sequence: ['block.upi'],
        preferences: { show_default_blocks: true },
      },
    },
    notes: {
      receiver_upi: orderData.receiverUpiId || 'kunnathadi@icici',
    },
    modal: {
      confirm_close: true,
      ondismiss: () => showToast('Subscription payment cancelled', 'warning'),
    },
    handler: async function (response) {
      try {
        const verifyRes = await api('/auth/owner-subscription/verify-payment', {
          method: 'POST',
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          }),
        });

        if (verifyRes.success) {
          currentUser = await api('/auth/me');
          applyOwnerFeatureVisibility();
          await loadProfile();
          showToast('Subscription activated. Dashboard and assign features are now enabled.', 'success');
        }
      } catch (err) {
        showToast(err.message || 'Subscription verification failed', 'error');
      }
    },
    theme: { color: '#e65100' },
  };

  if (preferredMethod === 'gpay') {
    options.config.display.blocks.upi.instruments = [
      { method: 'upi', apps: ['google_pay'], flows: ['intent'] },
      { method: 'upi', flows: ['qrcode', 'collect'] },
    ];
  } else if (preferredMethod === 'phonepe') {
    options.config.display.blocks.upi.instruments = [
      { method: 'upi', apps: ['phonepe'], flows: ['intent'] },
      { method: 'upi', flows: ['qrcode', 'collect'] },
    ];
  }

  const rzp = new Razorpay(options);
  rzp.on('payment.failed', (resp) => {
    showToast(`Payment failed: ${resp.error.description}`, 'error');
  });
  rzp.open();
}

function openOwnerSubscriptionSimulation(subscriptionPlan) {
  const ownerSub = getOwnerSubscription(currentUser) || {};
  const pricing = ownerSub.pricing || { thirty_days: 0, monthly: 0, yearly: 0 };
  const amount = subscriptionPlan === 'yearly'
    ? Number(pricing.yearly || 0)
    : subscriptionPlan === 'thirty_days'
      ? Number(pricing.thirty_days || 0)
      : Number(pricing.monthly || 0);
  const receiverUpi = ownerSub.receiverUpiId || 'kunnathadi@icici';
  const preferredMethod = document.getElementById('owner-sub-pay-method')?.value || 'upi';
  const appName = preferredMethod === 'gpay' ? 'Google Pay' : preferredMethod === 'phonepe' ? 'PhonePe' : 'UPI App';

  const overlay = document.createElement('div');
  overlay.className = 'upi-sim-overlay';
  overlay.innerHTML = `
    <div class="upi-sim-dialog">
      <div class="upi-sim-header">
        <div class="upi-sim-logo">
          <span style="font-size:40px;">💼</span>
        </div>
        <h3>${appName}</h3>
        <div class="upi-sim-dev-tag">Development Mode</div>
      </div>
      <div class="upi-sim-body">
        <p class="upi-sim-to">Owner Subscription Payment</p>
        <div class="upi-sim-amt">₹${amount.toFixed(2)}</div>
        <div class="upi-sim-upi">UPI: ${receiverUpi}</div>
        <div class="upi-sim-pin-box">
          <input type="password" maxlength="6" placeholder="Enter UPI PIN" class="upi-sim-pin" id="owner-sub-sim-pin">
        </div>
      </div>
      <div class="upi-sim-actions">
        <button class="upi-sim-cancel-btn" id="owner-sub-sim-cancel">Cancel</button>
        <button class="upi-sim-pay-btn" id="owner-sub-sim-pay" disabled>Pay ₹${Math.floor(amount)}</button>
      </div>
      <p class="upi-sim-note">⚠ Simulation mode — no real money charged.<br>Enter any 4–6 digit PIN to continue.</p>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));

  const pinInput = overlay.querySelector('#owner-sub-sim-pin');
  const payBtn = overlay.querySelector('#owner-sub-sim-pay');
  const cancelBtn = overlay.querySelector('#owner-sub-sim-cancel');

  pinInput.addEventListener('input', () => {
    payBtn.disabled = pinInput.value.length < 4;
  });
  setTimeout(() => pinInput.focus(), 350);

  cancelBtn.addEventListener('click', () => {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 300);
    showToast('Subscription payment cancelled', 'warning');
  });

  payBtn.addEventListener('click', async () => {
    payBtn.textContent = 'Processing...';
    payBtn.disabled = true;

    try {
      const devRes = await api('/auth/owner-subscription/dev-activate', {
        method: 'POST',
        body: JSON.stringify({ subscriptionPlan }),
      });

      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 300);

      if (devRes.success) {
        currentUser = await api('/auth/me');
        applyOwnerFeatureVisibility();
        await loadProfile();
        showToast('Dev mode: subscription activated. Owner dashboard and assignment enabled.', 'success');
      }
    } catch (err) {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 300);
      showToast(err.message || 'Dev subscription activation failed', 'error');
    }
  });
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  const res = await fetch(API + path, { 
    ...options, 
    headers: { ...headers, ...(options.headers || {}) } 
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || 'Request failed');
  return data;
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  
  toast.textContent = window.t ? window.t(message, message) : message;
  toast.className = 'toast toast-' + type;
  toast.classList.remove('hidden');
  
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function maskPhone(phone) {
  const raw = String(phone || '');
  if (raw.length < 6) return raw;
  return `${raw.slice(0, 2)}xxxx${raw.slice(-4)}`;
}

function formatChatTime(dateInput) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Assignment form submit
// Removed duplicate DOMContentLoaded - initialization now happens in enterApp() after login

// ─── Forgot Password ─────────────────────────────────────────────────────────
function hideForgotPanel() {
  document.getElementById('forgot-password-panel').classList.add('hidden');
  document.getElementById('forgot-email').value = '';
  document.getElementById('forgot-msg').style.display = 'none';
  const link = document.getElementById('forgot-password-link');
  if (link) link.style.display = '';
  const tabs = document.querySelector('.auth-tabs');
  if (tabs) tabs.classList.remove('hidden');
  const loginForm = document.getElementById('login-form');
  if (loginForm) loginForm.classList.remove('hidden');
}

async function submitForgotPassword() {
  const email = document.getElementById('forgot-email').value.trim();
  const msgEl = document.getElementById('forgot-msg');
  const btn   = document.getElementById('forgot-submit-btn');

  msgEl.style.display = 'none';

  if (!email) {
    msgEl.textContent = 'Please enter your email address.';
    msgEl.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;margin-top:10px;font-size:0.85rem;padding:8px 12px;border-radius:6px;border:1px solid #fca5a5;';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    const res = await fetch(`${API}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();

    if (res.ok) {
      msgEl.textContent = '✅ ' + (data.message || 'Reset link sent! Check your email inbox.');
      msgEl.style.cssText = 'display:block;background:#d1fae5;color:#065f46;margin-top:10px;font-size:0.85rem;padding:8px 12px;border-radius:6px;border:1px solid #6ee7b7;';
      btn.textContent = 'Sent!';
    } else {
      msgEl.textContent = data.error || 'Failed to send reset email. Try again.';
      msgEl.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;margin-top:10px;font-size:0.85rem;padding:8px 12px;border-radius:6px;border:1px solid #fca5a5;';
      btn.disabled = false;
      btn.textContent = 'Send Reset Link';
    }
  } catch {
    msgEl.textContent = 'Network error. Please try again.';
    msgEl.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;margin-top:10px;font-size:0.85rem;padding:8px 12px;border-radius:6px;border:1px solid #fca5a5;';
    btn.disabled = false;
    btn.textContent = 'Send Reset Link';
  }
}

// ─── Authentication ─────────────────────────────────────────────────────────
function initAuth() {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const roleSelect = document.getElementById('reg-role');
  const conductorFields = document.getElementById('conductor-fields');
  const ownerSubscriptionFields = document.getElementById('owner-subscription-fields');

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      if (tab === 'login') {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
      } else {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
      }
    });
  });

  const passengerFields = document.getElementById('passenger-fields');
  const ticketCategorySelect = document.getElementById('reg-ticket-category');
  const passDocGroup = document.getElementById('pass-document-group');

  // Show/hide conductor fields based on role selection
  if (roleSelect) {
    roleSelect.addEventListener('change', () => {
      // Reset passenger fields
      if (passengerFields) passengerFields.classList.add('hidden');
      
      if (roleSelect.value === 'conductor') {
        conductorFields?.classList.remove('hidden');
        ownerSubscriptionFields?.classList.add('hidden');
        initConductorCascade();
      } else if (roleSelect.value === 'owner') {
        conductorFields?.classList.add('hidden');
        ownerSubscriptionFields?.classList.remove('hidden');
      } else {
        // passenger
        conductorFields?.classList.add('hidden');
        ownerSubscriptionFields?.classList.add('hidden');
        if (passengerFields) passengerFields.classList.remove('hidden');
      }
    });
  }

  if (ticketCategorySelect) {
    ticketCategorySelect.addEventListener('change', () => {
      if (['student', 'free'].includes(ticketCategorySelect.value)) {
        if (passDocGroup) passDocGroup.classList.remove('hidden');
      } else {
        if (passDocGroup) passDocGroup.classList.add('hidden');
      }
    });
  }

  // Forgot password link
  const forgotLink = document.getElementById('forgot-password-link');
  if (forgotLink) {
    forgotLink.addEventListener('click', (e) => {
      e.preventDefault();
      const panel = document.getElementById('forgot-password-panel');
      panel.classList.remove('hidden');
      forgotLink.style.display = 'none';
      const tabs = document.querySelector('.auth-tabs');
      if (tabs) tabs.classList.add('hidden');
      const loginForm = document.getElementById('login-form');
      if (loginForm) loginForm.classList.add('hidden');
      document.getElementById('forgot-email').focus();
    });
  }

  // Login form submission
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('login-phone').value.trim();
      const password = document.getElementById('login-password').value;

      if (!input || !password) {
        showToast('Please enter username/phone and password', 'error');
        return;
      }

      // Detect if user typed an email address
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
      const payload = isEmail ? { email: input, password } : { phone: input, password };

      try {
        const data = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        token = data.token;
        currentUser = data.user;
        localStorage.setItem('scanandgo_token', token);
        showToast('Login successful!', 'success');
        
        setTimeout(() => {
          enterApp();
        }, 500);
      } catch (err) {
        showToast(err.message || 'Login failed', 'error');
      }
    });
  }

  // Register form submission
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const name = document.getElementById('reg-name').value.trim();
      const phone = document.getElementById('reg-phone').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      const role = document.getElementById('reg-role').value;

      if (!name || !phone || !password) {
        showToast('Please fill in all required fields', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('name', name);
      formData.append('phone', phone);
      formData.append('email', email);
      formData.append('password', password);
      formData.append('role', role);

      // Add conductor-specific fields if role is conductor
      if (role === 'conductor') {
        const zone = document.getElementById('reg-zone')?.value;
        const route = document.getElementById('reg-route')?.value;
        const bus = document.getElementById('reg-bus')?.value;
        
        if (zone) formData.append('zone', zone);
        if (route) formData.append('assignedRoute', route);
        if (bus) formData.append('assignedBus', bus);
        
        const upiId = document.getElementById('reg-upi-id')?.value.trim();
        if (upiId) formData.append('conductorUpiId', upiId);
      }

      if (role === 'owner') {
        const subscriptionPlan = document.getElementById('reg-owner-plan')?.value;
        if (!subscriptionPlan) {
          showToast('Please select a subscription plan for owner registration', 'error');
          return;
        }
        formData.append('subscriptionPlan', subscriptionPlan);
      }

      if (role === 'passenger') {
        const ticketCat = document.getElementById('reg-ticket-category')?.value || 'adult';
        formData.append('ticketCategory', ticketCat);

        if (['student', 'free'].includes(ticketCat)) {
          const passDocInput = document.getElementById('reg-pass-document');
          if (passDocInput && passDocInput.files[0]) {
            formData.append('passDocument', passDocInput.files[0]);
          } else {
            showToast('Pass document is mandatory for Student/Free categories', 'error');
            return;
          }
        }
      }

      try {
        const tokenVal = localStorage.getItem('scanandgo_token') || '';
        const res = await fetch(BACKEND_URL + '/api/auth/register', {
          method: 'POST',
          headers: tokenVal ? { 'Authorization': `Bearer ${tokenVal}` } : {},
          body: formData
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Registration failed');
        }

        token = data.token;
        currentUser = data.user;
        localStorage.setItem('scanandgo_token', token);
        showToast('Registration successful!', 'success');
        
        setTimeout(() => {
          enterApp();
        }, 500);
      } catch (err) {
        showToast(err.message || 'Registration failed', 'error');
      }
    });
  }
}

// ── Conductor Registration: Zone → Route → Bus Cascade ─────────────────────
let regRoutesCache = [];  // routes for selected zone
let regBusesCache = [];   // buses for selected route

function initConductorCascade() {
  const zoneSelect = document.getElementById('reg-zone');
  const routeSelect = document.getElementById('reg-route');
  const busInput = document.getElementById('reg-bus');
  if (!zoneSelect || !routeSelect || !busInput) return;

  // Zone change → load routes
  zoneSelect.addEventListener('change', async () => {
    const zone = zoneSelect.value;
    resetCascadeStep('route');
    resetCascadeStep('bus');

    if (!zone) {
      lockStep('route', '-- Select Zone First --');
      lockStep('bus', '-- Select Route First --');
      return;
    }

    try {
      const routes = await fetch(`${BACKEND_URL}/api/routes?zone=${zone}`).then(r => r.json());
      regRoutesCache = routes;
      routeSelect.innerHTML = '<option value="">-- Choose Route --</option>';
      routes.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id || r._id;
        opt.textContent = `${r.code} – ${r.name}`;
        routeSelect.appendChild(opt);
      });
      unlockStep('route');
    } catch (err) {
      console.error('Failed to load routes:', err);
      showToast('Failed to load routes', 'error');
    }
  });

  // Route change → load available buses for that route
  routeSelect.addEventListener('change', async () => {
    const routeId = routeSelect.value;
    resetCascadeStep('bus');

    if (!routeId) {
      lockStep('bus', '-- Select Route First --');
      return;
    }

    const zone = zoneSelect.value;
    try {
      // Only fetch available buses (not assigned to any route)
      const availableBuses = await fetch(`${BACKEND_URL}/api/buses/available?zone=${zone}`).then(r => r.json());
      regBusesCache = availableBuses;
      unlockStep('bus');
      busInput.placeholder = regBusesCache.length
        ? `Type bus number (${regBusesCache.length} available)`
        : 'No buses available for this route';
    } catch (err) {
      console.error('Failed to load buses:', err);
      showToast('Failed to load buses', 'error');
    }
  });

  // Bus input → validate + autocomplete
  busInput.addEventListener('input', () => {
    const val = busInput.value.trim().toUpperCase();
    busInput.value = val;
    validateBusNumber(val);
    showBusSuggestions(val);
  });

  busInput.addEventListener('focus', () => {
    const val = busInput.value.trim().toUpperCase();
    showBusSuggestions(val);
  });

  // Hide suggestions on blur (with delay so click registers)
  busInput.addEventListener('blur', () => {
    setTimeout(() => {
      document.getElementById('bus-suggestions')?.classList.add('hidden');
    }, 200);
  });
}

function lockStep(step, placeholderText) {
  const el = document.getElementById(`cascade-${step}`);
  el?.classList.add('cascade-locked');
  if (step === 'route') {
    const sel = document.getElementById('reg-route');
    sel.innerHTML = `<option value="">${placeholderText}</option>`;
    sel.disabled = true;
  } else if (step === 'bus') {
    const inp = document.getElementById('reg-bus');
    inp.value = '';
    inp.placeholder = placeholderText;
    inp.disabled = true;
    inp.dataset.busId = '';
    document.getElementById('bus-status-icon').textContent = '';
    document.getElementById('bus-hint').textContent = 'Format: KL-XX-X-XXXX (e.g. KL-15-A-1234)';
    document.getElementById('bus-hint').className = 'bus-hint';
    document.getElementById('bus-suggestions')?.classList.add('hidden');
  }
}

function unlockStep(step) {
  const el = document.getElementById(`cascade-${step}`);
  el?.classList.remove('cascade-locked');
  if (step === 'route') {
    document.getElementById('reg-route').disabled = false;
  } else if (step === 'bus') {
    document.getElementById('reg-bus').disabled = false;
  }
}

function resetCascadeStep(step) {
  if (step === 'route') {
    regRoutesCache = [];
    lockStep('route', '-- Select Zone First --');
  }
  if (step === 'bus') {
    regBusesCache = [];
    lockStep('bus', '-- Select Route First --');
  }
}

// Kerala bus number validation: KL-XX-X-XXXX or KL-XX-XX-XXXX
const BUS_NUMBER_REGEX = /^KL-\d{1,2}-[A-Z]{1,2}-\d{1,4}$/;

function validateBusNumber(val) {
  const icon = document.getElementById('bus-status-icon');
  const hint = document.getElementById('bus-hint');
  const input = document.getElementById('reg-bus');

  input.classList.remove('input-valid', 'input-invalid');
  icon.textContent = '';
  hint.className = 'bus-hint';

  if (!val) {
    hint.textContent = 'Format: KL-XX-X-XXXX (e.g. KL-15-A-1234)';
    input.dataset.busId = '';
    return;
  }

  // Check format
  if (!BUS_NUMBER_REGEX.test(val)) {
    icon.textContent = '⚠️';
    input.classList.add('input-invalid');
    hint.textContent = 'Invalid format. Use: KL-XX-X-XXXX (e.g. KL-15-A-1234)';
    hint.className = 'bus-hint bus-hint-error';
    input.dataset.busId = '';
    return;
  }

  // Check if bus exists in available list
  const match = regBusesCache.find(b => b.registration.toUpperCase() === val);
  if (match) {
    icon.textContent = '✅';
    input.classList.add('input-valid');
    hint.textContent = `Bus found: ${match.registration} (${match.type || 'ordinary'})`;
    hint.className = 'bus-hint bus-hint-success';
    input.dataset.busId = match.id || match._id;
  } else {
    icon.textContent = '❌';
    input.classList.add('input-invalid');
    hint.textContent = 'Bus not found for this route. Check the number.';
    hint.className = 'bus-hint bus-hint-error';
    input.dataset.busId = '';
  }
}

function showBusSuggestions(val) {
  const container = document.getElementById('bus-suggestions');
  if (!container) return;

  const filtered = val
    ? regBusesCache.filter(b => b.registration.toUpperCase().includes(val))
    : regBusesCache.slice(0, 8);

  if (!filtered.length || document.getElementById('reg-bus').disabled) {
    container.classList.add('hidden');
    return;
  }

  container.innerHTML = filtered.slice(0, 6).map(b => `
    <div class="bus-sug-item" data-id="${b.id || b._id}" data-reg="${b.registration}">
      <span class="bus-sug-reg">🚌 ${b.registration}</span>
      <span class="bus-sug-type">${b.type || 'ordinary'}</span>
    </div>
  `).join('');

  container.classList.remove('hidden');

  // Click handler for suggestions
  container.querySelectorAll('.bus-sug-item').forEach(item => {
    item.addEventListener('click', () => {
      const input = document.getElementById('reg-bus');
      input.value = item.dataset.reg;
      input.dataset.busId = item.dataset.id;
      validateBusNumber(item.dataset.reg.toUpperCase());
      container.classList.add('hidden');
    });
  });
}

function loadRegZones() {
  // Zones are statically listed in HTML, nothing to load dynamically
  // But reset cascade when opening conductor fields
  resetCascadeStep('route');
  resetCascadeStep('bus');
  document.getElementById('reg-zone').value = '';
}

// Legacy support: loadRegDropdowns is now handled by cascade
async function loadRegDropdowns() {
  // Cascade handles everything; no-op for backwards compat
}

// ─── Enter main app ─────────────────────────────────────────────────────────
// (Removed duplicate - see full implementation below)

// Modal open/close logic for Assign Bus modal
function setupAssignModalListeners() {
  const openBtn = document.getElementById('open-assign-modal');
  const closeBtn = document.getElementById('close-assign-modal');
  const modal = document.getElementById('assign-modal');
  if (openBtn && modal && !openBtn._assignModalListenerAttached) {
    openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      modal.classList.remove('hidden');
      setTimeout(() => {
        const firstInput = modal.querySelector('select, input, textarea');
        if (firstInput) firstInput.focus();
      }, 100);
    });
    openBtn._assignModalListenerAttached = true;
  }
  if (closeBtn && modal && !closeBtn._assignModalListenerAttached) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      modal.classList.add('hidden');
    });
    closeBtn._assignModalListenerAttached = true;
  }
  const overlay = modal?.querySelector('.modal-overlay');
  if (overlay && !overlay._assignModalListenerAttached) {
    overlay.addEventListener('click', () => modal.classList.add('hidden'));
    overlay._assignModalListenerAttached = true;
  }
}

// ─── Enter main app ─────────────────────────────────────────────────────────
// (Removed duplicate enterApp - see full implementation below)

// ─── Owner Dashboard Metrics ─────────────────────────────────────────────
// Owner Dashboard: Analytics, Metrics + Assignments
window.loadOwnerDashboard = async function loadOwnerDashboard() {
  setDashboardLoading(true);
  try {
    // Execute all data fetching concurrently to improve performance
    const overviewPromise = api('/owner/analytics/overview');
    const revenuePromise = loadRevenueBreakdown('daily');
    const routePromise = loadRouteAnalytics();
    const busPromise = loadBusAnalytics();
    const ticketsPromise = loadRecentTickets();
    const assignmentsPromise = loadAssignmentsAndOptions();

    const [overview] = await Promise.all([
      overviewPromise,
      revenuePromise,
      routePromise,
      busPromise,
      ticketsPromise,
      assignmentsPromise
    ]);
    
    // Update metric cards
    document.getElementById('metric-total-buses').textContent = overview.totalBuses ?? 0;
    document.getElementById('metric-active-buses').textContent = overview.activeBuses ?? 0;
    document.getElementById('metric-tickets-sold').textContent = overview.totalTicketsSold ?? 0;
    document.getElementById('metric-total-revenue').textContent = '₹' + formatRupees(overview.totalRevenue ?? 0);
    document.getElementById('metric-today-revenue').textContent = '₹' + formatRupees(overview.todayRevenue ?? 0);
    document.getElementById('metric-month-revenue').textContent = '₹' + formatRupees(overview.monthlyRevenue ?? 0);
    
    // Setup modal listeners
    setupAssignModalListeners();
    
    // Setup period button listeners
    setupPeriodButtonListeners();
    
    // Setup refresh button
    setupRefreshListener();

    const liveStatus = document.getElementById('owner-dashboard-live-status');
    if (liveStatus) {
      liveStatus.textContent = `Updated at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }
    
  } catch (err) {
    console.error('Failed to load dashboard:', err);
    showToast('Failed to load dashboard data', 'error');
  } finally {
    setDashboardLoading(false);
  }
}

function startOwnerDashboardAutoRefresh() {
  if (ownerDashboardRefreshTimer) clearInterval(ownerDashboardRefreshTimer);

  ownerDashboardRefreshTimer = setInterval(async () => {
    const dashboardPage = document.getElementById('page-owner-dashboard');
    const isDashboardVisible = dashboardPage && !dashboardPage.classList.contains('hidden');
    if (!isDashboardVisible || currentUser?.role !== 'owner') return;

    try {
      await loadOwnerDashboard();
    } catch (err) {
      console.error('[Owner Dashboard] Auto-refresh failed:', err);
    }
  }, OWNER_DASHBOARD_REFRESH_MS);
}

function stopOwnerDashboardAutoRefresh() {
  if (ownerDashboardRefreshTimer) {
    clearInterval(ownerDashboardRefreshTimer);
    ownerDashboardRefreshTimer = null;
  }
}

function startTicketsAutoRefresh() {
  if (ticketsRefreshTimer) clearInterval(ticketsRefreshTimer);
  ticketsRefreshTimer = setInterval(() => {
    if (document.getElementById('page-tickets').classList.contains('active')) {
      loadMyTickets();
    }
  }, TICKETS_WALLET_REFRESH_MS);
}

function stopTicketsAutoRefresh() {
  if (ticketsRefreshTimer) {
    clearInterval(ticketsRefreshTimer);
    ticketsRefreshTimer = null;
  }
}

function startWalletAutoRefresh() {
  if (walletRefreshTimer) clearInterval(walletRefreshTimer);
  walletRefreshTimer = setInterval(() => {
    if (document.getElementById('page-wallet').classList.contains('active')) {
      loadWalletPage();
    }
  }, TICKETS_WALLET_REFRESH_MS);
}

function stopWalletAutoRefresh() {
  if (walletRefreshTimer) {
    clearInterval(walletRefreshTimer);
    walletRefreshTimer = null;
  }
}

async function loadAdminDashboard() {
  try {
    const data = await api('/admin/dashboard');
    const billing = data.billing || {};
    const usage = data.usage || {};
    const ownerSubs = usage.ownerSubscriptions || {};

    document.getElementById('admin-total-billing').textContent = `₹${formatRupees(billing.totalCollected || 0)}`;
    document.getElementById('admin-billing-30d').textContent = `₹${formatRupees(billing.collectedLast30Days || 0)}`;
    document.getElementById('admin-payments-today').textContent = `${billing.paymentsToday || 0}`;
    document.getElementById('admin-owner-subs').textContent = `${ownerSubs.active || 0} / ${ownerSubs.expired || 0}`;
    document.getElementById('admin-users-total').textContent = `${usage?.users?.total || 0}`;
    document.getElementById('admin-tickets-today').textContent = `${usage?.tickets?.today || 0}`;

    renderAdminRecentPayments(billing.recentPayments || []);

    // Wire ad form submit once
    const adForm = document.getElementById('admin-new-ad-form');
    if (adForm && !adForm._adBound) {
      adForm._adBound = true;
      adForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/admin/ads', {
            method: 'POST',
            body: JSON.stringify({
              title: document.getElementById('ad-title').value.trim(),
              description: document.getElementById('ad-description').value.trim(),
              url: document.getElementById('ad-url').value.trim(),
              imageUrl: document.getElementById('ad-image-url').value.trim(),
            }),
          });
          adForm.reset();
          document.getElementById('admin-ad-form-wrap').classList.add('hidden');
          loadAdminAds();
          showToast('Advertisement posted!', 'success');
        } catch (err) {
          showToast(err.message || 'Failed to post ad', 'error');
        }
      });
    }
    loadAdminAds();
  } catch (err) {
    showToast(err.message || 'Failed to load admin dashboard', 'error');
  }
}

function renderAdminRecentPayments(payments) {
  const container = document.getElementById('admin-recent-payments');
  if (!container) return;

  if (!payments.length) {
    container.innerHTML = '<div class="empty-state">No payment records yet</div>';
    return;
  }

  container.innerHTML = `
    <table class="analytics-table">
      <thead>
        <tr>
          <th>Owner</th>
          <th>Plan</th>
          <th>Amount</th>
          <th>Provider</th>
          <th>Paid At</th>
        </tr>
      </thead>
      <tbody>
        ${payments.map((p) => `
          <tr>
            <td data-label="Owner">
              <strong>${escapeHtml(p.owner?.name || 'Unknown')}</strong><br>
              <small>${escapeHtml(p.owner?.phone || '-')}</small>
            </td>
            <td data-label="Plan">${escapeHtml(String(p.plan || '-').replace('_', ' ').toUpperCase())}</td>
            <td data-label="Amount">₹${formatRupees(p.amount || 0)}</td>
            <td data-label="Provider">${escapeHtml(p.provider || '-')}</td>
            <td data-label="Paid At">${formatDateTimeDisplay(p.paidAt)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ── Advertisement helpers ─────────────────────────────────────────────────

function toggleAdForm() {
  const wrap = document.getElementById('admin-ad-form-wrap');
  if (wrap) wrap.classList.toggle('hidden');
}

async function loadAdminAds() {
  const container = document.getElementById('admin-ads-list');
  if (!container) return;
  try {
    const data = await api('/admin/ads');
    const ads = data.ads || [];
    if (!ads.length) {
      container.innerHTML = '<div class="empty-state">No advertisements yet</div>';
      return;
    }
    container.innerHTML = `
      <table class="analytics-table">
        <thead><tr><th>Title</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${ads.map(ad => `
            <tr>
              <td data-label="Title">
                <strong>${escapeHtml(ad.title)}</strong>
                ${ad.url ? `<br><a href="${escapeHtml(ad.url)}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:#2563eb;">${escapeHtml(ad.url)}</a>` : ''}
              </td>
              <td data-label="Description">${escapeHtml(ad.description)}</td>
              <td data-label="Status"><span class="stat-badge ${ad.isActive ? 'stat-green' : 'stat-red'}">${ad.isActive ? 'Active' : 'Paused'}</span></td>
              <td data-label="Actions" style="white-space:nowrap;">
                <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;margin-right:4px;" onclick="toggleAdStatus('${ad._id}')">Toggle</button>
                <button class="btn btn-danger" style="font-size:11px;padding:4px 10px;" onclick="deleteAd('${ad._id}')">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = '<div class="empty-state">Failed to load advertisements</div>';
  }
}

async function toggleAdStatus(id) {
  try {
    await api(`/admin/ads/${id}/toggle`, { method: 'PUT' });
    loadAdminAds();
    showToast('Ad status updated', 'success');
  } catch (e) {
    showToast('Failed to update ad', 'error');
  }
}

async function deleteAd(id) {
  if (!confirm('Delete this advertisement?')) return;
  try {
    await api(`/admin/ads/${id}`, { method: 'DELETE' });
    loadAdminAds();
    showToast('Ad deleted', 'success');
  } catch (e) {
    showToast('Failed to delete ad', 'error');
  }
}

async function loadProfileAds() {
  const section = document.getElementById('profile-ads-section');
  if (!section) return;
  try {
    const data = await api('/admin/ads');
    const ads = data.ads || [];
    if (!ads.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    section.innerHTML = `
      <span class="profile-ads-label">Sponsored</span>
      ${ads.map(ad => `
        <a class="ad-card" ${ad.url ? `href="${escapeHtml(ad.url)}" target="_blank" rel="noopener noreferrer"` : 'role="presentation"'}>
          ${ad.imageUrl
            ? `<img class="ad-card-img" src="${escapeHtml(ad.imageUrl)}" alt="${escapeHtml(ad.title)}" onerror="this.style.display='none'">`
            : `<div class="ad-card-icon">📢</div>`
          }
          <div class="ad-card-body">
            <div class="ad-card-title">${escapeHtml(ad.title)}</div>
            <div class="ad-card-desc">${escapeHtml(ad.description)}</div>
            <div class="ad-card-meta"><span class="ad-card-sponsored">Ad</span></div>
          </div>
          ${ad.url ? `<div class="ad-card-arrow">↗</div>` : ''}
        </a>
      `).join('')}
    `;
  } catch (e) {
    section.style.display = 'none';
  }
}

// ─────────────────────────────────────────────────────────────────────────────

// Load revenue breakdown chart
async function loadRevenueBreakdown(period = 'daily') {
  try {
    const data = await api(`/owner/analytics/revenue-breakdown?period=${period}`);
    renderRevenueChart(data.data, period);
  } catch (err) {
    console.error('Failed to load revenue breakdown:', err);
  }
}

// Render revenue chart
function renderRevenueChart(data, period) {
  const container = document.getElementById('revenue-chart-container');
  if (!container || !data || !data.length) {
    container.innerHTML = '<div class="empty-state">No revenue data available</div>';
    return;
  }
  
  const maxRevenue = Math.max(...data.map(d => d.revenue));
  const barHeightMultiplier = maxRevenue > 0 ? 200 / maxRevenue : 0;
  
  let labelFormatter = (label) => label;
  if (period === 'daily') {
    labelFormatter = (label) => new Date(label).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  } else if (period === 'monthly') {
    labelFormatter = (label) => label; // Already formatted as "Jan 2024"
  } else if (period === 'hourly') {
    labelFormatter = (label) => `${label}:00`;
  }
  
  container.innerHTML = `
    <div class="revenue-chart">
      ${data.map(item => `
        <div class="chart-bar-container">
          <div class="chart-bar" style="height: ${item.revenue * barHeightMultiplier}px;">
            <span class="bar-value">₹${item.revenue}</span>
          </div>
          <div class="chart-label">${labelFormatter(item._id)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// Load route-wise analytics
async function loadRouteAnalytics() {
  try {
    const data = await api('/owner/analytics/route-wise');
    renderRouteAnalytics(data.routes || []);
  } catch (err) {
    console.error('Failed to load route analytics:', err);
    document.getElementById('route-analytics-table').innerHTML = '<div class="empty-state">Failed to load route data</div>';
  }
}

// Render route analytics table
function renderRouteAnalytics(routes) {
  const container = document.getElementById('route-analytics-table');
  if (!routes || !routes.length) {
    container.innerHTML = '<div class="empty-state">No route data available</div>';
    return;
  }
  
  container.innerHTML = `
    <table class="analytics-table">
      <thead>
        <tr>
          <th>Route</th>
          <th>Buses Assigned</th>
          <th>Total Tickets</th>
          <th>Total Revenue</th>
          <th>Avg. Revenue/Bus</th>
        </tr>
      </thead>
      <tbody>
        ${routes.map(route => `
          <tr>
            <td data-label="Route"><strong>${route.routeName || 'N/A'}</strong><br><small>${route.routeCode || ''}</small></td>
            <td data-label="Buses">${route.busCount}</td>
            <td data-label="Tickets">${route.totalTickets}</td>
            <td data-label="Revenue">₹${formatRupees(route.totalRevenue)}</td>
            <td data-label="Avg/Bus">₹${formatRupees(route.avgRevenuePerBus)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// Load bus-wise analytics
async function loadBusAnalytics() {
  try {
    const data = await api('/owner/analytics/bus-wise');
    renderBusAnalytics(data.buses || []);
  } catch (err) {
    console.error('Failed to load bus analytics:', err);
    document.getElementById('bus-analytics-table').innerHTML = '<div class="empty-state">Failed to load bus data</div>';
  }
}

// Render bus analytics table
function renderBusAnalytics(buses) {
  const container = document.getElementById('bus-analytics-table');
  if (!buses || !buses.length) {
    container.innerHTML = '<div class="empty-state">No bus data available</div>';
    return;
  }
  
  container.innerHTML = `
    <table class="analytics-table">
      <thead>
        <tr>
          <th>Bus Number</th>
          <th>Route</th>
          <th>Status</th>
          <th>Total Tickets</th>
          <th>Total Revenue</th>
          <th>Expenses</th>
          <th>Net Profit</th>
          <th>Utilization</th>
        </tr>
      </thead>
      <tbody>
        ${buses.map(bus => {
          const expenses  = bus.totalExpenses || 0;
          const profit    = (bus.netProfit !== undefined) ? bus.netProfit : (bus.totalRevenue - expenses);
          const profitColor = profit >= 0 ? '#065f46' : '#991b1b';
          const profitBg    = profit >= 0 ? '#dcfce7' : '#fee2e2';
          return `
            <tr>
              <td data-label="Bus"><strong>${bus.busNumber}</strong></td>
              <td data-label="Route">${bus.routeName || 'Unassigned'}</td>
              <td data-label="Status"><span class="status-pill status-${bus.status.toLowerCase()}">${bus.status}</span></td>
              <td data-label="Tickets">${bus.totalTickets}</td>
              <td data-label="Revenue">₹${formatRupees(bus.totalRevenue)}</td>
              <td data-label="Expenses"
                style="color:#e65100;cursor:pointer;text-decoration:underline;text-underline-offset:3px;"
                title="Click to view expense details"
                onclick="showBusExpenseModal('${bus.busId || bus._id}', '${(bus.busNumber||'').replace(/'/g, '')}')">
                ₹${formatRupees(expenses)}${expenses > 0 ? ' 📋' : ''}
              </td>
              <td data-label="Net Profit">
                <strong style="color:${profitColor};background:${profitBg};padding:2px 8px;border-radius:10px;font-size:12px;white-space:nowrap;">
                  ${profit >= 0 ? '▲' : '▼'} ₹${formatRupees(Math.abs(profit))}
                </strong>
              </td>
              <td data-label="Utilization">${bus.capacityUtilization}%</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

// ─── Owner: Show expense detail modal for a bus ───────────────────────────────
async function showBusExpenseModal(busId, busNumber) {
  const modal  = document.getElementById('bus-expense-modal');
  const title  = document.getElementById('bus-expense-modal-title');
  const body   = document.getElementById('bus-expense-modal-body');
  if (!modal || !body) return;

  title.textContent = `📋 Expenses — Bus ${busNumber}`;
  body.innerHTML = '<p style="color:#888;font-size:13px;text-align:center;padding:20px 0;">Loading…</p>';
  modal.style.display = 'block';

  try {
    const data = await api(`/owner/analytics/bus/${busId}/expenses`);
    const entries = data.entries || [];

    if (!entries.length) {
      body.innerHTML = '<p style="color:#888;font-size:14px;text-align:center;padding:20px 0;">No expense entries found for this bus.</p>';
      return;
    }

    // Summary cards
    const invoiceTotal = entries.filter(e => e.type === 'invoice').reduce((s, e) => s + e.amount, 0);
    const expenseTotal = entries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
    const withProof    = entries.filter(e => e.proofKey).length;

    const summaryHtml = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
        <div style="background:#eff6ff;border-radius:10px;padding:10px 12px;text-align:center;">
          <div style="font-size:11px;color:#1a73e8;font-weight:600;">🧾 INVOICES</div>
          <div style="font-size:15px;font-weight:800;color:#1a73e8;margin-top:2px;">₹${formatRupees(invoiceTotal)}</div>
        </div>
        <div style="background:#fff7ed;border-radius:10px;padding:10px 12px;text-align:center;">
          <div style="font-size:11px;color:#e65100;font-weight:600;">💸 EXPENSES</div>
          <div style="font-size:15px;font-weight:800;color:#e65100;margin-top:2px;">₹${formatRupees(expenseTotal)}</div>
        </div>
        <div style="background:#f0fdf4;border-radius:10px;padding:10px 12px;text-align:center;">
          <div style="font-size:11px;color:#065f46;font-weight:600;">📎 WITH PROOF</div>
          <div style="font-size:15px;font-weight:800;color:#065f46;margin-top:2px;">${withProof} / ${entries.length}</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #e5e7eb;">
        <span style="font-weight:700;font-size:14px;color:#111827;">${entries.length} Entries</span>
        <span style="font-weight:800;font-size:14px;">Total: <span style="color:#e65100;">₹${formatRupees(data.totalExpenses || 0)}</span></span>
      </div>`;

    let attachmentIndex = 0;
    const rows = entries.map(e => {
      const isInvoice = e.type === 'invoice';
      const color     = isInvoice ? '#1a73e8' : '#e65100';
      const label     = isInvoice ? '🧾 Invoice' : '💸 Expense';
      const dateStr   = new Date(e.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      let proofHtml   = '';
      if (e.proofKey) {
        attachmentIndex++;
        const idx = attachmentIndex;
        proofHtml = `<span
          onclick="openProofUrl('owner','${escapeHtml(busId)}','${e.id}','${escapeHtml(e.proofMimeType||'')}','${escapeHtml(e.proofOriginalName||'proof')}')"
          title="${escapeHtml(e.proofOriginalName || 'View attachment')}"
          style="display:inline-flex;align-items:center;gap:3px;margin-top:5px;padding:2px 8px;background:#e8f0fe;color:#1a73e8;border-radius:10px;font-size:11px;font-weight:600;cursor:pointer;user-select:none;">
          📎 ${idx}
        </span>`;
      }
      return `
        <div style="border-left:3px solid ${color};padding:10px 12px;margin-bottom:8px;background:#f9fafb;border-radius:0 8px 8px 0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <span style="font-weight:700;font-size:13px;color:${color};">${label}</span>
              <span style="font-size:11px;color:#9ca3af;margin-left:6px;">${dateStr}</span>
            </div>
            <span style="font-weight:800;font-size:14px;color:#111827;">₹${formatRupees(e.amount)}</span>
          </div>
          <div style="font-size:12px;color:#374151;margin-top:4px;">${escapeHtml(e.details || '—')}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">
            <span style="font-size:11px;color:#6b7280;">👤 ${escapeHtml(e.conductorName)}${e.conductorPhone ? ' · ' + escapeHtml(e.conductorPhone) : ''}</span>
            ${proofHtml}
          </div>
        </div>`;
    }).join('');

    body.innerHTML = summaryHtml + rows;
  } catch (err) {
    body.innerHTML = `<p style="color:#991b1b;font-size:13px;text-align:center;padding:20px 0;">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

// Load recent tickets
async function loadRecentTickets(limit = 10) {
  try {
    const data = await api(`/owner/analytics/tickets?limit=${limit}`);
    renderRecentTickets(data.tickets || []);
  } catch (err) {
    console.error('Failed to load recent tickets:', err);
    document.getElementById('recent-tickets-table').innerHTML = '<div class="empty-state">Failed to load tickets</div>';
  }
}

// Render recent tickets table
function renderRecentTickets(tickets) {
  const container = document.getElementById('recent-tickets-table');
  if (!tickets || !tickets.length) {
    container.innerHTML = '<div class="empty-state">No tickets found</div>';
    return;
  }
  
  container.innerHTML = `
    <table class="analytics-table">
      <thead>
        <tr>
          <th>Ticket ID</th>
          <th>Passenger</th>
          <th>Bus</th>
          <th>Route</th>
          <th>Tickets</th>
          <th>Fare</th>
          <th>Status</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        ${tickets.map(ticket => {
          const date = new Date(ticket.createdAt);
          const dateStr = date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
          const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
          const ticketCount = ticket.count || 1;
          const totalFare = ticket.total_fare || (ticket.fare * ticketCount);
          return `
            <tr>
              <td data-label="ID"><code>${ticket.ticketId || ticket._id.slice(-6)}</code></td>
              <td data-label="Passenger">${ticket.passengerName || 'N/A'}<br><small>${ticket.passengerPhone || ''}</small></td>
              <td data-label="Bus">${ticket.busNumber || 'N/A'}</td>
              <td data-label="Route">${ticket.routeName || 'N/A'}</td>
              <td data-label="Tickets"><span style="background:#e8f0fe;color:#1a73e8;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;">🎟️ ×${ticketCount}</span></td>
              <td data-label="Fare">₹${formatRupees(totalFare)}</td>
              <td data-label="Status"><span class="status-pill status-${ticket.status.toLowerCase()}">${ticket.status}</span></td>
              <td data-label="Date">${dateStr}<br><small>${timeStr}</small></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// Setup period button listeners
function setupPeriodButtonListeners() {
  const periodBtns = document.querySelectorAll('.period-btn');
  periodBtns.forEach(btn => {
    if (!btn._periodListenerAttached) {
      btn.addEventListener('click', async (e) => {
        const period = btn.dataset.period;
        
        // Update active state
        periodBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Reload revenue chart
        await loadRevenueBreakdown(period);
      });
      btn._periodListenerAttached = true;
    }
  });
}

// Setup refresh button listener
function setupRefreshListener() {
  const refreshBtn = document.getElementById('refresh-dashboard-btn');
  if (refreshBtn && !refreshBtn._refreshListenerAttached) {
    refreshBtn.addEventListener('click', async () => {
      await loadOwnerDashboard();
      showToast('Dashboard refreshed', 'success');
    });
    refreshBtn._refreshListenerAttached = true;
  }
}

// Fetch assignments and available options for assignment (new BusAssignment model)
async function loadAssignmentsAndOptions() {
  let assignments = [];
  try {
    const resp = await api('/owner/assignments-dashboard');
    assignments = resp.assignments || [];
  } catch (err) {
    assignments = [];
  }
  if (!assignments.length) {
    assignments = [
      {
        bus: { registration: 'KL-13-1234' },
        routeId: { name: 'Kannur Town – Thalassery' },
        conductorId: { name: 'Demo Conductor' },
        status: 'Active'
      }
    ];
  }
  renderAssignmentsList(assignments);

  // Fetch options for modal
  try {
    let [buses, routesResp, conductorsResp] = await Promise.all([
      api('/owner/available-buses'),
      api('/owner/available-routes'),
      api('/owner/available-conductors')
    ]);
    const routes = routesResp.routes || [];
    const conductors = conductorsResp.conductors || [];
    populateAssignOptions(buses, routes, conductors);
  } catch (err) {}
}

function renderAssignmentsList(assignments) {
  const container = document.getElementById('assignments-list');
  if (!container) return;
  if (!assignments.length) {
    container.innerHTML = '<div class="empty-state">No assignments yet.</div>';
    return;
  }
  container.innerHTML = `
    <div class="modern-assignments-table-wrap">
      <table class="modern-assignments-table">
        <thead>
          <tr>
            <th>Bus</th>
            <th>Route</th>
            <th>Conductor</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${assignments.map(a => `
            <tr>
              <td><span class="bus-pill">${a.bus?.registration || '-'}</span></td>
              <td><span class="route-pill">${a.routeId?.name || '-'}</span></td>
              <td><span class="conductor-pill">${a.conductorId?.name || '-'}</span></td>
              <td><span class="status-pill status-${(a.status || '').toLowerCase()}">${a.status || '-'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// Assignment modal submit handler for new BusAssignment model
// (handled below in DOMContentLoaded event)

// Duplicate setupAssignModalListeners removed (defined at line 893)

// ─── Assignment form submit
// (Removed duplicate event listener)

// Removed duplicate - already handled in main bootstrap
if (false) {
  document.addEventListener('DOMContentLoaded', () => {
    // Duplicate removed
  });
}

if (false) {
  const form = document.getElementById('assign-form');
  const modal = document.getElementById('assign-modal');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const busId = document.getElementById('assign-bus').value;
      const routeId = document.getElementById('assign-route').value;
      const conductorSel = document.getElementById('assign-conductor');
      const conductorPhone = conductorSel.options[conductorSel.selectedIndex]?.text.match(/\((\d{10,})\)/)?.[1] || '';
      if (!busId || !routeId || !conductorPhone) {
        showToast('Please select all fields', 'error');
        return;
      }
      try {
        await api('/owner/assign-conductor', {
          method: 'POST',
          body: JSON.stringify({ busId, routeId, conductorPhone })
        });
        showToast('Operation successful', 'success');
        // Show confirmation frame with bus number and owner id
        const confirmFrame = document.getElementById('assign-confirm-frame');
        document.getElementById('confirm-bus-number').textContent = busId;
        document.getElementById('confirm-owner-id').textContent = currentUser && currentUser._id ? currentUser._id : 'N/A';
        confirmFrame.classList.remove('hidden');
        setTimeout(() => {
          confirmFrame.classList.add('hidden');
          modal.classList.add('hidden');
          loadOwnerDashboard(); // Refresh dashboard
        }, 2500);
      } catch (err) {
        showToast(err.message || 'Assignment failed', 'error');
      }
    };
  }
}

// ─── App Initialization ────────────────────────────────────────────────────
// (Removed duplicate - using main bootstrap below)

function logout() {
  stopOwnerDashboardAutoRefresh();
  token = null;
  currentUser = null;
  _ownerDropdownCache = null;
  _ownerBusesCache    = null;
  destinationSearchInitialized = false;
  if (typeof resetDestinationSearch === 'function') {
    resetDestinationSearch();
  }
  localStorage.removeItem('scanandgo_token');
  if (socket) socket.disconnect();
  joinedProfileChatRooms = new Set();
  profileChatSocketBound = false;
  profileChatMessagesByRoom = { general: [], movies: [], dating: [], politics: [] };
  document.getElementById('nav-scanner').style.display = 'none';
  document.getElementById('nav-owner-dashboard').style.display = 'none';
  document.getElementById('nav-admin-dashboard').style.display = 'none';
  if (document.getElementById('nav-track')) document.getElementById('nav-track').style.display = 'none';
  if (document.getElementById('nav-routes')) document.getElementById('nav-routes').style.display = 'none';
  if (document.getElementById('nav-book')) document.getElementById('nav-book').style.display = 'none';
  if (document.getElementById('nav-wallet')) document.getElementById('nav-wallet').style.display = 'none';
  if (document.getElementById('nav-tickets')) document.getElementById('nav-tickets').style.display = 'none';
  document.getElementById('conductor-map-scan-btn-container')?.classList.add('hidden');
  document.getElementById('main-app').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  const burgerWrapper = document.getElementById('burger-wrapper');
  if (burgerWrapper) burgerWrapper.classList.add('hidden');
}

// ─── Zone Switcher ──────────────────────────────────────────────────────────
document.getElementById('zone-select')?.addEventListener('change', async function () {
  currentZone = this.value;
  localStorage.setItem('scanandgo_zone', currentZone);

  // Clear stale markers immediately
  clearMapOverlays();
  if (typeof resetDestinationSearch === 'function') {
    resetDestinationSearch();
  }

  // Navigate to map page first so the container is visible before flyTo
  navigateTo('map');

  // Give the browser one frame to paint the map page visible,
  // then invalidate layout and fly to the zone center
  setTimeout(() => {
    const center = ZONE_CENTERS[currentZone];
    if (map && center) {
      map.invalidateSize();  // recalculate dimensions after container was hidden
      map.flyTo([center.lat, center.lng], center.zoom, {
        animate: true,
        duration: 1.2,
      });
    }
  }, 50);

  // Reload routes for the new zone
  await loadRoutes();

  const zoneName = currentZone.charAt(0).toUpperCase() + currentZone.slice(1);
  showToast(`Switched to ${zoneName} – select a route to track buses`, 'success');

  // Re-filter owner assignment dropdowns instantly from cache (no API call)
  if (currentUser?.role === 'owner' && _ownerDropdownCache &&
      !document.getElementById('page-profile').classList.contains('hidden')) {
    _populateOwnerDropdownsByZone(currentZone);
  }
});

function updateWalletBadge() {
  document.getElementById('wallet-badge').textContent = `₹${formatRupees(currentUser?.wallet || 0)}`;
  updatePoyalooPassUI();
}

// ─── Navigation ─────────────────────────────────────────────────────────────
function navigateTo(pageId) {
  // Block passengers from accessing scanner page
  if (pageId === 'scanner' && currentUser?.role === 'passenger') {
    showToast('Scanner is only available for conductors', 'error');
    return;
  }

  // Expired owners can login but cannot open owner dashboard.
  if (pageId === 'owner-dashboard' && currentUser?.role === 'owner' && !isOwnerSubscriptionActive(currentUser)) {
    showToast('Owner subscription expired. Renew to access dashboard.', 'warning');
    pageId = 'profile';
  }

  if (pageId === 'admin-dashboard' && currentUser?.role !== 'admin') {
    showToast('Admin access required', 'error');
    return;
  }


  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.getElementById(`page-${pageId}`).classList.remove('hidden');
  document.getElementById(`page-${pageId}`).classList.add('active');
 
  const burgerWrapper = document.getElementById('burger-wrapper');
  if (burgerWrapper) {
    if (pageId === 'map') {
      burgerWrapper.classList.remove('hidden');
    } else {
      burgerWrapper.classList.add('hidden');
    }
  }

  // Always load owner dashboard metrics when navigating to dashboard
  if (pageId === 'owner-dashboard') {
    loadOwnerDashboard();
    startOwnerDashboardAutoRefresh();
  } else {
    stopOwnerDashboardAutoRefresh();
  }

  if (pageId === 'admin-dashboard') loadAdminDashboard();

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  // Page-specific loads
  if (pageId === 'map') {
    setTimeout(() => {
      if (!map) initMap();
      if (map) map.invalidateSize();
      // Ensure map container is visible
      const mapContainer = document.getElementById('map');
      if (mapContainer) mapContainer.style.display = '';
      
      // Initialize destination search
      if (typeof initDestinationSearch === 'function') {
        initDestinationSearch();
      }
      
      // Auto-load assigned route details for conductors on map page entry
      if (currentUser?.role === 'conductor' && currentUser.assignedRoute && !originStop && !destinationStop) {
        if (typeof autoLoadAssignedRouteForConductor === 'function') {
          autoLoadAssignedRouteForConductor();
        }
      }
    }, 100);
  }
  if (pageId === 'routes') loadRoutesList();
  if (pageId === 'tickets') {
    loadMyTickets();
    startTicketsAutoRefresh();
  } else {
    stopTicketsAutoRefresh();
  }
  if (pageId === 'book') loadBookingForm();
  if (pageId === 'wallet') {
    loadWalletPage();
    startWalletAutoRefresh();
  } else {
    stopWalletAutoRefresh();
  }
  if (pageId === 'profile') loadProfile();
  if (pageId === 'scanner' && currentUser?.role === 'conductor') {
    // Reset scanner UI when entering
    resetScannerUI();
  }
  // Stop camera when leaving scanner page
  if (pageId !== 'scanner' && scannerRunning) {
    stopScanner();
  }
  // Stop camera when leaving book page
  if (pageId !== 'book' && poyalooScannerRunning) {
    stopPoyalooScanner();
  }
}



document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    if (page === 'map') {
      setTimeout(() => {
        if (map) map.invalidateSize();
      }, 150);
    }
    navigateTo(page);
  });
});

document.getElementById('profile-btn').addEventListener('click', () => navigateTo('profile'));

// ─── Map ────────────────────────────────────────────────────────────────────
function initMap() {
  if (map) return;
  if (typeof L === 'undefined') {
    console.warn('[initMap] Leaflet is not loaded yet!');
    return;
  }

  try {
    const center = ZONE_CENTERS[currentZone] || ZONE_CENTERS.trivandrum || { lat: 8.5241, lng: 76.9366, zoom: 13 };
    map = L.map('map', {
      zoomControl: false,
    }).setView([center.lat, center.lng], center.zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Route selector
    document.getElementById('route-select')?.addEventListener('change', (e) => {
      const routeId = e.target.value;
      if (routeId) {
        trackRoute(routeId);
        setTimeout(() => {
          if (map) map.invalidateSize();
          const mapContainer = document.getElementById('map');
          if (mapContainer) mapContainer.style.display = '';
        }, 100);
      } else {
        clearMapOverlays();
      }
    });
  } catch (err) {
    console.error('[initMap] Error initializing map:', err);
  }
}

// ─── Track Route: Show route and buses on map ─────────────────────────────

// Build stop popup HTML
function buildStopPopup(stop, routeId) {
  return `
    <div style="min-width: 200px;">
      <strong>${stop.name}</strong><br>
      ${stop.landmark ? `<small>${stop.landmark}</small><br>` : ''}
      ${stop.stop_order ? `<small>Stop #${stop.stop_order}</small><br>` : ''}
      ${stop.distance_from_start_km ? `<small>Distance: ${stop.distance_from_start_km.toFixed(1)} km</small><br>` : ''}
      <button class="btn-book-from-stop" data-route-id="${routeId}" data-stop-id="${stop.id}" data-stop-name="${escapeHtml(stop.name)}" onclick="bookFromStopBtn(this)">
        🎟️ Book Ticket
      </button>
    </div>
  `;
}

async function trackRoute(routeId) {
  if (!routeId) return;
  if (!map) {
    console.warn('[trackRoute] Map is not initialized yet. Skipping tracking.');
    return;
  }
  
  console.log(`[trackRoute] Starting to track route: ${routeId}`);
  
  // Untrack previous route
  if (currentTrackingRouteId && currentTrackingRouteId !== routeId) {
    if (socket && socket.connected) {
      socket.emit('untrack:route', currentTrackingRouteId);
      console.log(`🔕 Unsubscribed from previous route: ${currentTrackingRouteId}`);
    }
  }
  
  clearMapOverlays();
  
  try {
    // Fetch route details
    console.log(`[trackRoute] Fetching route details for: ${routeId}`);
    const route = await api(`/routes/${routeId}`);
    const stops = route.stops || [];
    currentRouteStops = stops;
    console.log(`[trackRoute] Loaded ${stops.length} stops for route ${route.name}`);

    // Draw route polyline
    if (stops.length > 1) {
      const latlngs = stops.map(s => [s.latitude, s.longitude]);
      routePolyline = L.polyline(latlngs, { color: '#007bff', weight: 5, opacity: 0.7 }).addTo(map);
      map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });
      console.log(`[trackRoute] Drew route polyline with ${stops.length} points`);
    }

    // Add stop markers
    stops.forEach(stop => {
      if (stop.name && stop.name.startsWith('.')) return; // Skip intermediate path points
      const marker = L.marker([stop.latitude, stop.longitude], {
        icon: L.divIcon({
          className: 'stop-marker',
          html: `<div class="stop-marker-dot"></div>`
        })
      }).addTo(map);
      marker.bindPopup(buildStopPopup(stop, routeId));
      stopMarkers[stop.id] = marker;
    });
    console.log(`[trackRoute] Added ${Object.keys(stopMarkers).length} stop markers`);

    // Fetch active buses for this route
    console.log(`[trackRoute] Fetching buses for route: ${routeId}`);
    const buses = await api(`/routes/${routeId}/buses`);
    currentRouteBuses = buses;
    console.log(`[trackRoute] Found ${buses.length} buses on this route`);
    
    // Filter buses if a specific bus number is searched
    const filteredBuses = searchedBusNumber ?
      buses.filter(bus => bus.registration && bus.registration.toLowerCase().includes(searchedBusNumber.toLowerCase()))
      : buses;

    filteredBuses.forEach(bus => {
      console.log(`[trackRoute] Processing bus: ${bus.registration} (${bus.latitude}, ${bus.longitude})`);
      addBusMarker(bus);
    });

    currentTrackingRouteId = routeId;
    
    // Join the Socket.IO room to receive live bus location updates
    if (socket && socket.connected) {
      socket.emit('track:route', routeId);
      console.log(`🔔 Subscribed to route updates: ${routeId}`);
    } else {
      console.error('[trackRoute] Socket not connected! Cannot subscribe to updates.');
      showToast('⚠️ Live updates unavailable - check connection', 'warning');
    }
    
    console.log(`[trackRoute] ✅ Successfully tracked route ${route.name}`);
  } catch (err) {
    console.error('[trackRoute] Error:', err);
    showToast('Failed to load route or buses', 'error');
  }
}

async function enterApp() {

  // Load profile
  try {
    currentUser = await api('/auth/me');
  } catch {
    logout();
    return;
  }

  // Configure UI instantly based on role before doing heavy async tasks
  if (currentUser.role === 'conductor' || currentUser.role === 'admin') {
    const isAdmin = currentUser.role === 'admin';
    if (!isAdmin) {
      document.getElementById('nav-scanner').style.display = '';
      document.getElementById('conductor-map-scan-btn-container')?.classList.remove('hidden');
      startValidatedTicketsAutoRefresh();
      loadConductorEarnings(); // Load earnings card
    } else {
      document.getElementById('conductor-map-scan-btn-container')?.classList.add('hidden');
    }
    document.getElementById('nav-admin-dashboard').style.display = isAdmin ? '' : 'none';
    document.getElementById('nav-owner-dashboard').style.display = 'none';
    
    if (document.getElementById('nav-track')) document.getElementById('nav-track').style.display = '';
    if (document.getElementById('nav-routes')) document.getElementById('nav-routes').style.display = '';
    if (document.getElementById('nav-book')) document.getElementById('nav-book').style.display = '';
    if (document.getElementById('nav-wallet')) document.getElementById('nav-wallet').style.display = '';
    if (document.getElementById('nav-tickets')) document.getElementById('nav-tickets').style.display = '';
    
    document.getElementById('page-map').style.display = '';
    document.getElementById('page-routes').style.display = '';
    document.getElementById('page-tickets').style.display = '';
    document.getElementById('page-book').style.display = '';
    document.getElementById('page-wallet').style.display = '';
    document.getElementById('page-profile').style.display = '';
    document.getElementById('page-admin-dashboard').style.display = isAdmin ? '' : 'none';
    
    navigateTo(isAdmin ? 'admin-dashboard' : 'scanner');
  } else if (currentUser.role === 'owner') {
    document.getElementById('conductor-map-scan-btn-container')?.classList.add('hidden');
    const ownerSub = getOwnerSubscription(currentUser);
    const ownerFeaturesAllowed = isOwnerSubscriptionActive(currentUser);

    document.getElementById('nav-owner-dashboard').style.display = ownerFeaturesAllowed ? '' : 'none';
    document.getElementById('nav-admin-dashboard').style.display = 'none';
    document.getElementById('nav-scanner').style.display = 'none';
    
    if (document.getElementById('nav-track')) document.getElementById('nav-track').style.display = '';
    if (document.getElementById('nav-routes')) document.getElementById('nav-routes').style.display = '';
    if (document.getElementById('nav-book')) document.getElementById('nav-book').style.display = '';
    if (document.getElementById('nav-wallet')) document.getElementById('nav-wallet').style.display = '';
    if (document.getElementById('nav-tickets')) document.getElementById('nav-tickets').style.display = '';
    
    document.getElementById('page-map').style.display = '';
    document.getElementById('page-routes').style.display = '';
    document.getElementById('page-tickets').style.display = '';
    document.getElementById('page-book').style.display = '';
    document.getElementById('page-wallet').style.display = '';
    document.getElementById('page-profile').style.display = '';
    document.getElementById('page-admin-dashboard').style.display = 'none';

    if (ownerSub?.renewalReminder?.shouldNotify) {
      showToast(ownerSub.renewalReminder.message || 'Your owner subscription expires in less than 1 day. Renew now.', 'warning');
    }

    if (!ownerFeaturesAllowed) {
      showToast('Owner subscription expired. Dashboard and assignment features are hidden until renewal.', 'warning');
      navigateTo('map');
    } else {
      if (!window._ownerDashboardShownOnce) {
        loadOwnerDashboard();
        navigateTo('owner-dashboard');
        window._ownerDashboardShownOnce = true;
      } else {
        navigateTo('map');
      }
    }
  } else {
    document.getElementById('conductor-map-scan-btn-container')?.classList.add('hidden');
    document.getElementById('nav-scanner').style.display = 'none';
    document.getElementById('nav-owner-dashboard').style.display = 'none';
    document.getElementById('nav-admin-dashboard').style.display = 'none';
    
    if (document.getElementById('nav-track')) document.getElementById('nav-track').style.display = '';
    if (document.getElementById('nav-routes')) document.getElementById('nav-routes').style.display = '';
    if (document.getElementById('nav-book')) document.getElementById('nav-book').style.display = '';
    if (document.getElementById('nav-wallet')) document.getElementById('nav-wallet').style.display = '';
    if (document.getElementById('nav-tickets')) document.getElementById('nav-tickets').style.display = '';
    
    document.getElementById('page-map').style.display = '';
    document.getElementById('page-routes').style.display = '';
    document.getElementById('page-tickets').style.display = '';
    document.getElementById('page-book').style.display = '';
    document.getElementById('page-wallet').style.display = '';
    document.getElementById('page-profile').style.display = '';
    document.getElementById('page-admin-dashboard').style.display = 'none';
    navigateTo('map');
  }

  // Now that the UI is configured for the correct role, reveal the main app
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('splash').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');

  if (window.applyTranslations) window.applyTranslations();

  try {
    updateWalletBadge();
  } catch (err) {
    console.error('Error updating wallet badge:', err);
  }

  // Only pre-load tickets and wallet data for passengers to improve load speed for conductors/owners
  if (currentUser.role === 'passenger' || currentUser.role === 'conductor' || currentUser.role === 'owner') {
    try {
      loadMyTickets();
    } catch (err) {
      console.error('Error loading tickets:', err);
    }
    try {
      loadWalletPage();
    } catch (err) {
      console.error('Error loading wallet page:', err);
    }
  }

  // Load zones from API and populate the selector BEFORE init map
  try {
    await loadZones();
  } catch (err) {
    console.error('Error loading zones:', err);
  }

  // Init map FIRST
  try {
    initMap();
  } catch (err) {
    console.error('Error initializing map:', err);
  }

  // Connect socket ALWAYS
  try {
    connectSocket();
  } catch (err) {
    console.error('Error connecting socket:', err);
  }

  // Load routes ALWAYS
  try {
    await loadRoutes();
  } catch (err) {
    console.error('Error loading routes:', err);
  }
}

// --- The following code is for trackRoute and should be a separate function ---

// (The rest of your code continues here, starting with trackRoute or other functions)

// Helper: Calculate distance between two points using Haversine formula
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Helper: Find closest point on a polyline to a given lat/lng
function getClosestPointOnPolyline(lat, lng, polyline) {
  if (!polyline) return [lat, lng];
  let minDist = Infinity;
  let closest = [lat, lng];
  
  let latlngs = polyline.getLatLngs();
  // Flatten if it is a nested array (Leaflet sometimes wraps coordinate paths)
  if (latlngs.length > 0 && Array.isArray(latlngs[0])) {
    latlngs = latlngs.flat();
  }
  
  for (let i = 0; i < latlngs.length - 1; i++) {
    const p1 = latlngs[i];
    const p2 = latlngs[i + 1];
    if (!p1 || !p2 || p1.lat === undefined || p1.lng === undefined || p2.lat === undefined || p2.lng === undefined) continue;

    // Project point onto segment p1-p2
    const t = projectPointOnSegment(lat, lng, p1, p2);
    const proj = {
      lat: p1.lat + t * (p2.lat - p1.lat),
      lng: p1.lng + t * (p2.lng - p1.lng)
    };
    const d = haversineKm(lat, lng, proj.lat, proj.lng);
    if (d < minDist) {
      minDist = d;
      closest = [proj.lat, proj.lng];
    }
  }
  return closest;
}

// Helper: Project point onto segment, returns t in [0,1]
function projectPointOnSegment(lat, lng, p1, p2) {
  const x = lat, y = lng;
  const x1 = p1.lat, y1 = p1.lng, x2 = p2.lat, y2 = p2.lng;
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return 0;
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  return Math.max(0, Math.min(1, t));
}

function addBusMarker(bus) {
  if (searchedBusNumber && bus.registration && !bus.registration.toLowerCase().includes(searchedBusNumber.toLowerCase())) {
    return;
  }
  if (!map) {
    console.warn('[addBusMarker] Map is not initialized yet. Skipping bus marker.');
    return;
  }
  if (!bus.latitude || !bus.longitude) {
    console.log('[addBusMarker] Skipping bus - no coordinates:', bus.id, bus.registration);
    return;
  }

  console.log('[addBusMarker] Adding/updating bus marker:', bus.registration, bus.latitude, bus.longitude);

  // Snap bus to nearest point on route polyline if available
  let markerLatLng = [bus.latitude, bus.longitude];
  if (routePolyline) {
    markerLatLng = getClosestPointOnPolyline(bus.latitude, bus.longitude, routePolyline);
  }

  const routeStatus = bus.routeStatus || bus.route_verification_status || 'pending';

  // Choose marker style based on route verification status
  let markerHtml;
  switch (routeStatus) {
    case 'verified':
      markerHtml = `<div class="bus-marker bus-marker-verified">🚌<span class="bus-verify-badge">✓</span></div>`;
      break;
    case 'delayed':
      markerHtml = `<div class="bus-marker bus-marker-delayed">🚌<span class="bus-verify-badge bus-badge-delay">⏱</span></div>`;
      break;
    case 'off-route':
      markerHtml = `<div class="bus-marker bus-marker-offroute">🚌<span class="bus-verify-badge bus-badge-x">✗</span></div>`;
      break;
    default: // pending
      const cnt = bus.matchedStops || bus.verified_stops_count || 0;
      markerHtml = `<div class="bus-marker bus-marker-pending">🚌<span class="bus-verify-badge bus-badge-pending">${cnt}/3</span></div>`;
      break;
  }

  const icon = L.divIcon({
    className: 'bus-marker-wrapper',
    html: markerHtml,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });

  if (busMarkers[bus.id]) {
    busMarkers[bus.id].setLatLng(markerLatLng);
    busMarkers[bus.id].setIcon(icon);
  } else {
    const marker = L.marker(markerLatLng, { icon }).addTo(map);
    marker.on('click', () => showBusInfo(bus));
    busMarkers[bus.id] = marker;
  }

  // Store latest bus data on the marker for click updates
  busMarkers[bus.id]._busData = bus;

  // Status line in popup
  let statusLine = '';
  if (routeStatus === 'verified') statusLine = '<br><span class="popup-rv popup-rv-ok">✅ Verified on route</span>';
  else if (routeStatus === 'delayed') statusLine = '<br><span class="popup-rv popup-rv-delay">⏱ Bus on way, delay expected</span>';
  else if (routeStatus === 'off-route') statusLine = '<br><span class="popup-rv popup-rv-bad">❌ Off-route — Service cancelled</span>';
  else statusLine = `<br><span class="popup-rv popup-rv-wait">⏳ Verifying… ${bus.matchedStops || bus.verified_stops_count || 0}/3</span>`;

  busMarkers[bus.id].bindPopup(`
    <strong>${bus.registration}</strong><br>
    Speed: ${bus.speed_kmh || 0} km/h<br>
    Next: ${bus.next_stop_name || bus.nextStop || '-'}
    ${statusLine}
  `);
}

// Helper: Format timestamp to readable time
function formatTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function showBusInfo(bus) {
  const panel = document.getElementById('bus-info-panel');
  const content = document.getElementById('bus-info-content');

  const routeStatus = bus.routeStatus || bus.route_verification_status || 'pending';

  // Route verification banner
  let statusBanner = '';
  if (routeStatus === 'verified') {
    statusBanner = `<div class="rv-banner rv-banner-ok">
      <span class="rv-banner-icon">✅</span>
      <div><strong>Verified on Route</strong><br><span>Bus confirmed following the assigned route</span></div>
    </div>`;
  } else if (routeStatus === 'delayed') {
    statusBanner = `<div class="rv-banner rv-banner-delay">
      <span class="rv-banner-icon">⏱</span>
      <div><strong>Bus On Way — Delay Expected</strong><br><span>Bus is on the route but may arrive later than expected</span></div>
    </div>`;
  } else if (routeStatus === 'off-route') {
    statusBanner = `<div class="rv-banner rv-banner-bad">
      <span class="rv-banner-icon">❌</span>
      <div><strong>Off-Route — Service Cancelled</strong><br><span>This bus is NOT following the expected route. Please wait for the next bus.</span></div>
    </div>`;
  } else {
    const cnt = bus.matchedStops || bus.verified_stops_count || 0;
    const req = bus.requiredStops || 3;
    statusBanner = `<div class="rv-banner rv-banner-wait">
      <span class="rv-banner-icon">⏳</span>
      <div><strong>Verifying Route…</strong><br><span>${cnt} of ${req} stops confirmed</span></div>
      <div class="rv-progress"><div class="rv-progress-bar" style="width:${Math.min(100, (cnt / req) * 100)}%"></div></div>
    </div>`;
  }

  content.innerHTML = `
    <h3>🚌 ${bus.registration}</h3>
    ${statusBanner}
    <div class="info-row"><span class="info-label">Type</span><span>${bus.type || bus.bus_type || '-'}</span></div>
    <div class="info-row"><span class="info-label">Speed</span><span>${bus.speed_kmh || bus.speed || 0} km/h</span></div>
    <div class="info-row"><span class="info-label">Next Stop</span><span>${bus.next_stop_name || bus.nextStop || '-'}</span></div>
    <div class="info-row"><span class="info-label">Last Update</span><span>${formatTime(bus.last_gps_update || bus.timestamp)}</span></div>
    <div class="info-row"><span class="info-label">Status</span><span>${bus.status || 'running'}</span></div>
  `;

  panel.classList.remove('hidden');
}

function closeBusPanel() {
  document.getElementById('bus-info-panel').classList.add('hidden');
  
  // Re-show the route options panel if the summary bar is still visible
  const summaryBar = document.getElementById('trip-summary-bar');
  if (summaryBar && !summaryBar.classList.contains('hidden')) {
    const routeOptionsPanel = document.getElementById('route-options-panel');
    if (routeOptionsPanel) {
      routeOptionsPanel.classList.remove('hidden');
    }
  }
}

function clearMapOverlays() {
  // Unsubscribe from previous route's Socket.IO room
  if (currentTrackingRouteId && socket && socket.connected) {
    socket.emit('untrack:route', currentTrackingRouteId);
    console.log(`🔕 Unsubscribed from route: ${currentTrackingRouteId}`);
  }
  
  if (map) {
    Object.values(busMarkers).forEach(m => map.removeLayer(m));
    Object.values(stopMarkers).forEach(m => map.removeLayer(m));
    if (routePolyline) map.removeLayer(routePolyline);
    if (userLocationMarker) {
      map.removeLayer(userLocationMarker);
      userLocationMarker = null;
    }
  }
  
  busMarkers = {};
  stopMarkers = {};
  routePolyline = null;
  currentRouteBuses = [];
  currentTrackingRouteId = null;
}

// ─── Socket.IO ──────────────────────────────────────────────────────────────
function connectSocket() {
  if (typeof io === 'undefined') {
    console.warn('[connectSocket] Socket.io is not loaded yet!');
    return;
  }

  try {
    socket = BACKEND_URL
      ? io(BACKEND_URL, { auth: { token } })
      : io({ auth: { token } });
    profileChatSocketBound = false;
    bindProfileChatSocketEvents();

    // Optionally, show a toast or UI indicator on connect/disconnect
    socket.on('connect', () => {
      console.log('[Socket.IO] Connected to server');
      showToast('Connected to live updates', 'success');

      joinedProfileChatRooms.forEach((roomKey) => {
        socket.emit('chat:join', roomKey);
      });
    });
    socket.on('disconnect', () => {
      console.log('[Socket.IO] Disconnected from server');
      showToast('Disconnected from live updates', 'error');
    });
    socket.on('connect_error', (err) => {
      console.error('[Socket.IO] Connection error:', err.message);
    });

    // Live bus location updates
    socket.on('bus:location', (data) => {
      console.log('[Socket.IO] Received bus:location:', data.registration, data.latitude, data.longitude);
      const busData = {
        id: data.busId,
        registration: data.registration,
        latitude: data.latitude,
        longitude: data.longitude,
        speed_kmh: data.speed,
        next_stop_name: data.nextStop,
        last_gps_update: data.timestamp,
        routeStatus: data.routeStatus || 'pending',
        matchedStops: data.matchedStops || 0,
      };

      addBusMarker(busData);

      // Keep currentRouteBuses in sync for ETA calculations
      const idx = currentRouteBuses.findIndex(b => b.id === data.busId);
      if (idx >= 0) {
        currentRouteBuses[idx] = { ...currentRouteBuses[idx], ...busData };
      } else if (currentTrackingRouteId) {
        currentRouteBuses.push(busData);
      }
    });

    // Route verification status updates
    socket.on('bus:route-status', (data) => {
      // Update existing marker with new verification status
      if (busMarkers[data.busId] && busMarkers[data.busId]._busData) {
        const busData = busMarkers[data.busId]._busData;
        busData.routeStatus = data.status;
        busData.matchedStops = data.matchedStops || 0;
        busData.requiredStops = data.requiredStops;
        addBusMarker(busData);
      }

      // Show toast notifications for important state changes
      if (data.status === 'verified') {
        showToast('✅ Bus confirmed on route', 'success');
      } else if (data.status === 'delayed') {
        showToast('⏱ Bus on way, delay expected', 'warning');
      } else if (data.status === 'off-route') {
        showToast('❌ Off-route — Service cancelled', 'error');
      }
    });

    // Bus cancelled due to route deviation
    socket.on('bus:cancelled', (data) => {
      showToast(`🚫 Bus cancelled: ${data.reason}`, 'error');
      if (busMarkers[data.busId] && busMarkers[data.busId]._busData) {
        const busData = busMarkers[data.busId]._busData;
        busData.routeStatus = 'off-route';
        busData.matchedStops = 0;
        addBusMarker(busData);
      }
    });

    // Bus arrived at stop
    socket.on('bus:stop-arrived', (data) => {
      showToast(`Bus arrived at ${data.stopName}`, 'info');

      // Flash the stop marker
      if (stopMarkers[data.stopId]) {
        const el = stopMarkers[data.stopId].getElement();
        if (el) {
          el.style.transform = 'scale(1.3)';
          setTimeout(() => { el.style.transform = ''; }, 1000);
        }
      }
    });
  } catch (err) {
    console.error('[connectSocket] Error connecting socket:', err);
  }
}

// ─── Routes List ────────────────────────────────────────────────────────────
async function loadRoutes() {
  try {
    console.log(`[loadRoutes] Loading routes for zone: ${currentZone}`);
    allRoutes = await api(`/routes?zone=${currentZone}`);
    console.log(`[loadRoutes] ✅ Loaded ${allRoutes.length} routes`);
    populateRouteSelect();
    
    // Show helpful message if no routes
    if (allRoutes.length === 0) {
      console.warn(`[loadRoutes] No routes found in ${currentZone} zone`);
      showToast(`No routes in ${currentZone}. Try switching to another zone.`, 'warning');
    }
  } catch (err) {
    console.error('[loadRoutes] Failed to load routes:', err);
    showToast('Failed to load routes. Please refresh the page.', 'error');
  }
}

function populateRouteSelect() {
  const select = document.getElementById('route-select');
  if (!select) {
    console.error('[populateRouteSelect] Route select element not found!');
    return;
  }
  
  console.log(`[populateRouteSelect] Populating with ${allRoutes.length} routes`);
  
  select.innerHTML = '<option value="">Select a Route to Track</option>';
  
  if (allRoutes.length === 0) {
    select.innerHTML = '<option value="">No routes available in this zone</option>';
    showToast('No routes found. Try switching zones.', 'warning');
    return;
  }
  
  allRoutes.forEach(r => {
    select.innerHTML += `<option value="${r.id}">${r.code} — ${r.name}</option>`;
  });
  
  console.log(`[populateRouteSelect] ✅ Added ${allRoutes.length} routes to dropdown`);
}

async function loadRoutesList() {
  const container = document.getElementById('routes-list');
  container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">Loading routes...</div>';

  const searchText = document.getElementById('route-search').value.trim();

  try {
    let url = `/routes?zone=${currentZone}`;
    if (searchText) {
      url += `&search=${encodeURIComponent(searchText)}`;
    }

    const routes = await api(url);
    container.innerHTML = '';

    if (routes.length === 0) {
      container.innerHTML = '<div class="suggestion-no-results">No routes found matching your search.</div>';
      return;
    }

    routes.forEach(routeDetail => {
      const stops = routeDetail.stops || [];
      const badgeClass = `badge-${routeDetail.type}`;
      const isPassenger = currentUser?.role === 'passenger' || currentUser?.role === 'conductor' || currentUser?.role === 'owner';
      
      const stopsHtml = stops.map(s => {
        const actionBtn = isPassenger 
          ? `<button class="btn-book-stop-inline" data-route-id="${routeDetail.id}" data-stop-id="${s.id}" data-stop-name="${escapeHtml(s.name)}" onclick="event.stopPropagation(); bookFromStopBtn(this)">🎟️ Book</button>`
          : `<button class="btn-track-stop-inline" style="background:var(--primary);color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;margin-left:6px;box-shadow:var(--shadow-sm);transition:all 0.2s;" onclick="event.stopPropagation(); selectRouteOnMap('${routeDetail.id}')">🗺️ Track</button>`;
        return `<li>
          ${s.stop_order}. ${s.name} ${s.name_ml ? `(${s.name_ml})` : ''}
          ${actionBtn}
        </li>`;
      }).join('');

      let cardFooter = '';
      if (!isPassenger) {
        cardFooter = `
          <div style="margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 8px; text-align: right;">
            <button class="btn btn-primary btn-sm" style="padding: 6px 12px; font-size: 12px; font-weight: 700; border-radius: 6px;" onclick="event.stopPropagation(); selectRouteOnMap('${routeDetail.id}')">
              🗺️ Track Route & Buses
            </button>
          </div>
        `;
      }

      container.innerHTML += `
        <div class="card" onclick="selectRouteOnMap('${routeDetail.id}')">
          <div class="card-row">
            <span class="card-title">${routeDetail.name}</span>
            <span class="badge ${badgeClass}">${routeDetail.type}</span>
          </div>
          <div class="card-subtitle">${routeDetail.code} · Base fare ₹${formatRupees(routeDetail.base_fare)}</div>
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">${routeDetail.description || ''}</p>
          <details>
            <summary style="font-size:13px;cursor:pointer;color:var(--primary);">View ${stops.length} stops</summary>
            <ol class="stops-list">${stopsHtml}</ol>
          </details>
          ${cardFooter}
        </div>
      `;
    });
  } catch (err) {
    console.error('Error loading routes list:', err);
    container.innerHTML = '<div class="suggestion-item suggestion-no-results">Failed to search routes. Please try again.</div>';
  }
}

function selectRouteOnMap(routeId) {
  document.getElementById('route-select').value = routeId;
  navigateTo('map');
  setTimeout(() => {
    trackRoute(routeId);
  }, 150);
}

// ─── Book from stop (map popup or routes list) ─────────────────────────────
function bookFromStop(routeId, stopId, stopName) {
  pendingBooking = { routeId, stopId };
  showToast(`Booking from ${stopName}…`, 'info');
  navigateTo('book');
}

window.bookFromStop = bookFromStop;

document.getElementById('route-search').addEventListener('input', loadRoutesList);

// ─── Booking ────────────────────────────────────────────────────────────────
async function loadBookingForm() {
  const scanBtn = document.getElementById('scan-poyaloo-card-btn');
  if (scanBtn) {
    if (currentUser?.role === 'conductor' || currentUser?.role === 'admin') {
      scanBtn.style.display = 'flex';
    } else {
      scanBtn.style.display = 'none';
    }
  }

  const routeSelect = document.getElementById('book-route');
  routeSelect.innerHTML = `<option value="">${t('book_select_bus', 'Choose route')}</option>`;
  allRoutes.forEach(r => {
    routeSelect.innerHTML += `<option value="${r.id}">${r.code} — ${r.name}</option>`;
  });

  routeSelect.onchange = async () => {
    const routeId = routeSelect.value;
    if (!routeId) {
      document.getElementById('book-from').innerHTML = `<option value="">${t('book_select_source', 'Boarding stop')}</option>`;
      document.getElementById('book-to').innerHTML = `<option value="">${t('book_select_dest', 'Destination stop')}</option>`;
      document.getElementById('book-bus').innerHTML = `<option value="">${t('book_select_bus', 'Choose a bus')}</option>`;
      document.getElementById('fare-display').classList.add('hidden');
      return;
    }
    await populateBookingStopsAndBuses(routeId);
  };

  // If we came from bookFromStop, pre-fill route + from stop
  if (pendingBooking) {
    const { routeId, stopId, destStopId, boardingStopName, destStopName } = pendingBooking;
    console.log('[loadBookingForm] pre-filling:', { routeId, stopId, destStopId, boardingStopName, destStopName });
    pendingBooking = null;

    // Robustly select route dropdown option
    let routeSelected = false;
    for (let i = 0; i < routeSelect.options.length; i++) {
      const val = routeSelect.options[i].value;
      if (val && val.toString() === routeId.toString()) {
        routeSelect.selectedIndex = i;
        routeSelected = true;
        break;
      }
    }
    if (!routeSelected) {
      routeSelect.value = routeId;
    }

    await populateBookingStopsAndBuses(routeId);

    // Pre-select the "from" stop
    const fromSelect = document.getElementById('book-from');
    let fromSelected = false;
    for (let i = 0; i < fromSelect.options.length; i++) {
      const opt = fromSelect.options[i];
      if (opt.value && opt.value.toString() === stopId.toString()) {
        fromSelect.selectedIndex = i;
        fromSelected = true;
        break;
      }
      if (boardingStopName && opt.text && opt.text.trim().toLowerCase() === boardingStopName.trim().toLowerCase()) {
        fromSelect.selectedIndex = i;
        fromSelected = true;
        break;
      }
    }
    if (!fromSelected) {
      fromSelect.value = stopId;
    }
    fromSelect.dispatchEvent(new Event('change'));

    // Pre-select the "to" stop if provided
    if (destStopId) {
      const toSelect = document.getElementById('book-to');
      let toSelected = false;
      for (let i = 0; i < toSelect.options.length; i++) {
        const opt = toSelect.options[i];
        if (opt.value && opt.value.toString() === destStopId.toString()) {
          toSelect.selectedIndex = i;
          toSelected = true;
          break;
        }
        if (destStopName && opt.text && opt.text.trim().toLowerCase() === destStopName.trim().toLowerCase()) {
          toSelect.selectedIndex = i;
          toSelected = true;
          break;
        }
      }
      if (!toSelected) {
        toSelect.value = destStopId;
      }
      toSelect.dispatchEvent(new Event('change'));
    }
  }
}

async function populateBookingStopsAndBuses(routeId) {
  const route = await api(`/routes/${routeId}`);
  const stops = route.stops || [];

  const fromSelect = document.getElementById('book-from');
  const toSelect = document.getElementById('book-to');
  fromSelect.innerHTML = `<option value="">${t('book_select_source', 'Boarding stop')}</option>`;
  toSelect.innerHTML = `<option value="">${t('book_select_dest', 'Destination stop')}</option>`;

  stops.forEach(s => {
    const sId = s.id || s._id || (s.stop && (s.stop.id || s.stop._id));
    const sName = s.name || (s.stop && s.stop.name) || '';
    if (sName && sName.startsWith('.')) return; // Skip intermediate path points
    fromSelect.innerHTML += `<option value="${sId}" data-km="${s.distance_from_start_km}">${sName}</option>`;
    toSelect.innerHTML += `<option value="${sId}" data-km="${s.distance_from_start_km}">${sName}</option>`;
  });

  // Load buses
  const buses = await api(`/routes/${routeId}/buses`);
  const busSelect = document.getElementById('book-bus');
  busSelect.innerHTML = `<option value="">${t('book_select_bus', 'Choose bus')}</option>`;
  buses.forEach(b => {
    busSelect.innerHTML += `<option value="${b.id}">${b.registration} (${b.type})</option>`;
  });
  if (buses && buses.length > 0) {
    busSelect.value = buses[0].id;
  }

  updateFareEstimate(route);
  // Add event listener for ticket count change
  const ticketCountInput = document.getElementById('ticket-count');
  if (ticketCountInput) {
    ticketCountInput.oninput = () => updateFareEstimate(route);
    ticketCountInput.onchange = () => updateFareEstimate(route);
  }
}

function updateFareEstimate(route) {
  const fromKm = parseFloat(document.getElementById('book-from').selectedOptions[0]?.dataset?.km || 0);
  const toKm = parseFloat(document.getElementById('book-to').selectedOptions[0]?.dataset?.km || 0);
  const ticketCountInput = document.getElementById('ticket-count');
  let ticketCount = parseInt(ticketCountInput?.value || '1', 10);
  if (isNaN(ticketCount) || ticketCount < 1) {
    ticketCount = 1;
  }
  if (fromKm >= 0 && toKm > 0 && toKm > fromKm) {
    const dist = toKm - fromKm;
    const farePerTicket = Math.max(route.base_fare, Math.round(dist * route.per_km_fare * 100) / 100);
    const totalFare = farePerTicket * ticketCount;
    document.getElementById('ticket-price').textContent = `₹${formatRupees(farePerTicket)}`;
    document.getElementById('total-fare').textContent = `₹${formatRupees(totalFare)}`;
    document.getElementById('fare-display').classList.remove('hidden');
  } else {
    document.getElementById('fare-display').classList.add('hidden');
  }
}

document.getElementById('book-from').addEventListener('change', () => {
  const routeId = document.getElementById('book-route').value;
  const route = allRoutes.find(r => r.id === routeId);
  if (route) updateFareEstimate(route);
});
document.getElementById('book-to').addEventListener('change', () => {
  const routeId = document.getElementById('book-route').value;
  const route = allRoutes.find(r => r.id === routeId);
  if (route) updateFareEstimate(route);
});

// Helper validation functions
function showValidationError(elementId, message) {
  const el = document.getElementById(elementId);
  const errEl = document.getElementById(`${elementId}-error`);
  if (el) {
    el.style.borderColor = '#ea4335';
  }
  if (errEl) {
    errEl.textContent = message;
    errEl.style.display = 'block';
  }
}

function setupValidationInputListeners() {
  const fields = ['book-route', 'book-from', 'book-to', 'book-bus', 'ticket-count'];
  fields.forEach(fieldId => {
    const el = document.getElementById(fieldId);
    if (el) {
      const clearError = () => {
        el.style.borderColor = '';
        const errEl = document.getElementById(`${fieldId}-error`);
        if (errEl) {
          errEl.style.display = 'none';
          errEl.textContent = '';
        }
      };
      el.addEventListener('change', clearError);
      el.addEventListener('input', clearError);
    }
  });
}

function resetBookingForm() {
  const routeSelect = document.getElementById('book-route');
  if (routeSelect) {
    routeSelect.value = '';
  }
  const fromSelect = document.getElementById('book-from');
  if (fromSelect) {
    fromSelect.innerHTML = '<option value="">Boarding stop</option>';
    fromSelect.value = '';
  }
  const toSelect = document.getElementById('book-to');
  if (toSelect) {
    toSelect.innerHTML = '<option value="">Destination stop</option>';
    toSelect.value = '';
  }
  const busSelect = document.getElementById('book-bus');
  if (busSelect) {
    busSelect.innerHTML = '<option value="">Choose a bus</option>';
    busSelect.value = '';
  }
  const countInput = document.getElementById('ticket-count');
  if (countInput) {
    countInput.value = '1';
  }
  const fareDisplay = document.getElementById('fare-display');
  if (fareDisplay) {
    fareDisplay.classList.add('hidden');
  }
  const ticketPrice = document.getElementById('ticket-price');
  if (ticketPrice) {
    ticketPrice.textContent = '₹0';
  }
  const totalFare = document.getElementById('total-fare');
  if (totalFare) {
    totalFare.textContent = '₹0';
  }

  // Clear validation errors
  const errorElements = document.querySelectorAll('.validation-error');
  errorElements.forEach(el => {
    el.style.display = 'none';
    el.textContent = '';
  });
  document.querySelectorAll('.form-group select, .form-group input').forEach(el => {
    el.style.borderColor = '';
  });
}

document.getElementById('book-ticket-btn').addEventListener('click', async () => {
  const btn = document.getElementById('book-ticket-btn');
  btn.disabled = true;

  const routeId = document.getElementById('book-route').value;
  const fromId = document.getElementById('book-from').value;
  const toId = document.getElementById('book-to').value;
  const busId = document.getElementById('book-bus').value;

  // Clear previous errors
  const errorElements = document.querySelectorAll('.validation-error');
  errorElements.forEach(el => {
    el.style.display = 'none';
    el.textContent = '';
  });
  document.querySelectorAll('.form-group select, .form-group input').forEach(el => {
    el.style.borderColor = '';
  });

  let hasError = false;

  if (!routeId) {
    showValidationError('book-route', 'Please select a route');
    hasError = true;
  }
  if (!fromId) {
    showValidationError('book-from', 'Please select a boarding stop');
    hasError = true;
  }
  if (!toId) {
    showValidationError('book-to', 'Please select a destination stop');
    hasError = true;
  }
  if (!busId) {
    showValidationError('book-bus', 'Please select a bus');
    hasError = true;
  }

  const ticketCountInput = document.getElementById('ticket-count');
  const ticketCountVal = ticketCountInput?.value;
  const ticketCount = parseInt(ticketCountVal || '0', 10);

  if (!ticketCountVal || isNaN(ticketCount) || ticketCount < 1) {
    showValidationError('ticket-count', 'Please enter a valid number of tickets (minimum 1)');
    hasError = true;
  } else if (ticketCount > 6) {
    showValidationError('ticket-count', 'You can book a maximum of 6 tickets at a time');
    hasError = true;
  }

  if (routeId && fromId && toId && !hasError) {
    const fromSelect = document.getElementById('book-from');
    const toSelect = document.getElementById('book-to');
    const fromKm = parseFloat(fromSelect.selectedOptions[0]?.dataset?.km || 0);
    const toKm = parseFloat(toSelect.selectedOptions[0]?.dataset?.km || 0);

    if (fromId === toId) {
      showValidationError('book-to', 'Destination stop cannot be the same as boarding stop');
      hasError = true;
    } else if (toKm <= fromKm) {
      showValidationError('book-to', 'Destination stop must be after boarding stop');
      hasError = true;
    }
  }

  if (hasError) {
    btn.disabled = false;
    return showToast('Please correct the errors in the form', 'error');
  }

  const poyalooCardInput = document.getElementById('book-poyaloo-card');
  const poyalooCardNumber = poyalooCardInput ? poyalooCardInput.value.trim() : '';

  // Check wallet balance before booking (only if not using a custom card)
  const fareText = document.getElementById('total-fare').textContent;
  const totalFare = parseFloat(fareText.replace('₹', '')) || 0;
  if (!poyalooCardNumber && totalFare > 0 && (currentUser?.wallet || 0) < totalFare) {
    btn.disabled = false;
    showToast(`Insufficient balance (₹${currentUser?.wallet || 0}). Add ₹${Math.ceil(totalFare - (currentUser?.wallet || 0))} to wallet.`, 'error');
    navigateTo('wallet');
    return;
  }

  const originalBtnHTML = btn.innerHTML;
  btn.innerHTML = `🚌💨 Processing...`;

  try {
    const payload = {
      bus_id: busId,
      route_id: routeId,
      from_stop_id: fromId,
      to_stop_id: toId,
      ticket_count: ticketCount,
    };
    if (poyalooCardNumber) {
      payload.poyaloo_card_number = poyalooCardNumber;
    }

    const data = await api('/tickets/book', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    showToast('Ticket booked! ₹' + formatRupees(data.ticket.fare), 'success');

    if (poyalooCardInput) poyalooCardInput.value = '';

    // Refresh wallet
    currentUser = await api('/auth/me');
    updateWalletBadge();

    // Reset track page to default view
    if (typeof resetDestinationSearch === 'function') {
      resetDestinationSearch();
    }

    // Show QR
    showTicketModal(data.ticket);
  } catch (err) {
    if (err.message && err.message.includes('Insufficient')) {
      showToast(err.message, 'error');
      navigateTo('wallet');
    } else {
      showToast(err.message, 'error');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalBtnHTML;
  }
});

// ─── Tickets ────────────────────────────────────────────────────────────────
async function loadMyTickets() {
  try {
    const tickets = await api('/tickets/my');
    const container = document.getElementById('tickets-list');
    const empty = document.getElementById('no-tickets');

    // Cache tickets for modal use
    container._ticketsCache = tickets;

    if (tickets.length === 0) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    container.innerHTML = tickets.map(t => {
      const statusClass = `badge-${t.status}`;
      return `
        <div class="card" onclick="viewTicket('${t.id}')">
          <div class="card-row">
            <span class="card-title">${t.route_name}</span>
            <span class="badge ${statusClass}">${t.status}</span>
          </div>
          <div class="card-subtitle">${t.route_code} · ${t.bus_registration}</div>
          <div class="card-row">
            <span>${t.from_stop_name} → ${t.to_stop_name}</span>
            <strong>₹${formatRupees(t.fare)}</strong>
          </div>
          <div class="card-row">
            <span style="font-size:12px;color:var(--text-secondary)">${new Date(t.created_at).toLocaleDateString('en-IN')}</span>
            <span style="font-size:12px;color:var(--text-secondary)">${formatTime(t.created_at)}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function viewTicket(ticketId) {
  try {
    // Find ticket details from loaded tickets
    let ticketDetails = null;
    const ticketsList = document.getElementById('tickets-list');
    if (ticketsList && ticketsList._ticketsCache) {
      ticketDetails = ticketsList._ticketsCache.find(t => t.id === ticketId);
    }
    // Fallback: fetch all tickets if not cached
    if (!ticketDetails) {
      const allTickets = await api('/tickets/my');
      ticketDetails = allTickets.find(t => t.id === ticketId);
    }
    const qrData = await api(`/tickets/${ticketId}/qr`);
    // Prefer backend fields, fallback to cached ticket for missing fields
    showTicketModal({
      ...ticketDetails,
      ...qrData,
      id: ticketId
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.viewTicket = viewTicket;

function showTicketModal(ticket) {
  const body = document.getElementById('ticket-modal-body');
  body.innerHTML = `
    <h3>🎟️ Your Ticket</h3>
    <div class="ticket-qr" id="ticket-qr-section">
      ${ticket.qr_image ? `<img id="ticket-qr-img" src="${ticket.qr_image}" alt="QR Code" onerror="this.style.display='none';document.getElementById('qr-error-msg').style.display='block'">` : ''}
      <div id="qr-error-msg" style="display:${ticket.qr_image ? 'none' : 'block'};color:red;text-align:center;margin:12px 0;">
        ${ticket.qr_image ? 'Unable to load QR code. Please try again later.' : 'QR code unavailable for this ticket.'}
      </div>
    </div>
    <div class="ticket-details">
      <div class="info-row"><span>Route</span><span>${ticket.route || '-'}</span></div>
      <div class="info-row"><span>From</span><span>${ticket.from || '-'}</span></div>
      <div class="info-row"><span>To</span><span>${ticket.to || '-'}</span></div>
      <div class="info-row"><span>Ticket Count</span><strong>${typeof ticket.count === 'number' && ticket.count > 0 ? ticket.count : 1}</strong></div>
      <div class="info-row"><span>Fare (per ticket)</span><strong>₹${ticket.fare ? formatRupees(ticket.fare) : '-'}</strong></div>
      <div class="info-row"><span>Total Fare</span><strong>₹${ticket.total_fare ? formatRupees(ticket.total_fare) : (ticket.fare ? formatRupees((ticket.count || 1) * ticket.fare) : '-')}</strong></div>
      <div class="info-row"><span>Status</span><span class="badge badge-${ticket.status}">${ticket.status}</span></div>
      <div class="info-row"><span>Expires</span><span>${formatTime(ticket.expires_at)}</span></div>
    </div>
    <button id="download-ticket-btn" class="btn btn-primary btn-block" style="margin-top:16px;">⬇️ Download Ticket for Offline</button>
    <p style="font-size:12px;color:var(--text-secondary);margin-top:12px;">Show this QR code to the conductor when boarding. You can download and show this ticket even without internet.</p>
  `;
  // Always show the modal when viewing a ticket
  document.getElementById('ticket-modal').classList.remove('hidden');
  // Add download logic
  setTimeout(() => {
    const btn = document.getElementById('download-ticket-btn');
    const qrImg = document.getElementById('ticket-qr-img');
    if (!qrImg || qrImg.style.display === 'none') {
      if (btn) btn.disabled = true;
    } else {
      btn.disabled = false;
      btn.onclick = function() {
        // Ensure QR image is loaded before download
        if (!qrImg.complete || qrImg.naturalWidth === 0) {
          showToast('QR code not loaded. Please wait or try again.', 'error');
          return;
        }
        downloadTicketAsImage(ticket);
      };
    }
    // If QR fails to load after initial render, disable download
    if (qrImg) {
      qrImg.onerror = function() {
        if (btn) btn.disabled = true;
      };
    }
  }, 0);

}

// Download ticket as image (QR + details)
function downloadTicketAsImage(ticket) {
  const canvas = document.createElement('canvas');
  const width = 340;
  const height = 420;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // White background
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  // Draw QR
  const qrImg = document.getElementById('ticket-qr-img');
  if (!qrImg || qrImg.style.display === 'none' || !qrImg.complete || qrImg.naturalWidth === 0) {
    showToast('QR code not available. Cannot download ticket.', 'error');
    return;
  }
  ctx.drawImage(qrImg, width/2-75, 20, 150, 150);
  // Draw details
  ctx.font = 'bold 20px Inter, sans-serif';
  ctx.fillStyle = '#1a73e8';
  ctx.fillText('ScanAndGo Ticket', 60, 200);
  ctx.font = '16px Inter, sans-serif';
  ctx.fillStyle = '#222';
  ctx.fillText(`Route: ${ticket.route || '-'}`, 30, 240);
  ctx.fillText(`From: ${ticket.from || '-'}`, 30, 270);
  ctx.fillText(`To: ${ticket.to || '-'}`, 30, 300);
  ctx.fillText(`Fare: ₹${ticket.fare ? formatRupees(ticket.fare) : '-'}`, 30, 330);
  ctx.fillText(`Status: ${ticket.status}`, 30, 360);
  ctx.fillText(`Expires: ${formatTime(ticket.expires_at)}`, 30, 390);
  // Download
  canvas.toBlob(function(blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ticket-${ticket.id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, 'image/png');
  document.getElementById('ticket-modal').classList.remove('hidden');
}

// Download Poyaloo Pass as a modern Kerala Traveler Card image
function downloadPoyalooPassAsImage() {
  if (!currentUser || !currentUser.poyalooPassActive) {
    showToast('No active Poyaloo Pass found.', 'error');
    return;
  }

  const canvas = document.createElement('canvas');
  const width = 500;
  const height = 320;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // 1. Draw Kerala Orange-to-Gold Gradient Background
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#f97316'); // Orange
  grad.addColorStop(0.5, '#ea580c'); // Deep orange
  grad.addColorStop(1, '#b45309'); // Burnt orange/gold
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // 2. Draw Kerala Traditional Emblem (Palm tree logo + text branding)
  drawKeralaEmblemOnCanvas(ctx, 345, 190, 1.25);

  // 3. Draw Gold Contact Chip
  ctx.save();
  const chipX = 30;
  const chipY = 85;
  const chipW = 45;
  const chipH = 35;
  
  // Chip base gradient
  const chipGrad = ctx.createLinearGradient(chipX, chipY, chipX + chipW, chipY + chipH);
  chipGrad.addColorStop(0, '#ffe066');
  chipGrad.addColorStop(1, '#f5b041');
  ctx.fillStyle = chipGrad;
  ctx.beginPath();
  const radius = 4;
  ctx.moveTo(chipX + radius, chipY);
  ctx.lineTo(chipX + chipW - radius, chipY);
  ctx.quadraticCurveTo(chipX + chipW, chipY, chipX + chipW, chipY + radius);
  ctx.lineTo(chipX + chipW, chipY + chipH - radius);
  ctx.quadraticCurveTo(chipX + chipW, chipY + chipH, chipX + chipW - radius, chipY + chipH);
  ctx.lineTo(chipX + radius, chipY + chipH);
  ctx.quadraticCurveTo(chipX, chipY + chipH, chipX, chipY + chipH - radius);
  ctx.lineTo(chipX, chipY + radius);
  ctx.quadraticCurveTo(chipX, chipY, chipX + radius, chipY);
  ctx.closePath();
  ctx.fill();

  // Draw contact lines
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chipX, chipY + 12);
  ctx.lineTo(chipX + chipW, chipY + 12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(chipX, chipY + 23);
  ctx.lineTo(chipX + chipW, chipY + 23);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(chipX + 15, chipY);
  ctx.lineTo(chipX + 15, chipY + chipH);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(chipX + 30, chipY);
  ctx.lineTo(chipX + 30, chipY + chipH);
  ctx.stroke();
  ctx.restore();

  // 4. Draw Header branding
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px "Inter", sans-serif';
  ctx.fillText('Poyaloo Pass', 30, 45);

  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 9px "Inter", sans-serif';
  ctx.fillText('KERALA TRAVELER', 30, 62);

  // 5. Draw Active Status Badge (top right)
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  const badgeX = width - 110;
  const badgeY = 25;
  const badgeW = 80;
  const badgeH = 24;
  ctx.beginPath();
  ctx.moveTo(badgeX + 12, badgeY);
  ctx.lineTo(badgeX + badgeW - 12, badgeY);
  ctx.quadraticCurveTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + 12);
  ctx.lineTo(badgeX + badgeW, badgeY + badgeH - 12);
  ctx.quadraticCurveTo(badgeX + badgeW, badgeY + badgeH, badgeX + badgeW - 12, badgeY + badgeH);
  ctx.lineTo(badgeX + 12, badgeY + badgeH);
  ctx.quadraticCurveTo(badgeX, badgeY + badgeH, badgeX, badgeY + badgeH - 12);
  ctx.lineTo(badgeX, badgeY + 12);
  ctx.quadraticCurveTo(badgeX, badgeY, badgeX + 12, badgeY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 10px "Inter", sans-serif';
  ctx.fillText('● ACTIVE', badgeX + 15, badgeY + 16);
  ctx.restore();

  // 6. Draw Circular Passenger Avatar Photo
  const photoImg = document.getElementById('pass-photo-display');
  const avatarCenterX = 175;
  const avatarCenterY = 102;
  const avatarRadius = 35;

  ctx.save();
  if (photoImg && !photoImg.classList.contains('hidden') && photoImg.complete && photoImg.naturalWidth > 0) {
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(photoImg, avatarCenterX - avatarRadius, avatarCenterY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
  } else {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.font = 'bold 36px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👤', avatarCenterX, avatarCenterY + 2);
  }
  ctx.restore();

  // 7. Draw Passenger Name
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px "Inter", sans-serif';
  ctx.fillText(currentUser.name || 'Passenger Name', 30, 175);

  // 8. Draw Card Number
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = 'bold 13px "Courier New", monospace';
  const cardNum = currentUser.poyalooPassCardNumber || '00000000000';
  const formattedCardNum = cardNum.replace(/(\d{4})(\d{4})(\d{3})/, '$1 $2 $3');
  ctx.fillText(`Card: ${formattedCardNum}`, 30, 205);

  // 9. Draw Balance (Only show balance if physical card count is 0)
  const physicalCount = currentUser.poyalooPassPhysicalCount || 0;
  if (physicalCount === 0) {
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 15px "Inter", sans-serif';
    ctx.fillText(`Balance: ₹${formatRupees(currentUser.wallet || 0)}`, 30, 235);
  }

  // 10. Draw Footer details
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.font = '9px "Inter", sans-serif';
  ctx.fillText('Scan QR or use card number to board. Issued by Poyaloo Transit.', 30, 290);

  // 11. Draw QR Code on a clean high-contrast white background
  const qrImg = document.getElementById('pass-qr-image');
  if (qrImg && qrImg.complete && qrImg.naturalWidth > 0) {
    ctx.save();
    const qrSize = 100;
    const qrX = width - 130;
    const qrY = 85;

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(qrX + 8, qrY);
    ctx.lineTo(qrX + qrSize - 8, qrY);
    ctx.quadraticCurveTo(qrX + qrSize, qrY, qrX + qrSize, qrY + 8);
    ctx.lineTo(qrX + qrSize, qrY + qrSize - 8);
    ctx.quadraticCurveTo(qrX + qrSize, qrY + qrSize, qrX + qrSize - 8, qrY + qrSize);
    ctx.lineTo(qrX + 8, qrY + qrSize);
    ctx.quadraticCurveTo(qrX, qrY + qrSize, qrX, qrY + qrSize - 8);
    ctx.lineTo(qrX, qrY + 8);
    ctx.quadraticCurveTo(qrX, qrY, qrX + 8, qrY);
    ctx.closePath();
    ctx.fill();

    ctx.drawImage(qrImg, qrX + 6, qrY + 6, qrSize - 12, qrSize - 12);
    ctx.restore();
  }

  canvas.toBlob(function(blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kerala-traveler-pass-${cardNum}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Kerala Traveler Pass downloaded successfully!', 'success');
  }, 'image/png');
}

// Canvas helper function to draw stylized Kerala palm tree logo
function drawKeralaEmblemOnCanvas(ctx, x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // Draw green palm tree
  ctx.fillStyle = '#16a34a';
  
  // Trunk
  ctx.beginPath();
  ctx.moveTo(74, 40);
  ctx.lineTo(78, 40);
  ctx.lineTo(79, 80);
  ctx.lineTo(75, 80);
  ctx.closePath();
  ctx.fill();

  // Center top left frond
  ctx.beginPath();
  ctx.moveTo(76, 40);
  ctx.bezierCurveTo(76, 20, 60, 10, 50, 15);
  ctx.bezierCurveTo(62, 18, 70, 30, 76, 40);
  ctx.closePath();
  ctx.fill();

  // Center top right frond
  ctx.beginPath();
  ctx.moveTo(76, 40);
  ctx.bezierCurveTo(76, 20, 92, 10, 102, 15);
  ctx.bezierCurveTo(90, 18, 82, 30, 76, 40);
  ctx.closePath();
  ctx.fill();

  // Middle left frond
  ctx.beginPath();
  ctx.moveTo(76, 40);
  ctx.bezierCurveTo(65, 30, 50, 30, 42, 40);
  ctx.bezierCurveTo(54, 40, 66, 42, 76, 40);
  ctx.closePath();
  ctx.fill();

  // Middle right frond
  ctx.beginPath();
  ctx.moveTo(76, 40);
  ctx.bezierCurveTo(87, 30, 102, 30, 110, 40);
  ctx.bezierCurveTo(98, 40, 86, 42, 76, 40);
  ctx.closePath();
  ctx.fill();

  // Bottom left frond
  ctx.beginPath();
  ctx.moveTo(76, 40);
  ctx.bezierCurveTo(60, 40, 48, 50, 44, 62);
  ctx.bezierCurveTo(52, 54, 64, 48, 76, 40);
  ctx.closePath();
  ctx.fill();

  // Bottom right frond
  ctx.beginPath();
  ctx.moveTo(76, 40);
  ctx.bezierCurveTo(92, 40, 104, 50, 108, 62);
  ctx.bezierCurveTo(100, 54, 88, 48, 76, 40);
  ctx.closePath();
  ctx.fill();

  // Draw "KERALA" text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('KERALA', 76, 88);

  // Draw "God's Own Country" text
  ctx.fillStyle = '#facc15';
  ctx.font = 'italic bold 6.5px "Georgia", serif';
  ctx.textAlign = 'center';
  ctx.fillText("God's Own Country", 76, 96);

  ctx.restore();
}

function closeModal() {
  document.getElementById('ticket-modal').classList.add('hidden');

  const bookPage = document.getElementById('page-book');
  if (bookPage && !bookPage.classList.contains('hidden')) {
    resetBookingForm();
    navigateTo('map');
  }
}

// Close modal on overlay click
document.querySelector('.modal-overlay')?.addEventListener('click', closeModal);

// ─── Poyaloo Pass Book Scanner ───────────────────────────────────────────────
let poyalooQrScanner = null;
let poyalooScannerRunning = false;

async function stopPoyalooScanner() {
  if (poyalooQrScanner && poyalooScannerRunning) {
    try {
      await poyalooQrScanner.stop();
      poyalooQrScanner.clear();
    } catch (e) { /* ignore */ }
    poyalooScannerRunning = false;
  }
  const readerContainer = document.getElementById('poyaloo-scan-reader-container');
  if (readerContainer) readerContainer.classList.remove('scanning');
  
  const startBtn = document.getElementById('poyaloo-scan-camera-btn');
  if (startBtn) startBtn.classList.remove('hidden');
  
  const stopBtn = document.getElementById('poyaloo-scan-stop-btn');
  if (stopBtn) stopBtn.classList.add('hidden');
}

function closePoyalooScanModal() {
  stopPoyalooScanner();
  document.getElementById('poyaloo-scan-modal').classList.add('hidden');
}

function processPoyalooQRText(decodedText) {
  if (!decodedText) return;
  let parsedCardNumber = null;
  
  try {
    const parsed = JSON.parse(decodedText);
    if (parsed && parsed.type === 'poyaloo_pass' && parsed.cardNumber) {
      parsedCardNumber = parsed.cardNumber;
    }
  } catch (e) {
    const cleanData = decodedText.trim().replace(/\s+/g, '');
    if (cleanData.length === 11 && !isNaN(cleanData)) {
      parsedCardNumber = cleanData;
    }
  }
  
  if (parsedCardNumber) {
    const input = document.getElementById('book-poyaloo-card');
    if (input) {
      input.value = parsedCardNumber;
      input.dispatchEvent(new Event('input'));
    }
    showToast('Poyaloo Pass Card Number scanned!', 'success');
    if (navigator.vibrate) navigator.vibrate(200);
    closePoyalooScanModal();
  } else {
    showToast('Invalid QR code format. Not a valid Poyaloo Pass.', 'error');
  }
}

// Wire up Poyaloo Pass Scanner Elements
(function initPoyalooScanEvents() {
  // Open Modal
  document.getElementById('scan-poyaloo-card-btn')?.addEventListener('click', () => {
    document.getElementById('poyaloo-scan-modal').classList.remove('hidden');
    // reset scan UI state
    const readerContainer = document.getElementById('poyaloo-scan-reader-container');
    if (readerContainer) readerContainer.classList.remove('scanning');
    
    const startBtn = document.getElementById('poyaloo-scan-camera-btn');
    if (startBtn) {
      startBtn.classList.remove('hidden');
      if (!isCameraAvailable()) {
        startBtn.innerHTML = '📷 Open Camera & Scan <small style="display:block;font-size:11px;opacity:0.8;margin-top:2px;">⚠️ Requires HTTPS – use photo scan below</small>';
      }
    }
    document.getElementById('poyaloo-scan-stop-btn')?.classList.add('hidden');
  });

  // Close Button & Overlay click
  document.getElementById('poyaloo-scan-modal-close')?.addEventListener('click', closePoyalooScanModal);
  document.querySelector('#poyaloo-scan-modal .modal-overlay')?.addEventListener('click', closePoyalooScanModal);

  // Start Camera Scan
  document.getElementById('poyaloo-scan-camera-btn')?.addEventListener('click', async () => {
    if (!isCameraAvailable()) {
      showToast('Camera requires HTTPS. Use the "Scan QR from Photo" option below.', 'error');
      return;
    }

    const readerContainer = document.getElementById('poyaloo-scan-reader-container');
    if (readerContainer) readerContainer.classList.add('scanning');
    
    document.getElementById('poyaloo-scan-camera-btn')?.classList.add('hidden');
    document.getElementById('poyaloo-scan-stop-btn')?.classList.remove('hidden');

    try {
      poyalooQrScanner = new Html5Qrcode('poyaloo-scan-reader');
      await poyalooQrScanner.start(
        { facingMode: 'environment' },
        {
          fps: 30,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1.0,
        },
        async (decodedText) => {
          await stopPoyalooScanner();
          processPoyalooQRText(decodedText);
        },
        () => {} // Ignore scan failure frames
      );
      poyalooScannerRunning = true;
    } catch (err) {
      showToast('Camera error: ' + err + '. Try "Scan QR from Photo" instead.', 'error');
      stopPoyalooScanner();
    }
  });

  // Stop Camera Scan
  document.getElementById('poyaloo-scan-stop-btn')?.addEventListener('click', stopPoyalooScanner);

  // File Upload Scan
  document.getElementById('poyaloo-scan-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    // Use a temporary FileReader and Image to detect
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = async () => {
        let detected = null;
        try {
          detected = detectQRFromImage(img);
        } catch (err) {
          console.warn('Poyaloo File Scan error:', err);
        }

        if (detected && detected.data) {
          processPoyalooQRText(detected.data);
        } else {
          try {
            const tempScanner = new Html5Qrcode('poyaloo-scan-reader');
            const result = await tempScanner.scanFile(file, true);
            processPoyalooQRText(result);
          } catch (err) {
            showToast('Could not detect QR code in this image. Try another photo.', 'error');
          }
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
})();

// ─── QR Validation (Conductor) ──────────────────────────────────────────────
let html5QrScanner = null;
let scannerRunning = false;
let validatedTicketsRefreshTimer = null;

// ─── EM1630 / Scan Queue ─────────────────────────────────────────────────────
let scanQueue = [];
let em1630Buffer = '';
let em1630Watchdog = null;

// ─── Conductor Voice Notifications ───────────────────────────────────────────
let voiceEnabled = localStorage.getItem('conductor_voice') !== 'false';

function speakNotification(text) {
  if (!voiceEnabled || !window.speechSynthesis) return;
  window.speechSynthesis.cancel(); // stop any current speech immediately
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-IN';
  utter.rate = 0.95;
  utter.volume = 1;
  window.speechSynthesis.speak(utter);
}

function toggleConductorVoice() {
  voiceEnabled = !voiceEnabled;
  localStorage.setItem('conductor_voice', voiceEnabled);
  const btn = document.getElementById('voice-toggle-btn');
  if (btn) {
    btn.textContent = voiceEnabled ? '🔊 Voice On' : '🔇 Voice Off';
    btn.className = voiceEnabled ? 'voice-toggle-btn voice-on' : 'voice-toggle-btn voice-off';
  }
  if (voiceEnabled) speakNotification('Voice notifications on');
}

// Conductor tab switching
document.querySelectorAll('.ctab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ctab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.ctab;
    document.querySelectorAll('.ctab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`ctab-${tab}`).classList.remove('hidden');

    if (tab === 'validated') loadValidatedTickets();
    if (tab === 'upi-settings') loadConductorUpiSettings();
    if (tab === 'scan') {
      setTimeout(() => document.getElementById('em1630-input')?.focus(), 150);
      // Sync voice button label to current state
      const vBtn = document.getElementById('voice-toggle-btn');
      if (vBtn) {
        vBtn.textContent = voiceEnabled ? '🔊 Voice On' : '🔇 Voice Off';
        vBtn.className = voiceEnabled ? 'voice-toggle-btn voice-on' : 'voice-toggle-btn voice-off';
      }
    }
  });
});

// EM1630 keyboard wedge capture — scanner acts as HID keyboard, types QR data + Enter
(function initEM1630Capture() {
  const em1630Input = document.getElementById('em1630-input');
  if (!em1630Input) return;

  em1630Input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const scanned = em1630Buffer.trim();
      em1630Buffer = '';
      em1630Input.value = '';
      if (scanned && scanned.length > 5) {
        addToScanQueue(scanned, 'EM1630');
        updateEM1630Status(true);
        if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
      }
      e.preventDefault();
    }
  });

  em1630Input.addEventListener('input', () => {
    em1630Buffer = em1630Input.value;
  });

  // Re-focus the hidden input when conductor taps anywhere on the scan tab (not on a button/input)
  document.getElementById('ctab-scan')?.addEventListener('click', (e) => {
    if (!e.target.closest('button, input, textarea, label, select, details, summary')) {
      em1630Input.focus();
    }
  });
})();

function updateEM1630Status(active) {
  const el = document.getElementById('em1630-status');
  if (!el) return;
  if (active) {
    el.className = 'em1630-status em1630-active';
    el.textContent = '📡 EM1630 Active';
    clearTimeout(em1630Watchdog);
    em1630Watchdog = setTimeout(() => {
      el.className = 'em1630-status em1630-idle';
      el.textContent = '📡 EM1630 Ready';
    }, 8000);
  } else {
    el.className = 'em1630-status em1630-idle';
    el.textContent = '📡 EM1630 Ready';
  }
}

// Check if camera streaming is available (requires HTTPS on non-localhost)
function isCameraAvailable() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Show a hint if camera is not available
(function checkCameraSupport() {
  const startBtn = document.getElementById('start-scan-btn');
  if (startBtn && !isCameraAvailable()) {
    startBtn.innerHTML = '📷 Open Camera & Scan <small style="display:block;font-size:11px;opacity:0.8;margin-top:2px;">⚠️ Requires HTTPS – use photo scan below</small>';
  }
})();

// Start camera scan
document.getElementById('start-scan-btn')?.addEventListener('click', async () => {
  if (!isCameraAvailable()) {
    showToast('Camera requires HTTPS. Use the "Scan QR from Photo" option below, or open this site via HTTPS.', 'error');
    return;
  }

  const readerContainer = document.getElementById('qr-reader-container');
  readerContainer.classList.add('scanning');
  document.getElementById('start-scan-btn').classList.add('hidden');
  document.getElementById('stop-scan-btn').classList.remove('hidden');
  document.getElementById('validation-result').classList.add('hidden');

  try {
    html5QrScanner = new Html5Qrcode('qr-reader');

    await html5QrScanner.start(
      { facingMode: 'environment' }, // Use back camera on mobile
      {
        fps: 30,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
      },
      onQrScanSuccess,
      () => {} // Ignore scan failure frames
    );
    scannerRunning = true;
  } catch (err) {
    showToast('Camera error: ' + err + '. Try "Scan QR from Photo" instead.', 'error');
    stopScanner();
  }
});

// Stop camera scan
document.getElementById('stop-scan-btn')?.addEventListener('click', stopScanner);

// ─── Image-based QR scan (works without HTTPS / camera permission) ──────────

// Helper: contrast enhancement or crop helper is no longer needed since html5-qrcode's scanFile handles parsing directly.

function handlePhotoScan(file) {
  if (!file) return;

  const canvas = document.getElementById('photo-preview-canvas');
  const ctx = canvas.getContext('2d');
  const placeholder = document.getElementById('viewfinder-placeholder');
  const overlay = document.getElementById('viewfinder-overlay');
  const status = document.getElementById('viewfinder-status');
  const focusSquare = overlay.querySelector('.focus-square');

  document.getElementById('validation-result').classList.add('hidden');

  // Show image preview in canvas
  const img = new Image();
  const reader = new FileReader();
  reader.onload = (ev) => {
    img.onload = async () => {
      // Size canvas to fit container while keeping aspect ratio
      const containerW = canvas.parentElement.clientWidth;
      const scale = containerW / img.width;
      canvas.width = containerW;
      canvas.height = img.height * scale;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Show canvas + overlay
      canvas.classList.add('has-image');
      placeholder.classList.add('hidden');
      overlay.classList.remove('hidden');
      status.classList.remove('hidden');
      status.className = 'viewfinder-status';
      status.innerHTML = '<div class="scan-pulse"></div><span>Scanning QR code...</span>';
      focusSquare.className = 'focus-square';

      // Small delay for visual feedback
      await new Promise(r => setTimeout(r, 400));

      try {
        const h5scanner = new Html5Qrcode('qr-file-reader');
        const h5result = await h5scanner.scanFile(file, false);
        h5scanner.clear();

        focusSquare.className = 'focus-square found';
        status.className = 'viewfinder-status success';
        status.innerHTML = '<div class="scan-pulse"></div><span>✅ QR Code Detected!</span>';
        if (navigator.vibrate) navigator.vibrate(200);
        showToast('QR code detected!', 'success');
        // await new Promise(r => setTimeout(r, 600)); // Removed for faster scanning performance
        addToScanQueue(h5result, 'camera');
        resetScannerUI();
        return;
      } catch (e) {
        // Both methods failed
      }

      // ── All attempts failed ──
      focusSquare.className = 'focus-square fail';
      status.className = 'viewfinder-status fail';
      status.innerHTML = '<div class="scan-pulse"></div><span>❌ No QR found – try again</span>';
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      showToast('Could not read QR code. Tips: hold phone steady, ensure QR fills most of the frame, use good lighting.', 'error');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// Camera capture input
document.getElementById('qr-file-input')?.addEventListener('change', (e) => {
  handlePhotoScan(e.target.files[0]);
  e.target.value = '';
});

// Gallery input
document.getElementById('qr-gallery-input')?.addEventListener('change', (e) => {
  handlePhotoScan(e.target.files[0]);
  e.target.value = '';
});

async function stopScanner() {
  if (html5QrScanner && scannerRunning) {
    try {
      await html5QrScanner.stop();
    } catch (e) {
      console.warn('Error stopping scanner:', e);
    } finally {
      try {
        html5QrScanner.clear();
      } catch (clearErr) { /* ignore */ }
      scannerRunning = false;
    }
  }
  document.getElementById('qr-reader-container').classList.remove('scanning');
  document.getElementById('start-scan-btn').classList.remove('hidden');
  document.getElementById('stop-scan-btn').classList.add('hidden');
}

// QR scan success callback
async function onQrScanSuccess(decodedText) {
  // Stop scanner immediately to prevent double scan
  await stopScanner();

  // Vibrate on mobile if available
  if (navigator.vibrate) navigator.vibrate(200);

  // Add to validation queue (EM1630 and camera share the same queue)
  addToScanQueue(decodedText, 'camera');
}

// Validate ticket (shared by camera scan and manual entry)
async function validateTicketQR(qrData) {
  const container = document.getElementById('validation-result');
  container.classList.remove('hidden');
  container.className = 'validation-result';
  container.innerHTML = '<p style="text-align:center;">⏳ Validating...</p>';

  try {
    const result = await api('/tickets/validate', {
      method: 'POST',
      body: JSON.stringify({ qr_data: qrData }),
    });

    if (result.valid) {
      if (result.isPoyalooPass) {
        speakNotification('Pass Verified');
        container.className = 'validation-result valid conductor-validation-card';
        container.innerHTML = `
          <div class="cv-header pass-header" style="background: linear-gradient(135deg, var(--btn-accent-start), var(--btn-accent-end)); color: white; padding: 16px; border-radius: 12px 12px 0 0; text-align: center;">
            <span class="cv-icon" style="font-size: 2.5rem; display: block; margin-bottom: 8px;">💳</span>
            <h2 style="margin: 0; font-size: 1.5rem; font-weight: bold; color: white;">Poyaloo Pass Verified</h2>
            <p class="cv-subtitle" style="margin: 4px 0 0 0; font-size: 0.85rem; opacity: 0.9; color: white;">Digital Bus Pass Status: ACTIVE</p>
          </div>

          <div class="cv-ticket-card" style="padding: 16px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; background: white;">
            <div style="display: flex; gap: 16px; margin-bottom: 16px; align-items: center;">
              <div class="pass-verify-photo" style="width: 80px; height: 80px; border-radius: 8px; overflow: hidden; background: #f3f4f6; display: flex; align-items: center; justify-content: center; border: 2px solid var(--btn-accent-start); flex-shrink: 0;">
                ${result.pass.photoUrl ? `<img src="${result.pass.photoUrl}" style="width:100%; height:100%; object-fit:cover;">` : `<span style="font-size: 2.5rem; color: #9ca3af;">👤</span>`}
              </div>
              <div style="text-align: left;">
                <h3 style="margin: 0; font-size: 1.25rem; font-weight: bold; color: #1f2937;">${result.pass.passenger}</h3>
                <p style="margin: 4px 0 0 0; font-size: 0.9rem; color: #4b5563;">Card: <strong>${result.pass.cardNumber}</strong></p>
                <p style="margin: 2px 0 0 0; font-size: 0.85rem; color: #6b7280;">Phone: ${result.pass.phone || 'Hidden'}</p>
              </div>
            </div>

            <div class="cv-row" style="display: flex; justify-content: space-between; border-top: 1px solid #f3f4f6; padding-top: 12px;">
              <span class="cv-label" style="color: #6b7280; font-size: 0.9rem;">Category</span>
              <span class="cv-value"><span class="cv-ticket-category cv-cat-${result.pass.ticketCategory || 'adult'}" style="padding: 2px 8px; border-radius: 12px; font-size: 0.85rem; font-weight: 600; text-transform: uppercase;">${result.pass.ticketCategory || 'adult'}</span></span>
            </div>
            <div class="cv-row" style="display: flex; justify-content: space-between; margin-top: 8px;">
              <span class="cv-label" style="color: #6b7280; font-size: 0.9rem;">Wallet Balance</span>
              <span class="cv-value" style="font-size: 1.1rem; font-weight: bold; color: #10b981;">₹${formatRupees(result.pass.wallet || 0)}</span>
            </div>
          </div>

          <div class="cv-actions" style="margin-top: 16px; display: flex; gap: 12px;">
            <button id="approve-boarding-btn" class="btn btn-success cv-btn" style="flex: 1; padding: 12px; border-radius: 8px; font-weight: bold;">Approve Boarding</button>
            <button id="dismiss-boarding-btn" class="btn btn-secondary cv-btn" style="padding: 12px; border-radius: 8px;">Dismiss</button>
          </div>
          <div id="boarding-decision-result" style="margin-top: 12px; text-align: center; font-weight: bold;"></div>
        `;

        document.getElementById('approve-boarding-btn').onclick = () => {
          speakNotification('Boarding Approved');
          document.getElementById('boarding-decision-result').innerHTML = '<span style="color:#065f46;">✅ Boarding Approved Successfully!</span>';
          document.querySelector('.cv-actions').style.display = 'none';
          showToast('Boarding approved', 'success');
        };
        document.getElementById('dismiss-boarding-btn').onclick = () => {
          resetScannerUI();
        };
        showToast('✅ Poyaloo Pass Verified!', 'success');
        return;
      }

      speakNotification('Ticket Verified');
      // Show approve/reject UI for conductor
      container.className = 'validation-result valid conductor-validation-card';
      container.innerHTML = `
        <div class="cv-header">
          <span class="cv-icon">✅</span>
          <h2>Ticket Verified</h2>
          <p class="cv-subtitle">Step 2: Conductor approves or rejects the ticket</p>
        </div>

        <div class="cv-ticket-card">
          <div class="cv-row">
            <span class="cv-label">Passenger</span>
            <span class="cv-value cv-passenger">${result.ticket.passenger || '-'}</span>
          </div>
          <div class="cv-row">
            <span class="cv-label">Phone</span>
            <span class="cv-value">${result.ticket.phone ? result.ticket.phone : 'Hidden for privacy'}</span>
          </div>
          <div class="cv-row">
            <span class="cv-label">Email</span>
            <span class="cv-value">${result.ticket.email ? result.ticket.email : 'Missing'}</span>
          </div>
          <div class="cv-row">
            <span class="cv-label">Ticket Category</span>
            <span class="cv-value"><span class="cv-ticket-category cv-cat-${result.ticket.ticketCategory || 'adult'}">${({adult:'🎫 Adult',student:'🎓 Student',free:'🆓 Free'})[result.ticket.ticketCategory || 'adult']}</span>${(result.ticket.ticketCategory === 'student' || result.ticket.ticketCategory === 'free') ? ' <span style="font-size:11px;color:#dc2626;">⚠️ Verify Pass</span>' : ''}</span>
          </div>
          <div class="cv-route-row">
            <div class="cv-stop">
              <span class="cv-label">From</span>
              <span class="cv-value">${result.ticket.from || '-'}</span>
            </div>
            <span class="cv-arrow">→</span>
            <div class="cv-stop">
              <span class="cv-label">To</span>
              <span class="cv-value">${result.ticket.to || '-'}</span>
            </div>
          </div>
          <div class="cv-row">
            <span class="cv-label">Fare</span>
            <span class="cv-value cv-fare">₹${formatRupees(result.ticket.fare || 0)}</span>
          </div>
          <div class="cv-row">
            <span class="cv-label">Tickets</span>
            <span class="cv-value" style="background:#e8f0fe;color:#1a73e8;padding:2px 10px;border-radius:10px;font-size:1rem;">
              🎟️ ×${result.ticket.count || 1} ${(result.ticket.count || 1) > 1 ? 'passengers' : 'passenger'}
            </span>
          </div>
        </div>

        <div id="conductor-approve-reject" class="cv-actions">
          <button id="approve-ticket-btn" class="btn btn-success cv-btn">Approve</button>
          <button id="reject-ticket-btn" class="btn btn-danger cv-btn">Reject</button>
        </div>

        <div id="decision-result" class="cv-decision-result"></div>
      `;
      showToast('✅ Ticket validated! Awaiting conductor decision.', 'success');

      // Attach event listeners for approve/reject
      document.getElementById('approve-ticket-btn').onclick = async () => {
        await handleConductorDecision(result.ticket.id, 'approve');
      };
      document.getElementById('reject-ticket-btn').onclick = async () => {
        await handleConductorDecision(result.ticket.id, 'reject');
      };
    } else {
      speakNotification('Ticket invalid: ' + (result.error || 'Invalid ticket'));
      container.className = 'validation-result invalid';
      container.innerHTML = `
        <div style="text-align:center;margin-bottom:12px;">
          <span style="font-size:48px;">❌</span>
          <h3 style="color:#991b1b;margin-top:8px;">Invalid Ticket</h3>
        </div>
        <p style="text-align:center;color:#991b1b;">${result.error}</p>
        <button onclick="resetScannerUI()" class="btn btn-primary btn-block" style="margin-top:16px;">📷 Try Again</button>
      `;
      showToast('❌ ' + result.error, 'error');
    }
  } catch (err) {
    speakNotification('Error: ' + err.message);
    container.className = 'validation-result invalid';
    container.innerHTML = `
      <div style="text-align:center;">
        <span style="font-size:48px;">⚠️</span>
        <h3 style="color:#991b1b;margin-top:8px;">Error</h3>
        <p>${err.message}</p>
      </div>
      <button onclick="resetScannerUI()" class="btn btn-primary btn-block" style="margin-top:16px;">📷 Try Again</button>
    `;
    showToast(err.message, 'error');
  }
}

// Handle conductor approve/reject decision
async function handleConductorDecision(ticketId, decision) {
  const decisionResult = document.getElementById('decision-result');
  decisionResult.innerHTML = '<span>⏳ Submitting decision...</span>';
  try {
    const res = await api(`/tickets/${ticketId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
    if (res.success || res.approved !== undefined) {
      const isApproved = decision === 'approve';
      decisionResult.innerHTML = `<span style="color:${isApproved ? '#065f46' : '#991b1b'};font-weight:bold;">${isApproved ? '✅ Ticket Approved' : '❌ Ticket Rejected'}</span>`;
      showToast(isApproved ? 'Ticket approved!' : 'Ticket rejected!', isApproved ? 'success' : 'error');
      // Optionally, hide approve/reject buttons after decision
      document.getElementById('conductor-approve-reject').style.display = 'none';
      // Refresh earnings if approved
      if (isApproved) loadConductorEarnings();
    } else {
      decisionResult.innerHTML = `<span style="color:#991b1b;">Error: ${res.error || 'Unknown error'}</span>`;
      showToast(res.error || 'Decision failed', 'error');
    }
  } catch (err) {
    decisionResult.innerHTML = `<span style="color:#991b1b;">Error: ${err.message}</span>`;
    showToast(err.message, 'error');
  }
}

function resetScannerUI() {
  document.getElementById('validation-result').classList.add('hidden');
  document.getElementById('qr-input').value = '';
  // Reset viewfinder
  const canvas = document.getElementById('photo-preview-canvas');
  const placeholder = document.getElementById('viewfinder-placeholder');
  const overlay = document.getElementById('viewfinder-overlay');
  const status = document.getElementById('viewfinder-status');
  if (canvas) canvas.classList.remove('has-image');
  if (placeholder) placeholder.classList.remove('hidden');
  if (overlay) overlay.classList.add('hidden');
  if (status) status.classList.add('hidden');
  const sq = document.querySelector('.focus-square');
  if (sq) sq.className = 'focus-square';
}

// ─── Scan Queue Management ──────────────────────────────────────────────
function addToScanQueue(qrData, source) {
  // Deduplicate: skip if this QR is already pending in queue
  if (scanQueue.some(item => item.qrData === qrData && item.status === 'pending')) {
    showToast('This ticket is already in the queue', 'warning');
    return;
  }
  const id = Date.now() + '-' + Math.random().toString(36).substr(2, 5);
  scanQueue.push({ id, qrData, source, status: 'pending' });
  speakNotification('Q R code scanned successfully');
  renderScanQueue();
  validateQueueItem(id);
}

function renderScanQueue() {
  const pending = scanQueue.filter(item => item.status === 'pending');
  const queueSection = document.getElementById('scan-queue');
  const queueCount = document.getElementById('queue-count');
  if (!queueSection) return;
  if (queueCount) queueCount.textContent = pending.length;

  if (pending.length === 0) {
    queueSection.classList.add('hidden');
    scanQueue = scanQueue.filter(i => i.status === 'pending');
    return;
  }
  queueSection.classList.remove('hidden');

  // Only render new items that don’t yet have a card
  const container = document.getElementById('queue-items');
  pending.forEach((item) => {
    if (!document.getElementById(`queue-item-${item.id}`)) {
      const div = document.createElement('div');
      div.className = 'queue-item';
      div.id = `queue-item-${item.id}`;
      const badgeClass = item.source === 'EM1630' ? 'badge-em1630' : item.source === 'camera' ? 'badge-camera' : 'badge-manual';
      const badgeLabel = item.source === 'EM1630' ? '📡 EM1630' : item.source === 'camera' ? '📷 Camera' : '✍️ Manual';
      div.innerHTML = `
        <div class="queue-item-header">
          <span class="queue-source-badge ${badgeClass}">${badgeLabel}</span>
          <span class="queue-item-status" id="qstatus-${item.id}">⏳ Validating…</span>
        </div>
        <div id="queue-item-body-${item.id}" class="queue-item-body">
          <p class="queue-validating-text">⏳ Contacting server…</p>
        </div>
      `;
      container.prepend(div);
    }
  });
}

async function validateQueueItem(itemId) {
  const item = scanQueue.find(i => i.id === itemId && i.status === 'pending');
  if (!item) return;
  const bodyEl = document.getElementById(`queue-item-body-${itemId}`);
  const statusEl = document.getElementById(`qstatus-${itemId}`);
  try {
    const result = await api('/tickets/validate', {
      method: 'POST',
      body: JSON.stringify({ qr_data: item.qrData }),
    });
    if (!bodyEl) return;
    if (result.valid) {
      if (statusEl) statusEl.textContent = '✅ Valid';
      speakNotification('Ticket Verified');
      document.getElementById(`queue-item-${itemId}`)?.classList.add('queue-item-valid');
      bodyEl.innerHTML = `
        <div class="cv-ticket-card" style="margin-top:6px;">
          <div class="cv-row">
            <span class="cv-label">Passenger</span>
            <span class="cv-value cv-passenger">${result.ticket.passenger || '-'}</span>
          </div>
          <div class="cv-row">
            <span class="cv-label">Phone</span>
            <span class="cv-value">${result.ticket.phone || 'Hidden for privacy'}</span>
          </div>
          <div class="cv-row">
            <span class="cv-label">Email</span>
            <span class="cv-value">${result.ticket.email ? result.ticket.email : 'Missing'}</span>
          </div>
          <div class="cv-row">
            <span class="cv-label">Ticket Category</span>
            <span class="cv-value"><span class="cv-ticket-category cv-cat-${result.ticket.ticketCategory || 'adult'}">${({adult:'🎫 Adult',student:'🎓 Student',free:'🆓 Free'})[result.ticket.ticketCategory || 'adult']}</span>${(result.ticket.ticketCategory === 'student' || result.ticket.ticketCategory === 'free') ? ' <span style="font-size:11px;color:#dc2626;">⚠️ Verify Pass</span>' : ''}</span>
          </div>
          <div class="cv-route-row">
            <div class="cv-stop">
              <span class="cv-label">From</span>
              <span class="cv-value">${result.ticket.from || '-'}</span>
            </div>
            <span class="cv-arrow">→</span>
            <div class="cv-stop">
              <span class="cv-label">To</span>
              <span class="cv-value">${result.ticket.to || '-'}</span>
            </div>
          </div>
          <div class="cv-row">
            <span class="cv-label">Fare</span>
            <span class="cv-value cv-fare">₹${formatRupees(result.ticket.fare || 0)} × ${result.ticket.count || 1}</span>
          </div>
        </div>
        <div class="queue-decision-btns">
          <button class="btn btn-success cv-btn" onclick="resolveQueueItem('${itemId}','${result.ticket.id}','approve')">✅ Approve</button>
          <button class="btn btn-danger cv-btn" onclick="resolveQueueItem('${itemId}','${result.ticket.id}','reject')">❌ Reject</button>
        </div>
        <div id="q-decision-result-${itemId}" class="cv-decision-result"></div>
      `;
    } else {
      if (statusEl) statusEl.textContent = '❌ Invalid';
      speakNotification('Ticket invalid: ' + (result.error || 'Invalid ticket'));
      document.getElementById(`queue-item-${itemId}`)?.classList.add('queue-item-invalid');
      bodyEl.innerHTML = `
        <p class="queue-error-text">❌ ${result.error || 'Invalid ticket'}</p>
        <button class="btn btn-secondary btn-block btn-sm" style="margin-top:6px;" onclick="dismissQueueItem('${itemId}')">Dismiss</button>
      `;
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = '⚠️ Error';
    speakNotification('Error: ' + err.message);
    if (bodyEl) bodyEl.innerHTML = `
      <p class="queue-error-text">⚠️ ${err.message}</p>
      <button class="btn btn-secondary btn-block btn-sm" style="margin-top:6px;" onclick="dismissQueueItem('${itemId}')">Dismiss</button>
    `;
  }
}

async function resolveQueueItem(itemId, ticketId, decision) {
  const itemEl = document.getElementById(`queue-item-${itemId}`);
  const isApproved = decision === 'approve';
  
  // Optimistically mark as resolved and trigger card removal animation immediately
  const item = scanQueue.find(i => i.id === itemId);
  if (item) {
    item.status = isApproved ? 'approved' : 'rejected';
  }
  
  if (itemEl) {
    itemEl.classList.add('queue-item-done');
    // Slide out and remove from DOM after transition completes
    setTimeout(() => {
      itemEl.remove();
      renderScanQueue();
    }, 400);
  }

  try {
    const res = await api(`/tickets/${ticketId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
    if (res.success || res.approved !== undefined) {
      showToast(isApproved ? '✅ Ticket Approved!' : '❌ Ticket Rejected', isApproved ? 'success' : 'error');
      speakNotification(isApproved ? 'Ticket Approved' : 'Ticket Rejected');
      if (isApproved) loadConductorEarnings();
    } else {
      showToast(`Error: ${res.error || 'Failed to update ticket'}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

function dismissQueueItem(itemId) {
  const item = scanQueue.find(i => i.id === itemId);
  if (item) item.status = 'dismissed';
  const itemEl = document.getElementById(`queue-item-${itemId}`);
  if (itemEl) {
    itemEl.classList.add('queue-item-done');
    setTimeout(() => { itemEl.remove(); renderScanQueue(); }, 400);
  }
}

// Manual validate
document.getElementById('validate-btn')?.addEventListener('click', async () => {
  const qrData = document.getElementById('qr-input').value.trim();
  if (!qrData) return showToast('Please enter QR data', 'error');
  document.getElementById('qr-input').value = '';
  addToScanQueue(qrData, 'manual');
});

// ─── Conductor: Validated Tickets Dashboard ─────────────────────────────────
async function loadValidatedTickets() {
  try {
    const data = await api('/tickets/conductor/validated');
    const container = document.getElementById('validated-tickets-list');
    const empty = document.getElementById('no-validated');
    const countEl = document.getElementById('validated-count');
    const overtimeEl = document.getElementById('overtime-count');

    countEl.textContent = `${data.count} validated`;
    overtimeEl.textContent = `${data.overtimeCount} overtime`;

    // Show/hide overtime badge
    if (data.overtimeCount > 0) {
      overtimeEl.classList.remove('hidden');
    } else {
      overtimeEl.classList.add('hidden');
    }

    if (data.tickets.length === 0) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    container.innerHTML = data.tickets.map(t => {
      const isOT = t.isExpired;
      const ticketCount = Number(t.count || 1);
      const totalFare = Number(t.total_fare || 0) || (Number(t.fare || 0) * ticketCount);
      const travelPct = t.allowedMinutes > 0
        ? Math.min(100, Math.round((t.travelTimeMinutes / t.allowedMinutes) * 100))
        : 0;
      const barColor = travelPct > 100 ? 'red' : travelPct > 75 ? 'yellow' : 'green';
      const remainingMin = Math.max(0, t.allowedMinutes - t.travelTimeMinutes);

      return `
        <div class="vticket-card ${isOT ? 'overtime' : ''}">
          <div class="vticket-top">
            <div>
              <div class="vticket-passenger">${t.passenger}</div>
              <div class="vticket-phone">${t.phone ? t.phone : '<span style=\'color:#888\'>Hidden for privacy</span>'}</div>
              <div class="vticket-phone" style="font-size:11px;">${t.email ? '✉️ ' + t.email : '<span style=\'color:#888\'>✉️ Missing</span>'}</div>
              <div style="margin-top:3px;"><span class="cv-ticket-category cv-cat-${t.ticketCategory || 'adult'}">${({adult:'🎫 Adult',student:'🎓 Student',free:'🆓 Free'})[t.ticketCategory || 'adult']}</span>${(t.ticketCategory === 'student' || t.ticketCategory === 'free') ? ' <span style="font-size:10px;color:#dc2626;">⚠️ Verify Pass</span>' : ''}</div>
            </div>
            <span class="vticket-flag ${isOT ? 'flag-overtime' : 'flag-valid'}">
              ${isOT ? '🔴 OVERTIME' : '🟢 Valid'}
            </span>
          </div>
          <div class="vticket-route">${t.route_code} · ${t.route_name}</div>
          <div class="vticket-stops">${t.from_stop} → ${t.to_stop}</div>
          <div class="vticket-meta">
            <span>🕐 Boarded: ${formatTime(t.boarded_at)}</span>
            <span class="vticket-fare">₹${formatRupees(totalFare)}${ticketCount > 1 ? ` (x${ticketCount})` : ''}</span>
            ${ticketCount > 1 ? `<span class="vticket-count">🎟️ ×${ticketCount}</span>` : ''}
          </div>
          <div class="vticket-time-bar">
            <div class="vticket-time-fill ${barColor}" style="width: ${Math.min(travelPct, 100)}%"></div>
          </div>
          <div class="vticket-time-label ${isOT ? 'overtime-label' : ''}">
            ${isOT
              ? `⚠️ Exceeded by ${t.overtimeMinutes} min`
              : `${remainingMin} min remaining of ${t.allowedMinutes} min`
            }
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    showToast('Failed to load validated tickets: ' + err.message, 'error');
  }
}

// Auto-refresh validated tickets every 30s when visible
function startValidatedTicketsAutoRefresh() {
  if (validatedTicketsRefreshTimer) clearInterval(validatedTicketsRefreshTimer);
  validatedTicketsRefreshTimer = setInterval(() => {
    const ctabValidated = document.getElementById('ctab-validated');
    if (ctabValidated && !ctabValidated.classList.contains('hidden')) {
      loadValidatedTickets();
    }
  }, 30000);
}

document.getElementById('refresh-validated-btn')?.addEventListener('click', () => {
  loadValidatedTickets();
  showToast('Refreshed', 'info');
});

function getProfileChatElements() {
  return {
    wrap: document.getElementById('profile-chat-fab'),
    fabBtn: document.getElementById('profile-chat-fab-btn'),
    panel: document.getElementById('profile-chat-panel'),
    closeBtn: document.getElementById('profile-chat-close-btn'),
    roomBtns: document.querySelectorAll('.profile-chat-room-btn'),
    messages: document.getElementById('profile-chat-messages'),
    form: document.getElementById('profile-chat-form'),
    input: document.getElementById('profile-chat-input'),
    sendBtn: document.getElementById('profile-chat-send-btn'),
  };
}

function renderProfileChatMessages() {
  const { messages } = getProfileChatElements();
  if (!messages) return;

  const roomMessages = profileChatMessagesByRoom[activeProfileChatRoom] || [];
  if (roomMessages.length === 0) {
    messages.innerHTML = '<div class="profile-chat-empty">No messages yet. Start the conversation.</div>';
    return;
  }

  messages.innerHTML = roomMessages.map((m) => {
    const isMine = String(m.senderPhone || '') === String(currentUser?.phone || '');
    return `
      <div class="profile-chat-msg ${isMine ? 'mine' : ''}">
        <div class="profile-chat-msg-meta">
          <span>${escapeHtml(m.senderName || 'User')} • ${escapeHtml(maskPhone(m.senderPhone))}</span>
          <span>${escapeHtml(formatChatTime(m.createdAt))}</span>
        </div>
        <div class="profile-chat-msg-text">${escapeHtml(m.text)}</div>
      </div>
    `;
  }).join('');

  messages.scrollTop = messages.scrollHeight;
}

function upsertProfileChatMessage(message) {
  const roomKey = String(message?.roomKey || '');
  if (!CHAT_ROOMS.includes(roomKey)) return;

  const existing = profileChatMessagesByRoom[roomKey] || [];
  if (existing.some((m) => String(m._id) === String(message._id))) return;

  existing.push(message);
  if (existing.length > 200) existing.shift();
  profileChatMessagesByRoom[roomKey] = existing;

  if (roomKey === activeProfileChatRoom) {
    renderProfileChatMessages();
  }
}

async function loadProfileChatMessages(roomKey, force = false) {
  if (!CHAT_ROOMS.includes(roomKey)) return;
  if (!force && profileChatMessagesByRoom[roomKey]?.length > 0) {
    if (roomKey === activeProfileChatRoom) renderProfileChatMessages();
    return;
  }

  try {
    const data = await api(`/chat/messages/${roomKey}?limit=50`);
    profileChatMessagesByRoom[roomKey] = Array.isArray(data.messages) ? data.messages : [];
    if (roomKey === activeProfileChatRoom) renderProfileChatMessages();
  } catch (err) {
    showToast(err.message || 'Failed to load chat messages', 'error');
  }
}

function setActiveProfileChatRoom(roomKey) {
  if (!CHAT_ROOMS.includes(roomKey)) return;

  activeProfileChatRoom = roomKey;
  const { roomBtns } = getProfileChatElements();
  roomBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.room === roomKey);
  });

  joinProfileChatRoom(roomKey);
  loadProfileChatMessages(roomKey);
}

function joinProfileChatRoom(roomKey) {
  if (!CHAT_ROOMS.includes(roomKey)) return;
  if (!socket || !socket.connected) return;
  if (joinedProfileChatRooms.has(roomKey)) return;

  socket.emit('chat:join', roomKey);
  joinedProfileChatRooms.add(roomKey);
}

function hideProfileChatPanel() {
  const { panel, fabBtn } = getProfileChatElements();
  if (!panel || !fabBtn) return;
  panel.classList.add('hidden');
  fabBtn.setAttribute('aria-expanded', 'false');
}

function showProfileChatPanel() {
  const { panel, fabBtn, input } = getProfileChatElements();
  if (!panel || !fabBtn) return;
  panel.classList.remove('hidden');
  fabBtn.setAttribute('aria-expanded', 'true');
  joinProfileChatRoom(activeProfileChatRoom);
  loadProfileChatMessages(activeProfileChatRoom);
  setTimeout(() => input?.focus(), 50);
}

async function sendProfileChatMessage() {
  const { input, sendBtn } = getProfileChatElements();
  if (!input || !sendBtn) return;

  const text = input.value.trim();
  if (!text) return;
  if (text.length > 500) {
    showToast('Message is too long (max 500 chars)', 'error');
    return;
  }

  sendBtn.disabled = true;
  try {
    if (socket && socket.connected) {
      const ack = await new Promise((resolve) => {
        socket.emit('chat:send', { roomKey: activeProfileChatRoom, text }, (response) => {
          resolve(response || { ok: false, message: 'No response from chat server' });
        });
      });

      if (!ack.ok) {
        throw new Error(ack.message || 'Failed to send message');
      }
    } else {
      const data = await api(`/chat/messages/${activeProfileChatRoom}`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      upsertProfileChatMessage(data.message);
    }

    input.value = '';
  } catch (err) {
    showToast(err.message || 'Failed to send message', 'error');
  } finally {
    sendBtn.disabled = false;
  }
}

function initProfileChatWidget() {
  if (profileChatInitialized) return;

  const { wrap, fabBtn, panel, closeBtn, roomBtns, form } = getProfileChatElements();
  if (!wrap || !fabBtn || !panel || !closeBtn || !form) return;

  fabBtn.addEventListener('click', () => {
    const isHidden = panel.classList.contains('hidden');
    if (isHidden) showProfileChatPanel();
    else hideProfileChatPanel();
  });

  closeBtn.addEventListener('click', hideProfileChatPanel);

  roomBtns.forEach((btn) => {
    btn.addEventListener('click', () => setActiveProfileChatRoom(btn.dataset.room));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await sendProfileChatMessage();
  });

  document.addEventListener('click', (e) => {
    if (panel.classList.contains('hidden')) return;
    if (!wrap.contains(e.target)) hideProfileChatPanel();
  });

  profileChatInitialized = true;
  setActiveProfileChatRoom('general');
}

function bindProfileChatSocketEvents() {
  if (!socket || profileChatSocketBound) return;

  socket.on('chat:new-message', (message) => {
    upsertProfileChatMessage(message);
  });

  profileChatSocketBound = true;
}

// ─── Owner Assignment Helpers ────────────────────────────────────────────────

// Renders the buses-with-conductors table filtered to `zone`.
// Reads purely from _ownerBusesCache — no I/O.
function _renderOwnerBusesTable(zone) {
  const listEl = document.getElementById('owner-buses-list');
  if (!listEl || !Array.isArray(_ownerBusesCache)) return;

  const buses = _ownerBusesCache.filter(
    b => !b.zone || b.zone.toLowerCase() === zone.toLowerCase()
  );

  if (buses.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state" style="padding:20px;text-align:center;background:#f8fafc;border-radius:8px;">
        <p style="margin:0 0 10px 0;font-size:15px;color:#64748b;">No buses found in ${escapeHtml(zone)} zone.</p>
        <p style="margin:0;font-size:13px;color:#94a3b8;">
          Switch zone or run: <code style="background:#fff;padding:2px 6px;border-radius:4px;border:1px solid #e2e8f0;">node setup-owner-portfolio.js</code>
        </p>
      </div>`;
    return;
  }

  listEl.innerHTML = `
    <div class="owner-buses-table-wrapper">
      <table class="owner-buses-table">
        <thead>
          <tr>
            <th>Bus Number</th><th>Type</th><th>Capacity</th>
            <th>Status</th><th>Route</th><th>Conductors</th>
          </tr>
        </thead>
        <tbody>
          ${buses.map(bus => `
            <tr>
              <td data-label="Bus Number"><strong>${escapeHtml(bus.registration)}</strong></td>
              <td data-label="Type">${escapeHtml(bus.type)}</td>
              <td data-label="Capacity">${Number(bus.capacity)}</td>
              <td data-label="Status"><span class="status-badge status-${escapeHtml(bus.status)}">${escapeHtml(bus.status)}</span></td>
              <td data-label="Route">
                ${bus.route
                  ? `<strong>${escapeHtml(bus.route.name)}</strong><br><span style="color:#64748b;font-size:.9em;">${escapeHtml(bus.route.code)}</span>`
                  : '<span style="color:#888">Not assigned</span>'}
              </td>
              <td data-label="Conductors">
                ${bus.conductors && bus.conductors.length > 0
                  ? bus.conductors.map(c => `${escapeHtml(c.name)} (${escapeHtml(c.phone)})`).join('<br>')
                  : '<span style="color:#888">None assigned</span>'}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// Filters buses, routes and conductors dropdowns to `zone`.
// Reads purely from _ownerDropdownCache — no I/O.
// Conductors are cross-zone (no zone filter applied).
function _populateOwnerDropdownsByZone(zone) {
  if (!_ownerDropdownCache?.success || !_ownerDropdownCache.data) return;
  const { buses, routes, conductors } = _ownerDropdownCache.data;

  // ── Buses ──
  const zoneBuses = buses.filter(
    b => !b.details.zone || b.details.zone.toLowerCase() === zone.toLowerCase()
  );
  const busSel = document.getElementById('owner-assign-bus');
  if (busSel) {
    if (zoneBuses.length === 0) {
      busSel.innerHTML = `<option value="">No buses in ${escapeHtml(zone)} zone</option>`;
      showToast(`No buses found in ${zone} zone.`, 'warning');
    } else {
      busSel.innerHTML = `<option value="">${t('select_bus_number', 'Select Bus Number')}</option>` +
        zoneBuses.map(b =>
          `<option value="${escapeHtml(b.value)}">${escapeHtml(b.label)}</option>`
        ).join('');
    }
  }

  // ── Routes ──
  const zoneRoutes = routes.filter(
    r => !r.details.zone || r.details.zone.toLowerCase() === zone.toLowerCase()
  );
  const routeSel = document.getElementById('owner-assign-route');
  if (routeSel) {
    if (zoneRoutes.length === 0) {
      routeSel.innerHTML = `<option value="">No routes in ${escapeHtml(zone)} zone</option>`;
      showToast('No routes found for this zone. Contact admin.', 'warning');
    } else {
      routeSel.innerHTML = `<option value="">${t('select_route', 'Select Route')}</option>` +
        zoneRoutes.map(r =>
          `<option value="${escapeHtml(r.value)}">${escapeHtml(r.label)}</option>`
        ).join('');
    }
  }

  // ── Conductors (cross-zone, no filter) ──
  const conductorSel = document.getElementById('owner-assign-conductor');
  if (conductorSel) {
    const available = conductors.available || [];
    const assigned  = conductors.assigned  || [];
    if (available.length === 0 && assigned.length === 0) {
      conductorSel.innerHTML = `<option value="">${t('no_conductors_found', 'No conductors found')}</option>`;
      showToast('No conductors found. Please add conductors first.', 'warning');
    } else {
      let opts = `<option value="">${t('select_conductor', 'Select Conductor')}</option>`;
      if (available.length > 0) {
        opts += `<optgroup label="${t('available_conductors', '✓ Available Conductors')}">` +
          available.map(c =>
            `<option value="${escapeHtml(c.value)}">${escapeHtml(c.details.name)} (${escapeHtml(c.details.phone)})</option>`
          ).join('') + '</optgroup>';
      }
      if (assigned.length > 0) {
        opts += `<optgroup label="${t('currently_assigned', '⚠️ Currently Assigned')}">` +
          assigned.map(c =>
            `<option value="${escapeHtml(c.value)}">${escapeHtml(c.details.name)} (${escapeHtml(c.details.phone)}) - ${t('assigned', 'ASSIGNED')}</option>`
          ).join('') + '</optgroup>';
      }
      conductorSel.innerHTML = opts;
    }
  }

  // Re-render buses table filtered to zone (pure memory)
  _renderOwnerBusesTable(zone);
}

// ─── Profile ────────────────────────────────────────────────────────────────
async function loadProfile() {
  if (!currentUser) return;

  initProfileChatWidget();

  // Avatar letter / photo
  const avatarEl = document.getElementById('profile-avatar-letter');
  if (avatarEl) {
    if (currentUser.poyalooPassPhotoUrl) {
      const streamUrl = API + '/auth/poyaloo-pass/photo-stream?token=' + encodeURIComponent(token || '') + '&v=' + Date.now();
      avatarEl.innerHTML = `<img src="${streamUrl}" crossorigin="anonymous" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
    } else {
      avatarEl.textContent = (currentUser.name || '?').charAt(0).toUpperCase();
    }
  }

  document.getElementById('profile-name').textContent = currentUser.name;
  document.getElementById('profile-phone').textContent = currentUser.phone;

  // Email display
  const emailEl = document.getElementById('profile-email');
  if (emailEl) {
    emailEl.textContent = currentUser.email ? `✉️ ${currentUser.email}` : '✉️ Missing';
    emailEl.style.opacity = currentUser.email ? '1' : '0.6';
  }

  // Ticket category badge
  const catBadge = document.getElementById('profile-ticket-category-badge');
  if (catBadge) {
    const cat = currentUser.ticketCategory || 'adult';
    const catLabels = { adult: '🎫 Adult', student: '🎓 Student', free: '🆓 Free' };
    catBadge.textContent = catLabels[cat] || catLabels.adult;
    catBadge.className = 'profile-ticket-category-badge ticket-cat-' + cat;
  }

  // View Pass button (passengers with student/free categories and a pass uploaded)
  const passSection = document.getElementById('profile-pass-document-section');
  const viewPassBtn = document.getElementById('profile-view-pass-btn');
  if (passSection && viewPassBtn) {
    // Only show if user has uploaded a pass (we check studentPassUrl or studentPassKey)
    if ((currentUser.role === 'passenger' || currentUser.role === 'conductor' || currentUser.role === 'owner') && ['student', 'free'].includes(currentUser.ticketCategory) && (currentUser.studentPassUrl || currentUser.studentPassKey)) {
      passSection.style.display = '';
      viewPassBtn.onclick = async function() {
        try {
          const res = await api('/auth/pass-url');
          if (res.signedUrl) {
            const modal = document.getElementById('pass-document-modal');
            const modalBody = document.getElementById('pass-document-modal-body');
            if (modal && modalBody) {
              modalBody.innerHTML = `<img src="${res.signedUrl}" style="max-width:100%;border-radius:8px;" alt="Pass Document" onerror="this.onerror=null; this.parentElement.innerHTML='<iframe src=\\'${res.signedUrl}\\' style=\\'width:100%;height:500px;border:none;\\'></iframe>';">`;
              modal.style.display = 'block';
            } else {
              window.open(res.signedUrl, '_blank');
            }
          }
        } catch (err) {
          showToast('Could not load pass document', 'error');
        }
      };
    } else {
      passSection.style.display = 'none';
    }
  }

  // Hide phone checkbox
  const hidePhoneCheckbox = document.getElementById('profile-hide-phone-checkbox');
  if (hidePhoneCheckbox) {
    hidePhoneCheckbox.checked = !!currentUser.hidePhoneFromConductor;
    // Show hint if checked
    const hint = document.getElementById('profile-hide-phone-hint');
    if (hint) hint.style.display = hidePhoneCheckbox.checked ? '' : 'none';
    hidePhoneCheckbox.onchange = function() {
      if (hint) hint.style.display = hidePhoneCheckbox.checked ? '' : 'none';
      // Call async update
      (async () => {
        try {
          hidePhoneCheckbox.disabled = true;
          const res = await api('/auth/privacy', {
            method: 'PUT',
            body: JSON.stringify({ hidePhoneFromConductor: hidePhoneCheckbox.checked })
          });
          if (res.success) {
            currentUser.hidePhoneFromConductor = hidePhoneCheckbox.checked;
            showToast(hidePhoneCheckbox.checked ? 'Phone number hidden from conductor' : 'Phone number visible to conductor', 'success');
          } else {
            hidePhoneCheckbox.checked = !hidePhoneCheckbox.checked;
            showToast(res.error || 'Could not update privacy', 'error');
          }
        } catch (e) {
          hidePhoneCheckbox.checked = !hidePhoneCheckbox.checked;
          showToast('Could not update privacy', 'error');
        } finally {
          hidePhoneCheckbox.disabled = false;
        }
      })();
    };
  }

  // Hide Poyaloo Pass checkbox
  const hidePassContainer = document.getElementById('profile-hide-pass-container');
  const hidePassCheckbox = document.getElementById('profile-hide-pass-checkbox');
  if (hidePassContainer && hidePassCheckbox) {
    if (currentUser.role === 'passenger' || currentUser.role === 'conductor' || currentUser.role === 'owner') {
      hidePassContainer.style.display = 'block';
      hidePassCheckbox.checked = localStorage.getItem('hide_poyaloo_pass') === 'true';
    } else {
      hidePassContainer.style.display = 'none';
    }
  }

  // Block Poyaloo Pass checkbox
  const blockPassContainer = document.getElementById('profile-block-pass-container');
  const blockPassCheckbox = document.getElementById('profile-block-pass-checkbox');
  const blockPassHint = document.getElementById('profile-block-pass-hint');
  if (blockPassContainer && blockPassCheckbox) {
    if ((currentUser.role === 'passenger' || currentUser.role === 'conductor' || currentUser.role === 'owner') && currentUser.poyalooPassActive) {
      blockPassContainer.style.display = 'block';
      blockPassCheckbox.checked = currentUser.poyalooPassCardBlocked || false;
      if (blockPassHint) blockPassHint.style.display = blockPassCheckbox.checked ? 'block' : 'none';
    } else {
      blockPassContainer.style.display = 'none';
      if (blockPassHint) blockPassHint.style.display = 'none';
    }
  }

  // Role badge
  const roleEl = document.getElementById('profile-role');
  const roleText = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
  roleEl.textContent = t('auth_role_' + currentUser.role.toLowerCase(), roleText);
  roleEl.className = 'profile-role-badge';

  // Membership tier badge (passengers only)
  const membershipEl = document.getElementById('profile-membership-badge');
  if (membershipEl) {
    if (currentUser.role === 'passenger' || currentUser.role === 'conductor' || currentUser.role === 'owner') {
      try {
        const { travelDaysThisMonth } = await api('/tickets/monthly-travel-days');
        let coinClass, coinEmoji, tierName;
        if (travelDaysThisMonth >= 25) {
          coinClass = 'membership-gold';   coinEmoji = '🥇'; tierName = 'Gold';
        } else if (travelDaysThisMonth > 10) {
          coinClass = 'membership-silver'; coinEmoji = '🥈'; tierName = 'Silver';
        } else {
          coinClass = 'membership-bronze'; coinEmoji = '🥉'; tierName = 'Bronze';
        }
        membershipEl.innerHTML = `<span class="profile-membership-coin ${coinClass}"><span class="membership-emoji">${coinEmoji}</span><span class="membership-label">${tierName}<span class="membership-days">${travelDaysThisMonth} day${travelDaysThisMonth !== 1 ? 's' : ''}</span></span></span>`;
        membershipEl.style.display = '';
      } catch (e) {
        membershipEl.style.display = 'none';
      }
    } else {
      membershipEl.style.display = 'none';
    }
  }

  // Wallet
  document.getElementById('profile-wallet').textContent = `₹${formatRupees(currentUser.wallet)}`;

  // Poyaloo Pass
  updatePoyalooPassUI();

  // Owner subscription card
  const ownerSubCard = document.getElementById('owner-subscription-card');
  if (currentUser.role === 'owner' && ownerSubCard) {
    const ownerSub = getOwnerSubscription(currentUser) || {};
    ownerSubCard.classList.remove('hidden');

    const statusEl = document.getElementById('owner-sub-status');
    const expiresEl = document.getElementById('owner-sub-expires');
    const receiverEl = document.getElementById('owner-sub-receiver-upi');
    const planSel = document.getElementById('owner-sub-plan');
    const payMethodSel = document.getElementById('owner-sub-pay-method');
    const payBtn = document.getElementById('owner-sub-pay-btn');

    if (statusEl) {
      const statusText = (ownerSub.status || 'inactive').toUpperCase();
      statusEl.textContent = t('sub_status_' + (ownerSub.status || 'inactive').toLowerCase(), statusText);
    }
    if (expiresEl) expiresEl.textContent = formatDateTimeDisplay(ownerSub.endAt);
    if (receiverEl) receiverEl.textContent = ownerSub.receiverUpiId || 'kunnathadi@icici';

    // Disable 30-day option if it has already been used
    if (planSel) {
      const thirtyDayOption = planSel.querySelector('option[value="thirty_days"]');
      if (thirtyDayOption) {
        if (ownerSub.thirtyDayPlanEverActivated) {
          thirtyDayOption.disabled = true;
          thirtyDayOption.textContent = t('plan_thirty_days_used', '30 Days (one-time only — already used)');
        } else {
          thirtyDayOption.disabled = false;
          thirtyDayOption.textContent = t('plan_thirty_days', '30 Days');
        }
      }
      // Don't select thirty_days if it's been used
      const defaultPlan = (ownerSub.thirtyDayPlanEverActivated && ownerSub.plan === 'thirty_days')
        ? 'monthly'
        : (ownerSub.plan || 'monthly');
      planSel.value = defaultPlan;
    }

    if (payMethodSel && !payMethodSel.value) payMethodSel.value = 'gpay';
    updateOwnerPlanPriceLabel();

    if (planSel && !planSel._ownerSubPlanBound) {
      planSel.addEventListener('change', updateOwnerPlanPriceLabel);
      planSel._ownerSubPlanBound = true;
    }

    if (payBtn && !payBtn._ownerSubBound) {
      payBtn.addEventListener('click', async () => {
        const selectedPlan = document.getElementById('owner-sub-plan')?.value || 'monthly';
        payBtn.disabled = true;
        const oldText = payBtn.textContent;
        payBtn.textContent = 'Processing...';

        try {
          const orderData = await api('/auth/owner-subscription/create-order', {
            method: 'POST',
            body: JSON.stringify({ subscriptionPlan: selectedPlan }),
          });
          openOwnerSubscriptionCheckout(orderData);
        } catch (err) {
          if (String(err.message || '').includes('Payment gateway not configured')) {
            openOwnerSubscriptionSimulation(selectedPlan);
          } else {
            showToast(err.message || 'Failed to start subscription payment', 'error');
          }
        } finally {
          payBtn.disabled = false;
          payBtn.textContent = oldText;
        }
      });
      payBtn._ownerSubBound = true;
    }
  } else if (ownerSubCard) {
    ownerSubCard.classList.add('hidden');
  }

  const isConductorOrAdmin = currentUser.role === 'conductor' || currentUser.role === 'admin';

  // Conductor UPI & Earnings card
  const upiCard = document.getElementById('profile-upi-card');
  if (isConductorOrAdmin) {
    upiCard.classList.remove('hidden');
    document.getElementById('profile-upi-display').textContent = currentUser.conductorUpiId || 'Not set';
    // Fetch earnings
    try {
      const data = await api('/auth/earnings');
      document.getElementById('profile-today-earnings').textContent = `₹${formatRupees(data.todayEarnings || 0)}`;
      document.getElementById('profile-total-earnings').textContent = `₹${formatRupees(data.totalEarnings || 0)}`;
    } catch (e) {
      console.warn('Could not load profile earnings', e);
    }
  } else {
    upiCard.classList.add('hidden');
  }

  // Conductor Invoice & Expense card
  const expenseCard = document.getElementById('expense-entry-card');
  if (expenseCard) {
    if (isConductorOrAdmin) {
      const busId = currentUser.assignedBus?.id || currentUser.assignedBus?._id;
      if (busId) {
        expenseCard.classList.remove('hidden');
        loadConductorExpenses();
      } else {
        expenseCard.classList.add('hidden');
      }
    } else {
      expenseCard.classList.add('hidden');
    }
  }

  // Assignment section for conductor/admin
  const assignmentSection = document.getElementById('assignment-section');
  if (isConductorOrAdmin) {
    assignmentSection.classList.remove('hidden');
    document.getElementById('profile-assigned-route').textContent =
      currentUser.assignedRoute ? `${currentUser.assignedRoute.code} – ${currentUser.assignedRoute.name}` : t('not_assigned', 'Not assigned');
    document.getElementById('profile-assigned-bus').textContent =
      currentUser.assignedBus ? currentUser.assignedBus.registration : t('not_assigned', 'Not assigned');
    await loadAssignmentDropdowns();
  } else {
    assignmentSection.classList.add('hidden');
  }

  // Owner Assign Bus section (show only for owner)
  const ownerAssignSection = document.getElementById('owner-assign-section');
  if (currentUser && currentUser.role === 'owner' && ownerAssignSection && isOwnerSubscriptionActive(currentUser)) {
    ownerAssignSection.classList.remove('hidden');
    
    // Populate dropdowns + buses table.
    // First visit per login: two requests run in PARALLEL (faster than sequential).
    // Subsequent visits and zone switches: served from memory cache (zero API calls).
    try {
      if (!_ownerDropdownCache || !_ownerBusesCache) {
        const [ddResult, busResult] = await Promise.allSettled([
          api('/owner/dropdown-data'),
          api('/owner/buses-with-conductors')
        ]);

        // Cache dropdown data
        if (ddResult.status === 'fulfilled' && ddResult.value?.success) {
          _ownerDropdownCache = ddResult.value;
        } else {
          _ownerDropdownCache = null;
          showToast('Failed to load assignment dropdowns', 'error');
        }

        // Cache buses data
        if (busResult.status === 'fulfilled' && busResult.value?.success) {
          _ownerBusesCache = busResult.value.buses || [];
        } else {
          _ownerBusesCache = null;
          const listEl = document.getElementById('owner-buses-list');
          if (listEl) {
            const msg = escapeHtml(
              busResult.reason?.message || busResult.value?.error || 'Unknown error'
            );
            listEl.innerHTML = `
              <div class="empty-state" style="padding:20px;text-align:center;background:#fee;border-radius:8px;border:1px solid #fcc;">
                <p style="margin:0 0 10px 0;font-size:15px;color:#c00;">⚠️ Could not load buses</p>
                <p style="margin:0;font-size:13px;color:#666;">${msg}</p>
                <p style="margin:10px 0 0 0;font-size:13px;color:#666;">
                  Run: <code style="background:#fff;padding:2px 6px;border-radius:4px;border:1px solid #ddd;">node setup-owner-portfolio.js</code>
                </p>
              </div>`;
          }
        }
      }

      // Filter by currently selected zone and render — pure memory, no I/O
      _populateOwnerDropdownsByZone(currentZone);
    } catch (err) {
      showToast('Failed to load assignment data: ' + err.message, 'error');
    }
    
    // Attach submit handler for assignment form
    const ownerAssignForm = document.getElementById('owner-assign-form');
    if (ownerAssignForm && !ownerAssignForm._listenerAttached) {
      ownerAssignForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        try {
          const busId = document.getElementById('owner-assign-bus').value;
          const routeId = document.getElementById('owner-assign-route').value;
          const conductorId = document.getElementById('owner-assign-conductor').value;
          
          if (!busId || !routeId || !conductorId) {
            showToast('Please select bus, route, and conductor', 'error');
            return;
          }
          
          console.log('[Owner] Submitting assignment:', { busId, routeId, conductorId });
          
          // Use the correct endpoint for dropdown-based assignment
          const result = await api('/owner/assign-from-dropdowns', {
            method: 'POST',
            body: JSON.stringify({ busId, routeId, conductorId })
          });
          
          if (result.success) {
            showToast('✓ Assignment successful!', 'success');
            
            // Update confirmation display with selected text
            const busText = document.getElementById('owner-assign-bus').selectedOptions[0].textContent;
            const routeText = document.getElementById('owner-assign-route').selectedOptions[0].textContent;
            const conductorText = document.getElementById('owner-assign-conductor').selectedOptions[0].textContent;
            
            document.getElementById('owner-assign-confirm-bus').textContent = busText;
            document.getElementById('owner-assign-confirm-route').textContent = routeText;
            document.getElementById('owner-assign-confirm-conductor').textContent = conductorText;
            document.getElementById('owner-assign-success').classList.remove('hidden');
            
            // Reset form and refresh after 2 seconds
            setTimeout(async () => {
              document.getElementById('owner-assign-success').classList.add('hidden');
              ownerAssignForm.reset();

              // Invalidate cache so the next profile load fetches fresh assignment data
              _ownerDropdownCache = null;
              _ownerBusesCache    = null;

              // Refresh dashboard and profile to show updated assignments
              if (typeof loadOwnerDashboard === 'function') {
                await loadOwnerDashboard();
              }
              await loadProfile();
            }, 2000);
          } else {
            showToast('Assignment failed: ' + (result.error || 'Unknown error'), 'error');
          }
        } catch (err) {
          console.error('[Owner] Assignment failed:', err);
          showToast(err.message || 'Assignment failed', 'error');
        }
      });
      ownerAssignForm._listenerAttached = true;
    }
  } else if (ownerAssignSection) {
    ownerAssignSection.classList.add('hidden');
  }

  // Load public ads into the profile page
  loadProfileAds();
}

async function loadAssignmentDropdowns() {
  try {
    const routeSelect = document.getElementById('assignment-route');
    const busSelect = document.getElementById('assignment-bus');

    // Clear existing options
    routeSelect.innerHTML = '<option value="">Select Route</option>';
    busSelect.innerHTML = '<option value="">Select Bus</option>';

    const routes = await api(`/routes?zone=${currentZone}`);
    routes.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.id || r._id;
      opt.textContent = `${r.code} – ${r.name}`;
      if (currentUser.assignedRoute && (currentUser.assignedRoute.id === (r.id || r._id))) opt.selected = true;
      routeSelect.appendChild(opt);
    });

    const buses = await api(`/buses?zone=${currentZone}`);
    buses.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id || b._id;
      opt.textContent = b.registration;
      if (currentUser.assignedBus && (currentUser.assignedBus.id === (b.id || b._id))) opt.selected = true;
      busSelect.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load assignment dropdowns:', err);
  }
}

// Update assignment
document.getElementById('update-assignment-btn')?.addEventListener('click', async () => {
  const routeId = document.getElementById('assignment-route').value;
  const busId = document.getElementById('assignment-bus').value;

  if (!routeId || !busId) return showToast('Please select both route and bus', 'error');

  try {
    const data = await api('/auth/assignment', {
      method: 'PUT',
      body: JSON.stringify({ routeId, busId }),
    });

    // Update local user data
    currentUser.assignedRoute = data.assignedRoute;
    currentUser.assignedBus = data.assignedBus;

    document.getElementById('profile-assigned-route').textContent =
      `${data.assignedRoute.code} – ${data.assignedRoute.name}`;
    document.getElementById('profile-assigned-bus').textContent =
      data.assignedBus.registration;

    showToast('Assignment updated!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('logout-btn')?.addEventListener('click', logout);

// ─── Wallet Page ────────────────────────────────────────────────────────────
let walletSelectedMethod = 'gpay';

async function loadWalletPage() {
  // Set name on wallet card
  const nameEl = document.getElementById('wallet-card-name');
  if (nameEl && currentUser) nameEl.textContent = currentUser.name;

  // Load balance
  try {
    const user = await api('/auth/me');
    currentUser = user;
    updateWalletBadge();
    animateWalletBalance(user.wallet);
  } catch (e) { /* ignore */ }

  // Load transaction history
  loadWalletTransactions();

  // Setup quick amount buttons
  document.querySelectorAll('.quick-amt-btn').forEach(btn => {
    btn.onclick = () => {
      const input = document.getElementById('wallet-topup-amount');
      input.value = btn.dataset.amount;
      input.dispatchEvent(new Event('input'));
      document.querySelectorAll('.quick-amt-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    };
  });

  // Setup payment method options
  document.querySelectorAll('.wallet-pay-option').forEach(opt => {
    opt.onclick = () => {
      document.querySelectorAll('.wallet-pay-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      opt.querySelector('input[type="radio"]').checked = true;
      walletSelectedMethod = opt.dataset.method;
    };
  });
}

function animateWalletBalance(target) {
  const el = document.getElementById('wallet-page-balance');
  if (!el) return;
  const start = parseFloat(el.textContent) || 0;
  const duration = 600;
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = formatRupees(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function loadWalletTransactions() {
  try {
    const txns = await api('/wallet/transactions');
    const container = document.getElementById('wallet-txn-list');
    if (!container) return;

    if (!txns || txns.length === 0) {
      container.innerHTML = '<div class="wallet-txn-empty">No transactions yet. Add money to get started!</div>';
      return;
    }

    container.innerHTML = txns.map(t => {
      const isCredit = t.type === 'credit' || t.type === 'refund';
      const icon = isCredit ? '↓' : '↑';
      const sign = isCredit ? '+' : '-';
      const cls = isCredit ? 'wtxn-credit' : 'wtxn-debit';
      const statusBadge = t.payment_status === 'success'
        ? '<span class="wtxn-status wtxn-ok">✓</span>'
        : t.payment_status === 'failed'
          ? '<span class="wtxn-status wtxn-fail">✕</span>'
          : '<span class="wtxn-status wtxn-pending">⏳</span>';
      const d = new Date(t.created_at);
      const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

      return `
        <div class="wtxn-item ${cls}">
          <div class="wtxn-icon">${icon}</div>
          <div class="wtxn-info">
            <div class="wtxn-desc">${t.description || 'Transaction'}</div>
            <div class="wtxn-meta">${date}, ${time} ${statusBadge}</div>
          </div>
          <div class="wtxn-amt">${sign}₹${formatRupees(t.amount)}</div>
        </div>`;
    }).join('');
  } catch (e) {
    console.error('Failed to load transactions:', e);
  }
}

// Amount input validation
document.getElementById('wallet-topup-amount')?.addEventListener('input', function () {
  const val = parseFloat(this.value);
  const btn = document.getElementById('btn-wallet-add-money');
  if (!btn) return;
  const valid = val >= 1 && val <= 10000;
  btn.disabled = !valid;
  btn.querySelector('.bwp-text').textContent = valid ? `Add ₹${Math.floor(val)}` : 'Add Money';
  document.querySelectorAll('.quick-amt-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.amount === String(Math.floor(val)));
  });
});

// Add Money button click
document.getElementById('btn-wallet-add-money')?.addEventListener('click', async () => {
  const amount = parseFloat(document.getElementById('wallet-topup-amount').value);
  if (!amount || amount < 1 || amount > 10000) {
    return showToast('Enter amount between ₹1 and ₹10,000', 'error');
  }

  const btn = document.getElementById('btn-wallet-add-money');
  btn.disabled = true;
  btn.querySelector('.bwp-text').textContent = 'Processing...';

  // Try Razorpay first, fall back to simulation
  try {
    const orderRes = await fetch(`${API}/wallet/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ amount }),
    });
    const orderData = await orderRes.json();

    if (orderRes.ok && orderData.order_id) {
      // Real Razorpay payment
      openRazorpayCheckout(orderData, amount);
    } else {
      // Razorpay not configured — use UPI simulation
      openUPISimulation(amount);
    }
  } catch (err) {
    openUPISimulation(amount);
  }

  btn.disabled = false;
  btn.querySelector('.bwp-text').textContent = `Add ₹${Math.floor(amount)}`;
});

function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Razorpay SDK failed to load.'));
    document.head.appendChild(script);
  });
}

async function openRazorpayCheckout(orderData, amount) {
  try {
    await loadRazorpayScript();
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }

  const options = {
    key: orderData.key,
    amount: orderData.amount,
    currency: orderData.currency,
    name: 'ScanAndGo',
    description: 'Wallet Top-up',
    order_id: orderData.order_id,
    prefill: {
      name: currentUser?.name || '',
      email: currentUser?.email || '',
      contact: currentUser?.phone || '',
    },
    config: {
      display: {
        blocks: {
          upi: { name: 'Pay using UPI', instruments: [{ method: 'upi', flows: ['qrcode', 'collect', 'intent'] }] }
        },
        sequence: ['block.upi'],
        preferences: { show_default_blocks: true },
      }
    },
    modal: {
      confirm_close: true,
      ondismiss: () => showToast('Payment cancelled', 'warning'),
    },
    handler: async function (response) {
      // Verify payment
      showToast('Verifying payment...', 'info');
      try {
        const verifyRes = await api('/wallet/verify-payment', {
          method: 'POST',
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          }),
        });
        if (verifyRes.success) {
          currentUser.wallet = verifyRes.balance;
          updateWalletBadge();
          animateWalletBalance(verifyRes.balance);
          loadWalletTransactions();
          showWalletSuccess(verifyRes.message, verifyRes.balance);
          clearWalletInput();
        }
      } catch (err) {
        showToast(err.message || 'Verification failed', 'error');
      }
    },
    theme: { color: '#e65100' },
  };

  // Prefer GPay/PhonePe based on selection
  if (walletSelectedMethod === 'gpay') {
    options.config.display.blocks.upi.instruments = [
      { method: 'upi', apps: ['google_pay'], flows: ['intent'] },
      { method: 'upi', flows: ['qrcode', 'collect'] },
    ];
  } else if (walletSelectedMethod === 'phonepe') {
    options.config.display.blocks.upi.instruments = [
      { method: 'upi', apps: ['phonepe'], flows: ['intent'] },
      { method: 'upi', flows: ['qrcode', 'collect'] },
    ];
  }

  const rzp = new Razorpay(options);
  rzp.on('payment.failed', (resp) => showToast(`Payment failed: ${resp.error.description}`, 'error'));
  rzp.open();
}

function openUPISimulation(amount) {
  const overlay = document.createElement('div');
  overlay.className = 'upi-sim-overlay';
  overlay.innerHTML = `
    <div class="upi-sim-dialog">
      <div class="upi-sim-header">
        <div class="upi-sim-logo">
          <span style="font-size:40px;">📱</span>
        </div>
        <h3>Google Pay</h3>
        <div class="upi-sim-dev-tag">Development Mode</div>
      </div>
      <div class="upi-sim-body">
        <p class="upi-sim-to">Paying to <strong>ScanAndGo</strong></p>
        <div class="upi-sim-amt">₹${amount.toFixed(2)}</div>
        <div class="upi-sim-upi">UPI: scanandgo@razorpay</div>
        <div class="upi-sim-pin-box">
          <input type="password" maxlength="6" placeholder="Enter UPI PIN" class="upi-sim-pin" id="sim-pin">
        </div>
      </div>
      <div class="upi-sim-actions">
        <button class="upi-sim-cancel-btn" id="sim-cancel">Cancel</button>
        <button class="upi-sim-pay-btn" id="sim-pay" disabled>Pay ₹${Math.floor(amount)}</button>
      </div>
      <p class="upi-sim-note">⚠ Simulation mode — no real money charged.<br>Enter any 4–6 digit PIN to proceed.</p>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));

  const pinInput = overlay.querySelector('#sim-pin');
  const payBtn = overlay.querySelector('#sim-pay');
  const cancelBtn = overlay.querySelector('#sim-cancel');

  pinInput.addEventListener('input', () => { payBtn.disabled = pinInput.value.length < 4; });
  setTimeout(() => pinInput.focus(), 350);

  cancelBtn.addEventListener('click', () => {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 300);
    showToast('Payment cancelled', 'warning');
  });

  payBtn.addEventListener('click', async () => {
    payBtn.textContent = 'Processing...';
    payBtn.disabled = true;

    try {
      const data = await api('/wallet/add', {
        method: 'POST',
        body: JSON.stringify({ amount }),
      });

      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 300);

      if (data.success) {
        currentUser.wallet = data.balance;
        updateWalletBadge();
        animateWalletBalance(data.balance);
        loadWalletTransactions();
        showWalletSuccess(data.message, data.balance);
        clearWalletInput();
        // Also update profile page if visible
        const pw = document.getElementById('profile-wallet');
        if (pw) pw.textContent = `₹${data.balance}`;
      }
    } catch (err) {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 300);
      showToast(err.message || 'Payment failed', 'error');
    }
  });
}

function showWalletSuccess(message, balance) {
  const overlay = document.createElement('div');
  overlay.className = 'wallet-success-overlay';
  overlay.innerHTML = `
    <div class="wallet-success-dialog">
      <div class="wallet-success-check">
        <svg viewBox="0 0 80 80" width="80" height="80">
          <circle cx="40" cy="40" r="38" fill="none" stroke="#e65100" stroke-width="3" class="ws-circle"/>
          <path d="M22 40 L35 53 L58 28" fill="none" stroke="#e65100" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" class="ws-tick"/>
        </svg>
      </div>
      <h3>Money Added!</h3>
      <p>${message}</p>
      <div class="wallet-success-bal">Balance: <strong>₹${balance}</strong></div>
      <button class="btn btn-primary" onclick="this.closest('.wallet-success-overlay').remove()" style="margin-top:16px;padding:10px 40px;border-radius:12px;">Done</button>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

function clearWalletInput() {
  const input = document.getElementById('wallet-topup-amount');
  if (input) input.value = '';
  const btn = document.getElementById('btn-wallet-add-money');
  if (btn) {
    btn.disabled = true;
    btn.querySelector('.bwp-text').textContent = 'Add Money';
  }
  document.querySelectorAll('.quick-amt-btn').forEach(b => b.classList.remove('selected'));
}

document.getElementById('logout-btn')?.addEventListener('click', logout);

// ═══════════════════════════════════════════════════════════════════════════
// CONDUCTOR UPI & EARNINGS
// ═══════════════════════════════════════════════════════════════════════════

// Load conductor earnings card at top of scanner page
async function loadConductorEarnings() {
  const card = document.getElementById('conductor-earnings-card');
  if (!card) return;
  if (!currentUser || (currentUser.role !== 'conductor' && currentUser.role !== 'admin')) {
    card.style.display = 'none';
    return;
  }

  try {
    const data = await api('/auth/earnings');
    card.style.display = '';

    const todayEl = document.getElementById('conductor-today-earnings');
    const totalEl = document.getElementById('conductor-total-earnings');
    const upiEl = document.getElementById('earnings-upi-display');

    if (todayEl) todayEl.textContent = (data.todayEarnings || 0).toFixed(2);
    if (totalEl) totalEl.textContent = (data.totalEarnings || 0).toFixed(2);
    if (upiEl) {
      upiEl.textContent = data.conductorUpiId
        ? `UPI: ${data.conductorUpiId}`
        : '⚠️ No UPI ID set — go to UPI tab';
      upiEl.className = data.conductorUpiId ? 'upi-id-set' : 'upi-id-missing';
    }

    // Render recent settlements in UPI tab
    renderSettlements(data.recentSettlements || []);
  } catch (err) {
    console.error('Failed to load earnings:', err);
  }
}

function renderSettlements(settlements) {
  const container = document.getElementById('conductor-settlements-list');
  if (!container) return;

  if (!settlements.length) {
    container.innerHTML = '<div class="settlement-empty">No settlements yet. Validate tickets to earn.</div>';
    return;
  }

  container.innerHTML = settlements.map(s => {
    const date = new Date(s.createdAt).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
    return `
      <div class="settlement-item">
        <div class="settlement-icon">✅</div>
        <div class="settlement-details">
          <div class="settlement-desc">${s.description || 'Ticket settlement'}</div>
          <div class="settlement-date">${date}</div>
        </div>
        <div class="settlement-amount">+₹${s.amount.toFixed(2)}</div>
      </div>
    `;
  }).join('');
}

// Load UPI settings when tab is opened
function loadConductorUpiSettings() {
  if (!currentUser) return;
  const upiInput = document.getElementById('conductor-upi-input');
  const upiName = document.getElementById('conductor-upi-name');
  if (upiInput && currentUser.conductorUpiId) upiInput.value = currentUser.conductorUpiId;
  if (upiName && currentUser.conductorUpiName) upiName.value = currentUser.conductorUpiName;
  else if (upiName && currentUser.name) upiName.value = currentUser.name;
  loadConductorEarnings();
}

// ─── Conductor Invoice & Expense ─────────────────────────────────────────────
async function loadConductorExpenses() {
  const busId = currentUser?.assignedBus?.id || currentUser?.assignedBus?._id;
  if (!busId) return;

  const container = document.getElementById('expense-history');
  if (!container) return;

  try {
    const data = await api(`/buses/${busId}/expenses`);
    const entries = data.entries || [];
    if (!entries.length) {
      container.innerHTML = '<p style="color:#888;font-size:13px;margin:0;">No entries submitted yet.</p>';
      return;
    }
    container.innerHTML = `
      <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:#374151;">Recent Submissions</div>
      ${entries.map(e => {
        const isInvoice = e.type === 'invoice';
        const color = isInvoice ? '#1a73e8' : '#e65100';
        const label = isInvoice ? '🧾 Invoice' : '💸 Expense';
        const dateStr = new Date(e.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        let proofHtml = '';
        if (e.proofKey) {
          proofHtml = `<span
            onclick="openProofUrl('conductor','${escapeHtml(busId)}','${e._id}','${escapeHtml(e.proofMimeType||'')}','${escapeHtml(e.proofOriginalName||'proof')}')"
            title="${escapeHtml(e.proofOriginalName || 'View attachment')}"
            style="display:inline-flex;align-items:center;gap:3px;margin-top:5px;padding:2px 8px;background:#e8f0fe;color:#1a73e8;border-radius:10px;font-size:11px;font-weight:600;cursor:pointer;user-select:none;">
            📎 1
          </span>`;
        }
        return `
          <div style="border-left:3px solid ${color};padding:6px 10px;margin-bottom:6px;background:#f9fafb;border-radius:0 6px 6px 0;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-weight:600;font-size:13px;color:${color};">${label}</span>
              <span style="font-weight:700;font-size:13px;">₹${formatRupees(e.amount)}</span>
            </div>
            <div style="font-size:12px;color:#4b5563;margin-top:2px;">${escapeHtml(e.details || 'No details provided')}</div>
            <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${dateStr}</div>
            ${proofHtml}
          </div>`;
      }).join('')}
    `;
  } catch (err) {
    container.innerHTML = '<p style="color:#888;font-size:12px;margin:0;">Could not load expense history.</p>';
    console.warn('[Expenses] Load failed:', err);
  }
}

document.getElementById('btn-submit-expense')?.addEventListener('click', async () => {
  const busId = currentUser?.assignedBus?.id || currentUser?.assignedBus?._id;
  if (!busId) {
    showToast('No bus assigned. Cannot submit expense.', 'error');
    return;
  }

  const type       = document.getElementById('expense-type').value;
  const amount     = parseFloat(document.getElementById('expense-amount').value);
  const details    = document.getElementById('expense-details').value.trim();
  const proofInput = document.getElementById('expense-proof');
  const statusEl   = document.getElementById('expense-submit-status');
  const btn        = document.getElementById('btn-submit-expense');

  if (!amount || amount <= 0) {
    showToast('Enter a valid amount greater than 0', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    // Use FormData so the optional proof file is sent as multipart
    const fd = new FormData();
    fd.append('type',    type);
    fd.append('amount',  amount);
    fd.append('details', details);
    if (proofInput?.files?.length > 0) {
      fd.append('proof', proofInput.files[0]);
    }

    const res = await fetch(`${API}/buses/${busId}/expenses`, {
      method:  'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body:    fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'Failed to submit');

    // Clear form
    document.getElementById('expense-amount').value = '';
    document.getElementById('expense-details').value = '';
    if (proofInput) {
      proofInput.value = '';
      const preview = document.getElementById('expense-proof-preview');
      if (preview) preview.style.display = 'none';
    }

    // Show inline success
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = '#dcfce7';
      statusEl.style.color = '#065f46';
      statusEl.textContent = '✅ Entry submitted successfully!';
      setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
    }
    showToast('Entry submitted!', 'success');
    loadConductorExpenses();
  } catch (err) {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = '#fee2e2';
      statusEl.style.color = '#991b1b';
      statusEl.textContent = '❌ ' + (err.message || 'Failed to submit');
      setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
    }
    showToast(err.message || 'Failed to submit', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Entry';
  }
});

// Proof file preview when conductor selects a file
document.getElementById('expense-proof')?.addEventListener('change', function () {
  const preview = document.getElementById('expense-proof-preview');
  if (!preview) return;
  if (!this.files || !this.files[0]) { preview.style.display = 'none'; return; }
  const file = this.files[0];
  if (file.type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${url}" alt="preview" style="max-height:100px;max-width:200px;border-radius:8px;object-fit:cover;border:1px solid #e5e7eb;" />`;
    preview.style.display = 'block';
  } else {
    preview.innerHTML = `<span style="font-size:12px;color:#374151;">📄 ${escapeHtml(file.name)}</span>`;
    preview.style.display = 'block';
  }
});

// ─── Open a proof file via a backend-generated signed URL ────────────────────
// role: 'conductor' | 'owner'
async function openProofUrl(role, busId, expenseId, mimeType, originalName) {
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  try {
    const endpoint = role === 'owner'
      ? `/owner/analytics/bus/${busId}/expenses/${expenseId}/proof-url`
      : `/buses/${busId}/expenses/${expenseId}/proof-url`;

    const data = await api(endpoint);
    if (!data.signedUrl) throw new Error('No URL returned');

    // Open in new tab — works for both images and PDFs
    window.open(data.signedUrl, '_blank', 'noopener');
  } catch (err) {
    showToast('Could not open proof: ' + (err.message || 'Unknown error'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📎 1'; }
  }
}

// Save conductor UPI details
document.getElementById('btn-save-upi')?.addEventListener('click', async () => {
  const upiId = document.getElementById('conductor-upi-input').value.trim();
  const upiName = document.getElementById('conductor-upi-name').value.trim();
  const statusEl = document.getElementById('upi-save-status');
  const btn = document.getElementById('btn-save-upi');

  if (!upiId) {
    showUpiStatus('Please enter your UPI ID', 'error');
    return;
  }

  const upiRegex = /^[\w.\-]+@[\w]+$|^\d{10}@[\w]+$|^\d{10}$/;
  if (!upiRegex.test(upiId)) {
    showUpiStatus('Invalid UPI ID format. Use format like name@oksbi or 9876543210@paytm', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const data = await api('/auth/upi', {
      method: 'PUT',
      body: JSON.stringify({ conductorUpiId: upiId, conductorUpiName: upiName }),
    });

    if (data.success) {
      currentUser.conductorUpiId = data.conductorUpiId;
      currentUser.conductorUpiName = data.conductorUpiName;
      showUpiStatus('✅ UPI details saved! You will receive payments for validated tickets.', 'success');
      loadConductorEarnings(); // Refresh earnings card UPI display
    } else {
      showUpiStatus(data.error || 'Failed to save', 'error');
    }
  } catch (err) {
    showUpiStatus(err.message || 'Network error. Please try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save UPI Details';
  }
});

function showUpiStatus(msg, type) {
  const el = document.getElementById('upi-save-status');
  if (!el) return;
  el.style.display = 'block';
  el.className = 'upi-save-status upi-status-' + type;
  el.textContent = msg;
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Apply translations on load
  if (window.applyTranslations) window.applyTranslations();
  
  // Bind language switcher elements
  const codeBtn = document.getElementById('auth-lang-code-btn');
  const selectEl = document.getElementById('auth-lang-select');
  if (codeBtn && selectEl) {
    const currentLang = localStorage.getItem('app_lang') || 'en';
    selectEl.value = currentLang;
    
    codeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      codeBtn.style.display = 'none';
      selectEl.style.display = 'inline-block';
      selectEl.focus();
    });
    
    selectEl.addEventListener('change', () => {
      if (window.setLanguage) window.setLanguage(selectEl.value);
      selectEl.style.display = 'none';
      codeBtn.style.display = 'inline-block';
    });
    
    selectEl.addEventListener('blur', () => {
      selectEl.style.display = 'none';
      codeBtn.style.display = 'inline-block';
    });
  }

  initAuth();
  setupValidationInputListeners();
  initPoyalooPass();

  const adminRefreshBtn = document.getElementById('refresh-admin-dashboard-btn');
  if (adminRefreshBtn) {
    adminRefreshBtn.addEventListener('click', async () => {
      await loadAdminDashboard();
      showToast('Admin dashboard refreshed', 'success');
    });
  }

  // Refresh buttons for Tickets and Wallet
  document.getElementById('refresh-tickets-btn')?.addEventListener('click', () => {
    loadMyTickets();
    showToast('Tickets refreshed!', 'success');
  });

  document.getElementById('refresh-wallet-btn')?.addEventListener('click', () => {
    loadWalletPage();
    showToast('Wallet refreshed!', 'success');
  });

  // Splash
  setTimeout(() => {
    document.getElementById('splash').style.opacity = '0';
    setTimeout(() => {
      document.getElementById('splash').classList.add('hidden');

      // Check if already logged in
      if (token) {
        enterApp();
      } else {
        document.getElementById('auth-screen').classList.remove('hidden');
      }
    }, 500);
  }, 1500);
});

// Add this utility to show/hide a loading indicator for the dashboard
function setDashboardLoading(isLoading) {
  const el = document.getElementById('dashboard-loading');
  if (!el) return;
  el.style.display = isLoading ? '' : 'none';
}

// ─── Poyaloo Pass Frontend Controllers ─────────────────────────────────────────

function syncPassVisibility() {
  const hideCheckbox = document.getElementById('profile-hide-pass-checkbox');
  const passCard = document.getElementById('poyaloo-pass-card');
  if (!hideCheckbox || !passCard) return;

  const shouldHide = hideCheckbox.checked;
  localStorage.setItem('hide_poyaloo_pass', shouldHide ? 'true' : 'false');

  if (shouldHide) {
    passCard.classList.add('hidden');
  } else {
    if (currentUser && (currentUser.role === 'passenger' || currentUser.role === 'conductor' || currentUser.role === 'owner')) {
      passCard.classList.remove('hidden');
    }
  }
}

function updatePoyalooPassUI() {
  const passCard = document.getElementById('poyaloo-pass-card');
  if (!passCard) return;

  const hideCheckbox = document.getElementById('profile-hide-pass-checkbox');
  const shouldHide = localStorage.getItem('hide_poyaloo_pass') === 'true';
  if (hideCheckbox) {
    hideCheckbox.checked = shouldHide;
  }

  if (currentUser && (currentUser.role === 'passenger' || currentUser.role === 'conductor' || currentUser.role === 'owner')) {
    if (shouldHide) {
      passCard.classList.add('hidden');
    } else {
      passCard.classList.remove('hidden');
    }
    
    const inactiveContainer = document.getElementById('poyaloo-pass-inactive');
    const activeContainer = document.getElementById('poyaloo-pass-active-container');
    
    if (currentUser.poyalooPassActive) {
      inactiveContainer.classList.add('hidden');
      activeContainer.classList.remove('hidden');
      
      // Update details
      document.getElementById('pass-name-display').textContent = currentUser.name;
      
      // Format 11-digit card number as: XXXX XXXX XXX
      const cardNum = currentUser.poyalooPassCardNumber || '';
      const formattedCardNum = cardNum.replace(/(\d{4})(\d{4})(\d{3})/, '$1 $2 $3');
      document.getElementById('pass-card-number-display').textContent = `Card: ${formattedCardNum}`;
      document.getElementById('pass-wallet-display').textContent = `₹${formatRupees(currentUser.wallet)}`;

      // Card blocked visual state
      const statusIndicator = document.querySelector('.pass-status-indicator');
      const digitalPassCard = document.querySelector('.digital-pass-card');
      if (currentUser.poyalooPassCardBlocked) {
        if (statusIndicator) {
          statusIndicator.textContent = '🔒 Blocked';
          statusIndicator.style.color = '#ef4444';
          statusIndicator.style.fontWeight = '700';
        }
        if (digitalPassCard) {
          digitalPassCard.style.border = '2px solid #ef4444';
          digitalPassCard.style.opacity = '0.85';
        }
      } else {
        if (statusIndicator) {
          statusIndicator.textContent = '● Active';
          statusIndicator.style.color = '';
          statusIndicator.style.fontWeight = '';
        }
        if (digitalPassCard) {
          digitalPassCard.style.border = '';
          digitalPassCard.style.opacity = '';
        }
      }
      
      // Photo Upload / Display
      const photoDisplay = document.getElementById('pass-photo-display');
      const photoPlaceholder = document.getElementById('pass-photo-placeholder');
      if (currentUser.poyalooPassPhotoUrl) {
        const streamUrl = API + '/auth/poyaloo-pass/photo-stream?token=' + encodeURIComponent(token || '') + '&v=' + Date.now();
        photoDisplay.crossOrigin = "anonymous";
        photoDisplay.src = streamUrl;
        photoDisplay.classList.remove('hidden');
        photoPlaceholder.classList.add('hidden');
      } else {
        photoDisplay.classList.add('hidden');
        photoPlaceholder.classList.remove('hidden');
      }
      
      // QR Code
      const qrImage = document.getElementById('pass-qr-image');
      if (currentUser.poyalooPassQrCode) {
        qrImage.src = currentUser.poyalooPassQrCode;
      }
      
      // Physical Card Status
      const count = currentUser.poyalooPassPhysicalCount || 0;
      const statusText = document.getElementById('physical-card-status');
      if (statusText) {
        if (count === 0) {
          statusText.innerHTML = `First card is FREE! Subsequent cards cost ₹40.<br><small style='color: #064e3b; font-weight: 600; cursor: pointer;' title='Click to autofill contact phone'>🌴 Your printed Kerala Traveler Card will be shipped to the address below.</small>`;
        } else {
          statusText.innerHTML = `Kerala Traveler Card ordered ${count} time(s). Re-ordering costs ₹40.<br><small style='color: #064e3b; font-weight: 600; cursor: pointer;' id='autofill-prev-address' title='Click to autofill this address'>🌴 Shipping Address: ${currentUser.poyalooPassPhysicalAddress || '-'}</small>`;
        }
      }

      // Hide balance if physical card is ordered
      const balanceRow = document.querySelector('.pass-wallet-row');
      if (balanceRow) {
        if (count > 0) {
          balanceRow.classList.add('hidden');
        } else {
          balanceRow.classList.remove('hidden');
        }
      }
    } else {
      inactiveContainer.classList.remove('hidden');
      activeContainer.classList.add('hidden');
    }
  } else {
    passCard.classList.add('hidden');
  }
}

function initPoyalooPass() {
  // 1. Buy Pass
  const buyBtn = document.getElementById('poyaloo-pass-buy-btn');
  if (buyBtn) {
    buyBtn.addEventListener('click', async () => {
      const payMethodRadio = document.querySelector('input[name="pass-pay-method"]:checked');
      const paymentMethod = payMethodRadio ? payMethodRadio.value : 'wallet';

      buyBtn.disabled = true;
      const oldText = buyBtn.textContent;
      buyBtn.textContent = 'Processing Purchase...';

      try {
        const res = await api('/auth/poyaloo-pass/purchase', {
          method: 'POST',
          body: JSON.stringify({ paymentMethod })
        });
        if (res.success) {
          showToast(res.message, 'success');
          // Refresh user profile
          currentUser = await api('/auth/me');
          updateWalletBadge();
          updatePoyalooPassUI();
          await loadProfile();
        } else {
          showToast(res.error || 'Failed to purchase pass', 'error');
        }
      } catch (err) {
        showToast(err.message || 'Failed to purchase pass', 'error');
      } finally {
        buyBtn.disabled = false;
        buyBtn.textContent = oldText;
      }
    });
  }

  // Toggle selected class on pass payment option radios
  const passPayOptions = document.querySelectorAll('[data-pass-method]');
  passPayOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      passPayOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      const radio = opt.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });

  // 2. Photo Upload
  const photoInput = document.getElementById('pass-photo-input');
  if (photoInput) {
    photoInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('photo', file);

      showToast('Uploading photo...', 'info');

      try {
        const response = await fetch(API + '/auth/poyaloo-pass/photo', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token
          },
          body: formData
        });
        const res = await response.json();
        if (response.ok && res.success) {
          showToast(res.message, 'success');
          currentUser = await api('/auth/me');
          updatePoyalooPassUI();
          await loadProfile();
        } else {
          showToast(res.error || 'Failed to upload photo', 'error');
        }
      } catch (err) {
        showToast(err.message || 'Failed to upload photo', 'error');
      }
    });
  }

  // 3. Physical Card Order
  const physicalBtn = document.getElementById('poyaloo-pass-physical-btn');
  if (physicalBtn) {
    physicalBtn.addEventListener('click', async () => {
      const houseInput = document.getElementById('physical-card-house');
      const cityInput = document.getElementById('physical-card-city');
      const zipInput = document.getElementById('physical-card-zip');
      const phoneInput = document.getElementById('physical-card-phone');

      const house = houseInput ? houseInput.value.trim() : '';
      const city = cityInput ? cityInput.value.trim() : '';
      const zip = zipInput ? zipInput.value.trim() : '';
      const phone = phoneInput ? phoneInput.value.trim() : '';

      if (!house) {
        showToast('Please enter your house name or street address', 'warning');
        if (houseInput) houseInput.focus();
        return;
      }
      if (!city) {
        showToast('Please enter your post office or city', 'warning');
        if (cityInput) cityInput.focus();
        return;
      }
      if (!zip || zip.length < 5 || zip.length > 8) {
        showToast('Please enter a valid zipcode', 'warning');
        if (zipInput) zipInput.focus();
        return;
      }
      if (!phone || phone.length < 10) {
        showToast('Please enter a valid phone number', 'warning');
        if (phoneInput) phoneInput.focus();
        return;
      }

      const fullAddress = `House: ${house}, City/PO: ${city}, Zip: ${zip}, Contact Phone: ${phone}`;

      physicalBtn.disabled = true;
      const oldText = physicalBtn.textContent;
      physicalBtn.textContent = 'Ordering Card...';

      try {
        const res = await api('/auth/poyaloo-pass/physical-card', {
          method: 'POST',
          body: JSON.stringify({ shippingAddress: fullAddress })
        });
        if (res.success) {
          showToast(res.message, 'success');
          if (houseInput) houseInput.value = '';
          if (cityInput) cityInput.value = '';
          if (zipInput) zipInput.value = '';
          if (phoneInput) phoneInput.value = '';
          currentUser = await api('/auth/me');
          updateWalletBadge();
          updatePoyalooPassUI();
          await loadProfile();
        } else {
          showToast(res.error || 'Failed to order physical card', 'error');
        }
      } catch (err) {
        showToast(err.message || 'Failed to order physical card', 'error');
      } finally {
        physicalBtn.disabled = false;
        physicalBtn.textContent = oldText;
      }
    });
  }

  // Shipping Address Autofill on Click
  const statusText = document.getElementById('physical-card-status');
  if (statusText) {
    statusText.addEventListener('click', (e) => {
      if (e.target.tagName.toLowerCase() === 'small') {
        if (currentUser && currentUser.poyalooPassPhysicalAddress) {
          const addressStr = currentUser.poyalooPassPhysicalAddress;
          let house = '';
          let city = '';
          let zip = '';
          let phone = currentUser.phone || '';

          const houseMatch = addressStr.match(/House:\s*([^,]+)/);
          if (houseMatch) house = houseMatch[1].trim();

          const cityMatch = addressStr.match(/City\/PO:\s*([^,]+)/);
          if (cityMatch) city = cityMatch[1].trim();

          const zipMatch = addressStr.match(/Zip:\s*([^,]+)/);
          if (zipMatch) zip = zipMatch[1].trim();

          const phoneMatch = addressStr.match(/Contact Phone:\s*([^\s,]+)/);
          if (phoneMatch) phone = phoneMatch[1].trim();

          const houseInput = document.getElementById('physical-card-house');
          const cityInput = document.getElementById('physical-card-city');
          const zipInput = document.getElementById('physical-card-zip');
          const phoneInput = document.getElementById('physical-card-phone');

          if (houseInput) houseInput.value = house;
          if (cityInput) cityInput.value = city;
          if (zipInput) zipInput.value = zip;
          if (phoneInput) phoneInput.value = phone;

          showToast('Address details autofilled!', 'success');
        } else if (currentUser) {
          // If no address is saved yet, autofill phone number from profile if possible
          const phoneInput = document.getElementById('physical-card-phone');
          if (phoneInput) {
            phoneInput.value = currentUser.phone || '';
            showToast('Phone number autofilled from profile!', 'info');
          }
        }
      }
    });
  }

  // Poyaloo Pass Canvas Download Button
  document.getElementById('poyaloo-pass-download-btn')?.addEventListener('click', () => {
    downloadPoyalooPassAsImage();
  });

  // 4. Wallet Pass/Card Recharge Form
  const rechargeBtn = document.getElementById('btn-recharge-pass-card');
  if (rechargeBtn) {
    rechargeBtn.addEventListener('click', async () => {
      const cardNumInput = document.getElementById('wallet-recharge-card-number');
      const amountInput = document.getElementById('wallet-recharge-card-amount');
      const cardNumber = cardNumInput ? cardNumInput.value.trim() : '';
      const amount = amountInput ? parseFloat(amountInput.value) : 0;

      if (!cardNumber || cardNumber.replace(/\s+/g, '').length !== 11) {
        showToast('Please enter a valid 11-digit card number', 'warning');
        if (cardNumInput) cardNumInput.focus();
        return;
      }
      if (!amount || amount < 1 || amount > 10000) {
        showToast('Please enter an amount between ₹1 and ₹10,000', 'warning');
        if (amountInput) amountInput.focus();
        return;
      }

      const payMethodRadio = document.querySelector('input[name="recharge-pay-method"]:checked');
      const paymentMethod = payMethodRadio ? payMethodRadio.value : 'upi';

      rechargeBtn.disabled = true;
      const oldText = rechargeBtn.textContent;
      rechargeBtn.textContent = 'Processing Recharge...';

      try {
        const res = await api('/wallet/recharge-pass', {
          method: 'POST',
          body: JSON.stringify({ cardNumber, amount, paymentMethod })
        });
        if (res.success) {
          showToast(res.message, 'success');
          if (cardNumInput) cardNumInput.value = '';
          if (amountInput) amountInput.value = '';
          // Refresh user data (in case they recharged their own card)
          currentUser = await api('/auth/me');
          updateWalletBadge();
          updatePoyalooPassUI();
          await loadProfile();
          
          // Also load transactions
          if (currentPage === 'wallet') {
            loadWalletPage();
          }
        } else {
          showToast(res.error || 'Failed to recharge card', 'error');
        }
      } catch (err) {
        showToast(err.message || 'Failed to recharge card', 'error');
      } finally {
        rechargeBtn.disabled = false;
        rechargeBtn.textContent = oldText;
      }
    });
  }

  // Toggle selected class on recharge payment options
  const rechargePayOptions = document.querySelectorAll('[data-recharge-method]');
  rechargePayOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      rechargePayOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      const radio = opt.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });

  // Hide/Show Poyaloo Pass controls
  const hidePassBtn = document.getElementById('poyaloo-pass-hide-btn');
  if (hidePassBtn) {
    hidePassBtn.addEventListener('click', () => {
      const hideCheckbox = document.getElementById('profile-hide-pass-checkbox');
      if (hideCheckbox) {
        hideCheckbox.checked = true;
        syncPassVisibility();
      }
    });
  }

  const hidePassCheckbox = document.getElementById('profile-hide-pass-checkbox');
  if (hidePassCheckbox) {
    hidePassCheckbox.addEventListener('change', syncPassVisibility);
  }

  // Block Poyaloo Pass card checkbox handler
  const blockPassCheckbox = document.getElementById('profile-block-pass-checkbox');
  if (blockPassCheckbox) {
    blockPassCheckbox.addEventListener('change', async () => {
      const isBlocked = blockPassCheckbox.checked;
      const blockHint = document.getElementById('profile-block-pass-hint');
      try {
        blockPassCheckbox.disabled = true;
        const res = await api('/auth/privacy', {
          method: 'PUT',
          body: JSON.stringify({ poyalooPassCardBlocked: isBlocked })
        });
        if (res.success) {
          currentUser.poyalooPassCardBlocked = isBlocked;
          if (blockHint) blockHint.style.display = isBlocked ? 'block' : 'none';
          updatePoyalooPassUI();
          showToast(isBlocked ? '🔒 Poyaloo Pass card blocked. Physical card cannot be used for payments.' : '🔓 Poyaloo Pass card unblocked. Physical card is active again.', isBlocked ? 'warning' : 'success');
        } else {
          blockPassCheckbox.checked = !isBlocked;
          showToast(res.error || 'Could not update card block setting', 'error');
        }
      } catch (e) {
        blockPassCheckbox.checked = !isBlocked;
        showToast('Could not update card block setting', 'error');
      } finally {
        blockPassCheckbox.disabled = false;
      }
    });
  }
}

function initDestinationSearch() {
  if (destinationSearchInitialized) return;

  const container = document.getElementById('destination-search-container');
  const routeSelectWrapper = document.querySelector('.route-selector');
  
  if (!container) return;
  
  // Show/Hide based on role
  if (currentUser && ['passenger', 'conductor', 'owner'].includes(currentUser.role)) {
    container.classList.remove('hidden');
    if (routeSelectWrapper) routeSelectWrapper.style.display = 'none';
  } else {
    container.classList.add('hidden');
    if (routeSelectWrapper) routeSelectWrapper.style.display = '';
    return; // Don't bind passenger listeners if not passenger
  }
  
  destinationSearchInitialized = true;
  
  // Attach bus number input listeners (conductor only)
  const busInput = document.getElementById('bus-number-input');
  const clearBusBtn = document.getElementById('clear-bus-btn');
  if (busInput) {
    // Show/hide clear button and update searchedBusNumber
    busInput.addEventListener('input', () => {
      const val = busInput.value.trim();
      if (val) {
        clearBusBtn.classList.remove('hidden');
      } else {
        clearBusBtn.classList.add('hidden');
      }
      
      clearTimeout(busSearchDebounceTimer);
      busSearchDebounceTimer = setTimeout(() => {
        searchBuses(val);
      }, 300);

      // Update searchedBusNumber and refresh map if a route is tracked
      searchedBusNumber = val || null;
      if (currentTrackingRouteId) {
        trackRoute(currentTrackingRouteId);
      }
    });
    clearBusBtn.addEventListener('click', () => {
      busInput.value = '';
      clearBusBtn.classList.add('hidden');
      searchedBusNumber = null;
      const busSuggestionsDiv = document.getElementById('track-bus-suggestions');
      if (busSuggestionsDiv) {
        busSuggestionsDiv.innerHTML = '';
        busSuggestionsDiv.classList.add('hidden');
      }
      if (currentTrackingRouteId) {
        trackRoute(currentTrackingRouteId);
      }
    });
  }
  
  const originInput = document.getElementById('origin-input');
  const originClearBtn = document.getElementById('clear-origin-btn');
  const originSuggestionsDiv = document.getElementById('origin-suggestions');

  const destInput = document.getElementById('destination-input');
  const destClearBtn = document.getElementById('clear-dest-btn');
  const destSuggestionsDiv = document.getElementById('destination-suggestions');

  const summaryBar = document.getElementById('trip-summary-bar');
  const summaryClose = document.getElementById('trip-summary-close');
  const swapBtn = document.getElementById('swap-trip-btn');
  
  // Origin Input Listener
  if (originInput) {
    originInput.addEventListener('input', () => {
      const val = originInput.value.trim();
      if (val) {
        if (originClearBtn) originClearBtn.classList.remove('hidden');
      } else {
        if (originClearBtn) originClearBtn.classList.add('hidden');
      }
      
      clearTimeout(originSearchDebounceTimer);
      originSearchDebounceTimer = setTimeout(() => {
        searchStops(val, 'origin');
      }, 300);
    });
  }
  
  // Origin Clear Listener
  if (originClearBtn) {
    originClearBtn.addEventListener('click', () => {
      if (originInput) originInput.value = '';
      originClearBtn.classList.add('hidden');
      if (originSuggestionsDiv) {
        originSuggestionsDiv.innerHTML = '';
        originSuggestionsDiv.classList.add('hidden');
      }
      originStop = null;
      if (originInput) originInput.focus();
      resetSearchResults();
    });
  }

  // Destination Input Listener
  if (destInput) {
    destInput.addEventListener('input', () => {
      const val = destInput.value.trim();
      if (val) {
        if (destClearBtn) destClearBtn.classList.remove('hidden');
      } else {
        if (destClearBtn) destClearBtn.classList.add('hidden');
      }
      
      clearTimeout(destinationSearchDebounceTimer);
      destinationSearchDebounceTimer = setTimeout(() => {
        searchStops(val, 'destination');
      }, 300);
    });
  }
  
  // Destination Clear Listener
  if (destClearBtn) {
    destClearBtn.addEventListener('click', () => {
      if (destInput) destInput.value = '';
      destClearBtn.classList.add('hidden');
      if (destSuggestionsDiv) {
        destSuggestionsDiv.innerHTML = '';
        destSuggestionsDiv.classList.add('hidden');
      }
      destinationStop = null;
      if (destInput) destInput.focus();
      resetSearchResults();
    });
  }
  
  // Swap Locations Button Listener
  if (swapBtn) {
    swapBtn.addEventListener('click', () => {
      const tempStop = originStop;
      originStop = destinationStop;
      destinationStop = tempStop;

      const tempVal = originInput ? originInput.value : '';
      if (originInput && destInput) {
        originInput.value = destInput.value;
        destInput.value = tempVal;
      }

      if (originInput && originClearBtn) {
        if (originInput.value) originClearBtn.classList.remove('hidden');
        else originClearBtn.classList.add('hidden');
      }
      if (destInput && destClearBtn) {
        if (destInput.value) destClearBtn.classList.remove('hidden');
        else destClearBtn.classList.add('hidden');
      }

      if (originSuggestionsDiv) {
        originSuggestionsDiv.innerHTML = '';
        originSuggestionsDiv.classList.add('hidden');
      }
      if (destSuggestionsDiv) {
        destSuggestionsDiv.innerHTML = '';
        destSuggestionsDiv.classList.add('hidden');
      }

      if (originStop && destinationStop) {
        executeTripSearch();
      } else {
        resetSearchResults();
      }
    });
  }
  
  if (summaryClose) {
    summaryClose.addEventListener('click', () => {
      resetDestinationSearch();
    });
  }

  // View Tabs listeners
  const tabTrack = document.getElementById('tab-track-route');
  const tabMap = document.getElementById('tab-map-view');
  if (tabTrack) {
    tabTrack.addEventListener('click', () => {
      switchTripTab('track');
    });
  }
  if (tabMap) {
    tabMap.addEventListener('click', () => {
      switchTripTab('map');
    });
  }

  // Show All Routes listener
  const showAllBtn = document.getElementById('show-all-routes-btn');
  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => {
      const routeOptionsPanel = document.getElementById('route-options-panel');
      if (routeOptionsPanel) {
        routeOptionsPanel.classList.remove('collapsed');
        setTimeout(() => { if (map) map.invalidateSize(); }, 300);
      }
    });
  }
  
  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (originInput && originSuggestionsDiv && !originInput.contains(e.target) && !originSuggestionsDiv.contains(e.target)) {
      originSuggestionsDiv.classList.add('hidden');
    }
    if (destInput && destSuggestionsDiv && !destInput.contains(e.target) && !destSuggestionsDiv.contains(e.target)) {
      destSuggestionsDiv.classList.add('hidden');
    }
  });
}

function resetDestinationSearch() {
  const originInput = document.getElementById('origin-input');
  const originClearBtn = document.getElementById('clear-origin-btn');
  const originSuggestionsDiv = document.getElementById('origin-suggestions');

  const destInput = document.getElementById('destination-input');
  const destClearBtn = document.getElementById('clear-dest-btn');
  const destSuggestionsDiv = document.getElementById('destination-suggestions');

  const summaryBar = document.getElementById('trip-summary-bar');
  const routeOptionsPanel = document.getElementById('route-options-panel');
  const container = document.getElementById('destination-search-container');
  
  if (originInput) originInput.value = '';
  if (originClearBtn) originClearBtn.classList.add('hidden');
  if (originSuggestionsDiv) {
    originSuggestionsDiv.innerHTML = '';
    originSuggestionsDiv.classList.add('hidden');
  }

  if (destInput) destInput.value = '';
  if (destClearBtn) destClearBtn.classList.add('hidden');
  if (destSuggestionsDiv) {
    destSuggestionsDiv.innerHTML = '';
    destSuggestionsDiv.classList.add('hidden');
  }

  originStop = null;
  destinationStop = null;
  searchedBusNumber = null;
  
  if (summaryBar) summaryBar.classList.add('hidden');
  if (routeOptionsPanel) routeOptionsPanel.classList.add('hidden');
  if (container && currentUser && ['passenger', 'conductor', 'owner'].includes(currentUser.role)) {
    container.classList.remove('hidden');
  }
  
  closeBusPanel();
  clearMapOverlays();
}
async function searchBuses(query) {
  const suggestionsDiv = document.getElementById('track-bus-suggestions');
  if (!query) {
    suggestionsDiv.innerHTML = '';
    suggestionsDiv.classList.add('hidden');
    return;
  }
  try {
    const buses = await api(`/buses/search?registration=${encodeURIComponent(query)}`);
    if (!buses || buses.length === 0) {
      suggestionsDiv.innerHTML = '<div class="suggestion-item">Bus not found</div>';
      suggestionsDiv.classList.remove('hidden');
      return;
    }
    
    let html = '';
    buses.forEach(bus => {
      const routeName = bus.route ? bus.route.name : 'Unassigned';
      html += `
        <div class="suggestion-item" onclick="selectBusSearch('${bus.registration}', '${bus.route ? bus.route._id : ''}')">
          <div class="suggestion-name">🚌 ${bus.registration}</div>
          <div class="suggestion-district" style="font-size: 11px;">Route: ${routeName}</div>
        </div>
      `;
    });
    suggestionsDiv.innerHTML = html;
    suggestionsDiv.classList.remove('hidden');
  } catch (err) {
    console.error('Error searching buses:', err);
  }
}

function selectBusSearch(registration, routeId) {
  const busInput = document.getElementById('bus-number-input');
  const suggestionsDiv = document.getElementById('track-bus-suggestions');
  
  if (busInput) busInput.value = registration;
  searchedBusNumber = registration;
  
  if (suggestionsDiv) {
    suggestionsDiv.innerHTML = '';
    suggestionsDiv.classList.add('hidden');
  }
  
  if (routeId) {
    trackRoute(routeId);
  } else {
    showToast('Bus not in route', 'warning');
  }
}

async function searchStops(query, type) {
  const suggestionsDiv = document.getElementById(type === 'origin' ? 'origin-suggestions' : 'destination-suggestions');
  if (!suggestionsDiv) return;

  if (query.length < 2) {
    suggestionsDiv.innerHTML = '';
    suggestionsDiv.classList.add('hidden');
    return;
  }
  
  try {
    let url = `/routes/stops/search?q=${encodeURIComponent(query)}`;
    if (currentZone) {
      url += `&zone=${currentZone}`;
    }
    
    // Fetch stops and buses in parallel
    const [stops, allBuses] = await Promise.all([
      api(url),
      api(`/buses?zone=${currentZone}`).catch(() => [])
    ]);

    suggestionsDiv.innerHTML = '';

    const matchingBuses = allBuses.filter(b => 
      b.registration && b.registration.toLowerCase().includes(query.toLowerCase())
    );

    if (stops.length === 0 && matchingBuses.length === 0) {
      suggestionsDiv.innerHTML = `
        <div class="suggestion-item suggestion-no-results">
          No stops or buses found
        </div>
      `;
      suggestionsDiv.classList.remove('hidden');
      return;
    }

    // Render bus suggestions first
    matchingBuses.forEach(bus => {
      const item = document.createElement('div');
      item.className = 'suggestion-item bus-suggestion-item';
      item.style.borderLeft = '4px solid #eab308'; // Highlight bus suggestions in yellow
      
      const routeInfo = bus.route_code ? ` (Route ${bus.route_code} — ${bus.route_name})` : '';
      item.innerHTML = `
        <span class="suggestion-icon">🚌</span>
        <div class="suggestion-details">
          <span class="suggestion-name" style="font-weight:700;">${escapeHtml(bus.registration)}</span>
          <span class="suggestion-landmark" style="color:var(--primary); font-size:11px;">Track live bus route${routeInfo}</span>
        </div>
      `;

      item.addEventListener('click', async () => {
        suggestionsDiv.classList.add('hidden');
        searchedBusNumber = bus.registration;
        
        if (bus.route && bus.route._id) {
          try {
            const routeDetails = await api(`/routes/${bus.route._id}`);
            const stopsList = routeDetails.stops || [];
            if (stopsList.length >= 2) {
              const startStop = stopsList[0];
              const endStop = stopsList[stopsList.length - 1];
              
              originStop = {
                id: startStop.id || startStop._id || (startStop.stop && (startStop.stop.id || startStop.stop._id)),
                name: startStop.name || (startStop.stop && startStop.stop.name) || '',
                latitude: startStop.latitude || (startStop.stop && startStop.stop.latitude),
                longitude: startStop.longitude || (startStop.stop && startStop.stop.longitude)
              };

              destinationStop = {
                id: endStop.id || endStop._id || (endStop.stop && (endStop.stop.id || endStop.stop._id)),
                name: endStop.name || (endStop.stop && endStop.stop.name) || '',
                latitude: endStop.latitude || (endStop.stop && endStop.stop.latitude),
                longitude: endStop.longitude || (endStop.stop && endStop.stop.longitude)
              };

              const origIn = document.getElementById('origin-input');
              if (origIn) origIn.value = originStop.name;
              const clrOrig = document.getElementById('clear-origin-btn');
              if (clrOrig) clrOrig.classList.remove('hidden');

              const destIn = document.getElementById('destination-input');
              if (destIn) destIn.value = destinationStop.name;
              const clrDest = document.getElementById('clear-dest-btn');
              if (clrDest) clrDest.classList.remove('hidden');

              executeTripSearch();
            } else {
              showToast('Bus route does not have enough stops to track.', 'warning');
            }
          } catch (err) {
            console.error('Error fetching bus route details:', err);
            showToast('Failed to load bus route stops.', 'error');
          }
        } else {
          showToast('This bus is not currently assigned to a route.', 'warning');
        }
      });

      suggestionsDiv.appendChild(item);
    });
    
    stops.forEach(stop => {
      if (stop.name && stop.name.startsWith('.')) return; 
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.innerHTML = `
        <span class="suggestion-icon">🚏</span>
        <div class="suggestion-details">
          <span class="suggestion-name">${escapeHtml(stop.name)}</span>
          ${stop.landmark ? `<span class="suggestion-landmark">${escapeHtml(stop.landmark)}</span>` : ''}
        </div>
      `;
      
      item.addEventListener('click', () => {
        suggestionsDiv.classList.add('hidden');
        if (type === 'origin') {
          originStop = stop;
          const origIn = document.getElementById('origin-input');
          if (origIn) origIn.value = stop.name;
          const clrOrig = document.getElementById('clear-origin-btn');
          if (clrOrig) clrOrig.classList.remove('hidden');
        } else {
          destinationStop = stop;
          const destIn = document.getElementById('destination-input');
          if (destIn) destIn.value = stop.name;
          const clrDest = document.getElementById('clear-dest-btn');
          if (clrDest) clrDest.classList.remove('hidden');
        }
        executeTripSearch();
      });
      
      suggestionsDiv.appendChild(item);
    });
    
    suggestionsDiv.classList.remove('hidden');
  } catch (err) {
    console.error('Error searching stops:', err);
  }
}

async function executeTripSearch() {
  if (!originStop || !destinationStop) return;

  closeBusPanel();

  const tabsDiv = document.getElementById('trip-view-tabs');
  if (tabsDiv) tabsDiv.classList.remove('hidden');

  try {
    let url = `/routes/find?destination_stop_id=${destinationStop.id}&origin_stop_id=${originStop.id}&lat=${originStop.latitude}&lng=${originStop.longitude}`;
    if (currentZone) {
      url += `&zone=${currentZone}`;
    }
    
    const options = await api(url);
    renderRouteOptions(options);
    switchTripTab(activeTripTab);
  } catch (err) {
    console.error('Error finding routes:', err);
    showToast('Failed to find route options', 'error');
  }
}

async function autoLoadAssignedRouteForConductor() {
  const routeId = currentUser?.assignedRoute?.id;
  if (!routeId) return;

  console.log('[autoLoadAssignedRouteForConductor] Auto-loading route:', routeId);
  
  if (currentUser.assignedBus) {
    searchedBusNumber = currentUser.assignedBus.registration;
    const busInput = document.getElementById('bus-number-input');
    if (busInput) {
      busInput.value = searchedBusNumber;
      document.getElementById('clear-bus-btn')?.classList.remove('hidden');
    }
  }
  
  try {
    const routeDetails = await api(`/routes/${routeId}`);
    const stopsList = routeDetails.stops || [];
    if (stopsList.length >= 2) {
      const startStop = stopsList[0];
      const endStop = stopsList[stopsList.length - 1];
      
      originStop = {
        id: startStop.id || startStop._id || (startStop.stop && (startStop.stop.id || startStop.stop._id)),
        name: startStop.name || (startStop.stop && startStop.stop.name) || '',
        latitude: startStop.latitude || (startStop.stop && startStop.stop.latitude),
        longitude: startStop.longitude || (startStop.stop && startStop.stop.longitude)
      };

      destinationStop = {
        id: endStop.id || endStop._id || (endStop.stop && (endStop.stop.id || endStop.stop._id)),
        name: endStop.name || (endStop.stop && endStop.stop.name) || '',
        latitude: endStop.latitude || (endStop.stop && endStop.stop.latitude),
        longitude: endStop.longitude || (endStop.stop && endStop.stop.longitude)
      };

      const origIn = document.getElementById('origin-input');
      if (origIn) origIn.value = originStop.name;
      const clrOrig = document.getElementById('clear-origin-btn');
      if (clrOrig) clrOrig.classList.remove('hidden');

      const destIn = document.getElementById('destination-input');
      if (destIn) destIn.value = destinationStop.name;
      const clrDest = document.getElementById('clear-dest-btn');
      if (clrDest) clrDest.classList.remove('hidden');

      await executeTripSearch();
      
      // Auto-expand/select the first route option to display route and highlights
      setTimeout(() => {
        const firstCard = document.querySelector('.route-option-card');
        if (firstCard) {
          firstCard.click();
        }
      }, 500);
    }
  } catch (err) {
    console.error('Error auto-loading conductor route:', err);
  }
}

function resetSearchResults() {
  const tabsDiv = document.getElementById('trip-view-tabs');
  const routeOptionsPanel = document.getElementById('route-options-panel');
  const mapElement = document.getElementById('map');

  if (tabsDiv) tabsDiv.classList.add('hidden');
  if (routeOptionsPanel) {
    routeOptionsPanel.classList.add('hidden');
    routeOptionsPanel.classList.remove('full-screen-mode');
  }
  if (mapElement) mapElement.style.display = 'block';

  closeBusPanel();
  clearMapOverlays();
}

async function loadStopTimeline(routeData, expandContent) {
  try {
    expandContent.innerHTML = `<div style="text-align: center; padding: 12px; color: var(--text-secondary); font-size: 12px;">⌛ Loading timeline stops...</div>`;
    
    // Fetch route and active buses in parallel
    const [route, buses] = await Promise.all([
      api(`/routes/${routeData.route_id}`),
      api(`/routes/${routeData.route_id}/buses`).catch(() => [])
    ]);

    if (!route || !route.stops) {
      expandContent.innerHTML = `<div style="padding: 12px; color: var(--text-secondary); font-size: 12px;">Failed to load stops.</div>`;
      return;
    }
    
    const bIdx = route.stops.findIndex(s => s.id && s.id.toString() === routeData.boarding_stop.id.toString());
    const dIdx = route.stops.findIndex(s => s.id && s.id.toString() === routeData.destination_stop.id.toString());
    
    if (bIdx === -1 || dIdx === -1) {
      expandContent.innerHTML = `<div style="padding: 12px; color: var(--text-secondary); font-size: 12px;">Stops not found on this route.</div>`;
      return;
    }
    
    let segmentStops;
    if (bIdx <= dIdx) {
      segmentStops = route.stops.slice(bIdx, dIdx + 1);
    } else {
      segmentStops = route.stops.slice(dIdx, bIdx + 1).reverse();
    }
    
    let timelineHtml = `
      <div class="trip-timeline">
        <div class="timeline-line"></div>
        <div class="timeline-stops">
    `;
    
    segmentStops.forEach((stop, index) => {
      let dotClass = 'intermediate';
      if (index === 0) dotClass = 'origin';
      else if (index === segmentStops.length - 1) dotClass = 'destination';
      
      const distanceText = stop.distance_from_start_km !== undefined ? `${stop.distance_from_start_km.toFixed(1)} km` : '';
      
      // Check if any bus is at/near this stop
      const liveBusesAtStop = buses.filter(b => 
        (b.next_stop_id && b.next_stop_id.toString() === stop.id.toString()) || 
        (b.last_stop_id && b.last_stop_id.toString() === stop.id.toString())
      );
      
      let busIconHtml = '';
      if (liveBusesAtStop.length > 0) {
        const busLabels = liveBusesAtStop.map(b => b.registration).join(', ');
        const hasSearchedBus = searchedBusNumber && liveBusesAtStop.some(b => b.registration.toLowerCase().includes(searchedBusNumber.toLowerCase()));
        
        const badgeBg = hasSearchedBus ? '#eab308' : '#ea4335';
        const badgeColor = hasSearchedBus ? '#000' : '#fff';
        const badgeWeight = hasSearchedBus ? '800' : '700';
        const badgeBorder = hasSearchedBus ? '1px solid #1a1a2e' : 'none';
        
        busIconHtml = `<span class="timeline-bus-badge" style="background:${badgeBg};color:${badgeColor};border-radius:12px;padding:2px 8px;font-size:10px;font-weight:${badgeWeight};margin-left:8px;display:inline-flex;align-items:center;gap:3px;border:${badgeBorder};" title="Bus ${busLabels} is here">🚌 ${busLabels}</span>`;
      }

      timelineHtml += `
        <div class="timeline-stop-item">
          <div class="timeline-stop-dot ${dotClass}"></div>
          <span class="timeline-stop-name">${escapeHtml(stop.name)}${busIconHtml}</span>
          <span class="timeline-stop-meta">${distanceText}</span>
        </div>
      `;
    });
    
    timelineHtml += `
        </div>
      </div>
    `;
    
    const isPassenger = currentUser?.role === 'passenger' || currentUser?.role === 'conductor' || currentUser?.role === 'owner';
    const timelineBtnHtml = isPassenger 
      ? `
      <div class="timeline-actions" style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
        <button class="btn btn-primary btn-block btn-book-route-option-timeline" 
          style="padding: 10px; font-size: 13.5px; font-weight: 700; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: var(--shadow-sm); cursor: pointer;"
          data-route-id="${routeData.route_id}"
          data-boarding-id="${routeData.boarding_stop.id}"
          data-dest-id="${routeData.destination_stop.id}"
          data-boarding-name="${escapeHtml(routeData.boarding_stop.name)}"
          data-dest-name="${escapeHtml(routeData.destination_stop.name)}"
          onclick="bookFromRouteBtn(this)">
          🎟️ Book Ticket
        </button>
      </div>
      `
      : ``;
    
    timelineHtml += timelineBtnHtml;
    
    expandContent.innerHTML = timelineHtml;
  } catch (err) {
    console.error('Error loading stop timeline:', err);
    expandContent.innerHTML = `<div style="padding: 12px; color: var(--text-secondary); font-size: 12px;">Error loading stops.</div>`;
  }
}

function renderRouteOptions(options) {
  const panel = document.getElementById('route-options-panel');
  const list = document.getElementById('route-options-list');
  if (!list) return;
  list.innerHTML = '';
  
  currentRouteOptions = options;
  
  if (!options || Object.keys(options).length === 0) {
    list.innerHTML = '<div class="suggestion-no-results">No routes found passing through this destination.</div>';
    if (panel) panel.classList.remove('hidden');
    return;
  }
  
  const categories = [
    { key: 'best', title: 'Best Route', icon: '🚌', badge: 'Recommended', color: 'best' },
    { key: 'fastest', title: 'Fastest Route', icon: '⚡', badge: 'Fastest', color: 'fast' },
    { key: 'cheapest', title: 'Cheapest Route', icon: '💰', badge: 'Cheapest', color: 'cheap' },
    { key: 'least_walking', title: 'Least Walking', icon: '🚶', badge: 'Least Walking', color: 'walking' }
  ];
  
  let optionsCount = 0;
  
  categories.forEach(cat => {
    const data = options[cat.key];
    if (!data) return;
    
    optionsCount++;
    const card = document.createElement('div');
    card.className = `route-option-card route-option-${cat.color}`;
    card.id = `card-${cat.key}`;
    
    let distanceText = `${data.distance_km.toFixed(1)} km`;
    if (cat.key === 'least_walking' && data.walking_distance_km !== null) {
      distanceText = `${data.walking_distance_km.toFixed(2)} km walk`;
    } else if (data.walking_distance_km !== null) {
      distanceText = `${data.distance_km.toFixed(1)} km (+ ${data.walking_distance_km.toFixed(2)} km walk)`;
    }
    
    card.innerHTML = `
      <div class="route-option-badge badge-${cat.color}">${cat.title} (${cat.badge})</div>
      <div class="route-option-main">
        <span class="route-option-icon">${cat.icon}</span>
        <div class="route-option-details">
          <div class="route-option-code" style="font-weight:600;color:var(--text-primary);">${escapeHtml(data.route_code)} · ${escapeHtml(data.route_name)} (${escapeHtml(data.route_type)})</div>
          <div class="route-option-stats">₹${data.fare} · ~${data.duration_min} min · ${distanceText}</div>
        </div>
      </div>
      <div class="route-option-card-expandable-content hidden" id="expand-${cat.key}">
        <div style="text-align: center; padding: 12px; color: var(--text-secondary); font-size: 12px;">⌛ Loading timeline stops...</div>
      </div>
      <div class="route-option-action-row hidden" id="action-row-${cat.key}">
        <button class="btn btn-primary btn-sm btn-book-details" style="margin-top: 6px; padding: 6px 12px; font-size: 12px; font-weight: 700; border-radius: 6px; width: 100%; cursor: pointer;" onclick="event.stopPropagation(); handleBookDetailsClick('${cat.key}')">
          🎟️ Book Details
        </button>
      </div>
    `;
    
    card.addEventListener('click', async () => {
      document.querySelectorAll('.route-option-card').forEach(c => {
        c.classList.remove('selected');
        const exp = c.querySelector('.route-option-card-expandable-content');
        if (exp) exp.classList.add('hidden');
        const act = c.querySelector('.route-option-action-row');
        if (act) act.classList.add('hidden');
      });
      
      card.classList.add('selected');
      
      if (activeTripTab === 'track') {
        const expandContent = document.getElementById(`expand-${cat.key}`);
        if (expandContent) {
          expandContent.classList.remove('hidden');
          await loadStopTimeline(data, expandContent);
        }
      } else {
        const actionRow = document.getElementById(`action-row-${cat.key}`);
        if (actionRow) actionRow.classList.remove('hidden');
        
        const routeOptionsPanel = document.getElementById('route-options-panel');
        if (routeOptionsPanel) routeOptionsPanel.classList.add('collapsed');
        setTimeout(() => { if (map) map.invalidateSize(); }, 300);
        
        await plotRouteOnMap(data);
      }
    });
    
    list.appendChild(card);
  });

  // Render all passing routes (excluding recommended ones)
  if (options.all && options.all.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'route-options-divider';
    divider.style.margin = '16px 0 8px 0';
    divider.style.borderTop = '1px solid #ddd';
    divider.style.paddingTop = '12px';
    divider.innerHTML = '<h4 style="margin:0;font-size:14px;color:var(--text-primary);font-weight:600;">All Passing Routes</h4>';
    list.appendChild(divider);

    options.all.forEach((data, idx) => {
      optionsCount++;
      const card = document.createElement('div');
      card.className = 'route-option-card';
      card.id = `card-all-${idx}`;
      
      let distanceText = `${data.distance_km.toFixed(1)} km`;
      if (data.walking_distance_km !== null) {
        distanceText = `${data.distance_km.toFixed(1)} km (+ ${data.walking_distance_km.toFixed(2)} km walk)`;
      }

      card.innerHTML = `
        <div class="route-option-main">
          <span class="route-option-icon">🚌</span>
          <div class="route-option-details">
            <div class="route-option-code" style="font-weight:600;color:var(--text-primary);">${escapeHtml(data.route_code)} · ${escapeHtml(data.route_name)} (${escapeHtml(data.route_type)})</div>
            <div class="route-option-stats" style="font-size:12px;color:var(--text-secondary);margin-top:2px;">₹${data.fare} · ~${data.duration_min} min · ${distanceText}</div>
          </div>
        </div>
        <div class="route-option-card-expandable-content hidden" id="expand-all-${idx}">
          <div style="text-align: center; padding: 12px; color: var(--text-secondary); font-size: 12px;">⌛ Loading timeline stops...</div>
        </div>
        <div class="route-option-action-row hidden" id="action-row-all-${idx}">
          <button class="btn btn-primary btn-sm btn-book-details" style="margin-top: 6px; padding: 6px 12px; font-size: 12px; font-weight: 700; border-radius: 6px; width: 100%; cursor: pointer;" onclick="event.stopPropagation(); handleBookDetailsClick('all-${idx}')">
            🎟️ Book Details
          </button>
        </div>
      `;

      card.addEventListener('click', async () => {
        document.querySelectorAll('.route-option-card').forEach(c => {
          c.classList.remove('selected');
          const exp = c.querySelector('.route-option-card-expandable-content');
          if (exp) exp.classList.add('hidden');
          const act = c.querySelector('.route-option-action-row');
          if (act) act.classList.add('hidden');
        });

        card.classList.add('selected');
        
        if (activeTripTab === 'track') {
          const expandContent = document.getElementById(`expand-all-${idx}`);
          if (expandContent) {
            expandContent.classList.remove('hidden');
            await loadStopTimeline(data, expandContent);
          }
        } else {
          const actionRow = document.getElementById(`action-row-all-${idx}`);
          if (actionRow) actionRow.classList.remove('hidden');
          
          const routeOptionsPanel = document.getElementById('route-options-panel');
          if (routeOptionsPanel) routeOptionsPanel.classList.add('collapsed');
          setTimeout(() => { if (map) map.invalidateSize(); }, 300);
          
          await plotRouteOnMap(data);
        }
      });

      list.appendChild(card);
    });
  }
  
  if (optionsCount === 0) {
    list.innerHTML = '<div class="suggestion-no-results">No routes found passing through this destination.</div>';
  }
  
  if (panel) panel.classList.remove('hidden');
}

async function plotRouteOnMap(routeData) {
  // 1. Draw route and active buses
  await trackRoute(routeData.route_id);
  
  // 2. Add user location marker
  if (map && userLocationMarker) {
    map.removeLayer(userLocationMarker);
    userLocationMarker = null;
  }
  
  let hasUserLocation = false;
  let userLatLng = null;
  
  try {
    const loc = await getUserLocation();
    userLatLng = [loc.latitude, loc.longitude];
    if (map) {
      userLocationMarker = L.marker(userLatLng, {
        icon: L.divIcon({
          className: 'user-location-marker-container',
          html: `<div class="user-location-marker"></div>`
        })
      }).addTo(map);
    }
    hasUserLocation = true;
  } catch (err) {
    console.warn('Could not locate user on map:', err);
  }
  
  // 3. Highlight boarding and destination stops
  const boardingMarker = stopMarkers[routeData.boarding_stop.id];
  const destinationMarker = stopMarkers[routeData.destination_stop.id];
  
  if (boardingMarker) {
    boardingMarker.setIcon(L.divIcon({
      className: 'stop-marker-highlight boarding-stop-marker-parent',
      html: `<div class="boarding-stop-marker" title="Board here: ${routeData.boarding_stop.name}"></div>`
    }));
    boardingMarker.bindPopup(`<strong>🚏 Boarding Stop</strong><br>${routeData.boarding_stop.name}`);
  }
  
  if (destinationMarker) {
    destinationMarker.setIcon(L.divIcon({
      className: 'stop-marker-highlight destination-stop-marker-parent',
      html: `<div class="destination-stop-marker" title="Destination: ${routeData.destination_stop.name}"></div>`
    }));
    destinationMarker.bindPopup(`<strong>🏁 Destination Stop</strong><br>${routeData.destination_stop.name}`);
  }
  
  // 4. Zoom map to show boarding stop and destination stop
  const bounds = [];
  if (routeData.boarding_stop.latitude && routeData.boarding_stop.longitude) {
    bounds.push([routeData.boarding_stop.latitude, routeData.boarding_stop.longitude]);
  }
  if (routeData.destination_stop.latitude && routeData.destination_stop.longitude) {
    bounds.push([routeData.destination_stop.latitude, routeData.destination_stop.longitude]);
  }
  
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 100);

  // 5. If the details panel is already open, update it with the new route data
  const panel = document.getElementById('bus-info-panel');
  if (panel && !panel.classList.contains('hidden')) {
    showRouteInfoPopup(routeData);
  }
}

function showRouteInfoPopup(routeData) {
  const panel = document.getElementById('bus-info-panel');
  const content = document.getElementById('bus-info-content');
  if (!content) return;
  
  let walkingDistanceText = '';
  if (routeData.walking_distance_km !== null) {
    walkingDistanceText = `<div class="info-row"><span class="info-label">🚶 Walking to Stop</span><span>${routeData.walking_distance_km.toFixed(2)} km</span></div>`;
  }
  
      const isPassenger = currentUser?.role === 'passenger' || currentUser?.role === 'conductor' || currentUser?.role === 'owner';
      const actionButton = isPassenger 
        ? `
        <button class="btn-book-route-option" 
          data-route-id="${routeData.route_id}"
          data-boarding-id="${routeData.boarding_stop.id}"
          data-dest-id="${routeData.destination_stop.id}"
          data-boarding-name="${escapeHtml(routeData.boarding_stop.name)}"
          data-dest-name="${escapeHtml(routeData.destination_stop.name)}"
          onclick="bookFromRouteBtn(this)">
          🎟️ Book Ticket on This Route
        </button>
        `
        : `
        <button class="btn-book-route-option" 
          style="background:var(--success); border:none;" 
          onclick="event.stopPropagation(); document.getElementById('bus-info-panel').classList.add('hidden')">
          ✅ Got it
        </button>
        `;
      
      content.innerHTML = `
        <div class="route-info-detail">
          <h3>🚌 Route ${escapeHtml(routeData.route_code)}</h3>
          <p class="route-info-desc">${escapeHtml(routeData.route_name)} (${routeData.route_type})</p>
          
          <div class="info-row"><span class="info-label">Boarding Stop</span><strong>${escapeHtml(routeData.boarding_stop.name)}</strong></div>
          <div class="info-row"><span class="info-label">Destination Stop</span><strong>${escapeHtml(routeData.destination_stop.name)}</strong></div>
          ${walkingDistanceText}
          <div class="info-row"><span class="info-label">Bus Travel Distance</span><span>${routeData.distance_km.toFixed(1)} km</span></div>
          <div class="info-row"><span class="info-label">Fare Estimate</span><span class="highlight-text">₹${routeData.fare}</span></div>
          <div class="info-row"><span class="info-label">ETA to Destination</span><span class="highlight-text">~${routeData.duration_min} mins</span></div>
          <div class="info-row"><span class="info-label">Live Buses</span><span>${routeData.active_buses} running</span></div>
          
          ${actionButton}
        </div>
      `;
  
  if (panel) panel.classList.remove('hidden');
}

async function selectRouteOption(routeData) {
  await plotRouteOnMap(routeData);
  showRouteInfoPopup(routeData);
}

function handleBookDetailsClick(key) {
  if (!currentRouteOptions) return;
  let data = null;
  if (key.startsWith('all-')) {
    const idx = parseInt(key.split('-')[1]);
    data = currentRouteOptions.all[idx];
  } else {
    data = currentRouteOptions[key];
  }
  if (data) {
    showRouteInfoPopup(data);
  }
}

window.handleBookDetailsClick = handleBookDetailsClick;

function bookFromRoute(routeId, stopId, destStopId, boardingStopName, destStopName) {
  console.log('[bookFromRoute] routeId:', routeId, 'stopId:', stopId, 'destStopId:', destStopId, 'boardingStopName:', boardingStopName, 'destStopName:', destStopName);
  pendingBooking = { routeId, stopId, destStopId, boardingStopName, destStopName };
  showToast('Initializing ticket booking…', 'info');
  navigateTo('book');
}

window.bookFromRoute = bookFromRoute;

function bookFromRouteBtn(btn) {
  const routeId = btn.getAttribute('data-route-id');
  const boardingId = btn.getAttribute('data-boarding-id');
  const destId = btn.getAttribute('data-dest-id');
  const boardingName = btn.getAttribute('data-boarding-name');
  const destName = btn.getAttribute('data-dest-name');
  bookFromRoute(routeId, boardingId, destId, boardingName, destName);
}
window.bookFromRouteBtn = bookFromRouteBtn;

function bookFromStopBtn(btn) {
  const routeId = btn.getAttribute('data-route-id');
  const stopId = btn.getAttribute('data-stop-id');
  const stopName = btn.getAttribute('data-stop-name');
  bookFromStop(routeId, stopId, stopName);
}
window.bookFromStopBtn = bookFromStopBtn;

async function switchTripTab(tab) {
  activeTripTab = tab;
  
  const tabTrack = document.getElementById('tab-track-route');
  const tabMap = document.getElementById('tab-map-view');
  if (tabTrack && tabMap) {
    if (tab === 'track') {
      tabTrack.classList.add('active');
      tabMap.classList.remove('active');
    } else {
      tabMap.classList.add('active');
      tabTrack.classList.remove('active');
    }
  }

  // Toggle map-mode and collapsed classes on route-options-panel
  const routeOptionsPanel = document.getElementById('route-options-panel');
  if (routeOptionsPanel) {
    routeOptionsPanel.classList.remove('collapsed');
    if (tab === 'map') {
      routeOptionsPanel.classList.add('map-mode');
    } else {
      routeOptionsPanel.classList.remove('map-mode');
    }
  }
  
  const cards = document.querySelectorAll('.route-option-card');
  for (let card of cards) {
    const isSelected = card.classList.contains('selected');
    const exp = card.querySelector('.route-option-card-expandable-content');
    const act = card.querySelector('.route-option-action-row');
    
    if (tab === 'track') {
      if (act) act.classList.add('hidden');
      
      if (isSelected && exp) {
        exp.classList.remove('hidden');
        const routeData = getRouteDataFromCard(card);
        if (routeData) {
          await loadStopTimeline(routeData, exp);
        }
      } else {
        if (exp) exp.classList.add('hidden');
      }
    } else {
      if (exp) exp.classList.add('hidden');
      
      if (isSelected) {
        if (act) act.classList.remove('hidden');
        
        // COLLAPSE THE PANEL!
        if (routeOptionsPanel) routeOptionsPanel.classList.add('collapsed');
        
        const routeData = getRouteDataFromCard(card);
        if (routeData) {
          await plotRouteOnMap(routeData);
        }
      } else {
        if (act) act.classList.add('hidden');
      }
    }
  }

  setTimeout(() => { if (map) map.invalidateSize(); }, 300);
}

function getRouteDataFromCard(card) {
  if (!currentRouteOptions) return null;
  const id = card.id;
  if (id.startsWith('card-all-')) {
    const idx = parseInt(id.replace('card-all-', ''));
    return (currentRouteOptions.all && currentRouteOptions.all[idx]) ? currentRouteOptions.all[idx] : null;
  } else {
    const key = id.replace('card-', '');
    return currentRouteOptions[key] || null;
  }
}

window.switchTripTab = switchTripTab;