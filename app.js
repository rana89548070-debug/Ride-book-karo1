import { db, auth } from './firebase.js'; // 👈 auth bhi import kiya
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { 
  RecaptchaVerifier, 
  signInWithPhoneNumber 
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'; // 👈 Firebase Auth SDK

const ADMIN_PHONE = '7830722258';
const ADMIN_PASSWORD = 'Rohit@2001';
const DEFAULT_CENTER = [28.6139, 77.2090];
const ridesRef = collection(db, 'rides');

let map;
let pickupMarker;
let dropMarker;
let routeLine;
let pickupCoords = null;
let dropCoords = null;
let rides = [];
let selectedRideId = null;
let captainProfile = null;
let isAdminLoggedIn = false;
let confirmationResultGlobal = null; // Firebase confirmation token holder
let temporaryRideData = null; // Verification chalte tak data hold karne ke liye

const $ = (id) => document.getElementById(id);
const money = (amount) => `₹${Number(amount || 0).toLocaleString('en-IN')}`;

function showToast(message, type = 'info') {
  const toast = $('toast');
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3600);
}

// GOOGLE RECAPTCHA INITIALIZATION
function initRecaptcha() {
  if (window.recaptchaVerifier) return;
  window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
    'size': 'invisible',
    'callback': (response) => {
      console.log("reCAPTCHA verified successfully.");
    }
  });
}

// SATELLITE VIEW MAP INITIALIZATION
function initMap() {
  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri'
  });

  const streetLabels = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Labels &copy; Esri'
  });

  map = L.map('map', {
    center: DEFAULT_CENTER,
    zoom: 13,
    layers: [satelliteLayer, streetLabels]
  });

  map.on('click', handleMapClick);
}

// REVERSE GEOCODING
async function getLocationName(lat, lng) {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
    const data = await response.json();
    if (data && data.display_name) {
      const parts = data.display_name.split(',');
      return parts.slice(0, 3).join(',').trim();
    }
    return `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  } catch (error) {
    return `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  }
}

async function handleMapClick(e) {
  const { lat, lng } = e.latlng;

  if (!pickupCoords) {
    pickupCoords = [lat, lng];
    pickupMarker = L.marker(pickupCoords).addTo(map).bindPopup('<b>Pickup Point</b>').openPopup();
    $('pickup').value = "Fetching address...";
    const address = await getLocationName(lat, lng);
    $('pickup').value = address;
  } else if (!dropCoords) {
    dropCoords = [lat, lng];
    dropMarker = L.marker(dropCoords).addTo(map).bindPopup('<b>Drop Point</b>').openPopup();
    $('drop').value = "Fetching address...";
    const address = await getLocationName(lat, lng);
    $('drop').value = address;
    
    drawNavigationRoute(pickupCoords, dropCoords);
  }
}

// LIVE OSRM NAVIGATION ROUTE
async function drawNavigationRoute(start, end) {
  if (routeLine) map.removeLayer(routeLine);

  try {
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`);
    const data = await response.json();

    if (data.routes && data.routes.length > 0) {
      const coordinates = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
      routeLine = L.polyline(coordinates, { color: '#38bdf8', weight: 6, opacity: 0.8 }).addTo(map);
      map.fitBounds(routeLine.getBounds());

      const distanceInKm = (data.routes[0].distance / 1000).toFixed(2);
      const calculatedFare = Math.round(30 + (distanceInKm * 10));

      $('distanceText').textContent = `${distanceInKm} km`;
      $('fareText').textContent = `₹${calculatedFare}`;
    }
  } catch (error) {
    routeLine = L.polyline([start, end], { color: '#ef4444', weight: 4, dashArray: '5, 10' }).addTo(map);
    $('distanceText').textContent = "Calculated";
    $('fareText').textContent = "₹50";
  }
}

function resetMapSelection() {
  if (pickupMarker) map.removeLayer(pickupMarker);
  if (dropMarker) map.removeLayer(dropMarker);
  if (routeLine) map.removeLayer(routeLine);
  pickupCoords = null;
  dropCoords = null;
  pickupMarker = null;
  dropMarker = null;
  routeLine = null;
  $('pickup').value = '';
  $('drop').value = '';
  $('distanceText').textContent = '-- km';
  $('fareText').textContent = '₹--';
  map.setView(DEFAULT_CENTER, 12);
}

// TRIGGER FIREBASE REAL SMS OTP ON CLICK
async function createRide(e) {
  e.preventDefault();
  if (!pickupCoords || !dropCoords) {
    showToast('Map par pickup aur drop points select karein!', 'error');
    return;
  }

  const cName = $('name').value;
  const cPhone = $('phone').value.trim().replace(/\D/g, '').slice(-10);

  if (cPhone.length !== 10) {
    alert("❌ Error: Kripya sahi 10-digit mobile number dalein!");
    return;
  }

  // Google Authentication requires international layout (+91 for India)
  const internationalPhone = `+91${cPhone}`;

  // Temporarily store ride details till code authentication succeeds
  temporaryRideData = {
    name: cName,
    phone: cPhone,
    pickup: $('pickup').value,
    drop: $('drop').value,
    pickupLat: pickupCoords[0],
    pickupLng: pickupCoords[1],
    dropLat: docDropLat => pickupCoords[0], // fallback or drop logic mapping
    dropLat: dropCoords[0],
    dropLng: dropCoords[1],
    fare: parseInt($('fareText').textContent.replace('₹', '')) || 40,
    otp: Math.floor(1000 + Math.random() * 9000).toString(), // Dynamic Trip Start OTP for Captain
    status: 'requested',
    payment: $('payment').value,
    note: $('note').value || '',
    createdAt: serverTimestamp()
  };

  try {
    initRecaptcha();
    showToast("Google server se Real SMS bhej rahe hain...", "info");

    // Launch Google Auth Network SMS
    const confirmationResult = await signInWithPhoneNumber(auth, internationalPhone, window.recaptchaVerifier);
    confirmationResultGlobal = confirmationResult;
    
    // Inject custom UI for Verification field
    $('latestRideBox').innerHTML = `
      <div class="active-ride-status" style="border: 2px solid var(--info); padding: 12px; border-radius: 8px;">
        <h3 style="color:var(--info); margin-top:0;">🔐 Verify Your Number</h3>
        <p>Aapke number <b>${internationalPhone}</b> par ek asli Firebase OTP bheja gaya hai.</p>
        <div style="margin: 1rem 0; display:flex; gap:10px;">
          <input type="text" id="customerSmsOtpInput" placeholder="6-Digit OTP" class="form-control" style="text-align:center; font-size:1.1rem; max-width:140px; padding:6px; border:1px solid #ccc; border-radius:4px;">
          <button type="button" class="btn primary" id="verifyCustomerOtpBtn" style="padding: 6px 12px;">Verify & Book</button>
        </div>
        <p class="muted" style="font-size:0.8rem; margin:0;">Google Security Protection Active.</p>
      </div>
    `;

    // Hook verification engine handler
    $('verifyCustomerOtpBtn').addEventListener('click', verifyCustomerSMSAndSubmit);

  } catch (error) {
    console.error("Firebase SMS Error:", error);
    showToast("SMS nahi bheja ja saka: " + error.message, "error");
  }
}

// CONFIRM REAL SMS AND PUSH RECORD TO CLOUD FIRESTORE
async function verifyCustomerSMSAndSubmit() {
  const typedCode = $('customerSmsOtpInput').value.trim();
  if (typedCode.length !== 6) {
    showToast("Kripya 6-digit ka sahi OTP dalein", "error");
    return;
  }

  try {
    showToast("OTP verify ho raha hai...", "info");
    
    // Validate structural cryptographic confirmation token
    await confirmationResultGlobal.confirm(typedCode);
    
    // Success! Record data transaction into collection snapshot
    await addDoc(ridesRef, temporaryRideData);
    
    showToast('Number Verified & Ride Booked!', 'success');

    // Display Active Card holding the Captain Start Trip dynamic token
    $('latestRideBox').innerHTML = `
      <div class="active-ride-status">
        <p class="status-pill clear">Waiting for Captain...</p>
        <h4>Your Trip Start OTP: <span style="color:var(--brand); font-size:1.5rem;">${temporaryRideData.otp}</span></h4>
        <p class="muted">Jab captain aaye toh use yeh ride start karne ke liye bataein.</p>
        <hr style="border:1px solid var(--line); margin: 1rem 0;">
        <p><strong>Route:</strong> ${temporaryRideData.pickup} ➔ ${temporaryRideData.drop}</p>
        <p><strong>Fare Total:</strong> ${money(temporaryRideData.fare)} (${temporaryRideData.payment})</p>
      </div>
    `;
    
    $('rideForm').reset();
    temporaryRideData = null;
    confirmationResultGlobal = null;

  } catch (error) {
    console.error("Authentication check failed:", error);
    alert("❌ Galat OTP! Kripya phone par aaya hua sahi code enter karein.");
  }
}

function subscribeToRides() {
  const q = query(ridesRef, orderBy('createdAt', 'desc'));
  onSnapshot(q, (snapshot) => {
    rides = [];
    snapshot.forEach(doc => rides.push({ id: doc.id, ...doc.data() }));
    
    updateHeroStats();
    renderPendingQueue();
    renderAdminDashboard();
    
    if (captainProfile && selectedRideId) {
      const myRide = rides.find(r => r.id === selectedRideId);
      if (myRide) updateCaptainActivePanel(myRide);
    }
  });
}

function updateHeroStats() {
  const total = rides.length;
  const live = rides.filter(r => r.status === 'requested' || r.status === 'accepted' || r.status === 'started').length;
  if ($('heroTotalRides')) $('heroTotalRides').textContent = total;
  if ($('heroLiveRides')) $('heroLiveRides').textContent = live;
}

function renderPendingQueue() {
  const container = $('pendingRequests');
  const pending = rides.filter(r => r.status === 'requested');

  if (pending.length === 0) {
    container.innerHTML = '<div class="empty-state">Abhi koi live request nahi hai.</div>';
    return;
  }

  container.innerHTML = pending.map(ride => `
    <div class="request-item card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
        <strong>🧑 Customer: ${ride.name}</strong>
        <span class="pill">${money(ride.fare)}</span>
      </div>
      <p style="margin:4px 0;"><span style="color:var(--brand)">📍 From:</span> ${ride.pickup}</p>
      <p style="margin:4px 0;"><span style="color:var(--info)">🏁 To:</span> ${ride.drop}</p>
      <p class="muted" style="font-size:0.85rem;">📞 Mobile: ${ride.phone} | Pay: ${ride.payment}</p>
      ${captainProfile ? `<button class="btn primary full small-btn" style="margin-top:0.8rem;" onclick="globalAcceptRide('${ride.id}')">Accept This Ride</button>` : `<p class="muted">Go online to accept</p>`}
    </div>
  `).join('');
}

window.globalAcceptRide = async function(rideId) {
  if (!captainProfile) return;
  selectedRideId = rideId;
  try {
    await updateDoc(doc(db, 'rides', rideId), {
      status: 'accepted',
      captain: captainProfile
    });
    showToast('Ride accepted! View live route on map.', 'success');
    $('captainRideCard').classList.add('hidden');
    $('activeRideCard').classList.remove('hidden');
  } catch (error) {
    showToast('Action failed: ' + error.message, 'error');
  }
};

function saveCaptain(e) {
  e.preventDefault();
  captainProfile = {
    name: $('captainName').value,
    phone: $('captainPhone').value,
    bikeNumber: $('bikeNumber').value
  };
  $('captainBadge').textContent = "Online";
  $('captainBadge').className = "pill success-pill";
  $('captainForm').classList.add('hidden');
  renderPendingQueue();
}

function updateCaptainActivePanel(ride) {
  if (ride.status === 'accepted') {
    $('activeRideCard').classList.remove('hidden');
    $('captainOtpHint').textContent = "HIDDEN (Ask Rider)"; 
    $('startRideBtn').classList.remove('hidden');
    $('endRideBtn').classList.add('hidden');
    
    drawNavigationRoute([ride.pickupLat, ride.pickupLng], [ride.dropLat, ride.dropLng]);
  } else if (ride.status === 'started') {
    $('activeRideCard').classList.remove('hidden');
    $('captainOtpHint').textContent = "VERIFIED ✔";
    $('startRideBtn').classList.add('hidden');
    $('endRideBtn').classList.remove('hidden');
    $('otpInput').classList.add('hidden');
  } else if (ride.status === 'completed') {
    $('activeRideCard').innerHTML = `
      <div style="text-align:center; padding:1rem;">
        <h3 style="color:var(--success)">🏁 Trip Finished!</h3>
        <p><strong>Collected Amount:</strong> <span style="font-size:1.5rem; color:var(--brand); font-weight:bold;">${money(ride.fare)}</span></p>
        <button class="btn secondary full" onclick="window.location.reload()">Next Duty / Refresh</button>
      </div>
    `;
    resetMapSelection();
  }
}

async function startRide() {
  if (!selectedRideId) return;
  const typedOtp = $('otpInput').value.trim();
  const currentRide = rides.find(r => r.id === selectedRideId);
  
  if (!currentRide) return;

  if (typedOtp === currentRide.otp) {
    try {
      await updateDoc(doc(db, 'rides', selectedRideId), { status: 'started' });
      showToast('OTP Correct! Trip started.', 'success');
    } catch (error) {
      showToast('Error: ' + error.message, 'error');
    }
  } else {
    showToast('Galat OTP! Customer se poochkar sahi dalein.', 'error');
  }
}

async function endRide() {
  if (!selectedRideId) return;
  try {
    await updateDoc(doc(db, 'rides', selectedRideId), { status: 'completed' });
    showToast('Trip ended successfully!', 'success');
  } catch (error) {
    showToast('Error finishing trip: ' + error.message, 'error');
  }
}

function renderAdminDashboard() {
  if (!isAdminLoggedIn) return;
  const tbody = $('ridesTable');
  const completed = rides.filter(r => r.status === 'completed');
  const requested = rides.filter(r => r.status === 'requested');
  const revenue = completed.reduce((acc, r) => acc + (r.fare || 0), 0);
  const comm = Math.round(revenue * 0.10);

  $('totalRides').textContent = rides.length;
  $('requestedRides').textContent = requested.length;
  $('completedRides').textContent = completed.length;
  $('totalRevenue').textContent = `₹${revenue}`;
  $('commission').textContent = `₹${comm}`;

  tbody.innerHTML = rides.map(ride => `
    <tr>
      <td>${ride.id.substring(0, 5)}</td>
      <td>${ride.name}<br><small>${ride.phone}</small></td>
      <td>${ride.captain?.name || '--'}</td>
      <td>${ride.pickup.substring(0,20)}... ➔ ${ride.drop.substring(0,20)}...</td>
      <td>${money(ride.fare)}</td>
      <td><span class="status-label ${ride.status}">${ride.status}</span></td>
      <td><button class="mini-btn" onclick="globalDeleteRide('${ride.id}')">Delete</button></td>
    </tr>
  `).join('');
}

window.globalDeleteRide = async function(id) {
  if (!isAdminLoggedIn) return;
  if(confirm("Delete record?")) {
    await deleteDoc(doc(db, 'rides', id));
  }
}

function handleAdminLogin(e) {
  e.preventDefault();
  if ($('adminPhone').value === ADMIN_PHONE && $('adminPassword').value === ADMIN_PASSWORD) {
    isAdminLoggedIn = true;
    $('adminLoginForm').classList.add('hidden');
    $('adminDashboard').classList.remove('hidden');
    renderAdminDashboard();
  } else {
    showToast('Invalid Credentials!', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  subscribeToRides();
  $('rideForm').addEventListener('submit', createRide);
  $('resetMapBtn').addEventListener('click', resetMapSelection);
  $('captainForm').addEventListener('submit', saveCaptain);
  $('startRideBtn').addEventListener('click', startRide);
  $('endRideBtn').addEventListener('click', endRide);
  $('adminLoginForm').addEventListener('submit', handleAdminLogin);
});
